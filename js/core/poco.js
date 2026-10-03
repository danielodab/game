// O Poço sem Fundo — a torre infinita (dono: lógica).
var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

/* O QUE ISTO É
 * ============
 * O endgame que faltava (pacote 25/08, desenho batido com o usuário: "os
 * monstros que já existem se misturando e ficando mais forte"). O Poço é um
 * CALABOUÇO SINTÉTICO ('poco') empurrado em DATA.dungeons: cada andar
 * EMPRESTA o palco de uma sala real (layout, clima, cenário — tudo já
 * validado e bonito) e troca o elenco por uma MISTURA de monstros de todos
 * os calabouços. A cada 5 andares, um chefe entra na sala.
 *
 * A ESCALADA SEM CLONES: os ids dos monstros são os REAIS (a arte 3D segue
 * o defId; um clone ficaria invisível). Quem cresce é o ESTADO da batalha:
 * Game chama escalaEstado e os inimigos ganham +10% de PV por andar. O dano
 * deles mora nos feitiços e fica fixo por enquanto — briga mais longa =
 * mais dano tomado = mais fundo é mais difícil, sem cirurgia em feitiço.
 * O XP paga na mesma moeda (o fator multiplica na recompensa).
 *
 * O RECORDE é SEMANAL (placar de andares) + o histórico da conta —
 * DB.pocoAnota guarda; o resumo da Rede espalha; o perfil mostra.
 * Sem saque de peças no Poço (rollDrops não conhece 'poco' e o game já
 * engole isso): ele paga em XP, pedras dos monstros e VAIDADE.
 *
 * 02/10 — O CHÃO E OS GIGANTES (o dono: armadilhas aleatórias "no Poço" em vez
 * do mapa dos elementos, e "monstros MAIORES para o Poço, somados aos dos
 * calabouços"). Cada andar ganha PERIGOS sorteados pela MESMA semente do andar
 * (o juiz refaz a sala da semente: sai idêntico), e o andar múltiplo de 5 chama
 * UM Colosso. A regra dos dois mora aqui em baixo, em `Po.regras`, e o motor
 * só a chama (engine.js, `Pg()`): quem monta um andar do Poço tem este arquivo.
 */
