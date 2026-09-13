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
   * não abre sala sozinho. */
  function elenco(soChefes) {
    var ms = D().monsters || {};
    var fora = [];
    Object.keys(ms).forEach(function (id) {
      var m = ms[id];
      if (!m || !m.stats || typeof m.stats.hp !== 'number') return;
      if (m.summonOnly) return;
      // 08/09: monstro de calabouço fechado (sem arte) fica fora do elenco
      if (m.dungeonId && D().portalFechado && D().portalFechado(m.dungeonId)) return;
      if (soChefes ? !m.boss : !!m.boss) return;
      fora.push(id);
    });
    return fora;
  }

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

  function geraSala(andar, rnd) {
    rnd = rnd || Math.random;
    var palcos = salasReais();
    var comuns = elenco(false);
    var chefes = elenco(true);
    if (!palcos.length || !comuns.length) return null;
    var palco = palcos[Math.floor(rnd() * palcos.length)];
    var letras = Object.keys(palco.monsters || {});
    var mistura = {};
    var vagaChefe = (andar % Po.CHEFE_A_CADA === 0) && chefes.length
                  ? letras[Math.floor(rnd() * letras.length)] : null;
    letras.forEach(function (le) {
      mistura[le] = (le === vagaChefe) ? sorteia(chefes, rnd) : sorteia(comuns, rnd);
    });
    return {
      name: 'Andar ' + andar + ' — ' + (palco.name || 'o fundo'),
      weather: palco.weather,
      sceneryTheme: palco.sceneryTheme,
      layout: palco.layout,                    // o palco é emprestado como está
      monsters: mistura
    };
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
   * PV — e nada além de PV, por enquanto. */
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
})();
