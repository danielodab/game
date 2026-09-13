var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

/* ============================================================================
 * SOTERRA — js/core/coop.js   (11/09, o multijogador: a frente da BATALHA)
 * A batalha em dupla pela Rede — e o duelo pela Rede, que usa o mesmo trilho.
 *
 * O PRINCÍPIO É O LOCKSTEP. Os dois clientes montam o MESMO estado inicial (a
 * "ata" da sala: semente, dificuldade, o grupo ao pé da letra, o PV carregado)
 * e aplicam as MESMAS chamadas ao motor, na MESMA ordem. Só viajam os LANCES do
 * herói de gente (posicionar, andar, lançar, encerrar, fundir); monstros, pets
 * e invocações rodam na IA dos DOIS lados, que é pura, sobre um motor que só
 * sorteia pelo `state._rng`. Todo lance depois do qual o turno muda leva o HASH
 * do estado; se alguém diverge, a AUTORIDADE (o líder; no duelo, quem
 * desafiou) manda a FOTO do começo do turno e o outro retoma dali.
 *
 * O QUE MORA AQUI (e não no motor nem no Game):
 *   - a sessão (grupo configurado pelo grupo.js; ou o duelo) e a batalha em
 *     curso (`bid`);
 *   - `pronto` → `ata` → `dentro`, com reenvio da ata;
 *   - a fila de lances por (T, k), o buraco (`pede`) e a conferência do hash;
 *   - a foto de resgate da autoridade e a restauração de quem divergiu;
 *   - o sumiço (a voz `caiu`, o silêncio, o turno estourado), a carência, a
 *     IA no lugar de quem caiu, o W.O. do duelo e a volta;
 *   - a passagem de sala (`proxima`/`seguir`) e o fim do duelo (`fim`);
 *   - `assinatura`, `versao`, `sorteiaArena`, `payloadMeu`;
 *   - o relógio de parede (setInterval de 500 ms: o turno do DONO acaba pelo
 *     relógio, com a aba escondida também) e o piloto automático das provas.
 *
 * DECISÕES DESTA FRENTE (além das do plano):
 *   - `vivo`: um sinal de vida dirigido a cada 8 s em batalha, com o turno em
 *     que o cliente está. Sem ele, o parceiro que só ASSISTE (o turno é meu,
 *     que pode durar 150 s) ficaria calado e contaria como sumido pelos 30 s de
 *     silêncio; e o turno do outro só começa a "estourar" depois que ele disse
 *     que chegou naquele turno (um cliente com animação anda atrás do outro).
 *   - a foto é tirada em TODO começo de turno pelos dois (0,2 ms), para quem
 *     vira autoridade no meio da sala já ter a dela.
 *   - depois de uma restauração, os lances que eu já tinha mandado para turnos
 *     a partir da foto voltam para a fila e são REAPLICADOS sem reenviar (a
 *     autoridade vai aplicá-los também); os do outro, idem.
 *   - o `fim` do duelo leva também `mot` ('wo' | 'desistencia' | null).
 *
 * OS CONSERTOS DA REVISÃO (11/09, tarde):
 *   - quem é posto na IA sem ter caído CEDE a autoridade (`S.cedeu`): nunca
 *     há duas autoridades descartando a foto uma da outra;
 *   - o lance perdido no fim do turno volta pelo `pede` — também quando o
 *     outro já disse (no `vivo`) que passou do turno; quem volta pede na hora;
 *   - o duelo: a carga dos modelos tem teto próprio (90 s, com `carga` de
 *     quem ainda carrega), o `dentro` repete até o outro ouvir, e quem cancela
 *     avisa pelo trilho da batalha; divergência no duelo anula a partida
 *     (sem foto e sem `ia` vindos do outro: lá não há árbitro);
 *   - a `proxima` repete até o `pronto`; o `dentro` do grupo repete até a
 *     líder responder, e a ata que falhou solta a parceira (`cancela`);
 *   - o lance só vale do DONO da vez e com a unidade da vez; a desistência e
 *     o W.O. forjados não dão vitória a quem os forja;
 *   - o prazo do turno do outro corre pelo MEU relógio (com folga fixa para
 *     a animação dele); o banco dele tem teto;
 *   - `pede` e `foto-pede` de fora têm freio; no grupo, quem não é a
 *     autoridade confere o `fim` da sala com ela antes da recompensa.
 * ==========================================================================*/