(function () {
  'use strict';

  var Po = {};
  JOGO.Poco = Po;

  Po.ID = 'poco';
  Po.FATOR_POR_ANDAR = 0.10;
  Po.CHEFE_A_CADA = 5;
  Po.EPOCA = Date.UTC(2026, 7, 24);            // a mesma época da Brasa

  Po.semanaDe = function (ts) {
    ts = (typeof ts === 'number' && isFinite(ts)) ? ts : Date.now();
    return 1 + Math.max(0, Math.floor((ts - Po.EPOCA) / (86400000 * 7)));
  };
  Po.fator = function (andar) {
    return 1 + Po.FATOR_POR_ANDAR * (Math.max(1, andar) - 1);
  };

  /* OS COLOSSOS (02/10): um por andar múltiplo de 5, girando nesta ordem — o
   * 5 é de fogo, o 10 de água, o 15 de terra, o 20 de ar, o 25 de fogo outra
   * vez. Os ids são os de js/core/data/monsters.js e os da arte (não renomear). */
  Po.COLOSSOS = ['colosso_fogo', 'colosso_agua', 'colosso_terra', 'colosso_ar'];
  Po.colossoDoAndar = function (andar) {
    if (!(andar >= Po.CHEFE_A_CADA) || andar % Po.CHEFE_A_CADA) return null;
    return Po.COLOSSOS[(andar / Po.CHEFE_A_CADA - 1) % Po.COLOSSOS.length];
  };

  function D() { return JOGO.DATA || {}; }

  function dungeonPoco() {
    var ds = D().dungeons || [];
    for (var i = 0; i < ds.length; i++) if (ds[i] && ds[i].id === Po.ID) return ds[i];
    var novo = { id: Po.ID, name: 'O Poço sem Fundo',
                 description: 'Ninguém cavou. Ele já estava lá.',
                 rooms: [] };
    ds.push(novo);
    return novo;
  }

  /* os palcos: toda sala real de todo calabouço (menos o próprio poço) */
  function salasReais() {
    var fora = [];
    (D().dungeons || []).forEach(function (dg) {
      if (!dg || dg.id === Po.ID) return;
      // 08/09: calabouço de portal FECHADO não empresta palco ao Poço
      if (D().portalFechado && D().portalFechado(dg.id)) return;
      (dg.rooms || []).forEach(function (r) {
        if (r && r.layout && r.monsters) fora.push(r);
      });
    });
    return fora;
  }

  /* O elenco vem do formato NORMALIZADO (o rodapé de monsters.js põe os
   * números em `.stats`); `summonOnly` fica de fora — filhote de invocação
   * não abre sala sozinho. 02/10: o COLOSSO também fica de fora — ele tem
   * vaga própria no andar múltiplo de 5; no sorteio comum ele apareceria no
   * andar 1, em qualquer letra, quantas vezes a letra se repetisse. */
  function elenco(soChefes) {
    var ms = D().monsters || {};
    var fora = [];
    Object.keys(ms).forEach(function (id) {
      var m = ms[id];
      if (!m || !m.stats || typeof m.stats.hp !== 'number') return;
      if (m.summonOnly || m.colosso) return;
      // 08/09: monstro de calabouço fechado (sem arte) fica fora do elenco
      if (m.dungeonId && D().portalFechado && D().portalFechado(m.dungeonId)) return;
      if (soChefes ? !m.boss : !!m.boss) return;
      fora.push(id);
    });
    return fora;
  }
  Po.elenco = elenco;

  function sorteia(lista, rnd) { return lista[Math.floor(rnd() * lista.length)]; }

  /* O ANDAR SEMEADO (13/09, a segurança): com sessão do site o servidor refaz a
   * sala para pagar — então o andar do Poço sai de um gerador semeado pela
   * semente do BILHETE, e o mesmo andar com a mesma semente é a mesma sala nos
   * dois lados. O mulberry32 é o mesmo das missões; a semente é FNV do texto. */
  function gerador(txt) {
    var h = 2166136261 >>> 0, s = String(txt);
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    var a = h >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ------------------------------------------------------------ a grade do palco
  function ehChao(ch) { return ch !== '#' && ch !== '=' && ch !== '~' && ch !== undefined && ch !== null && ch !== ''; }
  function ehLetra(ch) { return ch >= 'a' && ch <= 'z'; }
  var DIRS = [[0, -1], [0, 1], [-1, 0], [1, 0]];
  var DIR_PLACA = { n: [0, -1], s: [0, 1], o: [-1, 0], l: [1, 0] };
  var ORDEM_DIR = ['n', 'l', 's', 'o'];

  /* Uma letra que o palco não usa: o chefe e o colosso ganham casa PRÓPRIA. */
  function letraLivre(grade) {
    var usadas = {};
    grade.forEach(function (row) { row.forEach(function (ch) { usadas[ch] = true; }); });
    var cand = 'zyxwvutsrqponmlkjihgfedcba';
    for (var i = 0; i < cand.length; i++) if (!usadas[cand.charAt(i)]) return cand.charAt(i);
    return null;
  }

  function geraSala(andar, rnd) {
    rnd = rnd || Math.random;
    var palcos = salasReais();
    var comuns = elenco(false);
    var chefes = elenco(true);
    if (!palcos.length || !comuns.length) return null;
    var palco = palcos[Math.floor(rnd() * palcos.length)];
    var grade = palco.layout.map(function (row) { return row.split(''); });
    var letras = Object.keys(palco.monsters || {});
    var mistura = {};
    letras.forEach(function (le) { mistura[le] = sorteia(comuns, rnd); });

    /* UM CHEFE, NÃO UMA LETRA DE CHEFES (02/10). Antes o chefe tomava uma LETRA
     * do palco, e a letra se repete: no Fecho de Brasa 3 a letra 'c' tem cinco
     * casas — o "um chefe a cada 5 andares" saía com dois a cinco chefes na
     * mesma sala. Agora ele toma UMA casa de monstro, com letra própria, e o
     * colosso toma outra: os dois somam ao andar no lugar de um comum cada. */
    var casas = [];
    grade.forEach(function (row, y) {
      row.forEach(function (ch, x) { if (ehLetra(ch) && mistura[ch]) casas.push({ x: x, y: y }); });
    });
    var chefe = null, colosso = null;
    if (andar % Po.CHEFE_A_CADA === 0 && chefes.length && casas.length) {
      var ic = Math.floor(rnd() * casas.length);
      var c1 = casas.splice(ic, 1)[0];
      var l1 = letraLivre(grade);
      if (l1) { grade[c1.y][c1.x] = l1; chefe = sorteia(chefes, rnd); mistura[l1] = chefe; }
    }
    var idColosso = Po.colossoDoAndar(andar);
    if (idColosso && (D().monsters || {})[idColosso] && casas.length) {
      var c2 = casas.splice(Math.floor(rnd() * casas.length), 1)[0];
      var l2 = letraLivre(grade);
      if (l2) { grade[c2.y][c2.x] = l2; colosso = idColosso; mistura[l2] = idColosso; }
    }
    // a letra que perdeu a última casa sai da lista (o pacote baixaria o corpo dela à toa)
    var vivas = {};
    grade.forEach(function (row) { row.forEach(function (ch) { vivas[ch] = true; }); });
    Object.keys(mistura).forEach(function (le) { if (!vivas[le]) delete mistura[le]; });

    return {
      name: 'Andar ' + andar + ' — ' + (palco.name || 'o fundo'),
      weather: palco.weather,
      sceneryTheme: palco.sceneryTheme,
      layout: grade.map(function (row) { return row.join(''); }),   // o palco, com o chefe e o colosso na casa deles
      monsters: mistura,
      colosso: colosso,
      perigos: geraPerigos(andar, grade, rnd)
    };
  }

  // ================================================================ OS PERIGOS
  /* OS PERIGOS DO CHÃO (02/10). Quatro tipos, todos À VISTA desde o começo da
   * sala e todos AVISADOS antes de ferir — o Poço é difícil pela escolha, não
   * pela surpresa:
   *
   *   placa    PLACA DE SETAS. Quem pisa (herói ou monstro) a arma, e a linha
   *            dela (até 5 casas numa direção, até o primeiro obstáculo) fica
   *            marcada no chão; as setas voam no começo da SEGUNDA rodada
   *            depois — todo mundo tem uma vez inteira para sair. A placa em
   *            si não está na linha: quem armou e ficou em cima não leva.
   *   rachado  CHÃO RACHADO. Desaba no começo da rodada `desaba` (3 a 5),
   *            avisado no começo da rodada anterior; vira buraco para sempre, e
   *            quem estiver em cima cai, se fere e sobe na casa livre mais
   *            perto. Só nasce onde o buraco NÃO separa o mapa.
   *   jato     JATO ELEMENTAL. Um respiro que cospe o elemento dele na própria
   *            casa e nas quatro vizinhas a cada 3 rodadas (a partir da 3ª),
   *            avisado no começo da rodada anterior. A resistência conta.
   *   runa     RUNA DE EXAUSTÃO. Prende o passo de quem pisa e tira 2 PP.
   *            Não fere — o aviso dela é ela mesma.
   *
   * Nenhum pega a ZONA DE ENTRADA (o chão a até 3 casas de um P — a mesma
   * régua da escolha da posição, engine.js zonaDoJogador) nem nasce em casa de
   * monstro; dois perigos não dividem casa. Quantos: 1 no andar 1 e mais um a
   * cada 3 andares, até 7. Os tipos abrem com a profundidade (placa e runa
   * desde o 1, jato do 2, rachado do 3). O dano é FRAÇÃO da vida máxima da
   * vítima — o Poço recebe herói de qualquer nível, e um número fixo seria
   * cócega no 30 e morte no 5; chefe e colosso levam metade. */
  Po.ZONA_ENTRADA = 3;              // = zonaDoJogador (engine.js): "a até 3 passos de qualquer P"
  Po.PERIGOS_MAX = 7;
  Po.PLACA_ALCANCE = 5;
  Po.PLACA_ATRASO = 2;              // a placa armada na rodada R dispara no começo da R+2
  Po.JATO_PERIODO = 3;
  Po.JATO_PRIMEIRA = 3;             // a rodada 1 não tem começo (a colocação a abre): o 1º aviso cai na 2
  Po.RACHADO_DESABA = [3, 5];       // a rodada em que desaba, sorteada nesta faixa
  Po.RUNA_PP = 2;
  Po.DANO = { placa: 0.12, jato: 0.15, rachado: 0.10 };   // fração da vida máxima
  Po.DANO_GRANDE = 0.5;             // chefe e colosso levam metade
  Po.TIPOS = {
    placa:   { desde: 1, peso: 3, nome: 'placa de setas' },
    runa:    { desde: 1, peso: 2, nome: 'runa de exaustão' },
    jato:    { desde: 2, peso: 3, nome: 'jato' },
    rachado: { desde: 3, peso: 2, nome: 'chão rachado' }
  };
  var ELEMENTOS_JATO = ['fogo', 'agua', 'terra', 'ar'];

  Po.perigosNoAndar = function (andar) {
    return Math.min(Po.PERIGOS_MAX, 1 + Math.floor(Math.max(1, andar) / 3));
  };

  /* As casas que um perigo ocupa ou alcança, lidas da GRADE (a mesma conta no
   * gerador e no motor — o motor relê do estado, com o chão de agora). */
  function linhaDaPlaca(chao, x, y, dir) {
    var d = DIR_PLACA[dir], out = [];
    if (!d) return out;
    for (var k = 1; k <= Po.PLACA_ALCANCE; k++) {
      var nx = x + d[0] * k, ny = y + d[1] * k;
      if (!chao(nx, ny)) break;
      out.push({ x: nx, y: ny });
    }
    return out;
  }
  function areaDoJato(chao, x, y) {
    var out = [{ x: x, y: y }];
    for (var i = 0; i < DIRS.length; i++) {
      var nx = x + DIRS[i][0], ny = y + DIRS[i][1];
      if (chao(nx, ny)) out.push({ x: nx, y: ny });
    }
    return out;
  }

  function geraPerigos(andar, grade, rnd) {
    var h = grade.length, w = h ? grade[0].length : 0;
    function ch(x, y) { return (x >= 0 && y >= 0 && y < h && x < w) ? grade[y][x] : null; }
    function chao(x, y) { return ehChao(ch(x, y)); }
    var ps = [], i, x, y;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) if (grade[y][x] === 'P') ps.push({ x: x, y: y });
    if (!ps.length) return [];
    function naEntrada(cx, cy) {
      for (var k = 0; k < ps.length; k++) if (Math.abs(ps[k].x - cx) + Math.abs(ps[k].y - cy) <= Po.ZONA_ENTRADA) return true;
      return false;
    }
    // candidatas: chão comum, fora da entrada e fora das casas de monstro
    var cand = [];
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        var c = grade[y][x];
        if (!ehChao(c) || c === 'P' || ehLetra(c) || naEntrada(x, y)) continue;
        cand.push({ x: x, y: y });
      }
    }
    var usado = {};
    function livre(lista) {
      for (var k = 0; k < lista.length; k++) {
        var q = lista[k];
        if (usado[q.x + ',' + q.y] || naEntrada(q.x, q.y)) return false;
      }
      return true;
    }
    function marca(lista) { lista.forEach(function (q) { usado[q.x + ',' + q.y] = true; }); }
    // o mapa continua inteiro sem as casas rachadas? (todo chão alcançável do
    // primeiro P segue alcançável, menos as próprias rachadas)
    var rachadas = {};
    var alcanceBase = alcance({});
    function alcance(sem) {
      var vis = {}, fila = [ps[0]], n = 0;
      vis[ps[0].x + ',' + ps[0].y] = true;
      while (fila.length) {
        var cu = fila.shift(); n++;
        for (var k = 0; k < DIRS.length; k++) {
          var nx = cu.x + DIRS[k][0], ny = cu.y + DIRS[k][1], key = nx + ',' + ny;
          if (vis[key] || sem[key] || !chao(nx, ny)) continue;
          vis[key] = true;
          fila.push({ x: nx, y: ny });
        }
      }
      return n;
    }
    function naoSepara(cx, cy) {
      var sem = {}, nSem = 0;
      for (var k in rachadas) if (Object.prototype.hasOwnProperty.call(rachadas, k)) { sem[k] = true; nSem++; }
      sem[cx + ',' + cy] = true; nSem++;
      return alcance(sem) === alcanceBase - nSem;
    }

    var abertos = Object.keys(Po.TIPOS).filter(function (t) { return andar >= Po.TIPOS[t].desde; });
    var total = Po.perigosNoAndar(andar), fora = [];
    for (var n = 0; n < total && cand.length; n++) {
      var soma = 0;
      abertos.forEach(function (t) { soma += Po.TIPOS[t].peso; });
      var r = rnd() * soma, tipo = abertos[abertos.length - 1];
      for (i = 0; i < abertos.length; i++) { r -= Po.TIPOS[abertos[i]].peso; if (r < 0) { tipo = abertos[i]; break; } }
      for (var tenta = 0; tenta < 40; tenta++) {
        var cel = cand[Math.floor(rnd() * cand.length)];
        if (usado[cel.x + ',' + cel.y]) continue;
        var p = null, pegada = null;
        if (tipo === 'placa') {
          var d0 = Math.floor(rnd() * 4);
          for (var dd = 0; dd < 4 && !p; dd++) {
            var dir = ORDEM_DIR[(d0 + dd) % 4];
            var lin = linhaDaPlaca(chao, cel.x, cel.y, dir);
            if (lin.length < 3) continue;
            var peg = [cel].concat(lin);
            if (!livre(peg)) continue;
            p = { tipo: 'placa', x: cel.x, y: cel.y, dir: dir };
            pegada = peg;
          }
        } else if (tipo === 'jato') {
          var area = areaDoJato(chao, cel.x, cel.y);
          if (area.length >= 3 && livre(area)) {
            p = { tipo: 'jato', x: cel.x, y: cel.y, elemento: sorteia(ELEMENTOS_JATO, rnd),
                  periodo: Po.JATO_PERIODO, fase: Math.floor(rnd() * Po.JATO_PERIODO) };
            pegada = area;
          }
        } else if (tipo === 'rachado') {
          if (livre([cel]) && naoSepara(cel.x, cel.y)) {
            var faixa = Po.RACHADO_DESABA;
            p = { tipo: 'rachado', x: cel.x, y: cel.y,
                  desaba: faixa[0] + Math.floor(rnd() * (faixa[1] - faixa[0] + 1)) };
            pegada = [cel];
            rachadas[cel.x + ',' + cel.y] = true;
          }
        } else if (livre([cel])) {
          p = { tipo: 'runa', x: cel.x, y: cel.y };
          pegada = [cel];
        }
        if (p) { marca(pegada); fora.push(p); break; }
      }
    }
    return fora;
  }

  /* Garante chão: o poço existe e tem salas até o andar `n` — Game chama
   * antes de descer (a sala seguinte SEMPRE já existe quando o botão vem). */
  Po.preparar = function (n) {
    var dg = dungeonPoco();
    while (dg.rooms.length < n) {
      var sala = geraSala(dg.rooms.length + 1);
      if (!sala) return false;
      dg.rooms.push(sala);
    }
    return true;
  };

  /* o andar `andar` feito da semente do bilhete (a mesma sala nos dois lados) */
  Po.salaSemeada = function (andar, semente) {
    return geraSala(andar, gerador('poco:' + andar + ':' + (semente >>> 0)));
  };
  /* põe a sala no lugar do andar (o poço cresce até ele, se precisar) */
  Po.poeSala = function (andar, sala) {
    if (!sala || !(andar >= 1)) return false;
    if (!Po.preparar(andar)) return false;
    dungeonPoco().rooms[andar - 1] = sala;
    return true;
  };

  /* A escalada aplicada no ESTADO (ids reais, arte intacta): inimigos ganham
   * PV — e nada além de PV, por enquanto. O colosso sobe junto, pela mesma
   * conta: "escala com o andar igual ao resto do Poço". */
  Po.escalaEstado = function (state, andar) {
    if (!state || !state.units) return 0;
    var fator = Po.fator(andar), n = 0;
    state.units.forEach(function (u) {
      if (u.side !== 'enemy') return;
      u.hpMax = Math.round(u.hpMax * fator);
      u.hp = u.hpMax;
      n++;
    });
    return n;
  };

  // ================================================================ A REGRA
  /* Po.regras — o que o motor chama (engine.js, sempre por `Pg()` e só com
   * `state.perigos` presente). `I` é o INTERNO do motor: dano, empurrão, cura,
   * grade. Nada aqui sorteia: o chão do Poço não gasta o rng da sala, então o
   * mesmo andar com os mesmos lances dá o mesmo fim no cliente e no juiz. */
  var R = {};
  Po.regras = R;

  function E() { return JOGO.Engine; }
  function noChao(state, I) { return function (x, y) { return I.isFloor(state, x, y); }; }
  function vivos(state) {
    return state.units.filter(function (u) { return u.alive && !u.offBoard; });
  }
  function quemEsta(state, x, y) { return E().unitAt(state, x, y); }
  function nomeDoTipo(p) {
    if (p.tipo === 'jato') return 'jato de ' + nomeEl(p.elemento);
    return (Po.TIPOS[p.tipo] && Po.TIPOS[p.tipo].nome) || p.tipo;
  }
  var NOME_EL = { fogo: 'fogo', agua: 'água', terra: 'terra', ar: 'ar' };
  function nomeEl(el) { return NOME_EL[el] || el || 'neutro'; }
  function copiaCasas(l) { return l.map(function (c) { return { x: c.x, y: c.y }; }); }

  /* MONTAR: o chão do andar entra no estado (cópia — a sala do Poço é dado e
   * não pode guardar placa armada de uma luta para a outra) e a couraça do
   * Colosso de Rocha nasce cheia. */
  R.monta = function (state, room, I) {
    var chao = noChao(state, I);
    state.perigos = [];
    (room.perigos || []).forEach(function (d, i) {
      var p = { id: 'p' + i, tipo: d.tipo, x: d.x, y: d.y, aviso: 0 };
      if (d.tipo === 'placa') { p.dir = d.dir; p.casas = linhaDaPlaca(chao, d.x, d.y, d.dir); p.armada = false; }
      else if (d.tipo === 'jato') {
        p.elemento = d.elemento; p.periodo = d.periodo || Po.JATO_PERIODO; p.fase = d.fase || 0;
        p.casas = areaDoJato(chao, d.x, d.y);
      } else if (d.tipo === 'rachado') { p.desaba = d.desaba; p.caiu = false; p.casas = [{ x: d.x, y: d.y }]; }
      else if (d.tipo === 'runa') { p.pp = Po.RUNA_PP; }
      else return;                                    // tipo que esta versão não conhece: não entra
      state.perigos.push(p);
    });
    state.units.forEach(function (u) {
      var k = I.getTrait(u, 'couraca');
      if (k) u.couraca = k.pontos;
    });
    if (state.perigos.length) {
      var cont = {}, ordem = [];
      state.perigos.forEach(function (p) {
        var nome = nomeDoTipo(p);
        if (!cont[nome]) { cont[nome] = 0; ordem.push(nome); }
        cont[nome]++;
      });
      E().log('O chão deste andar: ' + ordem.map(function (nm) { return cont[nm] + '× ' + nm; }).join(', ') + '.');
    }
  };

  function porCasa(state, x, y, tipo) {
    var ps = state.perigos || [];
    for (var i = 0; i < ps.length; i++) if (ps[i].x === x && ps[i].y === y && (!tipo || ps[i].tipo === tipo)) return ps[i];
    return null;
  }
  R.porCasa = function (state, x, y, tipo) { return porCasa(state, x, y, tipo); };

  /* O PASSO QUE CUSTA (o desempate da busca de caminho no motor): a placa
   * desarmada, a runa e a armadilha do outro lado que quem anda enxerga. */
  R.mapaPasso = function (state, mover) {
    var m = {}, ps = state.perigos || [];
    for (var i = 0; i < ps.length; i++) {
      var p = ps[i];
      if ((p.tipo === 'placa' && !p.armada) || p.tipo === 'runa') m[p.x + ',' + p.y] = 1;
    }
    if (mover) {
      var tr = state.traps || [];
      for (var j = 0; j < tr.length; j++) {
        if (tr[j].side !== mover.side && E().armadilhaVisivel(state, mover.side, tr[j])) m[tr[j].x + ',' + tr[j].y] = 1;
      }
    }
    return m;
  };

  R.prendePasso = function (state, u, x, y) { return !!porCasa(state, x, y, 'runa'); };

  /* PISAR (cada casa do caminho, na ordem): a placa arma, a runa cobra. */
  R.aoPisar = function (state, u, x, y, I) {
    var p = porCasa(state, x, y);
    if (!p) return;
    if (p.tipo === 'placa' && !p.armada) {
      p.armada = true;
      p.aviso = state.round + Po.PLACA_ATRASO;
      I.emit({ type: 'perigoAviso', id: p.id, tipo: 'placa', x: p.x, y: p.y, casas: copiaCasas(p.casas),
               rodada: p.aviso, armadaPor: u.uid });
      E().log(u.name + ' pisa numa placa: setas na linha marcada no começo da rodada ' + p.aviso + '!');
    } else if (p.tipo === 'runa') {
      var antes = u.pp;
      u.pp = Math.max(0, u.pp - (p.pp || Po.RUNA_PP));
      I.emit({ type: 'perigoRuna', id: p.id, uid: u.uid, x: x, y: y, pp: antes - u.pp });
      E().log('A runa prende o passo de ' + u.name + (antes > u.pp ? ' e leva ' + (antes - u.pp) + ' PP.' : '.'), u.uid);
    }
  };

  /* ANDAR (depois do caminho todo): o rastro do Colosso de Brasa e a marca
   * de que o Colosso da Maré saiu do lugar neste turno. */
  R.aoAndar = function (state, u, deX, deY, path, I) {
    var t = I.getTrait(u, 'rastroBrasa');
    if (t) {
      var casas = [{ x: deX, y: deY }].concat(path.slice(0, path.length - 1)), n = 0;
      for (var i = 0; i < casas.length; i++) {
        var c = casas[i];
        if (!I.isFloor(state, c.x, c.y) || E().trapsAt(state, c.x, c.y).length) continue;
        // o MESMO formato da armadilha do Xamã: o motor a dispara, a tela a desenha
        state.traps.push({ x: c.x, y: c.y, trapId: t.spellId, ownerUid: u.uid, side: u.side,
                           remaining: t.duration || 2 });
        I.emit({ type: 'trapSet', uid: u.uid, trapId: t.spellId, x: c.x, y: c.y, side: u.side });
        n++;
      }
      if (n) E().log('O chão arde por onde ' + u.name + ' passou.');
    }
    if (I.getTrait(u, 'mare')) u._andou = true;
  };

  /* O FIM DO TURNO do Colosso da Maré: parado em cima de poça, se refaz; e
   * onde ele termina nasce (ou se renova) uma poça. Parado = não andou neste
   * turno; o empurrão não conta como andar, mas tira da poça — é a resposta. */
  R.fimTurno = function (state, u, I) {
    var t = I.getTrait(u, 'mare');
    if (!t || !u.alive || u.offBoard) { if (u) delete u._andou; return; }
    var parado = !u._andou;
    delete u._andou;
    var poca = porCasa(state, u.x, u.y, 'poca');
    if (parado && poca && u.hp < u.hpMax) {
      var cura = I.cura(state, u, Math.max(1, Math.round(u.hpMax * t.cura)));
      if (cura > 0) E().log(u.name + ' se refaz parado na poça (+' + cura + ').', u.uid);
    }
    var ate = state.round + (t.duration || 3);
    if (poca) poca.ate = Math.max(poca.ate, ate);
    else if (I.isFloor(state, u.x, u.y)) {
      var nova = { id: 'q' + u.x + '_' + u.y, tipo: 'poca', x: u.x, y: u.y, ate: ate, aviso: 0 };
      state.perigos.push(nova);
      I.emit({ type: 'perigoNasce', id: nova.id, tipo: 'poca', x: u.x, y: u.y });
    }
  };

  function danoDoPerigo(u, frac, el) {
    var amt = u.hpMax * frac;
    if (el) amt = amt * (100 - E().effResist(u, el)) / 100;
    if (u.boss || (u.defId && ((JOGO.DATA || {}).monsters || {})[u.defId] && JOGO.DATA.monsters[u.defId].colosso)) amt *= Po.DANO_GRANDE;
    return Math.max(1, Math.round(amt));
  }
  function fereCasas(state, p, frac, el, I) {
    var atingidos = [];
    p.casas.forEach(function (c) {
      var u = quemEsta(state, c.x, c.y);
      if (u && u.alive && !u.offBoard) atingidos.push(u);
    });
    I.emit({ type: 'perigoDispara', id: p.id, tipo: p.tipo, x: p.x, y: p.y, casas: copiaCasas(p.casas),
             elemento: el || 'neutro', atingidos: atingidos.map(function (u) { return u.uid; }) });
    for (var i = 0; i < atingidos.length && state.phase === 'playing'; i++) {
      var u = atingidos[i];
      if (!u.alive) continue;
      I.dano(state, u, danoDoPerigo(u, frac, el), el || 'neutro', null);
    }
    return atingidos.length;
  }

  /* O CHÃO QUE CAI: vira buraco; quem estava em cima se fere e sobe na casa
   * livre mais perto (busca em largura, na ordem fixa das direções). A
   * armadilha, o evento e a poça da casa caem junto. */
  function desaba(state, p, I) {
    var tile = I.tileAt(state, p.x, p.y);
    if (!tile || tile.type !== 'floor') { p.caiu = true; p.aviso = 0; return; }
    var u = quemEsta(state, p.x, p.y), destino = null;
    if (u) {
      var vis = {}, fila = [{ x: p.x, y: p.y }];
      vis[p.x + ',' + p.y] = true;
      while (fila.length && !destino) {
        var cu = fila.shift();
        for (var k = 0; k < DIRS.length; k++) {
          var nx = cu.x + DIRS[k][0], ny = cu.y + DIRS[k][1], key = nx + ',' + ny;
          if (vis[key] || !I.isFloor(state, nx, ny)) continue;
          vis[key] = true;
          if (!quemEsta(state, nx, ny)) { destino = { x: nx, y: ny }; break; }
          fila.push({ x: nx, y: ny });
        }
      }
      if (!destino) { p.aviso = 0; return; }          // sem chão livre no mapa: o rachado aguenta
    }
    // `desabou`: só para o desenho (renderer3d_v2 tileKind) — a regra lê o tipo
    tile.type = 'hole'; tile.deco = false; tile.desabou = true;
    p.caiu = true; p.aviso = 0;
    state.traps = state.traps.filter(function (t) { return t.x !== p.x || t.y !== p.y; });
    state.tileEventsActive = state.tileEventsActive.filter(function (t) { return t.x !== p.x || t.y !== p.y; });
    state.perigos = state.perigos.filter(function (q) { return q.tipo !== 'poca' || q.x !== p.x || q.y !== p.y; });
    I.emit({ type: 'perigoDispara', id: p.id, tipo: 'rachado', x: p.x, y: p.y, casas: [{ x: p.x, y: p.y }],
             elemento: 'neutro', atingidos: u ? [u.uid] : [] });
    E().log('O chão rachado desaba e vira buraco.');
    if (u) {
      var fx = u.x, fy = u.y;
      u.x = destino.x; u.y = destino.y;
      I.emit({ type: 'pushed', uid: u.uid, fromX: fx, fromY: fy, toX: u.x, toY: u.y, collision: 0, queda: true });
      E().log(u.name + ' cai no buraco e sobe na beira.', u.uid);
      I.dano(state, u, danoDoPerigo(u, Po.DANO.rachado, null), 'neutro', null);
    }
  }

  /* O COMEÇO DA RODADA: a poça seca, o que foi avisado para ESTA rodada
   * dispara, e o que vem na próxima é avisado agora — antes de qualquer um
   * agir, então todo mundo tem a vez inteira desta rodada para sair. */
  R.inicioRodada = function (state, I) {
    var r = state.round, i, p;
    for (i = state.perigos.length - 1; i >= 0; i--) {
      p = state.perigos[i];
      if (p.tipo === 'poca' && p.ate <= r) {
        state.perigos.splice(i, 1);
        I.emit({ type: 'perigoSome', id: p.id, tipo: 'poca', x: p.x, y: p.y });
      }
    }
    var lista = state.perigos.slice();
    for (i = 0; i < lista.length && state.phase === 'playing'; i++) {
      p = lista[i];
      if (!p.aviso || p.aviso !== r) continue;
      if (p.tipo === 'placa') {
        p.armada = false; p.aviso = 0;
        var n = fereCasas(state, p, Po.DANO.placa, null, I);
        E().log('As setas da placa varrem a linha' + (n ? '!' : ' vazia.'));
      } else if (p.tipo === 'jato') {
        p.aviso = 0;
        var nj = fereCasas(state, p, Po.DANO.jato, p.elemento, I);
        E().log('O jato de ' + nomeEl(p.elemento) + ' irrompe do chão' + (nj ? '!' : '.'));
      } else if (p.tipo === 'rachado' && !p.caiu) {
        desaba(state, p, I);
      }
    }
    if (state.phase !== 'playing') return;
    var prox = r + 1;
    state.perigos.forEach(function (q) {
      if (q.aviso) return;
      var vem = (q.tipo === 'jato' && prox >= Po.JATO_PRIMEIRA && (prox - q.fase) % q.periodo === 0) ||
                (q.tipo === 'rachado' && !q.caiu && q.desaba === prox);
      if (!vem) return;
      q.aviso = prox;
      I.emit({ type: 'perigoAviso', id: q.id, tipo: q.tipo, x: q.x, y: q.y, casas: copiaCasas(q.casas),
               rodada: prox, elemento: q.elemento || 'neutro' });
      E().log(q.tipo === 'jato' ? 'O respiro de ' + nomeEl(q.elemento) + ' ronca: o chão marcado explode no começo da próxima rodada.'
                                : 'O chão rachado range: desaba no começo da próxima rodada.');
    });
  };

  /* A COURAÇA do Colosso de Rocha: corta o golpe pela metade enquanto tiver
   * placas; cada golpe arranca uma, o de AR arranca duas (o vento entra pelas
   * frestas — e é o elemento que vence a terra). */
  R.couraca = function (state, u, amount, element, I) {
    var t = I.getTrait(u, 'couraca') || { reducao: 0.5 };
    var cortado = Math.max(1, Math.round(amount * (1 - (t.reducao || 0.5))));
    u.couraca = Math.max(0, u.couraca - (element === 'ar' ? 2 : 1));
    if (u.couraca === 0) {
      I.emit({ type: 'couracaCaiu', uid: u.uid });
      E().log('A couraça de ' + u.name + ' cai em pedaços!', u.uid);
    }
    return cortado;
  };

  /* A VENTANIA: quem golpeia o colosso DE PERTO, na própria vez, é soprado
   * para longe — uma vez por lance (feitiço de dois efeitos de dano não sopra
   * duas vezes). Veneno, armadilha, explosão e pet não contam: não são o
   * golpe de quem está na vez. */
  R.aoFerir = function (state, alvo, sourceUid, I) {
    var t = I.getTrait(alvo, 'ventania');
    var a = E().findUnit(state, sourceUid);
    if (!t || !a || !a.alive || a.offBoard || a === alvo || a.side === alvo.side || !alvo.alive) return;
    if (E().activeUnit(state) !== a) return;
    if (I.manhattan(a.x, a.y, alvo.x, alvo.y) !== 1) return;
    var lances = 0;
    for (var k in (a.castsThisTurn || {})) if (Object.prototype.hasOwnProperty.call(a.castsThisTurn, k)) lances += a.castsThisTurn[k];
    var chave = (state.turno || 0) + ':' + a.uid + ':' + lances;
    if (alvo._ventania === chave) return;
    alvo._ventania = chave;
    I.emit({ type: 'ventania', uid: alvo.uid, alvoUid: a.uid });
    E().log('O vento preso em ' + alvo.name + ' sopra ' + a.name + ' para longe!');
    I.empurra(state, alvo, a, t.tiles || 2, 'push');
  };

  /* O QUE A IA SABE DO CHÃO (ai.js): o peso de terminar a vez em cada casa.
   * Casa que leva golpe no começo da PRÓXIMA rodada é a pior coisa do mapa
   * (a unidade vai estar lá); a da rodada seguinte ainda dá para corrigir.
   * Placa e runa custam pouco (terminar em cima é ter pisado). O Colosso da
   * Maré gosta da poça. */
  R.pesoCasas = function (state, unit) {
    var m = {}, ps = state.perigos || [], r = state.round;
    function soma(x, y, v) { var k = x + ',' + y; m[k] = (m[k] || 0) + v; }
    for (var i = 0; i < ps.length; i++) {
      var p = ps[i];
      if (p.aviso && p.casas) {
        var v = (p.aviso === r + 1) ? -80 : -30;
        for (var j = 0; j < p.casas.length; j++) soma(p.casas[j].x, p.casas[j].y, v);
      }
      if (p.tipo === 'placa' && !p.armada) soma(p.x, p.y, -15);
      else if (p.tipo === 'runa') soma(p.x, p.y, -20);
      else if (p.tipo === 'rachado' && !p.caiu && !p.aviso) soma(p.x, p.y, -6);
      else if (p.tipo === 'poca' && unit && E().unitHasTrait(unit, 'mare')) {
        soma(p.x, p.y, 8);
        if (p.x === unit.x && p.y === unit.y) soma(p.x, p.y, 6);
      }
    }
    return m;
  };

  /* As casas avisadas agora (a tela pinta; as provas conferem). */
  R.avisos = function (state) {
    var out = [];
    (state && state.perigos || []).forEach(function (p) {
      if (!p.aviso || !p.casas) return;
      p.casas.forEach(function (c) { out.push({ x: c.x, y: c.y, rodada: p.aviso, tipo: p.tipo, elemento: p.elemento || 'neutro' }); });
    });
    return out;
  };
})();