(function () {
  'use strict';

  var Coop = {};
  JOGO.Coop = Coop;

  // ------------------------------------------------------------ constantes
  Coop.GRACA_MS = 15000;        // grupo: carência depois do sumiço, antes da IA
  Coop.SILENCIO_MS = 30000;     // sem sinal nenhum: conta como sumiço
  Coop.WO_MS = 60000;           // duelo: sumido por 60 s perde
  Coop.ATA_MS = 3000;           // reenvio da ata
  Coop.ATA_TENTATIVAS = 5;
  Coop.BURACO_MS = 3000;        // buraco na fila antes do `pede`
  Coop.DENTRO_MS = 15000;       // duelo: os dois `dentro`, senão cancela sem resultado
  Coop.VIVO_MS = 8000;          // sinal de vida em batalha
  Coop.PRONTO_MS = 5000;        // o parceiro repete o `pronto` na antessala
  Coop.FOTO_REPEDE_MS = 3000;   // sem foto, pede de novo
  Coop.FIM_MS = 10000;          // duelo: espera o `fim` do outro para anotar
  Coop.TIQUE_MS = 500;
  Coop.HASHES = 64;             // turnos guardados (hash, log)
  Coop.FOLGA_MS = 15000;        // o turno do outro: a folga pela animação dele, no MEU relógio
  Coop.CARGA_MS = 90000;        // duelo: o teto da carga dos modelos da arena
  Coop.DENTRO_REP_MS = 2000;    // duelo: o `dentro` (e a `carga` de quem carrega) repete até o outro ouvir
  Coop.PROXIMA_MS = 3000;       // grupo: quem lidera repete a `proxima` até o `pronto` chegar
  Coop.PROXIMA_VEZES = 20;
  Coop.ATA_TARDE_MS = 30000;    // um `dentro` atrasado ainda abre a batalha de quem lidera
  Coop.FIM_GRUPO_MS = 10000;    // grupo: quem não é a autoridade espera o `fim` dela (e o `vivo` que passa de 8 s)
  Coop.PEDE_MIN_MS = 2000;      // o `pede` e o `foto-pede` que chegam: um por este tempo
  Coop.PEDE_MAX = 24;           // lances reenviados por `pede`
  Coop.SAIU_VISTO_MS = 10000;   // canal de abas: `saiu` sem cx de quem falou há menos disto não vale

  Coop._agora = function () { return Date.now(); };
  Coop._semIntervalo = false;   // provas: sem setInterval (o teste chama _tique)
  Coop._semTela = false;        // provas: o tique roda o Game como aba escondida

  function agora() { var t; try { t = +Coop._agora(); } catch (e) { t = NaN; } return isFinite(t) ? t : Date.now(); }
  function R() { return JOGO.Rede || null; }
  function G() { return JOGO.Game || null; }
  function E() { return JOGO.Engine || null; }
  function D() { return JOGO.DATA || {}; }
  function num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }
  function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }
  /* 11/09: O MESTRE NO GRUPO (pedido do dono, com o Cavaleiro Negro) */
  function gmAtivo() {
    try { return !!(JOGO.GM && JOGO.GM.ativo && JOGO.GM.ativo()); } catch (e) { return false; }
  }
  /* o Mestre que o RELÉ conferiu: o mestre:true da presença (a Rede só o põe
   * quando confia no relé) — nunca o que veio escrito no envelope */
  function mestreConferido(id) {
    var r = R();
    if (!id || !r || typeof r.pares !== 'function') return false;
    try { return r.pares().some(function (p) { return p && p.id === id && p.mestre === true; }); }
    catch (e) { return false; }
  }
  /* a ficha do Mestre entra no DATA desta página só para a batalha (o
   * validaPayload já exigiu o Mestre conferido); sai na sala seguinte, com o
   * grupo desfeito fora da batalha, ou na volta à praça (game.js) */
  function emprestaFichas(party) {
    var Gm = JOGO.GM;
    if (!Gm || !Gm.emprestaFicha) return;
    (party || []).forEach(function (p) { if (p && p.classId === 'gm' && p.ficha) Gm.emprestaFicha(p.ficha); });
  }
  function devolveFichas() {
    var Gm = JOGO.GM;
    try { if (Gm && Gm.devolveFicha) Gm.devolveFicha(); } catch (e) {}
  }

  // ------------------------------------------------------------ estado
  var cfg = null;       // o grupo que o grupo.js configurou: { gid, lider, eu, parceiro:{ id, cx, heroi, nome } }
  /* OS HEROIS DO PARCEIRO, GUARDADOS (12/09). Quem cai da internet nao perde a
   * descida: a sala seguinte nasce com os corpos dele mesmo sem o `pronto`
   * (que ele nao tem como mandar off), com o PV carregado de sempre. Guardado
   * por id: um parceiro NOVO nao herda a lista do anterior. */
  var parceiroUltimo = null;   // { id, herois: [payload...] }
  var S = nova(null);   // a sessão de batalha
  var piloto = null;    // provas: { joga, casa, fica, segue }

  function nova(tipo) {
    return {
      tipo: tipo, bid: null, fase: null, n: 0,
      ata: null, ataEnvios: 0, ataProx: 0, chamando: false, ataFalhou: false,
      prontoParceiro: null, prontoProx: 0,
      fila: {}, log: {}, hashes: {}, foto: null, antes: {}, buracoDesde: 0,
      logSrv: [], fotografada: false,  // 13/09: o registro que o servidor refaz (lances + marcas, em ordem)
      sincronizando: false, fotoPedidaEm: 0, fotoPendente: false, fotoDepois: false, dessinc: 0, restauracoes: 0, ultimaDessinc: null,
      proximaLiberada: false, proximaEnviada: false,
      descidaAcabou: false, parceiroSaiu: false, parceiroVoltou: false,
      sumidoDesde: 0, parceiroIA: false, tomouAutoridade: false, meAssumiu: false,
      mortePendente: {},            // 12/09: quem SAIU da batalha — os herois dele morrem
      esperando: null, bkParceiro: 0, vivoEm: 0, ultimoSinal: 0, turnoDele: 0, turnoDeleEm: 0,
      duelo: null, parceiro: null, dentroEu: false, dentroEle: false, dentroPrazo: 0,
      fim: null, fimDele: null, fimPrazo: 0, anotado: false, fimMotivo: null,
      rodouSemTela: false, aviso: null,
      // os consertos da revisão (11/09)
      cedeu: false,                 // o outro me pôs na IA sem eu ter caído: a autoridade é dele até o fim da sala
      pedeEm: 0, fotoEm: 0,         // o freio do `pede` e do `foto-pede` que chegam
      religouPendente: false, religouEm: 0,
      proximaSala: null, proximaProx: 0, proximaVezes: 0,
      dentroConfirmado: false, dentroRepProx: 0, ataFalhouEm: 0,
      cargaTeto: 0, cargaProx: 0,
      fimGrupo: null, fimGrupoDele: null, fimGrupoMeu: null, fimFotoPedidaEm: 0,
      tortos: 0
    };
  }

  function parceiro() {
    if (S.tipo === 'duelo') return S.parceiro;
    return (cfg && cfg.parceiro) || null;
  }
  function meuId() {
    if (S.tipo === 'duelo' && S.duelo && S.duelo.meuId) return S.duelo.meuId;
    if (cfg && cfg.eu) return cfg.eu;
    var r = R();
    try { return r && r.meuId ? r.meuId() : null; } catch (e) { return null; }
  }
  Coop.meuId = meuId;
  function nomeDe(id, sug) {
    var r = R();
    try { if (r && r.nomeDe) return r.nomeDe(id, sug); } catch (e) {}
    return sug || id || '?';
  }
  function nomeParceiro() {
    var p = parceiro();
    return p ? (p.nome || nomeDe(p.id)) : 'o parceiro';
  }

  /* Quem o outro pôs na IA sem ter caído (o turno "estourou" do lado dele, a
   * aba escondida) CEDE: até o fim da sala a autoridade e a liderança da sala
   * são de quem ficou — senão os dois se achavam autoridade e um jogava fora
   * a foto do outro, com a tela presa em "Sincronizando…". */
  function souLider() {
    if (S.tipo === 'duelo') return false;
    if (S.cedeu) return false;
    if (S.tomouAutoridade) return true;
    return !!(cfg && cfg.lider && cfg.lider === meuId());
  }
  Coop.souLider = souLider;
  function souAutoridade() {
    if (S.cedeu) return false;
    if (S.tipo === 'duelo') return S.tomouAutoridade || !!(S.duelo && S.duelo.eu === 'A');
    return souLider();
  }
  function autoridadeId() {
    if (souAutoridade()) return meuId();
    var p = parceiro();
    return p ? p.id : null;
  }
  function emBatalha() {
    var g = G();
    return !!(g && g.screen === 'battle' && g.modoRede && g.modoRede() && S.bid);
  }

  // ------------------------------------------------------------ avisos e callbacks
  function chama(nome, arg) {
    var f = Coop[nome];
    if (typeof f === 'function') { try { f(arg); } catch (e) {} }
  }
  function muda() { chama('aoMudar', Coop.sessao()); }
  function avisa(texto, kind) {
    S.aviso = { texto: texto, kind: kind || 'info', t: agora() };
    if (typeof Coop.aoAviso === 'function') { try { Coop.aoAviso(texto, kind || 'info'); } catch (e) {} }
    else if (JOGO.UI && typeof JOGO.UI.toast === 'function') { try { JOGO.UI.toast(texto, kind || 'info'); } catch (e2) {} }
  }

  // ------------------------------------------------------------ envio
  function envia(acao, dados) {
    var r = R(), p = parceiro();
    if (!r || !r.dirige || !p || !p.id) return false;
    var ok = false;
    if (acao === 'vivo' && dados) S.vivoT = num(+dados.T, 0);          // o turno que eu disse por último
    try { ok = !!r.dirige('batalha', p.id, acao, dados, p.cx ? { cx: p.cx } : {}); } catch (e) { ok = false; }
    if (!ok) {
      try { S.ultimaRecusa = r.ultimaRecusa ? r.ultimaRecusa() : 'falhou'; } catch (e2) { S.ultimaRecusa = 'falhou'; }
    }
    return ok;
  }
  function paraFio(l, comDe) {
    var o = { b: l.b, T: l.T, k: l.k, a: l.a, ok: !!l.ok };
    if (l.u != null) o.u = l.u;
    if (l.x != null) o.x = l.x;
    if (l.y != null) o.y = l.y;
    if (l.s != null) o.s = l.s;
    if (l.alvo != null) o.alvo = l.alvo;
    if (l.T2 != null) { o.T2 = l.T2; o.h = l.h; }
    if (l.bk != null) o.bk = l.bk;
    if (comDe && l.de) o.de = l.de;
    return o;
  }

  // ------------------------------------------------------------ dados: assinatura, versão, arena
  function canon(v) {
    if (v === null || v === undefined) return 'null';
    var t = typeof v;
    if (t === 'number') return isFinite(v) ? String(v) : 'null';
    if (t === 'boolean') return v ? 'true' : 'false';
    if (t === 'string') return JSON.stringify(v);
    if (t === 'function') return 'null';
    if (Object.prototype.toString.call(v) === '[object Array]') {
      var a = [];
      for (var i = 0; i < v.length; i++) a.push(canon(v[i]));
      return '[' + a.join(',') + ']';
    }
    var ks = [], k;
    for (k in v) if (Object.prototype.hasOwnProperty.call(v, k) && typeof v[k] !== 'function') ks.push(k);
    ks.sort();
    var out = [];
    for (i = 0; i < ks.length; i++) out.push(JSON.stringify(ks[i]) + ':' + canon(v[ks[i]]));
    return '{' + out.join(',') + '}';
  }
  function fnv(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 16777619) >>> 0; }
    return h >>> 0;
  }
  function semGm(obj, ehFeitico) {
    var out = {}, k;
    for (k in (obj || {})) {
      if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
      if (k === 'gm' || /^gm-/.test(k)) continue;
      if (ehFeitico && obj[k] && obj[k].classId === 'gm') continue;
      out[k] = obj[k];
    }
    return out;
  }
  var assinaturaGuardada = null;
  /* FNV-1a sobre os dados que decidem a batalha (sem o Mestre, sem o Poço):
   * dois clientes com assinaturas diferentes jogariam batalhas diferentes. */
  Coop.assinatura = function () {
    if (assinaturaGuardada) return assinaturaGuardada;
    var d = D();
    var dgs = [];
    var lista = d.dungeons || [];
    for (var i = 0; i < lista.length; i++) if (lista[i] && lista[i].id !== 'poco') dgs.push(lista[i]);
    var pedaco = {
      classes: semGm(d.classes, false), spells: semGm(d.spells, true),
      monsterSpells: d.monsterSpells || null, monsters: d.monsters || null,
      petSpells: d.petSpells || null, pets: d.pets || null,
      fusionForms: d.fusionForms || null, fusionBlends: d.fusionBlends || null,
      fusionSpells: d.fusionSpells || null, fusionSummons: d.fusionSummons || null,
      dungeons: dgs, portaisFechados: d.portaisFechados || null,
      dificuldades: d.dificuldades || null, roomFury: (d.leveling || {}).roomFury || null,
      summonCap: d.summonCap || null, tileEvents: d.tileEvents || null,
      weathers: d.weathers || null, rivals: d.rivals || null,
      // 13/09: a cura e o custo da poção decidem a batalha em grupo
      consumiveis: d.consumiveis || null, consumiveisRegras: d.consumiveisRegras || null
    };
    assinaturaGuardada = ('00000000' + fnv(canon(pedaco)).toString(16)).slice(-8);
    return assinaturaGuardada;
  };
  Coop.versao = function () {
    var v = null;
    try {
      var g = (typeof window !== 'undefined') ? window : globalThis;
      v = g.SOTERRA_VERSAO && g.SOTERRA_VERSAO.versao;
    } catch (e) { v = null; }
    return String(v || 'dev') + ':' + Coop.assinatura();
  };

  /* A ARENA do duelo, sorteada pela semente dos dois entre as salas dos
   * calabouços ABERTOS, em ordem alfabética (hoje: cistern e greenhouse). */
  Coop.sorteiaArena = function (semente) {
    var d = D(), ds = d.dungeons || [], abertos = [], porId = {};
    for (var i = 0; i < ds.length; i++) {
      var x = ds[i];
      if (!x || !x.id || x.id === 'poco' || !x.rooms || !x.rooms.length) continue;
      if (d.portalFechado && d.portalFechado(x.id)) continue;
      abertos.push(x.id);
      porId[x.id] = x;
    }
    if (!abertos.length) return null;
    abertos.sort();
    var s = (+semente) >>> 0;
    var dg = abertos[s % abertos.length];
    var ri = (s >>> 8) % porId[dg].rooms.length;
    var room = porId[dg].rooms[ri] || {};
    return { dungeonId: dg, roomIndex: ri,
             nome: (porId[dg].name || dg) + ' — sala ' + (ri + 1) + (room.name ? ' (' + room.name + ')' : '') };
  };

  /* O MEU herói no formato do motor, com o `dono`. O Mestre (11/09) só com o
   * modo ligado nesta página, e com a FICHA junto (a classe e os feitiços
   * gm-*): o motor do parceiro não os tem. */
  Coop.payloadMeu = function (heroId) {
    var P = JOGO.Progress;
    if (!P || !P.battleParty || !P.hero) return null;
    var h = P.hero(heroId);
    if (!h || (h.classId === 'gm' && !gmAtivo())) return null;
    var lst = null;
    try { lst = P.battleParty([heroId]); } catch (e) { lst = null; }
    var p = lst && lst[0];
    if (!p) return null;
    p = clone(p);
    delete p.items; delete p.itemVar;      // o motor não lê; só pesariam na ata
    p.dono = meuId();
    if (p.classId === 'gm') {
      var fi = null;
      try { fi = JOGO.GM.fichaDoGrupo(p.spells || []); } catch (e2) { fi = null; }
      if (!fi) return null;
      p.ficha = fi;
    }
    return p;
  };
  /* OS MEUS, ATE DOIS (12/09, pedido do dono: "podem ir com os dois
   * personagens selecionados... no caso 4 personagens no maximo"). A sala em
   * grupo passa a nascer com os selecionados de cada lado; a ata leva primeiro
   * os de quem lidera e depois os de quem segue. Quem nao tiver o segundo
   * (conta nova, ou o Mestre sem o modo ligado) desce com um, e a sala nasce
   * com tres — o motor nunca supos dois. */
  Coop.MAX_HEROIS = 2;
  Coop.payloadMeus = function (ids) {
    var out = [], vistos = {};
    (Object.prototype.toString.call(ids) === '[object Array]' ? ids : [ids]).forEach(function (hid) {
      if (typeof hid !== 'string' || !hid || vistos[hid] || out.length >= Coop.MAX_HEROIS) return;
      var p = Coop.payloadMeu(hid);
      if (!p) return;
      vistos[hid] = true;
      out.push(p);
    });
    return out;
  };
  /* os DONOS de uma lista de payloads, na ordem em que aparecem */
  function donosDe(lista) {
    var out = [];
    (lista || []).forEach(function (p) {
      var d = (p && p.dono) || null;
      if (d && out.indexOf(d) < 0) out.push(d);
    });
    return out;
  }

  /* Os feitiços que um herói desta classe PODE ter: os de base, os de todos
   * os caminhos, e os que um item (o espaço lume) ou um conjunto concedem.
   * Nunca o de monstro, de pet, de fusão ou de outra classe. Guardado. */
  var poolGuardado = {};
  function poolDaClasse(classId) {
    if (poolGuardado[classId]) return poolGuardado[classId];
    var d = D(), c = (d.classes || {})[classId] || {}, pool = {}, i, k;
    var base = c.baseSpells || [];
    for (i = 0; i < base.length; i++) pool[base[i]] = true;
    var paths = c.paths || {};
    for (k in paths) {
      if (!Object.prototype.hasOwnProperty.call(paths, k)) continue;
      var pl = paths[k] || [];
      for (i = 0; i < pl.length; i++) pool[pl[i]] = true;
    }
    var its = d.items || {};
    for (k in its) if (Object.prototype.hasOwnProperty.call(its, k) && its[k] && its[k].grantsSpell) pool[its[k].grantsSpell] = true;
    var sets = d.sets || {};
    for (k in sets) {
      if (!Object.prototype.hasOwnProperty.call(sets, k) || !sets[k] || !sets[k].bonuses) continue;
      for (var n in sets[k].bonuses) {
        var b = sets[k].bonuses[n];
        if (b && b.grantsSpell) pool[b.grantsSpell] = true;
      }
    }
    poolGuardado[classId] = pool;
    return pool;
  }
  function statsSaos(s) {
    if (s == null) return true;
    if (typeof s !== 'object') return false;
    for (var k in s) {
      if (!Object.prototype.hasOwnProperty.call(s, k)) continue;
      var v = s[k];
      if (typeof v === 'number' && (!isFinite(v) || v < -1000 || v > 100000)) return false;
    }
    return isFinite(+s.hp) && +s.hp >= 1;
  }
  /* O MESTRE NO GRUPO (11/09): o herói dele só passa do Mestre que o relé
   * conferiu — ou o meu, com o modo ligado aqui —, e com a ficha certa: a
   * classe 'gm' e só feitiços gm-* nela; os outros feitiços, os do jogo. */
  function validaMestre(p) {
    if (!p.dono || !(p.dono === meuId() ? gmAtivo() : mestreConferido(p.dono))) return false;
    var fi = p.ficha;
    if (!fi || typeof fi !== 'object' || !fi.classe || fi.classe.id !== 'gm' ||
        !fi.feiticos || typeof fi.feiticos !== 'object') return false;
    for (var k in fi.feiticos) {
      if (!Object.prototype.hasOwnProperty.call(fi.feiticos, k)) continue;
      var f = fi.feiticos[k];
      if (!/^gm-/.test(k) || !f || f.classId !== 'gm' || Object.prototype.toString.call(f.effects) !== '[object Array]') return false;
    }
    if (typeof p.level !== 'number' || p.level !== Math.floor(p.level) || p.level < 1 || p.level > 99) return false;
    var sp = p.spells || [], e = E();
    if (Object.prototype.toString.call(sp) !== '[object Array]') return false;
    for (var i = 0; i < sp.length; i++) {
      if (typeof sp[i] !== 'string') return false;
      if (/^gm-/.test(sp[i])) { if (!Object.prototype.hasOwnProperty.call(fi.feiticos, sp[i])) return false; }
      else if (e && !e.spell(sp[i])) return false;
    }
    return statsSaos(p.stats);
  }
  function validaPayload(p, op) {
    if (!p || typeof p !== 'object') return false;
    if (p.classId === 'gm') return !(op && op.semMestre) && validaMestre(p);   // no duelo, o Mestre segue fora
    var cls = (D().classes || {})[p.classId];
    if (!cls) return false;
    var teto = num((D().leveling || {}).maxLevel, 30);
    // o nível é um inteiro de verdade: '99' em texto passava na conferência como 1 e valia 99 no motor
    if (typeof p.level !== 'number' || p.level !== Math.floor(p.level) || p.level < 1 || p.level > teto) return false;
    var sp = p.spells || [];
    if (Object.prototype.toString.call(sp) !== '[object Array]') return false;
    var e = E(), pool = poolDaClasse(p.classId), temPool = false;
    for (var q in pool) { if (Object.prototype.hasOwnProperty.call(pool, q)) { temPool = true; break; } }
    for (var i = 0; i < sp.length; i++) {
      if (typeof sp[i] !== 'string' || /^gm-/.test(sp[i])) return false;
      if (e && !e.spell(sp[i])) return false;
      if (temPool && !pool[sp[i]]) return false;            // feitiço de chefe, de pet ou de outra classe
    }
    if (!statsSaos(p.stats)) return false;
    return true;
  }
  Coop._validaPayload = validaPayload;
  function okDupla(x) {
    if (!x || Object.prototype.toString.call(x) !== '[object Array]' || x.length < 1 || x.length > 2) return false;
    for (var i = 0; i < x.length; i++) if (!validaPayload(x[i], { semMestre: true })) return false;
    return true;
  }
  /* O GRUPO DA ATA (12/09): de dois a QUATRO herois, de exatamente DOIS donos
   * — os de quem lidera primeiro, na ordem, e os de quem segue depois. E a
   * unica forma valida: uma lista com tres donos, ou com os donos misturados,
   * ou com o mesmo heroi duas vezes, nao abre a sala. */
  function okGrupoDaAta(lista, donoA, donoB) {
    if (!lista || Object.prototype.toString.call(lista) !== '[object Array]') return false;
    if (lista.length < 2 || lista.length > 2 * Coop.MAX_HEROIS) return false;
    var vistos = {}, i, p;
    for (i = 0; i < lista.length; i++) {
      p = lista[i];
      if (!p || typeof p !== 'object' || !validaPayload(p)) return false;
      var ch = String(p.dono) + '/' + String(p.heroId || p.classId);
      if (vistos[ch]) return false;                 // o mesmo heroi duas vezes
      vistos[ch] = true;
    }
    var ds = donosDe(lista);
    if (ds.length !== 2 || ds[0] !== donoA || ds[1] !== donoB) return false;
    // agrupados: todos os de A antes de todos os de B (a ordem que a ata monta)
    var virou = false;
    for (i = 0; i < lista.length; i++) {
      if (lista[i].dono === donoB) virou = true;
      else if (virou) return false;
    }
    var nA = 0;
    for (i = 0; i < lista.length; i++) if (lista[i].dono === donoA) nA++;
    return nA >= 1 && nA <= Coop.MAX_HEROIS && (lista.length - nA) <= Coop.MAX_HEROIS;
  }
  function novaSemente() { return Math.floor(Math.random() * 4294967296) >>> 0; }

  // ------------------------------------------------------------ o grupo (vem do grupo.js)
  function lembraParceiro(id, herois) {
    if (!id || !herois || !herois.length) return;
    parceiroUltimo = { id: id, herois: clone(herois) };
  }
  /* os herois do parceiro para a ata: o `pronto` desta sala, e se ele nao veio
   * (ele esta off) o que ficou guardado da sala passada */
  function heroisDoParceiro() {
    var p = parceiro();
    if (!p) return [];
    if (prontoValido() && S.prontoParceiro) {
      return (S.prontoParceiro.herois || [S.prontoParceiro.heroi]).slice();
    }
    // o guardado so vale para quem esta FORA: com ele aqui, espera-se o `pronto`
    // desta sala (ele pode ter trocado de heroi na praca)
    if (!S.sumidoDesde && !S.parceiroIA) return [];
    if (parceiroUltimo && parceiroUltimo.id === p.id) return clone(parceiroUltimo.herois);
    return [];
  }
  Coop._heroisDoParceiro = heroisDoParceiro;

  Coop.configura = function (info) {
    if (!info || !info.parceiro || !info.parceiro.id) {
      var tinha = cfg;
      cfg = null;
      // 11/09: o grupo desfeito fora da batalha devolve a ficha do Mestre; na
      // batalha ela fica até o fim da sala
      if (!emBatalha()) devolveFichas();
      if (S.tipo === 'grupo') {
        if (emBatalha()) {
          // o grupo se desfez com a batalha em curso: é saída deliberada — os
          // heróis dele CAEM (12/09, marcaSaida). Quem só caiu da internet não
          // passa por aqui: o grupo.js não desfaz o grupo dentro da descida.
          if (tinha && tinha.parceiro) marcaSaida(tinha.parceiro.id);
          S.descidaAcabou = true;
        } else {
          var n0 = S.n;
          S = nova(null);
          S.n = n0;
          S.descidaAcabou = true;
        }
      }
      if (!Coop.ativo()) paraTique();
      muda();
      return;
    }
    var p = info.parceiro;
    var novo = {
      gid: info.gid || (cfg && cfg.gid) || null, lider: info.lider || null, eu: info.eu || meuId(),
      parceiro: { id: String(p.id), cx: p.cx || null, heroi: p.heroi || null, nome: p.nome || nomeDe(p.id),
                  // 12/09: a lista dos dois herois dele (sem ela classesParceiro caia num so)
                  herois: (Object.prototype.toString.call(p.herois) === '[object Array]')
                    ? p.herois.slice(0, Coop.MAX_HEROIS) : [] }
    };
    var outro = !cfg || !cfg.parceiro || cfg.parceiro.id !== novo.parceiro.id;
    // parceiro novo: a lista guardada do anterior nao vale mais
    if (outro && parceiroUltimo && parceiroUltimo.id !== novo.parceiro.id) parceiroUltimo = null;
    var eraLider = souLider();
    cfg = novo;
    if (S.tipo !== 'duelo') {
      if (outro && !emBatalha()) { var n1 = S.n; S = nova('grupo'); S.n = n1; }
      else S.tipo = 'grupo';
    }
    // a liderança mudou fora da batalha: quem virou parceiro repete o `pronto`
    var agoraLider = souLider();
    if (!emBatalha()) S.tomouAutoridade = false;
    var g = G();
    if (!agoraLider && g && g.screen === 'antessala' && g.modoRede && g.modoRede() === 'grupo') mandaPronto();
    if (agoraLider !== eraLider && !emBatalha()) { S.chamando = false; S.ata = null; }
    ligaTique();
    muda();
  };
  Coop.ativo = function () { return !!((cfg && cfg.parceiro) || S.tipo === 'duelo'); };
  Coop.emGrupo = function () { return !!(cfg && cfg.parceiro); };
  Coop.classeParceiro = function () {
    var p = cfg && cfg.parceiro;
    return (p && p.heroi && p.heroi.classId) || null;
  };
  /* AS CLASSES do parceiro (12/09): ate duas, para o game.js pedir os modelos
   * dos dois herois dele antes de descer. O `heroi` solto segue valendo como o
   * principal (o grupo.js manda os dois em `herois`). */
  Coop.classesParceiro = function () {
    var p = cfg && cfg.parceiro, out = [];
    var lista = (p && Object.prototype.toString.call(p.herois) === '[object Array]') ? p.herois : [];
    lista.forEach(function (h) {
      var c = h && h.classId;
      if (c && out.indexOf(c) < 0 && out.length < Coop.MAX_HEROIS) out.push(c);
    });
    if (!out.length) { var c0 = Coop.classeParceiro(); if (c0) out.push(c0); }
    return out;
  };
  Coop.partySize = function () {
    var a = S.ata;
    return (a && a.party && a.party.length) ? a.party.length : 2;
  };
  /* A VEZ DO SAQUE (11/09, achado 19 da revisão). Cada cliente da dupla
   * sorteava o saque inteiro de quem joga sozinho com dupla — e uma pessoa com
   * dois navegadores (dois ids locais, ou duas contas), jogando a sala com um
   * herói em cada janela, levava DOIS sorteios pelo esforço de um. Agora a
   * sala tem UM sorteio para o grupo: a semente da ata (a mesma nos dois
   * motores) diz de quem é a vez, e só esse cliente sorteia o item, as cartas,
   * a carta de pet, as pedras, os selos e as insígnias — com as chances de
   * quem joga sozinho com dupla (o game.js, computeRewards). A soma dos dois é
   * o que UMA dupla solo tira; cada um, na média, a metade. true = a vez é
   * minha; false = do parceiro; null = sem ata (quem chama decide). */
  Coop.vezDoSaque = function () {
    var a = S.ata;
    if (!a || !a.party || a.party.length < 2) return null;
    /* A SEMENTE SORTEIA UM DONO, NAO UMA CADEIRA (12/09). Com um heroi de cada
     * lado dava no mesmo, mas desde que cada um desce com dois a lista tem
     * quatro cadeiras: sortear cadeira daria a vez a quem levou mais herois
     * (e, com 3 cadeiras, 2 chances contra 1). O sorteio e entre os DONOS. */
    var donos = donosDe(a.party);
    if (donos.length < 2) return null;
    var s = (+a.semente) >>> 0;
    var i = ((s ^ (s >>> 11) ^ (s >>> 23)) >>> 0) % donos.length;
    var me = meuId();
    if (!me) return null;
    return donos[i] === me;
  };

  Coop.sessao = function () {
    var p = parceiro();
    return {
      tipo: S.tipo || (cfg && cfg.parceiro ? 'grupo' : null),
      bid: S.bid, eu: meuId(),
      parceiro: p ? { id: p.id, cx: p.cx || null, nome: p.nome || nomeDe(p.id) } : null,
      autoridade: autoridadeId(), lider: souLider(),
      lado: S.duelo ? S.duelo.eu : null,
      fase: S.fase,
      esperando: S.esperando ? { uid: S.esperando.uid, desde: S.esperando.desde, prazo: S.esperando.prazo } : null,
      parceiroOn: !S.sumidoDesde && !S.parceiroSaiu,
      parceiroIA: S.parceiroIA,
      sumidoDesde: S.sumidoDesde || 0,
      sincronizando: S.sincronizando,
      dessinc: S.dessinc, restauracoes: S.restauracoes,
      prontoParceiro: prontoValido(),
      chamando: S.chamando, ataFalhou: S.ataFalhou,
      proximaLiberada: S.proximaLiberada,
      descidaAcabou: S.descidaAcabou,
      parceiroSaiu: S.parceiroSaiu, parceiroVoltou: S.parceiroVoltou,
      arena: S.duelo ? { dungeonId: S.duelo.dungeonId, roomIndex: S.duelo.roomIndex, nome: S.duelo.nome } : null,
      fim: S.fim ? { venc: S.fim.venc, venci: S.fim.venci, empate: S.fim.empate,
                     resultado: S.fim.resultado || null, contestado: !!S.fim.contestado } : null,
      fimMotivo: S.fimMotivo,
      aviso: S.aviso
    };
  };

  // ------------------------------------------------------------ o relógio (setInterval)
  var tiqueId = null;
  function ligaTique() {
    if (tiqueId || Coop._semIntervalo || typeof setInterval !== 'function') return;
    tiqueId = setInterval(function () { try { tique(); } catch (e) {} }, Coop.TIQUE_MS);
  }
  function paraTique() { if (tiqueId) { clearInterval(tiqueId); tiqueId = null; } }
  Coop._tique = function () { tique(); };

  function tique() {
    var g = G(), ag = agora();
    if (g && g.modoRede && g.modoRede() && g._tique) {
      var escondida = !!Coop._semTela;
      try { if (!escondida && typeof document !== 'undefined') escondida = !!document.hidden; } catch (e0) {}
      if (escondida && g.screen === 'battle') S.rodouSemTela = true;
      try { g._tique(escondida); } catch (e) {}
    }
    // a MINHA conexão voltou: o que depende do outro sai depois da `volta`
    // do grupo.js (que ouve o `religou` depois de mim), no tique seguinte
    if (S.religouPendente) { S.religouPendente = false; depoisDeReligar(); }
    // a ata: o líder reenvia até o `dentro`
    if (S.chamando && S.ata && souLider() && g && g.screen === 'antessala' && ag >= S.ataProx) {
      if (S.ataEnvios >= Coop.ATA_TENTATIVAS) {
        S.chamando = false; S.ataFalhou = true; S.ataFalhouEm = ag;
        avisa(nomeParceiro() + ' não respondeu.', 'aviso');
        muda();
      } else {
        S.ataEnvios++;
        S.ataProx = ag + Coop.ATA_MS;
        envia('ata', S.ata);
      }
    }
    // o parceiro na antessala repete o `pronto` até a ata chegar
    if (S.tipo === 'grupo' && !souLider() && g && g.screen === 'antessala' && !S.bid && ag >= S.prontoProx) mandaPronto();
    // a parceira que já montou a batalha da ata repete o `dentro` até ouvir a líder
    // (um lance, um `vivo` ou a `cancela`): senão a ata que falhou deixava as duas paradas
    if (S.tipo === 'grupo' && !souLider() && S.bid && emBatalha() && !S.dentroConfirmado &&
        g.state && g.state.phase === 'placing' && ag >= S.dentroRepProx) {
      S.dentroRepProx = ag + Coop.ATA_MS;
      envia('dentro', { bid: S.bid });
    }
    // quem lidera repete a `proxima` até a parceira chegar à porta (o `pronto`)
    if (S.tipo === 'grupo' && S.proximaSala && souLider() && g && g.screen === 'antessala' && ag >= S.proximaProx) {
      if (prontoValido() || S.proximaVezes >= Coop.PROXIMA_VEZES || S.proximaSala.roomIndex !== g.roomIndex) S.proximaSala = null;
      else { S.proximaVezes++; S.proximaProx = ag + Coop.PROXIMA_MS; envia('proxima', S.proximaSala); }
    }
    // duelo: a carga dos modelos (teto próprio) e os dois `dentro`, senão cancela sem resultado
    if (S.tipo === 'duelo' && S.bid && !S.fim && !(S.dentroEu && S.dentroEle)) {
      if (!S.dentroEu) {
        if (S.cargaTeto && ag > S.cargaTeto) { cancelaDuelo('carga'); return; }
        if (ag >= S.cargaProx) { S.cargaProx = ag + Coop.DENTRO_REP_MS; envia('carga', { b: S.bid }); }
      } else {
        if (S.dentroPrazo && ag > S.dentroPrazo) { cancelaDuelo('dentro'); return; }
        if (ag >= S.dentroRepProx) { S.dentroRepProx = ag + Coop.DENTRO_REP_MS; envia('dentro', { bid: S.bid, viu: false }); }
      }
    }
    // a foto FINAL que não veio (a autoridade saiu): segue com o que tem
    if (S.fimFotoPedidaEm && S.sincronizando && ag - S.fimFotoPedidaEm > 2 * Coop.FIM_GRUPO_MS) {
      S.sincronizando = false;
      muda();
    }
    var viva = emBatalha() && !S.fim;
    if (viva) confereSumico(ag);
    var stV = g && g.state, tV = stV ? (stV.turno || 0) : 0;
    // o sinal de vida a cada 8 s — e antes, se o meu turno passou do que eu disse
    // por último (quem espera um lance que se perdeu pede logo, não 8 s depois)
    if (viva && (ag - S.vivoEm >= Coop.VIVO_MS || (tV > (S.vivoT || 0) && ag - S.vivoEm >= 1000))) {
      S.vivoEm = ag;
      envia('vivo', { b: S.bid, T: tV });
    }
    if (S.sincronizando && ag - S.fotoPedidaEm >= Coop.FOTO_REPEDE_MS) pedeFoto();
    if (S.fim && !S.anotado && (S.fimDele || ag >= S.fimPrazo)) anotaDuelo();
    if (!Coop.ativo() && !S.bid) paraTique();
  }

  // ------------------------------------------------------------ sumiço, IA, W.O.
  function confereSumico(ag) {
    var p = parceiro(), g = G(), st = g && g.state;
    if (!p || !st || S.parceiroIA || S.fim) return;
    if (st.phase !== 'playing' && st.phase !== 'placing') return;
    var t0 = S.sumidoDesde || 0, mot = 'caiu';
    var visto = 0, r = R();
    try { visto = (r && r.visto) ? num(+r.visto(p.id), 0) : 0; } catch (e) { visto = 0; }
    var ultimo = Math.max(visto, S.ultimoSinal || 0);
    if (ultimo && ag - ultimo >= Coop.SILENCIO_MS && (!t0 || ultimo < t0)) t0 = ultimo;
    // o turno dele estourou. O prazo corre pelo MEU relógio, desde que EU
    // cheguei ao turno dele; se ele disse (lance ou `vivo`) que chegou depois
    // de mim — a animação dele anda atrás —, ganha até FOLGA_MS por isso.
    // Um `vivo` com turno velho não segura o prazo (antes, segurava para sempre)
    var es = S.esperando;
    if (es && es.prazo > 0) {
      var ini = es.desde;
      if (S.turnoDele === es.T && S.turnoDeleEm > es.desde) ini = Math.min(S.turnoDeleEm, es.desde + Coop.FOLGA_MS);
      var estouro = ini + es.prazo;
      if (ag >= estouro && (!t0 || estouro < t0)) { t0 = estouro; mot = 'prazo'; }
    }
    if (!t0) return;
    if (S.tipo === 'duelo') { if (ag - t0 >= Coop.WO_MS) venceWO(); return; }
    if (ag - t0 >= Coop.GRACA_MS) assumeParceiro(mot);
  }

  /* O PARCEIRO CAIU (12/09, pedido do dono: "caso ele cair do jogo/internet
   * deve continuar na luta se ela nao tiver acabado ou nascer na proxima sala
   * caso tenha acabado — e enquanto ele ta off seu turno passara").
   *
   * Passada a carencia, quem ficou vira autoridade e os herois dele ganham a
   * marca `ia`. A marca NAO significa mais "a IA joga por ele": o game.js
   * PASSA o turno de um heroi de gente marcado assim (a IA continua jogando
   * monstro, pet e invocacao). Foi o que o dono pediu, e e a diferenca com
   * quem SAI da batalha, que morre.
   *
   * Ele tambem nao perde a descida: o payload dos herois dele fica guardado
   * (`parceiroUltimo`) e a sala seguinte nasce com eles em pe, com o PV
   * carregado, mesmo sem o `pronto` — e quando a conexao voltar ele reassume
   * os corpos onde estiverem. */
  function assumeParceiro(mot) {
    var p = parceiro(), g = G(), st = g && g.state;
    if (!p || !st) return;
    S.parceiroIA = true;
    S.tomouAutoridade = true;
    S.cedeu = false;                     // se eu tinha cedido e ele sumiu agora, a autoridade volta a mim
    S.sincronizando = false;
    var uids = [];
    for (var i = 0; i < st.units.length; i++) {
      var u = st.units[i];
      if ((u.kind === 'hero' || u.kind === 'fusion') && u.dono === p.id && u.alive && !u.offBoard) {
        u.ia = true;
        marcaSrv('ia', u.uid, true);
        uids.push(u.uid);
      }
    }
    for (var j = 0; j < uids.length; j++) envia('ia', { b: S.bid, u: uids[j], mot: mot });
    if (st.phase === 'placing' && g._assumeColocacao) g._assumeColocacao();
    avisa(nomeParceiro() + ' caiu — o turno dele passa até voltar.', 'aviso');
    muda();
  }
  /* QUEM SAI DA BATALHA MORRE (12/09, pedido do dono: "um jogador quando
   * estiver em grupo e sair da batalha/desistir, ele deve morrer").
   *
   * Antes o heroi de quem saia ficava no tabuleiro com a IA ate o fim da sala:
   * abandonar era de graca, e ate ajudava (um corpo a mais lutando sem risco
   * para o dono). Agora o corpo CAI. A diferenca com quem apenas CAIU da
   * internet e proposital e e a metade de tras deste pedido: cair nao mata —
   * o heroi fica de pe, o turno dele passa, e ele volta quando a conexao
   * voltar (ver `assumeParceiro`).
   *
   * A morte cai assim que a voz chega (entre dois quadros, nunca no meio de
   * um lance: o JavaScript nao interrompe um lance em curso), e de novo no
   * `proximoLance` se chegou sem batalha. Quem SAIU nao simula mais nada,
   * entao so o motor de quem ficou importa — nao ha dois lados a igualar. */
  function marcaSaida(id) {
    var g = G(), st = g && g.state;
    S.parceiroSaiu = true;
    S.descidaAcabou = true;
    S.tomouAutoridade = true;
    if (!st) return;
    for (var i = 0; i < st.units.length; i++) {
      var u = st.units[i];
      if ((u.kind === 'hero' || u.kind === 'fusion') && u.dono === id && u.alive && !u.offBoard) {
        S.mortePendente[u.uid] = true;
      }
    }
    mataQuemSaiu();
  }
  /* mata os herois de quem saiu, se der agora: fora de um lance em curso */
  function mataQuemSaiu() {
    var g = G(), st = g && g.state, e = E();
    if (!st || !e || !e.processDeath) return false;
    // sala ja decidida: nada a derrubar (e processDeath rechecaria o fim)
    if (st.phase !== 'playing' && st.phase !== 'placing') { S.mortePendente = {}; return false; }
    var uids = Object.keys(S.mortePendente), fez = false;
    for (var i = 0; i < uids.length; i++) {
      var u = e.findUnit(st, uids[i]);
      delete S.mortePendente[uids[i]];
      if (!u || !u.alive || u.offBoard) continue;
      marcaSrv('morte', u.uid);
      try { e.processDeath(st, u); fez = true; } catch (er) {}
    }
    if (fez) {
      avisa(nomeParceiro() + ' saiu da batalha — o heroi dele cai.', 'aviso');
      muda();
    }
    return fez;
  }
  function venceWO() {
    var g = G();
    if (!g || !g.state || S.fim) return;
    S.fimMotivo = 'wo';
    S.tomouAutoridade = true;
    avisa(nomeParceiro() + ' saiu da arena — vitória por W.O.', 'ok');
    if (g._encerra) g._encerra(g.meuLado(), 'wo');
  }
  /* o duelo que não começou (a carga passou do teto, ou o `dentro` do outro
   * não veio): sem resultado. O outro fica sabendo pelo trilho da BATALHA
   * (o `cancela` do grupo.js não vale para quem já viu a arena) — `calado`
   * quando foi ele que cancelou. */
  function cancelaDuelo(mot, calado) {
    if (!calado && S.tipo === 'duelo' && S.bid) envia('desiste', { b: S.bid, mot: mot || 'dentro' });
    avisa(mot === 'carga' ? 'O duelo não começou — a arena demorou demais para carregar.'
                          : 'O duelo não começou — ' + nomeParceiro() + ' não entrou na arena.', 'aviso');
    var g = G();
    S = nova(null);
    if (g && g._saiDaRede) { try { g._saiDaRede(); } catch (e) {} }
    if (JOGO.Duelo && JOGO.Duelo.cancelar) { try { JOGO.Duelo.cancelar(mot || 'dentro'); } catch (e2) {} }
    paraTique();
    muda();
  }

  Coop.parceiroSumiu = function (id, t0) {
    var p = parceiro();
    if (!p || id !== p.id) return;
    var t = num(+t0, 0) || agora();
    var novo = !S.sumidoDesde;
    if (!S.sumidoDesde || t < S.sumidoDesde) S.sumidoDesde = t;
    if (novo && (emBatalha() || S.tipo === 'duelo') && !S.parceiroIA && !S.fim) {
      var s = Math.round((S.tipo === 'duelo' ? Coop.WO_MS : Coop.GRACA_MS) / 1000);
      avisa(nomeParceiro() + ' caiu — esperando voltar (' + s + ' s)…', 'aviso');
    }
    muda();
  };
  Coop.parceiroVoltou = function (id, cx) {
    var p = parceiro();
    if (!p || id !== p.id) return;
    if (cx) {
      p.cx = cx;
      if (cfg && cfg.parceiro && cfg.parceiro.id === id) cfg.parceiro.cx = cx;
    }
    var estava = !!S.sumidoDesde;
    S.sumidoDesde = 0;
    S.ultimoSinal = agora();
    if (estava) {
      S.parceiroVoltou = true;
      if (emBatalha()) {
        avisa(nomeParceiro() + ' voltou' + (S.parceiroIA ? ' — e volta a jogar.' : '.'), 'ok');
        var g = G(), st = g && g.state;
        /* ELE VOLTA A JOGAR (12/09). Enquanto estava fora o turno dele passava
         * (a marca `ia`); de volta, os corpos sao dele de novo. A marca sai
         * AQUI, no motor de quem ficou (a autoridade), e chega ao dele pela
         * foto de resgate que ele pede ao religar — `u.ia` entra no hash, entao
         * nunca se limpa so de um lado sem a foto atras. A voz `ia` com
         * mot 'volta' faz o outro lado CEDER a autoridade (senao, se liderava,
         * ele descartaria a minha foto) sem marcar nada. */
        if (st && S.tipo === 'grupo' && S.parceiroIA) {
          for (var i = 0; i < st.units.length; i++) {
            var u = st.units[i];
            if ((u.kind === 'hero' || u.kind === 'fusion') && u.dono === p.id && u.ia) {
              u.ia = false;
              marcaSrv('ia', u.uid, false);
              if (u.alive && !u.offBoard) envia('ia', { b: S.bid, u: u.uid, mot: 'volta' });
            }
          }
          S.parceiroIA = false;
        }
        // e o que ele mandou ao cx velho se perdeu: peço daqui em diante
        if (st) envia('pede', { b: S.bid, T: st.turno || 0, k: (S.log[st.turno || 0] || []).length });
      }
    }
    muda();
  };

  // ------------------------------------------------------------ antessala, pronto, ata, dentro
  function salaAtual() { var g = G(); return g ? (g.dungeonId + ':' + g.roomIndex) : ''; }
  function prontoValido() { return !!(S.prontoParceiro && S.prontoParceiro.sala === salaAtual()); }
  function mandaPronto() {
    var g = G();
    if (!g || !g.party || !g.party.length || !Coop.emGrupo()) return false;
    // 12/09: os MEUS selecionados (ate dois) — a sala nasce com os dois lados
    var ps = Coop.payloadMeus(g.party);
    if (!ps.length) return false;
    S.prontoProx = agora() + Coop.PRONTO_MS;
    return envia('pronto', { sala: salaAtual(), heroi: ps[0], herois: ps, versao: Coop.versao() });
  }
  /* O Game chama ao chegar na antessala de uma descida em grupo. */
  Coop.naAntessala = function () {
    if (!Coop.emGrupo()) return;
    devolveFichas();                            // 11/09: a ficha da sala passada sai; a ata nova empresta de novo
    S.tipo = 'grupo';
    S.fase = 'antessala';
    S.bid = null; S.fila = {}; S.log = {}; S.hashes = {}; S.foto = null; S.antes = {};
    S.ata = null; S.chamando = false; S.ataFalhou = false; S.ataEnvios = 0; S.ataFalhouEm = 0;
    S.proximaLiberada = false; S.proximaEnviada = false;
    // a `proxima` que eu (líder) mandei ao sair da recompensa segue repetindo até o `pronto`
    var g0 = G();
    if (!S.proximaSala || !g0 || S.proximaSala.roomIndex !== g0.roomIndex) S.proximaSala = null;
    S.parceiroIA = false; S.mortePendente = {};
    S.meAssumiu = false; S.cedeu = false;
    /* 12/09: a autoridade que eu tomei por uma QUEDA do parceiro atravessa a
     * sala. Sem isto a descida travava aqui: quem ficou abria a recompensa
     * como lider (por `tomouAutoridade`), pedia a sala seguinte — e chegando
     * na antessala deixava de ser lider, sem ninguem para abrir a porta. Quem
     * SAIU e outra coisa: ali a descida acabou mesmo (`descidaAcabou`). */
    S.tomouAutoridade = !!S.sumidoDesde && !S.parceiroSaiu;
    S.esperando = null; S.sincronizando = false; S.fotoPendente = false; S.fimFotoPedidaEm = 0;
    S.fimGrupo = null; S.fimGrupoDele = null; S.fimGrupoMeu = null; S.dentroConfirmado = false;
    ligaTique();
    if (!souLider()) mandaPronto();
    muda();
  };
  Coop.podeEntrar = function () {
    var g = G();
    if (!Coop.emGrupo()) return { ok: false, motivo: 'ocupado' };
    if (!souLider()) return { ok: false, motivo: 'nao-lider' };
    if (!g || g.screen !== 'antessala' || !g.modoRede || g.modoRede() !== 'grupo') return { ok: false, motivo: 'sala' };
    if (S.chamando) return { ok: false, motivo: 'ocupado' };
    /* 12/09: o `pronto` do parceiro e o caminho normal; sem ele — ele CAIU da
     * internet — a sala seguinte nasce com os herois guardados da sala
     * passada, para ele nao perder a descida por uma queda. */
    if (prontoValido() && S.prontoParceiro.versao && S.prontoParceiro.versao !== Coop.versao()) {
      return { ok: false, motivo: 'versao' };
    }
    var hsP = heroisDoParceiro();
    if (!hsP.length) return { ok: false, motivo: 'sem-pronto' };
    if (hsP.length > Coop.MAX_HEROIS) return { ok: false, motivo: 'versao' };
    for (var i = 0; i < hsP.length; i++) if (!validaPayload(hsP[i])) return { ok: false, motivo: 'versao' };
    return { ok: true, motivo: null };
  };
  /* a conta do servidor de quem está na Rede (o `nuvem` que o relé conferiu), ou null */
  function nuvemDe(id) {
    var r = R(), achou = null;
    try { if (r && r.pares) r.pares().forEach(function (p2) { if (p2.id === id) achou = p2.nuvem || null; }); } catch (e) {}
    return achou;
  }
  /* O líder, no "Entrar na batalha": manda a ata e só cria a batalha dele no `dentro`. */
  Coop.entrar = function () {
    var pe = Coop.podeEntrar();
    if (!pe.ok) {
      if (pe.motivo === 'versao') avisa('Vocês estão em versões diferentes do jogo — recarreguem a página.', 'aviso');
      return false;
    }
    var g = G(), p = parceiro();
    var meus = Coop.payloadMeus(g.party);
    if (!meus.length) return false;
    // 12/09: a ata leva os MEUS na frente e os do parceiro atras (o `rAta` do
    // outro lado confere essa ordem, e o `dono` e sempre quem mandou)
    var pars = heroisDoParceiro().map(function (h) {
      var c = clone(h);
      c.dono = p.id;                  // o dono e sempre quem mandou, nunca o escrito
      return c;
    });
    if (!pars.length) return false;
    /* A SEGURANÇA (13/09): com sessão do site a SEMENTE da sala em grupo vem do
     * servidor — ele refaz a batalha e paga os dois no fim. O líder pede, e a
     * ata sai quando a semente chega (com o PV que o servidor anotou). */
    var Aut = JOGO.Autoridade;
    if (Aut && Aut.ligada && Aut.ligada() && Coop._sementeFixa == null) {
      if (S.pedindoGrupo) return true;
      var contaPar = nuvemDe(p.id);
      if (!contaPar) {
        avisa('O servidor não conferiu a conta de ' + nomeParceiro() + ' — ela precisa entrar na conta e recarregar a página.', 'aviso');
        return false;
      }
      S.pedindoGrupo = true;
      var idsDe = function (lista) { return lista.map(function (h) { return h.heroId || h.classId; }); };
      Aut.abreGrupo({ dungeonId: g.dungeonId, roomIndex: g.roomIndex, dificuldade: g.dificuldade || 'normal',
                      herois: idsDe(meus), dono: meuId(),
                      parceiro: { conta: contaPar, dono: p.id, herois: idsDe(pars) } }).then(function (r) {
        S.pedindoGrupo = false;
        if (!r || !r.ok || typeof r.semente !== 'number' || typeof r.gid !== 'string') {
          avisa('O servidor não abriu a sala do grupo: ' + ((r && r.erro) || 'sem resposta') + '.', 'aviso');
          muda();
          return;
        }
        mandaAta(g, p, meus, pars, r.semente >>> 0, r.carry || null, r.gid);
      });
      muda();
      return true;
    }
    mandaAta(g, p, meus, pars,
             (Coop._sementeFixa != null) ? (Coop._sementeFixa >>> 0) : novaSemente(),
             (g._carry && g._carry()) || null, null);
    return true;
  };
  function mandaAta(g, p, meus, pars, semente, carry, gid) {
    lembraParceiro(p.id, pars);
    S.n++;
    // a ata passa pelo JSON também do lado do líder: os dois motores montam a
    // batalha do MESMO texto (undefined some, NaN vira null — nos dois)
    S.ata = clone({
      bid: (cfg.gid || 'g') + ':' + g.dungeonId + ':' + g.roomIndex + ':' + S.n,
      dungeonId: g.dungeonId, roomIndex: g.roomIndex,
      dificuldade: g.dificuldade || 'normal',
      semente: semente,
      versao: Coop.versao(),
      party: meus.concat(pars),
      carry: carry,
      gid: gid                        // 13/09: a sala do grupo no servidor (null sem sessão)
    });
    S.chamando = true; S.ataFalhou = false;
    S.ataEnvios = 1; S.ataProx = agora() + Coop.ATA_MS;
    envia('ata', S.ata);
    muda();
  }
  function iniciaBatalha(bid) {
    S.bid = bid;
    S.fila = {}; S.log = {}; S.hashes = {}; S.foto = null;
    S.logSrv = []; S.fotografada = false;
    S.buracoDesde = 0; S.sincronizando = false; S.fotoPendente = false; S.fotoDepois = false;
    S.ultimoSinal = agora(); S.turnoDele = 0; S.turnoDeleEm = 0; S.vivoEm = 0;
    S.esperando = null; S.fim = null; S.fimDele = null; S.anotado = false;
    S.cedeu = false; S.pedeEm = 0; S.fotoEm = 0;
    S.fimGrupo = null; S.fimGrupoDele = null; S.fimGrupoMeu = null; S.fimFotoPedidaEm = 0;
    S.dentroConfirmado = false; S.dentroRepProx = 0; S.proximaSala = null;
    var antes = S.antes[bid] || [];
    S.antes = {};
    for (var i = 0; i < antes.length; i++) {
      var l = antes[i];
      S.fila[l.T + ':' + l.k] = l;
    }
  }
  function rPronto(d) {
    if (!d || !d.sala) return;
    var bruta = (Object.prototype.toString.call(d.herois) === '[object Array]')
      ? d.herois : ((d.heroi && typeof d.heroi === 'object') ? [d.heroi] : []);
    var quem = parceiro().id, hs = [];
    for (var i = 0; i < bruta.length && hs.length < Coop.MAX_HEROIS; i++) {
      if (!bruta[i] || typeof bruta[i] !== 'object') continue;
      var h = clone(bruta[i]);
      h.dono = quem;                     // o dono do heroi e quem mandou, nunca o que veio escrito
      hs.push(h);
    }
    if (!hs.length) return;
    S.prontoParceiro = { sala: String(d.sala), heroi: hs[0], herois: hs, versao: d.versao || null };
    muda();
  }
  function rAta(d) {
    if (!d || souLider() || S.tipo === 'duelo') return;
    var g = G();
    if (!g) return;
    if (S.bid && d.bid === S.bid) { envia('dentro', { bid: d.bid }); return; }   // ata repetida: já estou dentro
    // a rede de segurança da `proxima` perdida: a ata da sala SEGUINTE chegou
    // comigo ainda na recompensa — sigo (o `seguir`) e a ata vale a seguir
    if (g.screen === 'roomClear' && d.dungeonId === g.dungeonId && d.roomIndex === g.roomIndex + 1 && !S.descidaAcabou) {
      S.proximaLiberada = true;
      Coop.seguir();
    }
    if (g.screen !== 'antessala' || g.dungeonId !== d.dungeonId || g.roomIndex !== d.roomIndex) return;
    if (d.versao !== Coop.versao()) {
      avisa('Vocês estão em versões diferentes do jogo — recarreguem a página.', 'aviso');
      return;
    }
    var p = parceiro();
    // 12/09: de dois a quatro herois, os de quem lidera na frente e os MEUS
    // atras — nada mais abre a sala (ver okGrupoDaAta)
    if (!okGrupoDaAta(d.party, p.id, meuId())) {
      avisa('Vocês estão em versões diferentes do jogo — recarreguem a página.', 'aviso');
      return;
    }
    iniciaBatalha(d.bid);
    S.ata = d;
    S.chamando = false;
    // 12/09: guardo os herois de quem lidera, para uma queda dele nao acabar
    // a descida na sala seguinte
    lembraParceiro(p.id, d.party.filter(function (x) { return x && x.dono === p.id; }));
    emprestaFichas(d.party);                    // 11/09: o Mestre no grupo (a ficha, só para a batalha)
    if (!g._criaDaAta || !g._criaDaAta(d)) { S.bid = null; S.ata = null; return; }
    S.fase = 'placing';
    S.dentroRepProx = agora() + Coop.ATA_MS;
    envia('dentro', { bid: d.bid });
    muda();
  }
  function rDentro(d) {
    if (!d || !d.bid) return;
    if (S.tipo === 'duelo') {
      if (d.bid !== S.bid) return;
      S.dentroEle = true;
      S.ultimoSinal = agora();
      // ele ainda não ouviu o meu: respondo (o dele pode ter vindo antes de eu entrar, ou o meu se perdeu)
      if (S.dentroEu && d.viu !== true) envia('dentro', { bid: S.bid, viu: true });
      muda();
      return;
    }
    if (!souLider()) return;
    var g = G();
    if (S.bid && d.bid === S.bid) return;                      // já estamos dentro: o `p` (ou o `vivo`) responde
    var tarde = !S.chamando && S.ataFalhou && S.ata && d.bid === S.ata.bid &&
                agora() - (S.ataFalhouEm || 0) <= Coop.ATA_TARDE_MS;
    if (!S.ata || d.bid !== S.ata.bid || !(S.chamando || tarde)) {
      // uma batalha que eu não abro mais (a ata falhou há muito, ou já mandei outra):
      // a parceira volta para a antessala, senão fica na colocação para sempre
      if (g && g.screen === 'antessala' && !S.bid) envia('cancela', { bid: d.bid });
      return;
    }
    if (!g || g.screen !== 'antessala') return;
    S.chamando = false; S.ataFalhou = false;
    var ata = S.ata;
    iniciaBatalha(ata.bid);
    S.ata = ata;
    emprestaFichas(ata.party);                  // 11/09: o Mestre no grupo (a ficha, só para a batalha)
    if (!g._criaDaAta || !g._criaDaAta(ata)) {
      S.bid = null;
      avisa('Não deu para abrir a sala.', 'aviso');
      muda();
      return;
    }
    S.fase = 'placing';
    muda();
  }

  // ------------------------------------------------------------ o registro do servidor
  /* A SEGURANÇA (13/09): o servidor paga a sala em grupo refazendo a batalha. O
   * S.log é o do lockstep (indexado por turno, com os buracos e os pedidos) e
   * não pode ganhar entrada nenhuma; este é outro: a sequência EXATA do que
   * este motor aplicou — os lances dos dois, na ordem em que entraram, e as
   * MARCAS que mudam a batalha fora dos lances (quem caiu, quem voltou, quem
   * saiu e morreu). Uma foto de resgate troca o estado inteiro: depois dela
   * este registro não refaz mais a sala, e a marca `fotografada` avisa. */
  function anotaSrv(l) {
    if (!S.bid || !S.logSrv) return;
    var c = { a: l.a, ok: !!l.ok };
    if (l.u != null) c.u = l.u;
    if (l.x != null) c.x = l.x;
    if (l.y != null) c.y = l.y;
    if (l.s != null) c.s = l.s;
    if (l.alvo != null) c.alvo = l.alvo;
    if (l.de != null) c.de = l.de;
    if (l.ev != null) c.ev = l.ev;
    if (l.v != null) c.v = l.v;
    if (S.logSrv.length < 6000) S.logSrv.push(c);
  }
  function marcaSrv(ev, uid, v) { anotaSrv({ a: 'x', ev: ev, u: uid, v: v, ok: true }); }
  /* o registro para fechar a sala no servidor */
  Coop.logServidor = function () {
    return { bid: S.bid, lances: (S.logSrv || []).slice(), fotografada: !!S.fotografada,
             autoridade: autoridadeId() === meuId(), ata: S.ata ? clone(S.ata) : null };
  };

  // ------------------------------------------------------------ os lances
  /* O Game chama DEPOIS de aplicar um lance local no motor (l.T = o turno de
   * ANTES do lance). Carimba (T, k), o que o motor devolveu e, se o turno
   * mudou, o hash de logo depois — e manda. */
  Coop.registra = function (l, ok) {
    var g = G(), st = g && g.state;
    if (!st || !S.bid || !l) return;
    anotaSrv({ a: l.a, u: l.u, x: l.x, y: l.y, s: l.s, alvo: l.alvo, ok: !!ok, de: meuId() });
    var T = (typeof l.T === 'number') ? l.T : 0;
    var lista = S.log[T] || (S.log[T] = []);
    l.T = T; l.k = lista.length; l.b = S.bid; l.ok = !!ok; l.de = meuId();
    var T2 = st.turno || 0;
    if (T2 !== T || st.phase !== 'playing') { l.T2 = T2; l.h = E().hash(st); }
    if (l.a === 'e') l.bk = Math.round(num(g.banked, 0));
    lista.push(l);
    envia('lance', paraFio(l, false));
  };
  function guardaAntes(l) {
    var fila = S.antes[l.b] || (S.antes[l.b] = []);
    if (fila.length < 400) fila.push(l);
  }
  function jaVisto(l) {
    var g = G(), st = g && g.state;
    var T = st ? (st.turno || 0) : 0;
    if (l.T < T) return true;
    var lista = S.log[l.T];
    return !!(lista && l.k < lista.length);
  }
  function rLance(d, de) {
    if (!d || typeof d.T !== 'number' || typeof d.k !== 'number' || !d.a) return;
    d.de = de;
    if (d.T > (S.turnoDele || 0)) { S.turnoDele = d.T; S.turnoDeleEm = agora(); }
    // o banco do outro tem teto: bk = 1e9 dava um prazo de anos
    if (d.a === 'e' && d.bk != null) S.bkParceiro = Math.max(0, Math.min(num(+d.bk, 0), num((G() || {}).bankMax, 120)));
    if (S.bid && d.b === S.bid) S.dentroConfirmado = true;
    if (!S.bid || d.b !== S.bid) { if (d.b) guardaAntes(d); return; }
    if (jaVisto(d)) return;
    S.fila[d.T + ':' + d.k] = d;
  }
  function haAdiante(T, k) {
    var eu = meuId();
    for (var key in S.fila) {
      if (!Object.prototype.hasOwnProperty.call(S.fila, key)) continue;
      var l = S.fila[key];
      if (l.de === eu) continue;
      if (l.T > T || (l.T === T && l.k > k)) return true;
    }
    return false;
  }
  /* O lance só vale do DONO da unidade da vez, e com ELA (o `e` fecha a vez).
   * Na colocação, só o `p` de quem coloca. Um cliente alterado pré-carregava
   * um `e` para a MINHA vez (pulava o meu turno) ou mandava `m`/`c` com o meu
   * herói — e o hash ele calculava certo. */
  function donoCerto(l, st) {
    var g = G();
    if (!l || !st || !g) return false;
    if (st.phase === 'placing') {
      var quem = (g.podeColocar && g.podeColocar()) ? meuId() : (parceiro() || {}).id;
      return l.a === 'p' && !!l.de && l.de === quem;
    }
    if (l.a === 'p') return false;
    var au = E().activeUnit(st);
    if (!au || au.ia || !au.dono || au.dono !== l.de) return false;
    return l.a === 'e' || l.u === au.uid;
  }
  Coop._donoCerto = donoCerto;
  function lanceTorto(l) {
    S.tortos++;
    if (S.tipo === 'duelo') {
      S.fimMotivo = 'contestado';
      var g = G();
      if (g && g._encerra && g.state && !S.fim) g._encerra(null, 'trapaca');
    } else if (S.tortos === 1) avisa(nomeParceiro() + ' mandou um lance que não era dele — ignorado.', 'aviso');
    muda();
  }
  /* O próximo lance da fila para o turno atual, ou null. */
  Coop.proximoLance = function (uid) {
    var g = G(), st = g && g.state;
    if (!st || !S.bid) return null;
    var T = st.turno || 0, k = (S.log[T] || []).length, key = T + ':' + k;
    var l = S.fila[key];
    if (l) {
      delete S.fila[key];
      S.buracoDesde = 0;
      if (!donoCerto(l, st)) { lanceTorto(l); return null; }
      return l;
    }
    // 12/09: quem saiu da batalha morre — na fila, no mesmo ponto dos dois lados
    if (mataQuemSaiu()) return null;
    // falta lance: há um lance DELE mais adiante na fila, ou ele já disse (no
    // `vivo`) que passou deste turno — o último lance do turno (o `e`, o `p`)
    // não tem "posterior" que o denuncie, e se perdia numa queda curta
    var u0 = uid ? E().findUnit(st, uid) : null;
    var dele = !uid || (!!u0 && g.donoDe && g.donoDe(u0) === 'parceiro');
    if (haAdiante(T, k) || (dele && S.turnoDele > T)) {
      var ag = agora();
      if (!S.buracoDesde) S.buracoDesde = ag;
      else if (ag - S.buracoDesde >= Coop.BURACO_MS) {
        S.buracoDesde = ag;
        envia('pede', { b: S.bid, T: T, k: k });
      }
    } else S.buracoDesde = 0;
    return null;
  };
  /* O Game chama DEPOIS de aplicar um lance que veio da fila (do outro, ou um
   * meu reaplicado depois da foto). Confere o que o motor devolveu e o hash. */
  Coop.aplicado = function (l, ok, semConferir) {
    if (!l) return;
    anotaSrv({ a: l.a, u: l.u, x: l.x, y: l.y, s: l.s, alvo: l.alvo, ok: !!ok, de: l.de });
    var T = l.T || 0;
    var lista = S.log[T] || (S.log[T] = []);
    lista.push(l);
    var g = G(), st = g && g.state;
    if (l.de === meuId()) {
      // um lance MEU que voltou à fila depois da foto: reaplicado aqui, sai de
      // novo com o resultado e o hash DE AGORA (a autoridade pode não o ter
      // recebido: ia ao cx velho, ou no socket meio morto). Repetido, ela descarta
      if (l.reenvia && st) {
        delete l.reenvia;
        l.ok = !!ok;
        var T2 = st.turno || 0;
        if (T2 !== T || st.phase !== 'playing') { l.T2 = T2; l.h = E().hash(st); }
        else { delete l.T2; delete l.h; }
        envia('lance', paraFio(l, false));
      }
      return;
    }
    if (semConferir || !st) return;
    var mot = null;
    if (typeof l.ok === 'boolean' && l.ok !== !!ok) mot = 'ok';
    if (!mot && l.T2 != null) {
      if ((st.turno || 0) !== l.T2) mot = 'turno';
      else if (E().hash(st) !== l.h) mot = 'hash';
    }
    if (mot) divergiu(mot, T);
  };
  /* O outro pede os MEUS lances de (T, k) em diante. Com freio: um pedido por
   * PEDE_MIN_MS e no máximo PEDE_MAX lances por pedido — uma rajada de `pede`
   * me fazia estourar o balde do relé e ser desligado (e no duelo, W.O.). */
  function rPede(d) {
    if (!d || d.b !== S.bid) return;
    var ag = agora();
    if (S.pedeEm && ag - S.pedeEm < Coop.PEDE_MIN_MS) return;
    S.pedeEm = ag;
    var eu = meuId(), T0 = num(d.T, 0), k0 = num(d.k, 0), n = 0;
    var ts = [];
    for (var t in S.log) if (Object.prototype.hasOwnProperty.call(S.log, t) && +t >= T0) ts.push(+t);
    ts.sort(function (a, b) { return a - b; });
    for (var i = 0; i < ts.length && n < Coop.PEDE_MAX; i++) {
      var lista = S.log[ts[i]] || [];
      for (var j = 0; j < lista.length && n < Coop.PEDE_MAX; j++) {
        var l = lista[j];
        if (l.de !== eu) continue;
        if (ts[i] === T0 && l.k < k0) continue;
        envia('lance', paraFio(l, false));
        n++;
      }
    }
  }

  // ------------------------------------------------------------ turno, hash e foto
  /* O Game chama sempre que `state.turno` muda (depois de QUALQUER chamada ao motor). */
  Coop.aoTurno = function (st) {
    if (!st || !S.bid) return;
    var T = st.turno || 0, e = E(), g = G();
    try { S.hashes[T] = e.hash(st); } catch (e1) {}
    if (st.phase === 'playing') { try { S.foto = { T: T, estado: e.foto(st) }; } catch (e2) {} }
    var k;
    for (k in S.hashes) if (Object.prototype.hasOwnProperty.call(S.hashes, k) && +k < T - Coop.HASHES) delete S.hashes[k];
    for (k in S.log) if (Object.prototype.hasOwnProperty.call(S.log, k) && +k < T - Coop.HASHES) delete S.log[k];
    var u = (st.phase === 'playing') ? e.activeUnit(st) : null;
    var donoU = (u && g && g.donoDe) ? g.donoDe(u) : null;
    if (donoU === 'parceiro') {
      S.esperando = { uid: u.uid, T: T, desde: agora(),
                      prazo: Math.round((num(g.turnTime, 30) + S.bkParceiro) * 1000) };
    } else {
      S.esperando = null;
      // o MEU turno começou: o `vivo` sai na hora — quem espera mede o meu
      // prazo desde este instante, e não até 8 s depois
      if (donoU === 'eu' && !S.fim) { S.vivoEm = agora(); envia('vivo', { b: S.bid, T: T }); }
    }
    // e a cada turno que passa (no máximo um a cada 2 s): quem está parado num
    // lance que se perdeu sabe logo que eu já passei dele, e pede
    if (donoU !== 'eu' && !S.fim && st.phase === 'playing' && agora() - S.vivoEm >= 2000) {
      S.vivoEm = agora();
      envia('vivo', { b: S.bid, T: T });
    }
    S.fase = st.phase === 'placing' ? 'placing' : (st.phase === 'playing' ? 'batalha' : 'fim');
    if (S.fotoPendente && st.phase === 'playing' && souAutoridade()) { S.fotoPendente = false; mandaFoto(); }
    if (S.fotoDepois && st.phase === 'playing' && !souAutoridade()) { S.fotoDepois = false; pedeFoto(); }
    muda();
  };
  /* Divergiu. No DUELO não há árbitro (a foto de um lado é só a palavra
   * dele): a partida acaba sem vencedor. No grupo, quem não é a autoridade
   * pede a foto; a autoridade AVISA (`dessinc`) e a outra pede — ninguém
   * aceita foto que não pediu. */
  function divergiu(mot, T) {
    S.dessinc++;
    S.ultimaDessinc = { mot: mot, T: T, t: agora() };
    if (S.tipo === 'duelo') {
      S.fimMotivo = 'contestado';
      var g = G();
      if (g && g._encerra && g.state && !S.fim) g._encerra(null, 'dessinc');
      muda();
      return;
    }
    if (souAutoridade()) envia('dessinc', { b: S.bid, T: T });
    else pedeFoto();
    muda();
  }
  function rDessinc(d) {
    if (!d || S.tipo !== 'grupo' || d.b !== S.bid || souAutoridade() || S.sincronizando) return;
    S.dessinc++;
    S.ultimaDessinc = { mot: 'aviso', T: num(d.T, 0), t: agora() };
    pedeFoto();
    muda();
  }
  function pedeFoto() {
    var g = G(), st = g && g.state;
    if (!st || !S.bid) return;
    // nunca em placing (o `placement` guarda referência de unidade): pede assim
    // que a batalha começar — e sem travar a colocação, que o `p` destrava
    if (st.phase === 'placing') { S.fotoDepois = true; return; }
    // um pedido em curso basta: o tique repete no prazo (dois gatilhos juntos —
    // o `ia` e o `religou` — pediam duas vezes, e o freio da autoridade calava o segundo)
    if (S.sincronizando && agora() - S.fotoPedidaEm < Coop.FOTO_REPEDE_MS) return;
    var primeira = !S.sincronizando;
    S.sincronizando = true;
    S.fotoPedidaEm = agora();
    envia('foto-pede', { b: S.bid, T: st.turno || 0 });
    if (primeira) avisa('Sincronizando com ' + nomeParceiro() + '…', 'info');
  }
  function mandaFoto() {
    var g = G(), st = g && g.state;
    if (!st || !S.bid) return false;
    if (st.phase === 'placing') { S.fotoPendente = true; return false; }
    S.fotoEm = agora();
    if (st.phase !== 'playing') {
      // a sala já acabou aqui: a foto é a do FIM (quem divergiu no último turno paga por ela)
      var fim = null;
      try { fim = E().foto(st); } catch (e0) { fim = null; }
      if (!fim) return false;
      return envia('foto', { b: S.bid, T: st.turno || 0, estado: fim, lances: [], lider: autoridadeId(), fim: true });
    }
    if (!S.foto) return false;
    var ls = (S.log[S.foto.T] || []).map(function (l) { return paraFio(l, true); });
    // quem está na IA AGORA: a foto é do começo do turno, e o `ia` pode ter
    // entrado no meio dele (quem sumiu, quem cedeu) — quem restaura marca de novo
    var ia = [];
    for (var i = 0; i < st.units.length; i++) {
      var u = st.units[i];
      if ((u.kind === 'hero' || u.kind === 'fusion') && u.ia) ia.push(u.uid);
    }
    return envia('foto', { b: S.bid, T: S.foto.T, estado: S.foto.estado, lances: ls, lider: autoridadeId(), ia: ia });
  }
  function rFotoPede(d) {
    // no duelo não há foto; quem cedeu a autoridade não fotografa
    if (S.tipo === 'duelo' || S.cedeu) return;
    if (!d || d.b !== S.bid || !souAutoridade()) return;
    var g = G(), st = g && g.state;
    if (st && st.phase === 'placing') { S.fotoPendente = true; return; }
    if (S.fotoEm && agora() - S.fotoEm < Coop.PEDE_MIN_MS) return;     // o freio (a foto são 2 ou 3 fatias)
    mandaFoto();
  }
  function rFoto(d) {
    if (S.tipo === 'duelo') return;                          // no duelo, a foto do outro é só a palavra dele
    if (!d || d.b !== S.bid || !d.estado || souAutoridade()) return;
    if (!S.sincronizando) return;                            // só a foto que EU pedi
    restaura(d);
  }
  /* A RESTAURAÇÃO: o estado vira o da foto; os lances que eu tinha aplicado
   * a partir dela voltam para a fila (os meus são reaplicados sem reenviar). */
  /* A FOTO NÃO PODE TRAZER UMA FUSÃO CRUZADA (12/09). Fundir é só entre
   * personagens do MESMO jogador, então uma foto de resgate em que os dois
   * lados de uma fusão têm donos diferentes só pode vir de um cliente
   * alterado — e é recusada inteira. Antes desta data a fusão entre jogadores
   * existia com os dois aceitando, e aqui se conferia o MEU sim; com a regra
   * absoluta a conferência ficou mais simples E mais forte: nem o meu sim
   * abriria a porta. */
  function fotoSemFusaoCruzada(estado) {
    var st = null;
    try { st = (typeof estado === 'string') ? JSON.parse(estado) : estado; } catch (e) { return false; }
    if (!st || !st.units) return false;
    var porUid = {}, i;
    for (i = 0; i < st.units.length; i++) porUid[st.units[i].uid] = st.units[i];
    for (i = 0; i < st.units.length; i++) {
      var f = st.units[i];
      if (f.kind !== 'fusion' || !f.fusedFrom || f.fusedFrom.length < 2) continue;
      var ua = porUid[f.fusedFrom[0]], ub = porUid[f.fusedFrom[1]];
      // o lado A da fusão É a própria unidade fundida (o uid se preserva)
      var donoA = (ua ? ua.dono : f.dono) || null, donoB = (ub ? ub.dono : null) || null;
      if (ub && donoA !== donoB) return false;
    }
    return true;
  }
  function restaura(pkt) {
    var g = G();
    if (!g || !g.restauraFoto) return false;
    if (!fotoSemFusaoCruzada(pkt.estado)) {
      S.sincronizando = false;
      avisa('A foto de ' + nomeParceiro() + ' trazia uma fusão entre heróis de jogadores diferentes — ignorada.', 'aviso');
      muda();
      return false;
    }
    var T0 = num(pkt.T, 0), nFoto = (pkt.lances || []).length;
    var nova = {}, t, i, l;
    for (t in S.log) {
      if (!Object.prototype.hasOwnProperty.call(S.log, t) || +t < T0) continue;
      var lista = S.log[t];
      for (i = 0; i < lista.length; i++) {
        l = lista[i];
        if (+t === T0 && l.k < nFoto) continue;
        nova[l.T + ':' + l.k] = l;
      }
    }
    for (var key in S.fila) {
      if (!Object.prototype.hasOwnProperty.call(S.fila, key)) continue;
      l = S.fila[key];
      if (l.T < T0 || (l.T === T0 && l.k < nFoto)) continue;
      if (!nova[key]) nova[key] = l;
    }
    for (t in S.log) if (Object.prototype.hasOwnProperty.call(S.log, t) && +t >= T0) delete S.log[t];
    S.log[T0] = [];
    S.fila = nova;
    var lances = (pkt.lances || []).map(function (x) { var y = clone(x); if (!y.de) y.de = autoridadeId(); return y; });
    // os MEUS que voltaram à fila saem de novo quando forem reaplicados (Coop.aplicado)
    var eu = meuId();
    for (var kk in S.fila) {
      if (Object.prototype.hasOwnProperty.call(S.fila, kk) && S.fila[kk].de === eu) S.fila[kk].reenvia = true;
    }
    var ok = false;
    var ia = [];
    if (Object.prototype.toString.call(pkt.ia) === '[object Array]') {
      for (var q = 0; q < pkt.ia.length && q < 16; q++) if (typeof pkt.ia[q] === 'string') ia.push(pkt.ia[q]);
    }
    try { ok = !!g.restauraFoto({ T: T0, estado: pkt.estado, lances: lances, ia: ia }); } catch (e) { ok = false; }
    S.sincronizando = !ok;
    if (ok) {
      S.fotografada = true;              // 13/09: o estado veio da foto — este registro não refaz mais a sala
      S.restauracoes++;
      S.restauradaEm = agora();
      S.meAssumiu = false;
      S.fimFotoPedidaEm = 0;
      S.fimGrupo = null;
      if (!pkt.fim) S.foto = { T: T0, estado: pkt.estado };
    }
    muda();
    return ok;
  }

  // ------------------------------------------------------------ controle: ia, fusão, próxima, desistência
  function rIa(d) {
    // no duelo ninguém põe o herói do outro na IA (o sumiço lá é W.O.)
    if (!d || d.b !== S.bid || S.tipo === 'duelo') return;
    var g = G(), st = g && g.state, p = parceiro();
    if (!st || !p) return;
    var u = E().findUnit(st, d.u);
    if (!u || (u.kind !== 'hero' && u.kind !== 'fusion')) return;
    if (u.dono === meuId() && d.mot === 'volta') {
      // 12/09: eu voltei — o outro devolveu os meus corpos. Cedo a autoridade
      // (ate o fim da sala) e me acerto pela foto dele, que ja vem sem a marca
      u.ia = false;
      S.meAssumiu = false;
      S.cedeu = true;
      S.tomouAutoridade = false;
      S.fotoPendente = false;
      pedeFoto();
    } else if (u.dono === meuId()) {
      // o outro me deu por sumido: o turno dos MEUS herois passa (12/09). CEDO a
      // autoridade (até o fim da sala) e sincronizo pela foto dele
      u.ia = true;
      S.meAssumiu = true;
      S.cedeu = true;
      S.tomouAutoridade = false;
      S.fotoPendente = false;
      pedeFoto();
    }
    muda();
  }
  /* O PARCEIRO SAIU DA BATALHA (12/09): o heroi dele MORRE. So vale para o
   * proprio heroi de quem falou — ninguem derruba o heroi do outro por aqui —
   * e a morte cai na fila, no mesmo ponto dos dois motores (marcaSaida). */
  function rSai(d) {
    if (!d || d.b !== S.bid || S.tipo === 'duelo') return;
    var g = G(), st = g && g.state, p = parceiro();
    if (!st || !p) return;
    var u = E().findUnit(st, d.u);
    if (!u || (u.kind !== 'hero' && u.kind !== 'fusion')) return;
    if (u.dono !== p.id) return;
    S.parceiroSaiu = true;
    S.descidaAcabou = true;
    S.tomouAutoridade = true;
    S.cedeu = false;
    S.mortePendente[d.u] = true;
    mataQuemSaiu();
    muda();
  }
  /* FUNDIR ENTRE JOGADORES NÃO EXISTE MAIS (12/09, pedido do dono: "o jogador
   * só pode fundir com seus personagens e não com os do outro jogador"). Com
   * isso saíram daqui as vozes `fusao-pede` e `fusao-ok`, o pedido que
   * expirava em 20 s, o meu sim guardado (`consenti`) e as duas perguntas que
   * o game.js fazia (`_consentido`, `_eleConsentiu`). A fusão de um jogador
   * com os HERÓIS DELE segue viajando como sempre: o lance `f`, que os dois
   * motores aplicam igual. A trava mora em Fusion.canFuse, que é a porta por
   * onde o lance passa nos dois lados. */
  /* A passagem de sala: o líder libera (manda `proxima`), o parceiro segue. O
   * Game.nextRoom pergunta aqui antes de sair da tela de recompensa. */
  Coop._liberaNextRoom = function () {
    if (S.descidaAcabou || !Coop.emGrupo()) return false;
    if (souLider()) {
      if (!S.proximaEnviada) {
        S.proximaEnviada = true;
        var g = G();
        // a `proxima` repete (no tique) até o `pronto` da parceira: uma piscada
        // dela na recompensa não acaba mais a descida
        S.proximaSala = { b: S.bid, roomIndex: (g ? g.roomIndex : 0) + 1 };
        S.proximaVezes = 0;
        S.proximaProx = agora() + Coop.PROXIMA_MS;
        envia('proxima', S.proximaSala);
      }
      return true;
    }
    return !!S.proximaLiberada;
  };
  Coop.proxima = function () {
    if (!souLider()) return false;
    var g = G();
    return !!(g && g.nextRoom && g.nextRoom());
  };
  Coop.seguir = function () {
    if (souLider() || !S.proximaLiberada) return false;
    var g = G();
    return !!(g && g.nextRoom && g.nextRoom());
  };
  function rProxima(d) {
    if (souLider()) return;
    var g = G();
    // vale só na tela de recompensa, para a sala seguinte (a repetição chega
    // também na antessala); idempotente
    if (!g || g.screen !== 'roomClear') return;
    if (d && typeof d.roomIndex === 'number' && d.roomIndex !== g.roomIndex + 1) return;
    if (S.proximaLiberada) return;
    S.proximaLiberada = true;
    muda();
    if (piloto && piloto.segue) Coop.seguir();
  }
  Coop.sairDaBatalha = function () {
    var g = G(), st = g && g.state, eu = meuId();
    if (st && S.bid && g.screen === 'battle' && S.tipo === 'grupo') {
      var u = (st.phase === 'playing') ? E().activeUnit(st) : null;
      if (u && g.donoDe && g.donoDe(u) === 'eu') { try { g.endTurn(); } catch (e) {} }
      // 12/09: sair da batalha em grupo MATA os meus herois — o outro lado
      // recebe `sai` e derruba os corpos (ver marcaSaida)
      for (var i = 0; i < st.units.length; i++) {
        var x = st.units[i];
        if ((x.kind === 'hero' || x.kind === 'fusion') && x.dono === eu && x.alive && !x.offBoard) {
          envia('sai', { b: S.bid, u: x.uid });
        }
      }
    }
    if (JOGO.Grupo && JOGO.Grupo.sair) { try { JOGO.Grupo.sair('saiu-batalha'); } catch (e2) {} }
    var n = S.n;
    S = nova(Coop.emGrupo() ? 'grupo' : null);
    S.n = n;
    muda();
    return true;
  };
  Coop.desistir = function () {
    var g = G();
    if (S.tipo !== 'duelo' || !S.duelo) {
      // a arena que nasceu depois de o duelo ser cancelado (sem sessão): sair é voltar ao Acampamento
      if (g && g.modoRede && g.modoRede() === 'duelo' && g._saiDaRede) { try { g._saiDaRede(); } catch (e0) {} return true; }
      return false;
    }
    if (!g || !g.state || S.fim) return false;
    S.fimMotivo = 'desistencia';
    envia('desiste', { b: S.bid, lado: S.duelo.eu });
    if (g._encerra) g._encerra(S.duelo.eu === 'A' ? 'enemy' : 'player', 'desistencia');
    return true;
  };
  function algumLance() {
    for (var t in S.log) if (Object.prototype.hasOwnProperty.call(S.log, t) && S.log[t] && S.log[t].length) return true;
    return false;
  }
  /* Quem desiste é SEMPRE quem mandou: o lado não vem do envelope (antes, B
   * mandava lado:'A' e o cliente de A dava a vitória a B). O `desiste` com
   * mot 'dentro'/'carga' é o duelo que não começou do lado dele: cancela sem
   * resultado enquanto nenhum lance foi aplicado. */
  function rDesiste(d) {
    var g = G();
    if (!d || S.tipo !== 'duelo' || d.b !== S.bid || S.fim) return;
    if (d.mot === 'dentro' || d.mot === 'carga') {
      if (!algumLance()) cancelaDuelo(d.mot, true);
      return;
    }
    if (!g || !g.state) { cancelaDuelo('dentro', true); return; }   // desistiu antes de a minha arena abrir
    S.fimMotivo = 'desistencia';
    avisa(nomeParceiro() + ' desistiu do duelo.', 'ok');
    if (g._encerra) g._encerra(g.meuLado(), 'desistencia');
  }
  function rVivo(d) {
    if (!d || d.b !== S.bid) return;
    S.dentroConfirmado = true;
    var T = num(+d.T, 0);
    // o turno que ele diz só CRESCE: um `vivo` com turno velho não segura o prazo dele
    if (T > S.turnoDele) { S.turnoDele = T; S.turnoDeleEm = agora(); }
  }
  /* duelo: ele ainda carrega a arena — espero mais (até o teto da carga) */
  function rCarga(d) {
    if (!d || S.tipo !== 'duelo' || d.b !== S.bid || S.dentroEle || !S.dentroEu) return;
    var teto = (S.cargaTeto || agora()) + Coop.DENTRO_MS;
    S.dentroPrazo = Math.max(S.dentroPrazo || 0, Math.min(teto, agora() + Coop.DENTRO_MS));
    S.ultimoSinal = agora();
  }
  /* grupo: a líder não abre mais esta batalha (a ata falhou): volto à antessala */
  function rCancela(d) {
    if (!d || S.tipo !== 'grupo' || souLider() || !S.bid || d.bid !== S.bid) return;
    var g = G(), st = g && g.state;
    if (!st || st.phase !== 'placing' || algumLance()) return;
    S.bid = null; S.ata = null; S.fila = {}; S.log = {};
    if (g._voltaAntessala) g._voltaAntessala();
    muda();
  }

  // ------------------------------------------------------------ o duelo
  Coop.iniciaDuelo = function (d) {
    if (!d || !d.did || !d.oponente || !d.oponente.id) return false;
    var s = (+d.semente) >>> 0;
    var ar = Coop.sorteiaArena(s);
    if (!ar) return false;
    var dg = d.dungeonId || ar.dungeonId;
    var ri = (typeof d.roomIndex === 'number') ? d.roomIndex : ar.roomIndex;
    if (dg !== ar.dungeonId || ri !== ar.roomIndex) return false;
    if (!okDupla(d.duplaA) || !okDupla(d.duplaB)) return false;
    var lado = d.eu === 'B' ? 'B' : 'A';
    var me = (cfg && cfg.eu) || (function () { var r = R(); try { return r && r.meuId ? r.meuId() : null; } catch (e) { return null; } })();
    if (!me) return false;
    var idA = lado === 'A' ? me : String(d.oponente.id), idB = lado === 'A' ? String(d.oponente.id) : me;
    var A = clone(d.duplaA), B = clone(d.duplaB), i;
    for (i = 0; i < A.length; i++) A[i].dono = idA;
    for (i = 0; i < B.length; i++) B[i].dono = idB;
    var n0 = S.n;
    S = nova('duelo');
    S.n = n0;
    S.bid = String(d.did);
    S.fase = 'batalha';
    S.duelo = { did: String(d.did), eu: lado, meuId: me, semente: s, dungeonId: dg, roomIndex: ri, nome: ar.nome,
                duplaA: A, duplaB: B };
    S.parceiro = { id: String(d.oponente.id), cx: d.oponente.cx || null,
                   nome: d.oponente.nome || nomeDe(d.oponente.id) };
    // os 15 s do `dentro` do outro contam só depois que a MINHA arena abriu (a
    // carga dos modelos tem o teto dela, CARGA_MS); antes, a carga lenta
    // cancelava o duelo e a arena nascia depois, sem ninguém para sair dela
    S.dentroPrazo = 0;
    S.cargaTeto = agora() + Coop.CARGA_MS;
    S.cargaProx = 0;
    S.ultimoSinal = agora();
    // o "se valesse" (amistoso): os pontos da Brasa dos dois — o dele vem no
    // resumo da presença na Rede, o meu do DB (assíncrono: chega antes do fim)
    S.duelo.ptsDele = null; S.duelo.ptsMeus = null;
    // 13/09: o que o servidor precisa para refazer a arena e ranquear
    S.duelo.arenaSrv = { dungeonId: dg, roomIndex: ri, semente: s, duplaA: clone(A), duplaB: clone(B), eu: lado };
    try {
      var r0 = R(), ps = (r0 && r0.pares) ? r0.pares() : [];
      for (var q = 0; q < ps.length; q++) {
        if (ps[q].id === S.parceiro.id && ps[q].resumo && typeof ps[q].resumo.brasa === 'number') S.duelo.ptsDele = ps[q].resumo.brasa;
      }
    } catch (eP) {}
    try {
      var duelo0 = S.duelo, pr = (JOGO.DB && JOGO.DB.brasaVer) ? JOGO.DB.brasaVer() : null;
      if (pr && typeof pr.then === 'function') {
        pr.then(function (b) { if (b && typeof b.pts === 'number') duelo0.ptsMeus = b.pts; }, function () {});
      }
    } catch (eB) {}
    ligaTique();
    try { var r = R(); if (r && r.vigia) r.vigia(S.parceiro.id, S.parceiro.cx); } catch (e) {}
    var g = G(), bid = S.bid;
    var ok = !!(g && g._iniciaDueloRede && g._iniciaDueloRede({
      did: bid, dungeonId: dg, roomIndex: ri, semente: s, duplaA: A, duplaB: B, eu: lado, meuId: me,
      oponente: S.parceiro.nome, arena: ar
    }, function () {
      if (S.bid !== bid) return;
      S.dentroEu = true;
      S.dentroPrazo = agora() + Coop.DENTRO_MS;
      S.dentroRepProx = agora() + Coop.DENTRO_REP_MS;
      envia('dentro', { bid: bid, viu: !!S.dentroEle });
      muda();
    }));
    if (!ok) { S = nova(null); S.n = n0; muda(); return false; }
    avisa('Arena sorteada: ' + ar.nome + '.', 'info');
    muda();
    return true;
  };
  function anotaDuelo() {
    if (S.anotado || !S.fim || !S.duelo) return;
    S.anotado = true;
    var f = S.fim, wo = S.fimMotivo === 'wo';
    var res = f.empate ? 'empate-rede'
      : (wo ? (f.venci ? 'vitoria-wo' : 'derrota-wo') : (f.venci ? 'vitoria-rede' : 'derrota-rede'));
    var contestado = !!(S.fimDele && !wo && S.fimDele.venc !== f.venc);
    if (contestado) res += '-contestado';
    // a partida anulada (divergência, lance que não era dele, W.O. ou desistência forjados): sem vencedor
    if (S.fimMotivo === 'contestado') { res = 'contestado-rede'; contestado = true; }
    f.resultado = res;
    f.contestado = contestado;
    var ids = function (dp) { return dp.map(function (p) { return p.heroId || p.classId; }); };
    var mA = ids(S.duelo.duplaA), mB = ids(S.duelo.duplaB);
    var minha = S.duelo.eu === 'A' ? mA : mB, dele = S.duelo.eu === 'A' ? mB : mA;
    try {
      if (JOGO.DB && JOGO.DB.registrarPvp) {
        JOGO.DB.registrarPvp({ oponente: S.parceiro ? (S.parceiro.nome || nomeDe(S.parceiro.id)) : '?',
                               minhaDupla: minha, duplaDele: dele, resultado: res, clima: f.clima });
      }
    } catch (e) {}
    /* O DUELO RANQUEADO (13/09, a segurança): com sessão do site, o servidor
     * refaz a arena com as duplas das DUAS contas e o registro de lances, e só
     * o resultado de lá muda a Brasa — nos dois. W.O., desistência e partida
     * contestada não ranqueiam. Os tetos por par e por dia são do servidor. */
    try {
      var Aut = JOGO.Autoridade, arena = S.duelo.arenaSrv, Se = JOGO.Sessao;
      if (Aut && Aut.ligada && Aut.ligada() && Aut.fechaDuelo && arena && !wo && !contestado && S.parceiro) {
        var souA = arena.eu === 'A';
        var eu = { conta: Se && Se.contaId ? Se.contaId() : null, dono: meuId(),
                   herois: ids(souA ? arena.duplaA : arena.duplaB) };
        var ele = { conta: nuvemDe(S.parceiro.id), dono: S.parceiro.id, herois: ids(souA ? arena.duplaB : arena.duplaA) };
        if (eu.conta && ele.conta) {
          Aut.fechaDuelo({ did: S.duelo.did, dungeonId: arena.dungeonId, roomIndex: arena.roomIndex, semente: arena.semente,
                           A: souA ? eu : ele, B: souA ? ele : eu, lances: (S.logSrv || []).slice(),
                           hashFinal: f.h, fotografada: !!S.fotografada }).then(function (r) {
            if (r && r.ok && r.ranqueado && typeof r.delta === 'number') {
              avisa('Duelo ranqueado: ' + (r.delta >= 0 ? '+' : '') + r.delta + ' pontos de Brasa.', r.delta >= 0 ? 'ok' : 'info');
            } else if (r && r.ok && r.motivo === 'teto') {
              avisa('Este duelo não contou para o ranking (o teto de duelos ranqueados de hoje).', 'info');
            }
          });
        }
      }
    } catch (eR) {}
    // 11/09 (achado 20): o duelo pela Rede é AMISTOSO e não rende nada que
    // vire moeda ou bônus — nem o treino da guilda (XP_TREINO e MOEDA_TREINO
    // no cofre). Antes todo duelo anotado pagava aos DOIS lados, fosse qual
    // fosse o fim: desafio, aceite e "Desistir do duelo" em ~30 s, 25 vezes,
    // davam as 25 moedas do bônus de SAQUE da guilda (+15% por 24 h). Aqui não
    // entra dízimo, insígnia nem Brasa (a Brasa só mostra "se valesse")
    muda();
  }
  function recebeDuelo(ev) {
    if (!ev || ev.acao !== 'fim' || !S.duelo || !aceita(ev)) return;
    var d = ev.dados || {};
    if (d.did !== S.duelo.did) return;
    S.fimDele = { venc: d.venc, h: d.h, mot: d.mot || null };
    var g = G();
    // o outro fecha o duelo por W.O. ou desistência e eu ainda estou na arena.
    // Só vale o que não o favorece sem prova: a desistência DELE (eu venço), ou
    // o W.O. contra mim quando eu caí de verdade há pouco (religuei). O resto
    // (um `fim` forjado dando a vitória a ele) fecha SEM vencedor
    if (!S.fim && g && g.state && (d.mot === 'wo' || d.mot === 'desistencia')) {
      var ele = S.duelo.eu === 'A' ? 'B' : 'A';
      var ladoDe = function (x) { return x === 'A' ? 'player' : 'enemy'; };
      if (d.mot === 'desistencia' && d.venc === S.duelo.eu) {
        S.fimMotivo = 'desistencia';
        if (g._encerra) g._encerra(g.meuLado(), 'desistencia');
      } else if (d.mot === 'wo' && d.venc === ele && S.religouEm && agora() - S.religouEm <= Coop.WO_MS + Coop.SILENCIO_MS) {
        S.fimMotivo = 'wo';
        if (g._encerra) g._encerra(ladoDe(ele), 'wo');
      } else {
        S.fimMotivo = 'contestado';
        if (g._encerra) g._encerra(null, 'contestado');
      }
    } else if (!S.fim && g && g.state && d.mot === 'contestado') {
      // o outro anulou (divergência, lance torto): anular não dá vitória a ninguém
      S.fimMotivo = 'contestado';
      if (g._encerra) g._encerra(null, 'contestado');
    }
    if (S.fim && !S.anotado) anotaDuelo();
    muda();
  }

  /* O Game chama no fim da batalha. Devolve o que a tela de recompensa precisa. */
  Coop.aoFim = function (res) {
    res = res || {};
    S.fase = 'fim';
    S.esperando = null;
    if (S.tipo === 'duelo' && S.duelo) {
      if (!S.fim) {
        S.fim = { venc: res.venc, h: res.h, venci: !!res.venci, empate: !!res.empate, clima: res.clima, t: agora() };
        S.fimPrazo = agora() + Coop.FIM_MS;
        var r = R(), p = S.parceiro;
        try {
          if (r && r.dirige && p) r.dirige('duelo', p.id, 'fim', { did: S.duelo.did, venc: res.venc, h: res.h, mot: S.fimMotivo || null },
                                            p.cx ? { cx: p.cx } : {});
        } catch (e) {}
        if (S.fimDele || S.fimMotivo === 'wo') anotaDuelo();
        muda();
      }
      return { wo: S.fimMotivo === 'wo', desistencia: S.fimMotivo === 'desistencia',
               contestado: S.fimMotivo === 'contestado',
               oponente: S.parceiro ? (S.parceiro.nome || nomeDe(S.parceiro.id)) : '',
               arena: { dungeonId: S.duelo.dungeonId, roomIndex: S.duelo.roomIndex, nome: S.duelo.nome },
               ptsMeus: S.duelo.ptsMeus, ptsDele: S.duelo.ptsDele };
    }
    S.descidaAcabou = !!(S.descidaAcabou || S.parceiroSaiu || (S.parceiroIA && S.sumidoDesde));
    var info = { lider: souLider(), parceiroVoltou: !S.sumidoDesde && !S.parceiroSaiu,
                 descidaAcabou: S.descidaAcabou };
    if (S.descidaAcabou && res.fase === 'won' && !S.parceiroSaiu) avisa(nomeParceiro() + ' não voltou — a descida acabou.', 'aviso');
    muda();
    return info;
  };
  /* O FIM DA SALA NO GRUPO (o game.js pergunta no handleBattleOver). A
   * autoridade manda o `fim` {h, fase} e segue. Quem não é a autoridade manda
   * o dele e espera o dela (até FIM_GRUPO_MS): com o mesmo hash, segue; com
   * outro, pede a foto do FIM e paga pelo estado dela; se o `vivo` dela diz
   * que a sala continua lá, é divergência também (a foto do turno). Devolve
   * se pode seguir para a recompensa. */
  function mandaFimGrupo(st, h) {
    S.fimGrupoMeu = { b: S.bid, h: h, fase: st.phase, T: st.turno || 0 };
    envia('fim', S.fimGrupoMeu);
  }
  Coop.fimGrupo = function (st) {
    if (S.tipo !== 'grupo' || !S.bid || !st || !Coop.emGrupo()) return true;
    var e = E(), h = 0, ag = agora();
    try { h = e.hash(st); } catch (e0) { h = 0; }
    if (souAutoridade() || S.parceiroSaiu) {
      if (!S.fimGrupoMeu || S.fimGrupoMeu.h !== h) mandaFimGrupo(st, h);
      return true;
    }
    if (!S.fimGrupo) { S.fimGrupo = { prazo: ag + Coop.FIM_GRUPO_MS }; mandaFimGrupo(st, h); }
    var dele = S.fimGrupoDele;
    if (dele && dele.h === h) return true;
    if (dele || S.turnoDele > (st.turno || 0)) {
      if (!S.fimFotoPedidaEm) {
        S.fimFotoPedidaEm = ag;
        S.dessinc++;
        S.ultimaDessinc = { mot: 'fim', T: st.turno || 0, t: ag };
        S.sincronizando = true;
        S.fotoPedidaEm = ag;
        envia('foto-pede', { b: S.bid, T: st.turno || 0, fim: true });
        avisa('Sincronizando com ' + nomeParceiro() + '…', 'info');
        muda();
      }
      return ag - S.fimFotoPedidaEm > 2 * Coop.FIM_GRUPO_MS;     // a foto não veio: segue com o que tem
    }
    return ag >= S.fimGrupo.prazo;
  };
  function rFimGrupo(d) {
    if (!d || S.tipo !== 'grupo' || d.b !== S.bid) return;
    S.fimGrupoDele = { h: d.h, fase: d.fase, T: num(d.T, 0) };
    // quem espera ouve o meu de novo (o primeiro pode ter saído antes de ele chegar ao fim)
    if (souAutoridade() && S.fimGrupoMeu) envia('fim', S.fimGrupoMeu);
    muda();
  }
  Coop.bloqueado = function () {
    if (S.sincronizando) return true;
    if (S.tipo === 'duelo' && S.bid && !(S.dentroEu && S.dentroEle)) return true;
    return false;
  };
  /* O Game chama no init (volta ao menu/Acampamento): a batalha em rede acaba. */
  Coop._gameInit = function () {
    if (S.fim && !S.anotado) anotaDuelo();
    var n = S.n;
    S = nova(Coop.emGrupo() ? 'grupo' : null);
    S.n = n;
    if (!Coop.ativo()) paraTique();
    muda();
  };

  // ------------------------------------------------------------ o piloto automático (provas)
  Coop._piloto = function (o) { piloto = o ? clone(o) : null; return piloto; };
  /* O MEU herói joga pela AI.planTurn, mas PELA PORTA LOCAL do Game: os lances
   * saem como se fossem de gente (tentativas que falham inclusive). */
  Coop._pilotoPasso = function () {
    if (!piloto || !piloto.joga) return;
    var g = G(), st = g && g.state, e = E();
    if (!st || !g.modoRede || !g.modoRede() || g.screen !== 'battle') return;
    if (st.phase === 'placing') {
      if (g.podeColocar && g.podeColocar()) {
        var ops = e.placementOptions(st);
        var c = ops[Math.min(num(piloto.casa, 0), ops.length - 1)];
        if (c) g.onTileClicked(c.x, c.y);
      }
      return;
    }
    if (st.phase !== 'playing') return;
    var u = e.activeUnit(st);
    if (!u || g.donoDe(u) !== 'eu' || !g.isPlayerTurn()) return;
    if (piloto.fica) { g.endTurn(); return; }
    var plan = [];
    try { plan = (JOGO.AI && JOGO.AI.planTurn) ? JOGO.AI.planTurn(st, u.uid) : []; } catch (e1) { plan = []; }
    for (var j = 0; j < plan.length; j++) {
      if (g.state !== st || st.phase !== 'playing') return;
      var au = e.activeUnit(st);
      if (!au || au.uid !== u.uid || !g.isPlayerTurn()) return;
      var p = plan[j];
      if (p.action === 'move') g._local({ a: 'm', u: u.uid, x: p.x, y: p.y });
      else if (p.action === 'cast') g._local({ a: 'c', u: u.uid, s: p.spellId, x: p.x, y: p.y });
      else if (p.action === 'end') break;
    }
    if (g.state === st && st.phase === 'playing') {
      var au2 = e.activeUnit(st);
      if (au2 && au2.uid === u.uid && g.isPlayerTurn()) g.endTurn();
    }
  };

  // ------------------------------------------------------------ ganchos de prova
  Coop._log = function () { return clone(S.log); };
  Coop._hashes = function () { return clone(S.hashes); };
  Coop._fila = function () { return clone(S.fila); };
  Coop._estraga = function (uid, dPv) {
    var g = G(), st = g && g.state;
    var u = st ? E().findUnit(st, uid) : null;
    if (!u) return false;
    u.hp = Math.max(1, u.hp - (dPv || 1));
    return true;
  };
  Coop._config = function (o) {
    for (var k in (o || {})) if (Object.prototype.hasOwnProperty.call(o, k) && typeof Coop[k] === 'number') Coop[k] = o[k];
    return true;
  };
  Coop._reset = function () {
    cfg = null; S = nova(null); piloto = null; assinaturaGuardada = null;
    paraTique();
  };
  Coop._S = function () { return S; };

  // ------------------------------------------------------------ a escuta da Rede
  function aceita(ev) {
    var p = parceiro();
    if (!p || !ev || ev.de !== p.id) return false;
    if (p.cx && ev.cx && ev.cx !== p.cx) return false;     // o cx carimbado barra quem copia o `de`
    return true;
  }
  function recebe(ev) {
    if (!ev || !aceita(ev)) return;
    var d = ev.dados || {};
    S.ultimoSinal = agora();
    // ele falou pela conexão que eu conheço: não sumiu (um `saiu` de outra aba
    // dele, ou um `ausente` que se cruzou com a volta, não o tira mais)
    var p = parceiro();
    if (S.sumidoDesde && p && p.cx && ev.cx === p.cx) Coop.parceiroVoltou(p.id, p.cx);
    switch (ev.acao) {
      case 'pronto': rPronto(d); break;
      case 'ata': rAta(d); break;
      case 'dentro': rDentro(d); break;
      case 'lance': rLance(d, ev.de); break;
      case 'pede': rPede(d); break;
      case 'foto-pede': rFotoPede(d); break;
      case 'foto': rFoto(d); break;
      case 'ia': rIa(d); break;
      case 'sai': rSai(d); break;
      case 'proxima': rProxima(d); break;
      case 'desiste': rDesiste(d); break;
      case 'vivo': rVivo(d); break;
      case 'dessinc': rDessinc(d); break;
      case 'cancela': rCancela(d); break;
      case 'carga': rCarga(d); break;
      case 'fim': rFimGrupo(d); break;
      default: break;                                      // tipo desconhecido: calado
    }
  }
  /* O `saiu` (o tchau, ou a varredura da Rede) vale pouco: pelo relé novo a
   * queda que vale é o `caiu` do vigia, com o cx — o tchau de OUTRA aba da
   * mesma conta, ou a varredura numa aba estrangulada, tiravam o parceiro
   * vivo. No canal de abas o tchau traz o cx da página: o de outra aba não conta. */
  function saiuVale(p, ev) {
    var r = R(), ws = false;
    try { ws = !!(r && r.transporte && r.transporte() === 'ws'); } catch (e) { ws = false; }
    if (ws && p.cx) return false;
    if (ev.cx && p.cx && ev.cx !== p.cx) return false;
    if (!ev.cx && S.bid) {
      var v = 0;
      try { v = (r && r.visto) ? num(+r.visto(p.id), 0) : 0; } catch (e2) { v = 0; }
      if (v && agora() - v < Coop.SAIU_VISTO_MS) return false;
    }
    return true;
  }
  function recebeSinal(ev) {
    if (!ev) return;
    var p = parceiro();
    if (ev.tipo === 'caiu' && p && ev.id === p.id) {
      if (p.cx && ev.cx && ev.cx !== p.cx) return;
      Coop.parceiroSumiu(p.id, agora());
    } else if (ev.tipo === 'saiu' && p && ev.id === p.id) {
      if (!saiuVale(p, ev)) return;
      Coop.parceiroSumiu(p.id, agora());
    } else if (ev.tipo === 'religou') {
      S.religouEm = agora();
      S.religouPendente = true;          // no tique: depois da `volta` do grupo.js (senão o outro recusa pelo cx)
    }
  }
  /* a MINHA conexão voltou: quem não é a autoridade (grupo) pede a foto; e
   * todos pedem os lances do outro que foram ao cx velho (no duelo, é só isso) */
  function depoisDeReligar() {
    if (!S.bid || S.fim) return;
    var g = G(), st = g && g.state;
    if (!st) return;
    // (se a foto já veio depois da volta — o `ia` do outro chegou antes —, não pede outra)
    var jaRestaurou = !!(S.restauradaEm && S.restauradaEm >= S.religouEm);
    if (S.tipo === 'grupo' && emBatalha() && !souAutoridade() && !jaRestaurou) pedeFoto();
    if (emBatalha()) envia('pede', { b: S.bid, T: st.turno || 0, k: (S.log[st.turno || 0] || []).length });
  }
  var desligas = [];
  Coop._liga = function () {
    for (var i = 0; i < desligas.length; i++) { try { desligas[i](); } catch (e) {} }
    desligas = [];
    var r = R();
    if (!r || typeof r.ouvir !== 'function') return false;
    var pares = [['batalha', recebe], ['duelo', recebeDuelo], ['caiu', recebeSinal],
                 ['saiu', recebeSinal], ['religou', recebeSinal]];
    for (var j = 0; j < pares.length; j++) {
      try {
        var d = r.ouvir(pares[j][0], pares[j][1]);
        if (typeof d === 'function') desligas.push(d);
      } catch (e2) {}
    }
    return true;
  };
  Coop._liga();

  // a aba volta a aparecer: o que andou sem tela é redesenhado do estado atual
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('visibilitychange', function () {
      if (document.hidden || !S.rodouSemTela) return;
      S.rodouSemTela = false;
      var g = G(), e = E();
      if (g && g.state && g.screen === 'battle' && g.modoRede && g.modoRede() && e) {
        e.events.length = 0;
        e.emit({ type: 'battleStart', state: g.state });
      }
    });
  }
})();
