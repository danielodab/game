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
      prepUlt: null, prepProx: 0,        // 21/09: o último `prep` que mandei e quando repito

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
      tortos: 0,
      // 15/09: a guerra de guilda 2×2 — { gid, meuId, lado, ordem: [4 ids], js: {id: jogador}, guildas, nomes,
      // euFora, euCai, tarde, resultado, fechou } (ver "a guerra de guilda", mais abaixo)
      guerra: null, dentroLiberado: false, saiuNome: null,
      woDesde: 0,                   // 19/09: os DOIS adversários fora desde então (a contagem do W.O. na tela)
      iaPendentes: [],              // 19/09: marcas `ia` da guerra à espera da VEZ do herói: [{uid, v}], na ordem em que chegaram
      iaSeq: 0, iaVisto: {}, iaBuffer: []   // 19/09: o contador das minhas marcas, o último `n` visto de cada um, as guardadas na foto
    };
  }

  function parceiro() {
    if (S.tipo === 'duelo') return S.parceiro;
    if (S.tipo === 'guerra') return null;           // 15/09: na guerra são três (outrosGuerra)
    return (cfg && cfg.parceiro) || null;
  }
  function meuId() {
    if (S.tipo === 'duelo' && S.duelo && S.duelo.meuId) return S.duelo.meuId;
    if (S.tipo === 'guerra' && S.guerra && S.guerra.meuId) return S.guerra.meuId;
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
    if (S.tipo === 'duelo' || S.tipo === 'guerra') return false;
    if (S.cedeu) return false;
    if (S.tomouAutoridade) return true;
    return !!(cfg && cfg.lider && cfg.lider === meuId());
  }
  Coop.souLider = souLider;
  function souAutoridade() {
    if (S.tipo === 'guerra') return !!S.guerra && autoridadeGuerra() === meuId();
    if (S.cedeu) return false;
    if (S.tipo === 'duelo') return S.tomouAutoridade || !!(S.duelo && S.duelo.eu === 'A');
    return souLider();
  }
  function autoridadeId() {
    if (S.tipo === 'guerra') return autoridadeGuerra();
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
    if (S.tipo === 'guerra') return enviaGuerra(acao, dados);     // 15/09: aos três
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
    // 21/09: as casas marcadas na preparação viajam DENTRO do `p` — é delas que
    // o outro cliente (e o juíz do servidor) refaz a colocação
    if (l.e != null) o.e = l.e;
    if (l.eu != null) o.eu = l.eu;
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
      // 03/10: o Santuário dos Elementos — as salas e os números das quatro regras decidem a batalha
      especiais: d.especiais || null, santuario: d.santuario || null,
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
             nome: Tx('{a} — sala {b}{c}', { a: porId[dg].name || dg, b: ri + 1, c: room.name ? ' (' + room.name + ')' : '' }) };
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
    // 15/09: a guerra corre com o grupo formado (os dois da mesma guilda): o grupo não toma a sessão dela
    if (S.tipo !== 'duelo' && S.tipo !== 'guerra') {
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
  Coop.ativo = function () { return !!((cfg && cfg.parceiro) || S.tipo === 'duelo' || S.tipo === 'guerra'); };
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
      guerra: S.guerra ? sessaoGuerra() : null,      // 15/09: os quatro, quem manda, as guildas
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
        avisa(Tx('{a} não respondeu.', { a: nomeParceiro() }), 'aviso');
        muda();
      } else {
        S.ataEnvios++;
        S.ataProx = ag + Coop.ATA_MS;
        envia('ata', S.ata);
      }
    }
    // 15/09, a luta largada: a ata que falhou e não virou batalha nem com o `dentro` atrasado deixa a sala em grupo
    // aberta no servidor sem luta nenhuma — quem lidera a fecha (sem lance: a vida de ninguém muda), senão a próxima
    // luta do parceiro a largaria
    if (S.ataFalhou && S.ata && S.ata.gid && !S.gidSemLuta && souLider() && !emBatalha() &&
        ag - (S.ataFalhouEm || 0) > Coop.ATA_TARDE_MS) {
      S.gidSemLuta = true;
      var Afl = autoridadeLigada();
      if (Afl && Afl.fechaGrupo) Afl.fechaGrupo({ gid: S.ata.gid, lances: [], hashFinal: null, fotografada: false });
    }
    // o parceiro na antessala repete o `pronto` até a ata chegar
    if (S.tipo === 'grupo' && !souLider() && g && g.screen === 'antessala' && !S.bid && ag >= S.prontoProx) mandaPronto();
    // 21/09: e na PREPARAÇÃO o `prep` se repete a cada 2 s — o relé é burro e um
    // pacote perdido deixaria o parceiro esperando um PRONTO que já foi dado
    repetePrep(ag);
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
    // 15/09: a guerra — a carga, os `dentro` dos quatro e quem voltou sem o parceiro de guilda para o desmarcar
    if (S.tipo === 'guerra' && S.bid && !S.fim && tiqueGuerra(ag) === false) return;
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
    if (S.tipo === 'guerra') { confereSumicoGuerra(ag); return; }
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
    avisa(Tx('{a} caiu — o turno dele passa até voltar.', { a: nomeParceiro() }), 'aviso');
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
    // 19/09: quem saiu da guerra antes de o salão abrir (`sai` com `todos`): todos os heróis dele caem
    if (S.tipo === 'guerra') {
      outrosGuerra().forEach(function (j) {
        if (!j.saiuTudo) return;
        unidadesDe(st, j.id, true).forEach(function (u) { S.mortePendente[u.uid] = true; });
      });
    }
    var uids = Object.keys(S.mortePendente), fez = false;
    for (var i = 0; i < uids.length; i++) {
      var u = e.findUnit(st, uids[i]);
      delete S.mortePendente[uids[i]];
      if (!u || !u.alive || u.offBoard) continue;
      marcaSrv('morte', u.uid);
      try { e.processDeath(st, u); fez = true; } catch (er) {}
    }
    if (fez) {
      avisa(Tx('{a} saiu da batalha — o heroi dele cai.', { a: S.tipo === 'guerra' ? (S.saiuNome || Tx('Alguém')) : nomeParceiro() }), 'aviso');
      muda();
    }
    return fez;
  }
  function venceWO() {
    var g = G();
    if (!g || !g.state || S.fim) return;
    S.fimMotivo = 'wo';
    S.tomouAutoridade = true;
    S.hashAntesDoFim = hashDeRepouso(g.state);   // 15/09: o W.O. declarado refaz os lances até aqui
    avisa(Tx('{a} saiu da arena — vitória por W.O.', { a: nomeParceiro() }), 'ok');
    if (g._encerra) g._encerra(g.meuLado(), 'wo');
  }
  /* o duelo que não começou (a carga passou do teto, ou o `dentro` do outro
   * não veio): sem resultado. O outro fica sabendo pelo trilho da BATALHA
   * (o `cancela` do grupo.js não vale para quem já viu a arena) — `calado`
   * quando foi ele que cancelou. */
  function cancelaDuelo(mot, calado) {
    if (!calado && S.tipo === 'duelo' && S.bid) envia('desiste', { b: S.bid, mot: mot || 'dentro' });
    avisa(mot === 'carga' ? Tx('O duelo não começou — a arena demorou demais para carregar.')
                          : Tx('O duelo não começou — {a} não entrou na arena.', { a: nomeParceiro() }), 'aviso');
    var g = G();
    S = nova(null);
    if (g && g._saiDaRede) { try { g._saiDaRede(); } catch (e) {} }
    if (JOGO.Duelo && JOGO.Duelo.cancelar) { try { JOGO.Duelo.cancelar(mot || 'dentro'); } catch (e2) {} }
    paraTique();
    muda();
  }

  Coop.parceiroSumiu = function (id, t0, cx) {
    if (S.tipo === 'guerra') { sumiuGuerra(id, t0, cx); return; }
    var p = parceiro();
    if (!p || id !== p.id) return;
    var t = num(+t0, 0) || agora();
    var novo = !S.sumidoDesde;
    if (!S.sumidoDesde || t < S.sumidoDesde) S.sumidoDesde = t;
    if (novo && (emBatalha() || S.tipo === 'duelo') && !S.parceiroIA && !S.fim) {
      var s = Math.round((S.tipo === 'duelo' ? Coop.WO_MS : Coop.GRACA_MS) / 1000);
      avisa(Tx('{a} caiu — esperando voltar ({s} s)…', { a: nomeParceiro(), s: s }), 'aviso');
    }
    muda();
  };
  Coop.parceiroVoltou = function (id, cx) {
    if (S.tipo === 'guerra') { voltouGuerra(id, cx); return; }
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
      // 14/09: ele volta sem o banco de antes da queda — o prazo de espera do
      // turno dele é 30 s (+ a folga da animação), não 30 + o banco velho
      S.bkParceiro = 0;
      if (emBatalha()) {
        avisa(nomeParceiro() + ' voltou' + (S.parceiroIA ? Tx(' — e volta a jogar.') : '.'), 'ok');
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
  /* ===================================================== A PREPARAÇÃO (21/09)
   * O PRONTO da preparação viaja na voz `prep` — NUNCA como lance: fora do
   * `S.log`, fora do `anotaSrv`, fora do hash. Tinha de ser assim porque dois
   * jogadores marcando a casa ao mesmo tempo disputariam a MESMA chave (T=0,
   * k=0) da fila do lockstep. O nome `pronto` já é da antessala (`rPronto`),
   * daí o nome novo.
   *
   * É repetido a cada 2 s enquanto a preparação corre: o relé é burro e um
   * pacote perdido deixaria o parceiro esperando um PRONTO que já foi dado. */
  Coop.PREP_REP_MS = 2000;
  function zeraPrepCoop() { S.prepUlt = null; S.prepProx = 0; }
  Coop.zeraPrep = zeraPrepCoop;
  Coop.mandaPrep = function (d) {
    if (S.tipo !== 'grupo' || !S.bid || !d) return false;
    S.prepUlt = { x: d.x == null ? null : +d.x, y: d.y == null ? null : +d.y, v: !!d.v };
    S.prepProx = agora() + Coop.PREP_REP_MS;
    return envia('prep', { b: S.bid, x: S.prepUlt.x, y: S.prepUlt.y, v: S.prepUlt.v });
  };
  function rPrep(d) {
    if (!d || d.b !== S.bid) return;              // o PRONTO da sala anterior não vale
    var g = G();
    if (!g || !g._prepDoParceiro) return;
    try {
      g._prepDoParceiro({
        x: (typeof d.x === 'number' && isFinite(d.x)) ? d.x : null,
        y: (typeof d.y === 'number' && isFinite(d.y)) ? d.y : null,
        v: !!d.v
      });
    } catch (e) {}
  }
  /* o reenvio: chamado do tique enquanto a sala está em `placing` */
  function repetePrep(ag) {
    if (S.tipo !== 'grupo' || !S.bid || !S.prepUlt) return;
    var g = G(), st = g && g.state;
    if (!st || st.phase !== 'placing') return;
    if (ag < num(S.prepProx, 0)) return;
    S.prepProx = ag + Coop.PREP_REP_MS;
    envia('prep', { b: S.bid, x: S.prepUlt.x, y: S.prepUlt.y, v: S.prepUlt.v });
  }

  function mandaPronto() {
    var g = G();
    if (!g || !g.party || !g.party.length || !Coop.emGrupo()) return false;
    // 12/09: os MEUS selecionados (ate dois) — a sala nasce com os dois lados
    var ps = Coop.payloadMeus(g.party);
    if (!ps.length) return false;
    S.prontoProx = agora() + Coop.PRONTO_MS;
    /* 14/09 (a vida única): `vida` = {meuDono:heroId: PV agora} dos MEUS heróis que não estão
     * cheios (antes, 13/09, eram as curas de poção). Quem lidera põe na ata e segura a porta
     * enquanto algum estiver a 0. O formato é o mesmo que o rPronto já conferia. */
    var vida = null;
    try { vida = g.vidaMinhaNoGrupo ? g.vidaMinhaNoGrupo() : null; } catch (e) { vida = null; }
    return envia('pronto', { sala: salaAtual(), heroi: ps[0], herois: ps, versao: Coop.versao(), vida: vida });
  }
  /* A VIDA DO PARCEIRO (14/09): a do último `pronto`, andando no relógio daqui desde que ele
   * chegou (+1 PV a cada DATA.vidaEntreSalas.msPorPv), sem passar do PV máximo do payload dele
   * (stats.hp, o hpMax do motor). Herói que não veio no `vida` está cheio.
   * [{chave, heroId, hp, max, cheioEmMs, ate1Ms}] — os cheios também (a HUD mostra a linha). */
  function msPorPv() {
    var v = D().vidaEntreSalas || {};
    return (typeof v.msPorPv === 'number' && isFinite(v.msPorPv) && v.msPorPv > 0) ? v.msPorPv : 2000;
  }
  Coop.vidaParceiroDetalhe = function () {
    if (!prontoValido()) return [];
    var pr = S.prontoParceiro, vida = pr.vida || {}, ms = msPorPv();
    var passou = Math.max(0, agora() - num(pr.vidaEm, agora())), out = [];
    var quem = (S.parceiro && S.parceiro.id) || ((pr.herois && pr.herois[0] && pr.herois[0].dono) || '');
    (pr.herois || []).forEach(function (h) {
      if (!h || typeof h !== 'object') return;
      var hid = h.heroId || h.classId, k = (h.dono || quem) + ':' + hid;
      var mx = Math.floor(num(h.stats && h.stats.hp, 0));
      var hp0 = vida[k];
      if (typeof hp0 !== 'number') {
        if (mx >= 1) out.push({ chave: k, heroId: hid, hp: mx, max: mx, cheioEmMs: 0, ate1Ms: 0 });
        return;
      }
      if (mx < 1) mx = Math.max(1, hp0 + 1);
      var hp = Math.min(mx, hp0 + Math.floor(passou / ms)), resto = ms - (passou % ms);
      out.push({ chave: k, heroId: hid, hp: hp, max: mx,
                 cheioEmMs: hp < mx ? (mx - hp - 1) * ms + resto : 0, ate1Ms: hp < 1 ? resto : 0 });
    });
    return out;
  };
  /* {dono:heroId: PV agora} dos heróis do parceiro que não estão cheios */
  Coop.vidaParceiro = function () {
    var out = {};
    Coop.vidaParceiroDetalhe().forEach(function (p) { if (p.hp < p.max) out[p.chave] = p.hp; });
    return out;
  };
  /* o Game avisa que eu bebi: quem segue manda o `pronto` na hora (não espera os 5 s) */
  Coop.vidaMudou = function () {
    if (Coop.emGrupo() && !souLider()) mandaPronto();
    muda();
  };
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
    // 13/09: herói a 0 PV (meu ou do parceiro) segura a porta até a vida voltar — o servidor recusa igual.
    // 14/09: é a vida única (Game.esperaVida lê a minha em JOGO.Vida e a do parceiro no `pronto`)
    var ev = null;
    try { ev = g.esperaVida ? g.esperaVida() : null; } catch (e) { ev = null; }
    if (ev) return { ok: false, motivo: 'vida', vida: ev };
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
      if (pe.motivo === 'versao') avisa(Tx('Vocês estão em versões diferentes do jogo — recarreguem a página.'), 'aviso');
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
        avisa(Tx('O servidor não conferiu a conta de {a} — ela precisa entrar na conta e recarregar a página.', { a: nomeParceiro() }), 'aviso');
        return false;
      }
      S.pedindoGrupo = true;
      var idsDe = function (lista) { return lista.map(function (h) { return h.heroId || h.classId; }); };
      Aut.abreGrupo({ dungeonId: g.dungeonId, roomIndex: g.roomIndex, dificuldade: g.dificuldade || 'normal',
                      herois: idsDe(meus), dono: meuId(),
                      parceiro: { conta: contaPar, dono: p.id, herois: idsDe(pars) } }).then(function (r) {
        S.pedindoGrupo = false;
        // 14/09: um herói (meu ou do parceiro) está a 0 no relógio do servidor — a porta espera
        if (r && !r.ok && r.motivo === 'vida-zero') {
          avisa(Aut.textoVidaZero ? Aut.textoVidaZero(r) : Tx('Um herói está sem vida: espere ele recuperar.'), 'aviso');
          try { if (JOGO.Vida && JOGO.Vida.sincroniza) JOGO.Vida.sincroniza(); } catch (eV) {}
          muda();
          return;
        }
        if (!r || !r.ok || typeof r.semente !== 'number' || typeof r.gid !== 'string') {
          avisa(Tx('O servidor não abriu a sala do grupo: {a}.', { a: (r && r.erro) || Tx('sem resposta') }), 'aviso');
          muda();
          return;
        }
        if (Aut.abreLuta) Aut.abreLuta('grupo', r.gid);      // 15/09: a luta aberta de quem lidera, desde o gid
        mandaAta(g, p, meus, pars, r.semente >>> 0, r.carry || null, r.gid);
      });
      muda();
      return true;
    }
    // 13/09: sem servidor, o PV da PORTA de quem lidera vai na ata (14/09: a vida única dos dois)
    mandaAta(g, p, meus, pars,
             (Coop._sementeFixa != null) ? (Coop._sementeFixa >>> 0) : novaSemente(),
             (g._carryPorta ? g._carryPorta() : (g._carry && g._carry())) || null, null);
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
    // 15/09: a sala em grupo com gid do servidor é a luta aberta desta conta até fechar (autoridade.js)
    anotaLutaGrupo();
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
    // 13/09: a vida dele — só as chaves DELE (quem:heroId), só inteiros de 0 a 100000. 14/09: é o
    // PV de agora dos heróis dele que não estão cheios; `vidaEm` = quando chegou (a barra anda daqui)
    var vida = {};
    if (d.vida && typeof d.vida === 'object') {
      Object.keys(d.vida).forEach(function (k) {
        var n = d.vida[k];
        if (k.indexOf(quem + ':') === 0 && typeof n === 'number' && isFinite(n) && n >= 0 && n <= 100000) vida[k] = Math.floor(n);
      });
    }
    S.prontoParceiro = { sala: String(d.sala), heroi: hs[0], herois: hs, versao: d.versao || null, vida: vida, vidaEm: agora() };
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
      avisa(Tx('Vocês estão em versões diferentes do jogo — recarreguem a página.'), 'aviso');
      return;
    }
    var p = parceiro();
    // 12/09: de dois a quatro herois, os de quem lidera na frente e os MEUS
    // atras — nada mais abre a sala (ver okGrupoDaAta)
    if (!okGrupoDaAta(d.party, p.id, meuId())) {
      avisa(Tx('Vocês estão em versões diferentes do jogo — recarreguem a página.'), 'aviso');
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
  function rDentro(d, de) {
    if (!d || !d.bid) return;
    if (S.tipo === 'guerra') { rDentroGuerra(d, de); return; }
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
      avisa(Tx('Não deu para abrir a sala.'), 'aviso');
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
    // 21/09: sem o `e` o juiz refaria a colocação com todo mundo ao acaso
    if (l.e != null) c.e = l.e;
    if (l.eu != null) c.eu = l.eu;
    if (l.alvo != null) c.alvo = l.alvo;
    if (l.de != null) c.de = l.de;
    if (l.ev != null) c.ev = l.ev;
    if (l.v != null) c.v = l.v;
    if (S.logSrv.length < 6000) S.logSrv.push(c);
    anotaLutaGrupo();                    // 15/09: o registro da luta aberta acompanha o que o servidor refaz
  }
  /* 15/09, A LUTA LARGADA (o dono: "arrume as falhas conhecidas"): o registro da sala em grupo com gid do servidor
   * (js/core/autoridade.js) — a página que for embora no meio fecha a parte desta conta na volta (`largou`) */
  function autoridadeLigada() {
    var A = JOGO.Autoridade;
    try { return (A && A.ligada && A.ligada()) ? A : null; } catch (e) { return null; }
  }
  function anotaLutaGrupo() {
    // 19/09: a guerra pronta também é luta aberta — a página que for embora no meio fecha a parte desta conta ao voltar
    if (S.tipo === 'guerra') { anotaLutaGuerra(); return; }
    if (S.tipo !== 'grupo' || !S.ata || !S.ata.gid || !S.bid) return;
    var A = autoridadeLigada();
    if (!A || !A.abreLuta || !A.anotaLuta) return;
    try { A.abreLuta('grupo', S.ata.gid); A.anotaLuta(S.ata.gid, S.logSrv || []); } catch (e) {}
  }
  function anotaLutaGuerra(fim, corpo) {
    if (S.tipo !== 'guerra' || !S.guerra || !S.bid) return;
    var A = autoridadeLigada();
    if (!A || !A.abreLuta || !A.anotaLuta) return;
    try { A.abreLuta('guerra', S.guerra.gid); A.anotaLuta(S.guerra.gid, S.logSrv || [], !!fim, corpo || null); } catch (e) {}
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
    // 19/09: no lance LOCAL o hash é o VIVO — aqui ele É o da virada (o Game só chama o aoTurno depois deste registro,
    // e a marca `ia` guardada para a vez deste herói só entra lá). Ler S.hashes[T2] aqui pegava, depois de uma foto, o
    // hash da linha do tempo VELHA (o turno T2 já tinha passado por este motor antes de restaurar) e divergia de novo
    if (T2 !== T || st.phase !== 'playing') { l.T2 = T2; try { l.h = E().hash(st); } catch (eH) { l.h = 0; } }
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
    var jg = jogadorGuerra(de);                    // 15/09: na guerra, o turno e o banco de CADA um dos três
    if (jg) {
      if (d.T > jg.turnoDele) { jg.turnoDele = d.T; jg.turnoDeleEm = agora(); }
      if (d.a === 'e' && d.bk != null) jg.bk = Math.max(0, Math.min(num(+d.bk, 0), num((G() || {}).bankMax, 120)));
    } else {
      if (d.T > (S.turnoDele || 0)) { S.turnoDele = d.T; S.turnoDeleEm = agora(); }
      // o banco do outro tem teto: bk = 1e9 dava um prazo de anos
      if (d.a === 'e' && d.bk != null) S.bkParceiro = Math.max(0, Math.min(num(+d.bk, 0), num((G() || {}).bankMax, 120)));
    }
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
    } else if (S.tortos === 1) {
      avisa(Tx('{a} mandou um lance que não era dele — ignorado.', { a: S.tipo === 'guerra' ? nomeGuerra(l && l.de) : nomeParceiro() }), 'aviso');
    }
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
    if (haAdiante(T, k) || (dele && turnoDeleDe(u0) > T)) {
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
        if (T2 !== T || st.phase !== 'playing') { l.T2 = T2; l.h = hashDoTurno(st); }
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
      else if (hashDoTurno(st) !== l.h) mot = 'hash';
    }
    if (mot) divergiu(mot, T);
  };
  /* 19/09: o hash que se CONFERE no lance que chegou (e o do meu lance reaplicado depois da foto) é o da VIRADA do
   * turno (S.hashes[T], tirado no aoTurno antes das marcas `ia` guardadas para a vez daquele herói), não o vivo de
   * logo depois — na guerra, quem aplica uma marca pendente na virada tinha o hash vivo diferente do de quem a aplicou
   * ao receber, e divergia à toa. Só com a batalha viva: no fim o hash que vale é o do estado final, vivo. */
  function hashDoTurno(st) {
    var T = st.turno || 0;
    if (S.tipo === 'guerra' && st.phase === 'playing' && S.hashes && typeof S.hashes[T] === 'number') return S.hashes[T];
    return E().hash(st);
  }
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
  /* a vez de quem eu espero: o relógio do prazo dele corre desde AGORA (aoTurno e, 19/09, a restauração pela foto —
   * o relógio de antes da foto é o do motor congelado, e estourava a vez de quem estava ali) */
  function armaEspera(st) {
    var g = G(), e = E(), T = st.turno || 0;
    var u = (st.phase === 'playing') ? e.activeUnit(st) : null;
    var donoU = (u && g && g.donoDe) ? g.donoDe(u) : null;
    if (donoU === 'parceiro') {
      var jgT = jogadorGuerra(u.dono), bkT = jgT ? jgT.bk : S.bkParceiro;
      S.esperando = { uid: u.uid, T: T, desde: agora(), dono: u.dono || null,
                      prazo: Math.round((num(g.turnTime, 30) + bkT) * 1000) };
    } else S.esperando = null;
    return donoU;
  }
  Coop.aoTurno = function (st) {
    if (!st || !S.bid) return;
    var T = st.turno || 0, e = E();
    try { S.hashes[T] = e.hash(st); } catch (e1) {}
    if (st.phase === 'playing') { try { S.foto = { T: T, estado: e.foto(st) }; } catch (e2) {} }
    aplicaIaPendentes(st);                // 19/09: as marcas `ia` à espera da vez deste herói (depois do hash da virada)
    var k;
    for (k in S.hashes) if (Object.prototype.hasOwnProperty.call(S.hashes, k) && +k < T - Coop.HASHES) delete S.hashes[k];
    for (k in S.log) if (Object.prototype.hasOwnProperty.call(S.log, k) && +k < T - Coop.HASHES) delete S.log[k];
    var donoU = armaEspera(st);
    // o MEU turno começou: o `vivo` sai na hora — quem espera mede o meu
    // prazo desde este instante, e não até 8 s depois
    if (donoU === 'eu' && !S.fim) { S.vivoEm = agora(); envia('vivo', { b: S.bid, T: T }); }
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
    if (!d || (S.tipo !== 'grupo' && S.tipo !== 'guerra') || d.b !== S.bid || souAutoridade() || S.sincronizando) return;
    S.dessinc++;
    S.ultimaDessinc = { mot: 'aviso', T: num(d.T, 0), t: agora() };
    pedeFoto();
    muda();
  }
  function pedeFoto() {
    var g = G(), st = g && g.state;
    if (!st || !S.bid) return;
    // nunca em placing (o `placement` guarda referência de unidade): pede assim
    // que a batalha começar — e sem travar a colocação, que o `p` destrava.
    // 19/09: quem ENTROU ATRASADO na guerra (a ata chegou com ele fora da praça) nasce em placing enquanto os três
    // já jogam — o placing dele nunca acabaria sozinho, então a foto de quem manda é pedida daqui mesmo
    if (st.phase === 'placing' && !(S.tipo === 'guerra' && S.guerra && S.guerra.tarde)) { S.fotoDepois = true; return; }
    // um pedido em curso basta: o tique repete no prazo (dois gatilhos juntos —
    // o `ia` e o `religou` — pediam duas vezes, e o freio da autoridade calava o segundo)
    if (S.sincronizando && agora() - S.fotoPedidaEm < Coop.FOTO_REPEDE_MS) return;
    var primeira = !S.sincronizando;
    S.sincronizando = true;
    S.fotoPedidaEm = agora();
    envia('foto-pede', { b: S.bid, T: st.turno || 0 });
    // 19/09: na guerra a foto vem de quem MANDA (A1, A2, B1, B2 pela ordem), que tem nome — "o parceiro" era o
    // vocabulário do grupo e saía errado (a foto podia vir da guilda adversária)
    if (primeira) avisa(Tx('Sincronizando com {a}…', { a: S.tipo === 'guerra' ? nomeGuerra(autoridadeGuerra()) : nomeParceiro() }), 'info');
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
    var pkt = { b: S.bid, T: S.foto.T, estado: S.foto.estado, lances: ls, lider: autoridadeId(), ia: ia };
    // 19/09, a guerra: as marcas que AINDA esperam a vez do herói vão junto — quem restaura as guarda igual — e até
    // que `n` de cada um esta foto já traz (o que ele guardou com `n` maior entra depois dela)
    if (S.tipo === 'guerra') {
      pkt.iaPend = (S.iaPendentes || []).map(function (p) { return { u: p.uid, v: !!p.v }; });
      pkt.iaVisto = clone(S.iaVisto || {});
    }
    return envia('foto', pkt);
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
  function rFoto(d, de) {
    if (S.tipo === 'duelo') return;                          // no duelo, a foto do outro é só a palavra dele
    if (S.tipo === 'guerra' && de !== autoridadeId()) return;   // 15/09: na guerra, só a de quem manda (na MINHA conta)
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
      if (S.tipo === 'guerra') drenaIaGuerra();
      avisa(Tx('A foto de {a} trazia uma fusão entre heróis de jogadores diferentes — ignorada.', { a: nomeParceiro() }), 'aviso');
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
    // 19/09: os hashes de T0 em diante eram da linha do tempo VELHA deste motor (ele já tinha passado por esses turnos
    // antes de restaurar): conferir o próximo lance contra eles acusava divergência de novo, a cada volta
    for (t in S.hashes) if (Object.prototype.hasOwnProperty.call(S.hashes, t) && +t >= T0) delete S.hashes[t];
    S.log[T0] = [];
    S.fila = nova;
    var lances = (pkt.lances || []).map(function (x) { var y = clone(x); if (!y.de) y.de = autoridadeId(); return y; });
    // os MEUS que voltaram à fila saem de novo quando forem reaplicados (Coop.aplicado)
    var eu = meuId();
    for (var kk in S.fila) {
      if (Object.prototype.hasOwnProperty.call(S.fila, kk) && S.fila[kk].de === eu) S.fila[kk].reenvia = true;
    }
    var ok = false;
    /* 19/09: a lista `ia` da foto é a VERDADE INTEIRA de quem está fora agora — quem não está nela sai da marca. Antes
     * ela só marcava: quem voltava como A2 recebia a marca de volta pela foto do começo do turno (tirada quando ainda
     * estava fora), ficava 'fora' no próprio motor enquanto os três o viam de volta, e a vez dele passava sozinha.
     * Sem lista (a foto do FIM) o restauraFoto não mexe em marca nenhuma. */
    var ia = null;
    if (Object.prototype.toString.call(pkt.ia) === '[object Array]') {
      ia = [];
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
      S.fotoDepois = false;              // 19/09: a foto veio — o pedido guardado para "quando a batalha começar" é moot
      if (!pkt.fim) S.foto = { T: T0, estado: pkt.estado };
      if (S.tipo === 'guerra' && ia) {
        // a foto é a verdade inteira: as marcas aplicadas (a lista `ia`) e as que ainda esperam a vez do herói
        // (`iaPend`) são as de quem manda — as minhas de antes da foto saem
        var pend = [];
        if (Object.prototype.toString.call(pkt.iaPend) === '[object Array]') {
          for (var w = 0; w < pkt.iaPend.length && w < 32; w++) {
            var pp = pkt.iaPend[w];
            if (pp && typeof pp.u === 'string') pend.push({ uid: pp.u, v: !!pp.v });
          }
        }
        S.iaPendentes = pend;
        var visto = {};
        if (pkt.iaVisto && typeof pkt.iaVisto === 'object') {
          for (var kv in pkt.iaVisto) if (Object.prototype.hasOwnProperty.call(pkt.iaVisto, kv) && jogadorGuerra(kv)) visto[kv] = num(+pkt.iaVisto[kv], 0);
        }
        S.iaVisto = visto;
        sincronizaMarcasGuerra();
        drenaIaGuerra();                 // as marcas que chegaram enquanto eu esperava a foto e ela ainda não trazia
      }
      // o prazo de quem eu espero corre desde a foto (o relógio de antes é o do motor congelado)
      if (g.state) armaEspera(g.state);
    }
    muda();
    return ok;
  }

  // ------------------------------------------------------------ controle: ia, fusão, próxima, desistência
  function rIa(d, de) {
    if (S.tipo === 'guerra') { rIaGuerra(d, de); return; }
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
      if (g._voltouDaQueda) { try { g._voltouDaQueda(); } catch (eV) {} }   // 14/09: 30 s limpos
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
  function rSai(d, de) {
    if (S.tipo === 'guerra') { rSaiGuerra(d, de); return; }
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
          // 15/09: a marca da morte no MEU registro também — é com ele que a minha parte fecha no servidor (`largou`)
          marcaSrv('morte', x.uid);
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
    if (S.tipo === 'guerra') return Coop.sairDaGuerra('desistencia');   // 15/09: sair da guerra = os meus heróis caem
    var g = G();
    if (S.tipo !== 'duelo' || !S.duelo) {
      // a arena que nasceu depois de o duelo ser cancelado (sem sessão): sair é voltar ao Acampamento
      if (g && g.modoRede && g.modoRede() === 'duelo' && g._saiDaRede) { try { g._saiDaRede(); } catch (e0) {} return true; }
      return false;
    }
    if (!g || !g.state || S.fim) return false;
    S.fimMotivo = 'desistencia';
    /* 15/09, AS FALHAS CONHECIDAS (o dono: "arrume as falhas conhecidas"): desistir conta como DERROTA. Quem desiste
     * declara ao servidor — é contra ele mesmo, então vale — com os lances até aqui e o hash de ANTES do encerra; o
     * servidor refaz, põe os meus heróis a 0 e, na Arena e no Campo, conta a derrota na Brasa. Com keepalive e a fila de
     * retentativa da Autoridade: sai mesmo que a página vá embora logo depois. */
    S.hashAntesDoFim = hashDeRepouso(g.state);
    fechaDueloNoServidor({ desistiu: true, lado: S.duelo.eu }, S.hashAntesDoFim, { keepalive: true });
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
    S.hashAntesDoFim = hashDeRepouso(g.state);   // 15/09: o fechar de quem recebeu a desistência refaz até aqui
    avisa(Tx('{a} desistiu do duelo.', { a: nomeParceiro() }), 'ok');
    if (g._encerra) g._encerra(g.meuLado(), 'desistencia');
  }
  function rVivo(d, de) {
    if (!d || d.b !== S.bid) return;
    S.dentroConfirmado = true;
    var T = num(+d.T, 0);
    var jg = jogadorGuerra(de);
    if (jg) { if (T > jg.turnoDele) { jg.turnoDele = T; jg.turnoDeleEm = agora(); } return; }
    // o turno que ele diz só CRESCE: um `vivo` com turno velho não segura o prazo dele
    if (T > S.turnoDele) { S.turnoDele = T; S.turnoDeleEm = agora(); }
  }
  /* duelo: ele ainda carrega a arena — espero mais (até o teto da carga) */
  function rCarga(d) {
    if (S.tipo === 'guerra' && d && d.b === S.bid && S.dentroEu && !dentroGuerra()) {
      S.dentroPrazo = Math.max(S.dentroPrazo || 0, Math.min((S.cargaTeto || agora()) + Coop.DENTRO_MS, agora() + Coop.DENTRO_MS));
      return;
    }
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
  /* 14/09, O MAPA DO DESAFIO (o dono: "o duelo deve ocorrer no mapa da praça. Mapas aleatórios é para pvp de
   * inscrição na arena ou pvp comum no mapa pvp"): o amistoso é sempre a praça (js/core/data/arenas.js), sala 0 */
  Coop.MODOS_DUELO = ['desafio', 'arena', 'campo'];
  Coop.arenaDoDesafio = function () {
    var lista = D().arenas || [], m = null;
    for (var i = 0; i < lista.length; i++) if (lista[i] && lista[i].id === 'praca') m = lista[i];
    if (!m || !m.rooms || !m.rooms.length) return null;
    return { dungeonId: 'praca', roomIndex: 0, nome: m.name || Tx('A Praça') };
  };
  Coop.iniciaDuelo = function (d) {
    if (!d || !d.did || !d.oponente || !d.oponente.id) return false;
    var s = (+d.semente) >>> 0;
    // 14/09: o modo decide o mapa — a praça no desafio, o sorteio na arena e no campo (sem modo: o sorteio de antes)
    var modo = Coop.MODOS_DUELO.indexOf(d.modo) >= 0 ? d.modo : null;
    var ar = modo === 'desafio' ? Coop.arenaDoDesafio() : Coop.sorteiaArena(s);
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
                duplaA: A, duplaB: B, modo: modo };
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
    S.duelo.arenaSrv = { dungeonId: dg, roomIndex: ri, semente: s, duplaA: clone(A), duplaB: clone(B), eu: lado, modo: modo };
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
    avisa(modo === 'desafio' ? Tx('Desafio amistoso: {nome}.', { nome: ar.nome }) : Tx('Arena sorteada: {nome}.', { nome: ar.nome }), 'info');
    muda();
    return true;
  };
  /* 15/09, AS FALHAS CONHECIDAS (o dono: "arrume as falhas conhecidas" — desistir ou sumir do duelo não custava nada).
   * O hash do estado ANTES do Engine.encerra, para o servidor refazer os lances até ali (a desistência e o W.O.). Só
   * num ponto de repouso — a vez de gente conectada, ou a colocação —, que é onde o juiz também para depois dos turnos
   * da IA; no meio de um turno da IA (o mascote, a invocação) vai null e o servidor não confere o fim (os lances
   * seguem conferidos um a um). */
  function hashDeRepouso(st) {
    var e = E();
    if (!st || !e || !e.hash) return null;
    if (st.phase === 'playing') {
      var u = e.activeUnit ? e.activeUnit(st) : null;
      if (!u || (u.kind !== 'hero' && u.kind !== 'fusion') || !u.dono || u.ia) return null;
    } else if (st.phase !== 'placing') return null;
    try { return e.hash(st); } catch (er) { return null; }
  }
  Coop._hashDeRepouso = hashDeRepouso;
  /* o corpo do POST /api/duelo/fechar (sem sessão, ou sem as duas contas conferidas: null) */
  function corpoDoDuelo(hashFinal, extra) {
    var Aut = JOGO.Autoridade, arena = S.duelo && S.duelo.arenaSrv, Se = JOGO.Sessao;
    if (!Aut || !Aut.ligada || !Aut.ligada() || !Aut.fechaDuelo || !arena || !S.parceiro) return null;
    var ids = function (dp) { return dp.map(function (p) { return p.heroId || p.classId; }); };
    var souA = arena.eu === 'A';
    var eu = { conta: Se && Se.contaId ? Se.contaId() : null, dono: meuId(), herois: ids(souA ? arena.duplaA : arena.duplaB) };
    var ele = { conta: nuvemDe(S.parceiro.id), dono: S.parceiro.id, herois: ids(souA ? arena.duplaB : arena.duplaA) };
    if (!eu.conta || !ele.conta) return null;
    // 14/09: o `modo` vai junto — o servidor nunca ranqueia o desafio, e confere a arena e a paridade
    var c = { did: S.duelo.did, modo: arena.modo || undefined, dungeonId: arena.dungeonId, roomIndex: arena.roomIndex,
              semente: arena.semente, A: souA ? eu : ele, B: souA ? ele : eu, lances: (S.logSrv || []).slice(),
              hashFinal: (typeof hashFinal === 'number') ? hashFinal : null, fotografada: !!S.fotografada };
    for (var k in (extra || {})) if (Object.prototype.hasOwnProperty.call(extra, k)) c[k] = extra[k];
    return c;
  }
  /* Fecha o duelo no servidor UMA vez por sessão (S.fechouSrv): `extra` = {desistiu, lado} | {wo} | {}. A resposta
   * 'aguardando' pergunta de novo sozinha (Autoridade.fechaDuelo); a de vez traz a vida e a coroa. */
  function fechaDueloNoServidor(extra, hashFinal, op) {
    if (S.fechouSrv) return true;
    var corpo = corpoDoDuelo(hashFinal, extra);
    if (!corpo) return false;
    S.fechouSrv = true;
    var desistiu = !!(extra && extra.desistiu), wo = !!(extra && extra.wo);
    JOGO.Autoridade.fechaDuelo(corpo, op).then(function (r) {
      // 14/09: o servidor refez o duelo com a vida que ELE guardou no abrir e gravou a do fim
      try { if (JOGO.Vida && JOGO.Vida.sincroniza) JOGO.Vida.sincroniza(); } catch (eV) {}
      if (r && r.ok && r.ranqueado && typeof r.delta === 'number') {
        avisa(Tx('Duelo ranqueado: {a}{delta} pontos de Brasa.', { a: r.delta >= 0 ? '+' : '', delta: r.delta }), r.delta >= 0 ? 'ok' : 'info');
      } else if (r && r.ok && r.motivo === 'teto') {
        avisa(Tx('Este duelo não contou para o ranking (o teto de duelos ranqueados de hoje).'), 'info');
      } else if (r && r.ok && r.motivo === 'paridade') {
        avisa(Tx('Este duelo não valeu coroa: a diferença de nível passou do limite.'), 'info');
      } else if (r && r.ok && (r.motivo === 'sem-partida' || r.motivo === 'dupla' || r.motivo === 'mapa')) {
        avisa(Tx('Este duelo não valeu coroa: o servidor não reconheceu a partida.'), 'info');
      } else if (r && r.ok && wo && r.motivo === 'wo-sem-prova') {
        avisa(Tx('O servidor não viu a queda do outro lado: o W.O. não valeu coroa.'), 'info');
      }
      if (r && r.ok && desistiu && r.fim === 'desistencia') {
        avisa(Tx('Desistência registrada: os seus heróis saem com a vida a 0.'), 'aviso');
      }
    });
    return true;
  }
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
     * o resultado de lá muda a Brasa — nos dois. Os tetos por par e por dia são do servidor.
     * 15/09, AS FALHAS CONHECIDAS: a desistência e o W.O. também fecham, e custam a quem saiu —
     *   - quem DESISTIU já fechou no Coop.desistir, declarando (desistiu: true);
     *   - quem RECEBEU a desistência fecha sem declarar nada, com o hash de antes do encerra: o servidor grava a vida
     *     do replay dos dois e espera a declaração do desistente (a Autoridade pergunta de novo sozinha);
     *   - quem VENCEU por W.O. declara (wo: true); o servidor só acredita com a queda que o relé anotou;
     *   - quem PERDEU por W.O. não fecha (quem ficou fecha); a partida contestada segue sem fechar. */
    var vidaNoFechar = false;
    try {
      var Aut = JOGO.Autoridade, desist = S.fimMotivo === 'desistencia';
      if (!contestado) {
        if (wo) { if (f.venci) vidaNoFechar = fechaDueloNoServidor({ wo: true }, S.hashAntesDoFim); }
        else if (desist) { vidaNoFechar = f.venci ? fechaDueloNoServidor({}, S.hashAntesDoFim) : !!S.fechouSrv; }
        else vidaNoFechar = fechaDueloNoServidor({}, f.h);
      }
      // 14/09: sem o fechar (contestado, o W.O. contra mim), a vida de lá é a que ele guardou
      if (!vidaNoFechar && Aut && Aut.ligada && Aut.ligada() && JOGO.Vida && JOGO.Vida.sincroniza) JOGO.Vida.sincroniza();
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
        S.hashAntesDoFim = hashDeRepouso(g.state);   // 15/09: antes do encerra
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
    if (S.tipo === 'guerra' && S.guerra) {
      if (!S.fim) {
        S.fim = { venc: res.venc, h: res.h, venci: !!res.venci, empate: !!res.empate, clima: res.clima, t: agora() };
        fechaGuerraNoServidor();
        muda();
      }
      return infoGuerra();
    }
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
               ptsMeus: S.duelo.ptsMeus, ptsDele: S.duelo.ptsDele, modo: S.duelo.modo || null };
    }
    S.descidaAcabou = !!(S.descidaAcabou || S.parceiroSaiu || (S.parceiroIA && S.sumidoDesde));
    var info = { lider: souLider(), parceiroVoltou: !S.sumidoDesde && !S.parceiroSaiu,
                 descidaAcabou: S.descidaAcabou };
    if (S.descidaAcabou && res.fase === 'won' && !S.parceiroSaiu) avisa(Tx('{a} não voltou — a descida acabou.', { a: nomeParceiro() }), 'aviso');
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
        avisa(Tx('Sincronizando com {a}…', { a: nomeParceiro() }), 'info');
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
    if (S.tipo === 'guerra' && S.bid && !S.fim && !dentroGuerra()) return true;    // 15/09: os quatro entrando
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

  // ------------------------------------------------------------ a guerra de guilda 2×2 (15/09)
  /* A GUERRA DE GUILDA NA SEDE (15/09, o dono: "a guerra de guild que é 2x2 de cada guild é na sede de guild, isso
   * dá pontos de experiência para guild"). Quatro jogadores, cada um com a DUPLA dele: o MESMO lockstep do grupo e
   * do duelo, com três destinos em vez de um.
   *   - A ATA É DO SERVIDOR (servidor/guerra.py): os oito payloads, a semente e a vida de cada herói chegam pelo
   *     JOGO.Guerra (grupo.js) com a partida pronta. Não há compromisso nem revelação: os quatro confirmaram lá.
   *   - QUEM MANDA (a foto de resgate): o primeiro da ordem A1, A2, B1, B2 (A = quem entrou na fila antes; 1 = quem
   *     inscreveu) que está AQUI — sem queda, sem saída e sem os heróis marcados fora. Cada cliente calcula igual;
   *     a foto só vale de quem ele vê como autoridade, e só a que ele pediu.
   *   - LANCE só do dono da vez (donoCerto), com o hash no fim do turno, como sempre; cada lance vai aos três.
   *   - QUEM CAI: passada a carência, quem MARCA os heróis dele (u.ia: o turno passa) é o PARCEIRO DE GUILDA —
   *     nunca o adversário, que ganharia pulando a vez do outro. Quem volta é desmarcado pelo parceiro (ou por si
   *     mesmo, se o parceiro também está fora). Quem SAI da guerra morre (a voz `sai`, como no grupo).
   *   - W.O. DO LADO INTEIRO: só quando os DOIS adversários estão fora há WO_MS. O fechar vai com `wo: true` e sem
   *     o hash do fim; o servidor só o confirma com a queda dos dois anotada pelo relé (aí rende XP nos tetos) — sem
   *     essa prova vale só a vida da luta. Forjar um W.O. não dá nada.
   *   - O FIM: cada um dos quatro fecha no servidor (quem manda na hora; os outros GUERRA_FECHA_MS depois, e
   *     recebem o guardado — o registro limpo de outro vale se o meu foi fotografado).
   * 19/09 (o dono: "dê uma revisada na guerra de guild do meu jogo e ajuste o que for necessário"):
   *   - QUEM CAIU (ou entrou atrasado) NÃO VOLTA A MANDAR até o fim da guerra — o `cedeu` do grupo, espelhado nos
   *     quatro: cada um guarda `caiuAlgumaVez` de quem viu cair (o `caiu` do relé, o silêncio, a marca `ia`, o
   *     `ausente`) e `euCai` de si mesmo (a volta da conexão, a marca do parceiro, o `dentro` que chegou com a guerra
   *     solta). E a memória VIAJA: todo `vivo`, `dentro`, `foto-pede`, `foto` e `ia` leva `caidos` (quem este cliente
   *     sabe que caiu, ele mesmo inclusive); quem recebe só acrescenta — a decisão de quem manda converge nos quatro
   *     num `vivo`. Sem isso quem estava fora quando outro caiu voltava vendo outra autoridade e recusava a foto certa
   *     para sempre. Quem volta pede a foto SEMPRE e a lista `ia` da foto é a verdade inteira (quem não está nela sai
   *     da marca; `iaPend` traz as marcas que ainda esperam a vez do herói).
   *   - QUEM RELIGA anuncia `dentro {religou: true}` aos três SEM cx (a conexão nova não conhece a deles nem eles a
   *     dela): um `dentro` assim, vindo de um cx novo, vale como "caiu e voltou" mesmo sem o `caiu` do relé — é o que
   *     salva a guerra quando o próprio relé reinicia (os quatro voltam sem `caiu` nenhum).
   *   - QUEM SAI declara ao servidor (POST /api/guerra/sair {gid}, com keepalive e a fila de retentativa da Autoridade):
   *     os heróis dele a 0 na hora, também aqui (Vida.fim) — e é a prova que o juiz exige para a marca `morte` dele.
   *   - O FECHAR passa pela Autoridade (retentativa, keepalive, 'aguardando' perguntado de novo a cada 5 s) e o corpo
   *     fica guardado na luta aberta da conta para sair ao abrir o jogo; o W.O. vai com `wo: true` depois dos 60 s. */
  Coop.MAPA_GUERRA = 'sede';
  Coop.GUERRA_FECHA_MS = 2500;
  var GUERRA_ACOES = ['dentro', 'lance', 'pede', 'foto-pede', 'foto', 'ia', 'sai', 'vivo', 'dessinc', 'carga'];
  function jogadorGuerra(id) {
    var g = S.guerra;
    return (g && id && id !== g.meuId && Object.prototype.hasOwnProperty.call(g.js, id)) ? g.js[id] : null;
  }
  function outrosGuerra() {
    var g = S.guerra, out = [];
    if (!g) return out;
    for (var i = 0; i < g.ordem.length; i++) if (g.ordem[i] !== g.meuId && g.js[g.ordem[i]]) out.push(g.js[g.ordem[i]]);
    return out;
  }
  function nomeGuerra(id) {
    var g = S.guerra;
    return (g && g.nomes && g.nomes[id]) || nomeDe(id);
  }
  function foraGuerra(j) { return !!(j && (j.saiu || j.marcado || j.sumidoDesde)); }
  /* 19/09: quem manda é o primeiro da ordem que está AQUI e NUNCA CAIU (nem entrou atrasado). Só se os quatro já
   * caíram alguma vez vale o primeiro presente. Antes era só "o primeiro presente": a A1 que caía e voltava retomava
   * a autoridade sem sincronizar e a foto velha dela rebobinava a guerra dos outros três. */
  function presenteGuerra(id) {
    var g = S.guerra;
    return id === g.meuId ? !g.euFora : !foraGuerra(g.js[id]);
  }
  function caiuGuerra(id) {
    var g = S.guerra;
    return id === g.meuId ? !!g.euCai : !!(g.js[id] && g.js[id].caiuAlgumaVez);
  }
  /* o turno em que ele se ACERTOU depois da última queda (null = voltou e ainda não; undefined = nunca caiu) */
  function sincDe(id) {
    var g = S.guerra;
    if (id === g.meuId) return g.euCai ? (g.euSincT == null ? null : g.euSincT) : undefined;
    var j = g.js[id];
    if (!j || !j.caiuAlgumaVez) return undefined;
    return j.sincT == null ? null : j.sincT;
  }
  /* QUEM MANDA (19/09, a segunda rodada): (1) o primeiro da ordem presente que NUNCA caiu; (2) senão, entre os
   * presentes que caíram e já se ACERTARAM (sincT: o turno da foto que os restaurou), o que se acertou no turno mais
   * BAIXO — está em dia há mais tempo —, empate pela ordem; (3) só se ninguém presente se acertou ainda (os quatro
   * acabaram de voltar juntos, o relé reiniciou) vale o primeiro presente da ordem, e esse solta o próprio motor
   * (tiqueGuerra) depois de ouvir todos os presentes desde a volta. Antes, com os quatro já caídos alguma vez, valia
   * "o primeiro presente": a A1 que caía de novo e voltava se via como quem manda SEM foto (o `ia` dela foi ao cx
   * velho), soltava o motor no turno em que caiu, mandava `dessinc` aos três e a foto velha dela rebobinava a guerra
   * deles — o mesmo defeito da primeira revisão, de volta depois de um reinício do relé. Quem voltou e ainda não se
   * acertou (sincT null) nunca é eleito enquanto há alguém acertado; a decisão converge porque o sincT viaja. */
  function autoridadeGuerra() {
    var g = S.guerra;
    if (!g) return null;
    var i, id, T, melhor = null, mT = Infinity;
    for (i = 0; i < g.ordem.length; i++) { id = g.ordem[i]; if (presenteGuerra(id) && !caiuGuerra(id)) return id; }
    for (i = 0; i < g.ordem.length; i++) {
      id = g.ordem[i];
      if (!presenteGuerra(id)) continue;
      T = sincDe(id);
      if (typeof T === 'number' && T < mT) { mT = T; melhor = id; }
    }
    if (melhor) return melhor;
    for (i = 0; i < g.ordem.length; i++) { id = g.ordem[i]; if (presenteGuerra(id)) return id; }
    return g.meuId;
  }
  /* A MEMÓRIA DA QUEDA VIAJA (19/09): quem eu sei que caiu alguma vez (eu inclusive) vai em todo `vivo`, `dentro`,
   * `foto-pede`, `foto` e `ia` como `caidos: {id: sincT}` (null = voltou e ainda não se acertou). Quem recebe só
   * ACRESCENTA — a união converge nos quatro em segundos. Antes cada um montava a memória dos sinais que viu, e quem
   * estava fora quando a A1 caiu voltava vendo a A1 como quem manda: recusava a foto da Bia, a A1 (euCai) nunca
   * respondia, e ficava "Sincronizando com Ana…" para sempre.
   * A segunda rodada: `caidos[x]` só vale de quem tem o direito de falar por x — o PRÓPRIO x (o `sincT` dele é a
   * palavra dele) ou o parceiro de guilda de x (que só diz "caiu", a mesma régua da marca `ia`). Vindo de qualquer
   * um, um `vivo` forjado punha os três como caídos e fazia de quem quisesse a autoridade dos outros (uma foto de
   * mentira aceita por quem pedisse). O "caiu" do parceiro não apaga um sincT que EU soube depois da minha volta
   * (pode ser a memória velha dele); apaga o que soube antes de cair (essa é a velha). */
  function caidosGuerra() {
    var g = S.guerra, out = {};
    if (!g) return out;
    for (var i = 0; i < g.ordem.length; i++) {
      var T = sincDe(g.ordem[i]);
      if (T !== undefined) out[g.ordem[i]] = T;
    }
    return out;
  }
  function sincValido(v) {
    if (v === null) return null;
    if (typeof v !== 'number' || !isFinite(v) || v < 0) return undefined;
    return Math.min(Math.floor(v), 100000);
  }
  function adotaCaidos(lista, de) {
    var g = S.guerra, jd = jogadorGuerra(de);
    if (!g || !jd || !lista || typeof lista !== 'object') return false;
    var mapa = lista;
    if (Object.prototype.toString.call(lista) === '[object Array]') {       // a página velha ainda manda a lista
      mapa = {};
      for (var q = 0; q < lista.length && q < 4; q++) if (typeof lista[q] === 'string') mapa[lista[q]] = null;
    }
    var mudou = false, n = 0;
    for (var id in mapa) {
      if (!Object.prototype.hasOwnProperty.call(mapa, id) || ++n > 4) continue;
      var v = sincValido(mapa[id]);
      if (v === undefined) continue;
      if (id === g.meuId) {
        if (jd.lado !== g.lado) continue;                                   // só o meu parceiro fala por mim
        if (!g.euCai) { g.euCai = true; mudou = true; }
        if (g.euSincT === undefined) g.euSincT = null;
        continue;
      }
      var j = g.js[id];
      if (!j) continue;
      if (id === de) {
        if (!j.caiuAlgumaVez || j.sincT !== v) mudou = true;
        j.caiuAlgumaVez = true; j.sincT = v; j.sincTEm = agora();
      } else if (jd.lado === j.lado) {
        if (!j.caiuAlgumaVez) { j.caiuAlgumaVez = true; j.sincT = null; j.sincTEm = 0; mudou = true; }
        else if (j.sincT != null && j.sincTEm < (S.religouEm || 0)) { j.sincT = null; j.sincTEm = 0; mudou = true; }
      }
    }
    if (mudou) muda();
    return mudou;
  }
  /* ele caiu (ou foi marcado) na MINHA conta: não manda mais, e só volta à linha depois de se acertar por uma foto */
  function anotaQuedaGuerra(j) {
    if (!j) return;
    j.caiuAlgumaVez = true;
    j.sincT = null; j.sincTEm = 0;
  }
  function anotaMinhaQuedaGuerra(g) {
    if (!g) return;
    g.euCai = true;
    g.euSincT = null;
    g.voltas = (g.voltas || 0) + 1;       // a minha memória dos outros é velha: o tique só me solta depois de ouvir todos
  }
  function ouviTodosDesdeVoltaGuerra() {
    var g = S.guerra, lista = outrosGuerra();
    for (var i = 0; i < lista.length; i++) {
      var j = lista[i];
      if (!foraGuerra(j) && j.ouvidoNaVolta !== (g.voltas || 0)) return false;
    }
    return true;
  }
  /* A MARCA `ia` ESPERA A VEZ DO HERÓI (19/09). A passagem de vez de um herói marcado NÃO é lance: cada motor a faz
   * sozinho quando o herói fica ativo e está marcado. Marcar ou desmarcar "na hora" chegava em cada motor num ponto
   * diferente do turno (quem marcava podia estar turnos ATRÁS ou À FRENTE de quem recebia), e `u.ia` entra no hash:
   * uma divergência e uma foto a cada marca. Ancorar a marca no turno de quem falou não bastava — quem já estava à
   * frente aplicava no meio de outro turno. O único ponto que os quatro têm em comum é a VEZ do herói marcado: a
   * marca fica guardada e entra na virada para o turno em que ele é o ativo (Coop.aoTurno, depois do hash da virada)
   * — ou na hora, se ele já é o ativo aqui (o motor está parado esperando o lance dele, e nada muda até entrar). */
  function aplicaIaGuerra(u, v) {
    if (!u || !!u.ia === !!v) return false;
    u.ia = !!v;
    marcaSrv('ia', u.uid, !!v);
    return true;
  }
  function agendaIaGuerra(st, u, v) {
    if (!u) return false;
    var pend = (S.iaPendentes || []).filter(function (p) { return p.uid === u.uid; });
    var depois = pend.length ? !!pend[pend.length - 1].v : !!u.ia;    // o que vale quando a fila dele esvaziar
    if (depois === !!v) return false;
    var at = (st && st.phase === 'playing') ? E().activeUnit(st) : null;
    if (at && at.uid === u.uid && !pend.length) return aplicaIaGuerra(u, v);
    S.iaPendentes.push({ uid: u.uid, v: !!v });
    return true;
  }
  function aplicaIaPendentes(st) {
    if (S.tipo !== 'guerra' || !S.iaPendentes || !S.iaPendentes.length || !st || st.phase !== 'playing') return;
    var at = E().activeUnit(st);
    if (!at) return;
    var fica = [];
    for (var i = 0; i < S.iaPendentes.length; i++) {
      var p = S.iaPendentes[i];
      if (p.uid !== at.uid) { fica.push(p); continue; }
      aplicaIaGuerra(at, p.v);
    }
    S.iaPendentes = fica;
  }
  /* a marca de um herói como ela VAI ficar (a aplicada, ou a última guardada para a vez dele) */
  function iaEfetiva(u) {
    var pend = (S.iaPendentes || []).filter(function (p) { return p.uid === u.uid; });
    return pend.length ? !!pend[pend.length - 1].v : !!u.ia;
  }
  /* depois de uma foto: a marca dos meus e o `marcado` dos outros são o que a foto disse (a verdade inteira) */
  function sincronizaMarcasGuerra() {
    var st = (G() || {}).state, g = S.guerra;
    if (!st || !g) return;
    var fora = {};
    unidadesDe(st, null, true).forEach(function (u) { if (iaEfetiva(u)) fora[u.dono] = true; });
    if (fora[g.meuId]) { g.euFora = true; g.euCai = true; }
    else g.euFora = false;
    outrosGuerra().forEach(function (j) {
      j.marcado = !!fora[j.id];
      if (j.marcado) j.caiuAlgumaVez = true;
    });
  }
  function parceiroDeGuilda() {
    var g = S.guerra;
    var l = outrosGuerra().filter(function (j) { return j.lado === g.lado; });
    return l[0] || null;
  }
  function turnoDeleDe(u) {
    if (S.tipo !== 'guerra') return S.turnoDele || 0;
    var j = u ? jogadorGuerra(u.dono) : null;
    if (j) return j.turnoDele;
    var m = 0;
    outrosGuerra().forEach(function (x) { if (x.turnoDele > m) m = x.turnoDele; });
    return m;
  }
  // as vozes que levam a memória da queda (`caidos`) — as periódicas e as que decidem quem manda
  var COM_CAIDOS = { vivo: 1, dentro: 1, 'foto-pede': 1, foto: 1, ia: 1 };
  function comCaidos(acao, dados) {
    if (dados && typeof dados === 'object' && COM_CAIDOS[acao]) dados.caidos = caidosGuerra();
    return dados;
  }
  /* semCx (19/09): a voz vai a QUALQUER conexão do id — a de quem religou, que não sabe mais o cx dos outros */
  function enviaGuerra(acao, dados, semCx) {
    var r = R(), ok = false;
    if (!r || !r.dirige) return false;
    if (acao === 'vivo' && dados) S.vivoT = num(+dados.T, 0);
    comCaidos(acao, dados);
    outrosGuerra().forEach(function (j) {
      if (j.saiu) return;
      try { if (r.dirige('batalha', j.id, acao, dados, (j.cx && !semCx) ? { cx: j.cx } : {})) ok = true; } catch (e) {}
    });
    if (!ok) {
      try { S.ultimaRecusa = r.ultimaRecusa ? r.ultimaRecusa() : 'falhou'; } catch (e2) { S.ultimaRecusa = 'falhou'; }
    }
    return ok;
  }
  function enviaA(j, acao, dados) {
    var r = R();
    comCaidos(acao, dados);
    try { return !!(r && r.dirige && j && r.dirige('batalha', j.id, acao, dados, j.cx ? { cx: j.cx } : {})); }
    catch (e) { return false; }
  }
  /* o cx carimbado barra quem copia o `de`; um cx NOVO só vale de quem eu dava por caído (voltou por outra conexão)
   * — ou, 19/09, num `dentro {religou: true}`: a conexão nova se apresenta, e isso É a prova de que a velha caiu
   * (o relé carimba o `de` e o `cx`). Sem isso o relé reiniciando no meio da guerra deixava cada um recusando a
   * conexão nova de quem não viu cair, até os dois lados "vencerem" por W.O. */
  function aceitaGuerra(ev) {
    var j = jogadorGuerra(ev && ev.de);
    if (!j) return false;
    if (j.cx && ev.cx && ev.cx !== j.cx) {
      var religou = ev.acao === 'dentro' && !!ev.dados && ev.dados.religou === true;
      if (!j.sumidoDesde && !religou) return false;
      if (!j.sumidoDesde) j.sumidoDesde = agora() - 1;      // caiu e voltou: o `recebe` o dá por de volta (cx novo)
      j.cx = ev.cx;
    } else if (!j.cx && ev.cx) j.cx = ev.cx;
    return true;
  }
  function dentroGuerra() {
    if (!S.dentroEu) return false;
    if (S.dentroLiberado) return true;
    return outrosGuerra().every(function (j) { return j.dentro || j.saiu; });
  }
  function unidadesDe(st, dono, soVivas) {
    var out = [];
    for (var i = 0; st && st.units && i < st.units.length; i++) {
      var u = st.units[i];
      if ((u.kind === 'hero' || u.kind === 'fusion') && (dono == null ? !!u.dono : u.dono === dono) &&
          (!soVivas || (u.alive && !u.offBoard))) out.push(u);
    }
    return out;
  }
  Coop.arenaDaGuerra = function () {
    var lista = D().arenas || [], m = null;
    for (var i = 0; i < lista.length; i++) if (lista[i] && lista[i].id === Coop.MAPA_GUERRA) m = lista[i];
    if (!m || !m.rooms || !m.rooms.length) return null;
    return { dungeonId: Coop.MAPA_GUERRA, roomIndex: 0, nome: m.name || Tx('Salão da Sede') };
  };

  /* A partida pronta do servidor: d = { gid, ata: {mapa, sala, semente, A, B, carry}, jogadores: [{conta, nome,
   * dono, lado, ordem}], guildas: {A, B}, eu: o meu id da Rede }. A ata é conferida como a do grupo (o payload de
   * cada herói, o dono de cada um no lado certo): uma ata torta não abre a guerra. */
  Coop.iniciaGuerra = function (d) {
    if (!d || typeof d.gid !== 'string' || !d.gid || !d.ata || Object.prototype.toString.call(d.jogadores) !== '[object Array]' ||
        d.jogadores.length !== 4) return false;
    var ata = d.ata;
    if (ata.mapa !== Coop.MAPA_GUERRA || ata.sala !== 0 || typeof ata.semente !== 'number' || !Coop.arenaDaGuerra()) return false;
    var me = d.eu || (function () { var r = R(); try { return r && r.meuId ? r.meuId() : null; } catch (e) { return null; } })();
    if (!me) return false;
    var porDono = {}, nLado = { A: 0, B: 0 };
    for (var i = 0; i < d.jogadores.length; i++) {
      var j = d.jogadores[i];
      if (!j || typeof j.dono !== 'string' || !j.dono || porDono[j.dono] || (j.lado !== 'A' && j.lado !== 'B')) return false;
      porDono[j.dono] = j;
      nLado[j.lado]++;
    }
    if (nLado.A !== 2 || nLado.B !== 2 || !porDono[me]) return false;
    function okLado(lista, lado) {
      if (Object.prototype.toString.call(lista) !== '[object Array]' || lista.length < 1 || lista.length > 4) return false;
      for (var q = 0; q < lista.length; q++) {
        var p = lista[q];
        if (!p || !porDono[p.dono] || porDono[p.dono].lado !== lado || !validaPayload(p, { semMestre: true })) return false;
      }
      return true;
    }
    if (!okLado(ata.A, 'A') || !okLado(ata.B, 'B')) return false;
    var ordenados = d.jogadores.slice().sort(function (a, b) {
      return (a.lado === b.lado) ? (num(a.ordem, 0) - num(b.ordem, 0)) : (a.lado < b.lado ? -1 : 1);
    });
    var n0 = S.n;
    S = nova('guerra');
    S.n = n0;
    S.bid = d.gid;
    S.fase = 'batalha';
    var g = S.guerra = { gid: d.gid, meuId: me, lado: porDono[me].lado, ordem: ordenados.map(function (x) { return x.dono; }),
                         js: {}, nomes: {}, guildas: clone(d.guildas || null), euFora: false, resultado: null, fechou: false,
                         // 19/09: caí (ou entrei atrasado) alguma vez: não mando mais; `tarde` = a guerra já estava solta;
                         // `euReligou` = a minha conexão é outra desde que a guerra abriu (todo `dentro` meu diz)
                         euCai: false, tarde: false, tardePediu: false, saiSrv: false, euReligou: false };
    ordenados.forEach(function (x) {
      g.nomes[x.dono] = String(x.nome || nomeDe(x.dono)).slice(0, 24);
      if (x.dono === me) return;
      g.js[x.dono] = { id: x.dono, cx: null, nome: g.nomes[x.dono], lado: x.lado, conta: x.conta, ordem: num(x.ordem, 0),
                       sumidoDesde: 0, ultimoSinal: agora(), turnoDele: 0, turnoDeleEm: 0, bk: 0,
                       marcado: false, saiu: false, saiuEm: 0, dentro: false,
                       caiuAlgumaVez: false, saiuTudo: false };     // 19/09: a memória da queda; o `sai` sem estado
    });
    S.cargaTeto = agora() + Coop.CARGA_MS;
    S.cargaProx = 0;
    S.dentroPrazo = 0;
    S.ultimoSinal = agora();
    S.iaSeq = agora();                    // 19/09: o contador das minhas marcas `ia` nasce do relógio (uma página nova não repete)
    ligaTique();
    var r = R();
    outrosGuerra().forEach(function (x) { try { if (r && r.vigia) r.vigia(x.id, null); } catch (e) {} });
    var gm = G(), bid = S.bid, ar = Coop.arenaDaGuerra();
    var ok = !!(gm && gm._iniciaGuerraRede && gm._iniciaGuerraRede({
      gid: bid, mapa: ata.mapa, sala: ata.sala, semente: ata.semente, A: clone(ata.A), B: clone(ata.B),
      carry: clone(ata.carry || null), eu: g.lado, meuId: me, guildas: clone(d.guildas || null),
      jogadores: clone(ordenados), arena: ar
    }, function () {
      if (S.bid !== bid) return;
      S.dentroEu = true;
      S.dentroPrazo = agora() + Coop.DENTRO_MS;
      S.dentroRepProx = agora() + Coop.DENTRO_REP_MS;
      enviaGuerra('dentro', { bid: bid, viu: false });
      muda();
    }));
    if (!ok) { S = nova(null); S.n = n0; muda(); return false; }
    anotaLutaGuerra();                    // 19/09: a guerra pronta é luta aberta desde já (o servidor a considera viva)
    avisa(Tx('Guerra de Guilda no {nome}.', { nome: ar.nome }), 'info');
    muda();
    return true;
  };
  function rDentroGuerra(d, de) {
    var j = jogadorGuerra(de);
    if (!j || d.bid !== S.bid) return;
    // 19/09: eu já tinha soltado a guerra sem ele (o prazo do `dentro` passou): ele entra ATRASADO — a resposta diz
    var tarde = !!(S.dentroLiberado && !j.dentro);
    if (tarde) j.caiuAlgumaVez = true;    // 19/09: quem entra atrasado não manda — e EU também o tiro da linha (não só quem o marca)
    j.dentro = true;
    j.ultimoSinal = agora();
    if (S.dentroEu && d.viu !== true) enviaA(j, 'dentro', { bid: S.bid, viu: true, tarde: tarde, religou: !!S.guerra.euReligou });
    // e o contrário: quem me responde diz que a guerra já estava solta quando cheguei — não mando até o fim e pego a foto
    if (d.tarde === true && S.guerra) { S.guerra.tarde = true; S.guerra.euCai = true; }
    pedeFotoTarde();                      // já aqui, antes de o motor dar um passo que fosse (o tique só repete)
    muda();
  }
  /* 19/09: entrei atrasado (os três já jogavam): assim que os três me respondem, a foto de quem manda me põe no
   * turno deles — o meu placing nunca acabaria sozinho, e sem a foto eu mandaria `dessinc` do turno 0 aos três
   * (a `volta` do parceiro costuma chegar antes das respostas de `dentro` e já traz a foto: aí não se pede outra —
   * o freio de quem manda ignoraria o pedido e a repetição de 3 s traria uma segunda foto à toa). O pedido sai na
   * própria resposta que solta a batalha (rDentroGuerra): entre ela e o tique o motor dava um passo, jogava um lance
   * do turno 0 aos três e a foto o rebobinava. */
  function pedeFotoTarde() {
    var g = S.guerra;
    if (!g || !g.tarde || g.tardePediu || !dentroGuerra() || !emBatalha()) return;
    g.tardePediu = true;
    if (!S.restauradaEm) pedeFoto();
  }
  function tiqueGuerra(ag) {
    var g = S.guerra;
    if (!g) return true;
    if (!S.dentroEu) {
      if (S.cargaTeto && ag > S.cargaTeto) { Coop.sairDaGuerra('carga'); return false; }
      if (ag >= S.cargaProx) { S.cargaProx = ag + Coop.DENTRO_REP_MS; enviaGuerra('carga', { b: S.bid }); }
    } else if (!dentroGuerra()) {
      if (S.dentroPrazo && ag > S.dentroPrazo) {
        // quem não entrou a tempo conta como caído desde o começo: a carência e o W.O. correm — a guerra não espera
        // (19/09: e sai da linha de quem manda já aqui, não só quando o parceiro dele o marcar)
        var ini = S.dentroPrazo - Coop.DENTRO_MS;
        outrosGuerra().forEach(function (j) { if (!j.dentro && !j.sumidoDesde) { j.sumidoDesde = ini; j.caiuAlgumaVez = true; } });
        S.dentroLiberado = true;
        muda();
      } else if (ag >= S.dentroRepProx) {
        S.dentroRepProx = ag + Coop.DENTRO_REP_MS;
        outrosGuerra().forEach(function (j) { if (!j.dentro) enviaA(j, 'dentro', { bid: S.bid, viu: false, religou: !!g.euReligou }); });
      }
    }
    // 19/09: pedi a foto e, pela memória que chegou depois, quem manda sou EU (os quatro já caíram alguma vez e sou o
    // primeiro presente): ninguém responde a quem manda — o meu estado é a referência, o motor solta
    if (S.sincronizando && !S.fimFotoPedidaEm && souAutoridade()) {
      S.sincronizando = false; S.fotoDepois = false;
      drenaIaGuerra();
      muda();
    }
    // voltei com os heróis marcados fora e o meu parceiro de guilda também está fora: ninguém me desmarca
    if (g.euFora && !S.sincronizando && emBatalha()) {
      var par = parceiroDeGuilda();
      if (!par || foraGuerra(par)) desmarcaGuerra(g.meuId);
    }
    pedeFotoTarde();                      // entrei atrasado: a foto de quem manda (o pedido normalmente já saiu no `dentro`)
    return true;
  }
  function sumiuGuerra(id, t0, cx) {
    var j = jogadorGuerra(id);
    if (!j) return;
    if (cx && j.cx && cx !== j.cx) return;      // 19/09: o `ausente` de uma conexão VELHA dele não o derruba
    var t = num(+t0, 0) || agora();
    var novo = !j.sumidoDesde;
    if (!j.sumidoDesde || t < j.sumidoDesde) j.sumidoDesde = t;
    j.caiuAlgumaVez = true;               // 19/09: não volta a mandar até o fim da guerra (todos viram o mesmo `caiu`)
    if (novo && emBatalha() && !S.fim) {
      // 19/09: o prazo no aviso, como no duelo — do meu lado é a carência até o parceiro marcar; do lado deles a
      // guerra só para se os DOIS caírem, e aí a contagem do W.O. aparece no topo (confereSumicoGuerra)
      var meuLado = S.guerra && j.lado === S.guerra.lado;
      avisa(Tx('{nome} caiu — esperando voltar{a}…', { nome: j.nome, a: meuLado ? ' (' + Math.round(Coop.GRACA_MS / 1000) + ' s)' : '' }), 'aviso');
    }
    muda();
  }
  function voltouGuerra(id, cx) {
    var j = jogadorGuerra(id);
    if (!j) return;
    if (cx) j.cx = cx;
    var estava = !!j.sumidoDesde;
    j.sumidoDesde = 0;
    j.ultimoSinal = agora();
    if (estava) {
      j.bk = 0;                                    // 14/09: sem o banco de antes da queda
      if (emBatalha()) {
        avisa(j.nome + ' voltou' + (j.marcado ? Tx(' — e volta a jogar.') : '.'), 'ok');
        if (j.marcado && j.lado === S.guerra.lado) desmarcaGuerra(j.id);
        var st = (G() || {}).state;
        if (st) enviaA(j, 'pede', { b: S.bid, T: st.turno || 0, k: (S.log[st.turno || 0] || []).length });
      }
    }
    muda();
  }
  function confereSumicoGuerra(ag) {
    var g = S.guerra, gm = G(), st = gm && gm.state, r = R();
    if (!g || !st || S.fim || st.phase !== 'playing' || !dentroGuerra()) return;
    var t0s = {};
    outrosGuerra().forEach(function (j) {
      if (j.saiu) { t0s[j.id] = j.saiuEm || 1; return; }
      var t0 = j.sumidoDesde || 0, mot = 'caiu', visto = 0;
      try { visto = (r && r.visto) ? num(+r.visto(j.id), 0) : 0; } catch (e) { visto = 0; }
      var ultimo = Math.max(visto, j.ultimoSinal || 0);
      if (ultimo && ag - ultimo >= Coop.SILENCIO_MS && (!t0 || ultimo < t0)) t0 = ultimo;
      // o turno dele estourou no MEU relógio (com a folga da animação dele) — 19/09: nunca com o motor congelado
      // (sincronizando): esse relógio parou junto com ele, e estourava a vez de quem estava ali o tempo todo
      var es = S.esperando;
      if (es && es.dono === j.id && es.prazo > 0 && !S.sincronizando) {
        var ini = es.desde;
        if (j.turnoDele === es.T && j.turnoDeleEm > es.desde) ini = Math.min(j.turnoDeleEm, es.desde + Coop.FOLGA_MS);
        var estouro = ini + es.prazo;
        if (ag >= estouro && (!t0 || estouro < t0)) { t0 = estouro; mot = 'prazo'; }
      }
      t0s[j.id] = t0;
      // só o PARCEIRO DE GUILDA marca quem caiu
      if (t0 && j.lado === g.lado && !j.marcado && ag - t0 >= Coop.GRACA_MS) assumeGuerra(j, mot);
    });
    var inim = outrosGuerra().filter(function (j) { return j.lado !== g.lado; });
    var ambos = inim.length === 2 && t0s[inim[0].id] && t0s[inim[1].id];
    // 19/09: os DOIS adversários fora — a tela mostra "o lado deles tem N s para voltar" (o topo lê S.woDesde)
    var woDesde = ambos ? Math.max(t0s[inim[0].id], t0s[inim[1].id]) : 0;
    if (woDesde !== S.woDesde) {
      S.woDesde = woDesde;
      if (woDesde) avisa(Tx('Os dois adversários caíram — o lado deles tem {a} s para voltar.', { a: Math.round(Coop.WO_MS / 1000) }), 'aviso');
      muda();
    }
    if (ambos && ag - woDesde >= Coop.WO_MS) venceWOGuerra();
  }
  function assumeGuerra(j, mot) {
    var st = (G() || {}).state;
    if (!st) return;
    j.marcado = true;
    j.caiuAlgumaVez = true;               // 19/09: marcado (queda ou prazo) = não manda mais nesta guerra
    unidadesDe(st, j.id, true).forEach(function (u) {
      if (!agendaIaGuerra(st, u, true)) return;
      enviaGuerra('ia', { b: S.bid, u: u.uid, mot: mot, T: st.turno || 0, n: ++S.iaSeq });   // (o `T` é só o turno de quem falou)
    });
    avisa(Tx('{nome} caiu — o turno dele passa até voltar.', { nome: j.nome }), 'aviso');
    muda();
  }
  function desmarcaGuerra(dono) {
    var st = (G() || {}).state, g = S.guerra;
    if (!st || !g) return;
    unidadesDe(st, dono, false).forEach(function (u) {
      if (!agendaIaGuerra(st, u, false)) return;
      // 19/09: o herói que MORREU marcado também se desmarca nos outros dois motores — `u.ia` entra no hash, e
      // desmarcá-lo só aqui deixava os adversários com outro hash (uma divergência e uma foto a mais a cada volta)
      if (!u.offBoard) enviaGuerra('ia', { b: S.bid, u: u.uid, mot: 'volta', T: st.turno || 0, n: ++S.iaSeq });
    });
    if (dono === g.meuId) g.euFora = false;
    else if (g.js[dono]) g.js[dono].marcado = false;
    muda();
  }
  function venceWOGuerra() {
    var gm = G();
    if (!gm || !gm.state || S.fim) return;
    S.fimMotivo = 'wo';
    // 19/09: o W.O. rende XP quando o servidor confirma a queda dos dois no relé (antes o aviso dizia "sem XP" e a
    // tela de fim mostrava o XP dois segundos depois)
    avisa(Tx('Os dois adversários saíram da guerra — vitória por W.O.: o servidor confere a queda deles para valer o XP.'), 'ok');
    if (gm._encerra) gm._encerra(gm.meuLado(), 'wo');
  }
  /* a marca `ia` só vale do PARCEIRO DE GUILDA do dono da unidade; desmarcar (a volta), também do próprio dono */
  /* A MARCA QUE CHEGA ENQUANTO ESPERO A FOTO (19/09) fica guardada e entra DEPOIS dela: uma `volta` que chegava antes
   * da foto (o parceiro dele a mandou antes de quem manda a processar) era um "nada a fazer" no meu estado velho, a
   * foto trazia o herói ainda marcado, e eu ficava com a marca que os outros tiraram — o motor deles esperava o lance
   * dele, o meu passava a vez: a guerra parava. Cada marca leva `n` (o contador de quem falou); a foto diz até que `n`
   * de cada um quem manda já aplicou (`iaVisto`): o guardado com `n` maior entra, o resto a foto já traz. */
  function drenaIaGuerra() {
    var fila = S.iaBuffer || [];
    S.iaBuffer = [];
    for (var i = 0; i < fila.length; i++) {
      var it = fila[i];
      if (typeof it.d.n === 'number' && it.d.n <= num(+(S.iaVisto || {})[it.de], 0)) continue;
      rIaGuerra(it.d, it.de, true);
    }
  }
  function rIaGuerra(d, de, replay) {
    var g = S.guerra, gm = G(), st = gm && gm.state, jd = jogadorGuerra(de);
    if (!d || d.b !== S.bid || !st || !jd) return;
    if (!replay && S.sincronizando) {
      if ((S.iaBuffer || (S.iaBuffer = [])).length < 64) S.iaBuffer.push({ d: d, de: de });
      return;
    }
    var u = E().findUnit(st, d.u);
    if (!u || (u.kind !== 'hero' && u.kind !== 'fusion') || !u.dono) return;
    var volta = d.mot === 'volta';
    var ladoDono = u.dono === g.meuId ? g.lado : ((g.js[u.dono] || {}).lado || null);
    if (!ladoDono || ladoDono !== jd.lado || (u.dono === de && !volta)) return;
    if (typeof d.n === 'number') { S.iaVisto = S.iaVisto || {}; S.iaVisto[de] = Math.max(num(+S.iaVisto[de], 0), d.n); }
    // 19/09: a marca entra na VEZ do herói (na hora, se ele já é o ativo aqui) — o mesmo ponto nos quatro motores
    agendaIaGuerra(st, u, !volta);
    if (u.dono === g.meuId && replay) {
      // depois da foto: só o que a marca diz de mim — a foto acabou de vir, não se pede outra
      g.euFora = !volta;
      g.euCai = true;
      S.meAssumiu = !volta;
    } else if (u.dono === g.meuId) {
      /* o meu parceiro me deu por fora (ou me devolveu os heróis): o meu motor se acerta pela foto de quem manda.
       * 19/09: a `volta` vale MESMO com os meus heróis sem marca aqui — quem caiu não recebeu a marca (foi ao cx
       * velho), e sair cedo aqui era o que deixava a A1 de volta sem pedir foto e se achando autoridade. Caí alguma
       * vez (a marca só vem de queda ou prazo): não mando mais até o fim. A foto só se ainda não veio desde a minha
       * volta (a `volta` do parceiro chega logo depois dela, e já vem aplicada). */
      g.euFora = !volta;
      g.euCai = true;
      S.meAssumiu = !volta;
      if (volta && gm._voltouDaQueda) { try { gm._voltouDaQueda(); } catch (eV) {} }
      S.fotoPendente = false;
      // (quem entrou atrasado nunca "religou": a foto que já veio desde que a guerra abriu aqui conta do mesmo jeito)
      var jaRestaurou = !!(volta && S.restauradaEm && S.restauradaEm >= (S.religouEm || 0));
      if (!jaRestaurou) pedeFoto();
    } else if (g.js[u.dono]) {
      g.js[u.dono].marcado = !volta;
      if (!volta) g.js[u.dono].caiuAlgumaVez = true;   // 19/09: o parceiro dele o marcou: todos o tiram da linha
    }
    muda();
  }
  function rSaiGuerra(d, de) {
    var st = (G() || {}).state, j = jogadorGuerra(de);
    if (!d || d.b !== S.bid || !j) return;
    if (!j.saiu) { j.saiu = true; j.saiuEm = agora(); }
    S.saiuNome = j.nome;
    // 19/09: o `sai` SEM unidade (`todos`) é de quem saiu antes de o salão dele abrir (a carga estourou): todos os
    // heróis dele caem — mesmo que o meu salão ainda esteja carregando (mataQuemSaiu lê `saiuTudo` quando puder)
    if (d.todos === true) { j.saiuTudo = true; mataQuemSaiu(); muda(); return; }
    if (!st) return;
    var u = E().findUnit(st, d.u);
    if (!u || (u.kind !== 'hero' && u.kind !== 'fusion') || u.dono !== de) return;
    S.mortePendente[d.u] = true;
    mataQuemSaiu();
    muda();
  }
  /* sair da guerra (o menu, ou a arena que não carregou a tempo): os meus heróis caem nos motores dos outros.
   * 19/09: e caem AQUI e no SERVIDOR na hora — Vida.fim com os meus a 0 e o POST /api/guerra/sair {gid} (keepalive e a
   * fila de retentativa da Autoridade, pelo JOGO.Guerra). Antes quem saía não fechava nada: a vida só chegava ao
   * servidor quando um dos três fechasse com a marca `morte`, minutos depois, e dava para abrir outra luta antes. */
  Coop.sairDaGuerra = function (mot) {
    if (S.tipo !== 'guerra') return false;
    var gm = G(), st = gm && gm.state, g = S.guerra, gid = S.bid;
    if (st && gid && st.phase === 'playing') {
      unidadesDe(st, g.meuId, true).forEach(function (u) { enviaGuerra('sai', { b: gid, u: u.uid, mot: mot || 'saiu' }); });
    } else if (gid) enviaGuerra('sai', { b: gid, todos: true, mot: mot || 'saiu' });
    // a vida dos meus a 0 já (o servidor grava o mesmo no `sair`)
    if (st && gm && gm._vidaDoDono && JOGO.Vida && JOGO.Vida.fim) {
      try {
        var vd = gm._vidaDoDono(st, g.meuId), zeros = {};
        Object.keys(vd.fim).forEach(function (hid) { zeros[hid] = 0; });
        if (Object.keys(zeros).length) JOGO.Vida.fim(zeros, vd.maximos);
      } catch (eV) {}
    }
    if (gid && !g.saiSrv && !S.fim) {
      g.saiSrv = true;
      anotaLutaGuerra(false, null);
      var A = autoridadeLigada(), Gu = JOGO.Guerra;
      var sincroniza = function () { try { if (JOGO.Vida && JOGO.Vida.sincroniza) JOGO.Vida.sincroniza(); } catch (e) {} };
      if (A && A.saiDaGuerra) { try { Promise.resolve(A.saiDaGuerra(gid)).then(sincroniza, function () {}); } catch (eS) {} }
      else if (Gu && Gu.sairDaPartida) { try { Gu.sairDaPartida(gid); } catch (eS2) {} }
    }
    // 19/09: sair é sair — os dois heróis ficam sem vida no servidor também por carga (o jogador precisa saber)
    if (mot === 'carga') avisa(Tx('A guerra não começou para você — o salão demorou demais para carregar; os seus dois heróis ficam sem vida.'), 'aviso');
    var n = S.n;
    S = nova(null);
    S.n = n;
    if (gm && gm._saiDaRede) { try { gm._saiDaRede(); } catch (e) {} }
    paraTique();
    muda();
    return true;
  };
  function infoGuerra() {
    var g = S.guerra;
    return { guerra: true, gid: g.gid, wo: S.fimMotivo === 'wo', desistencia: S.fimMotivo === 'desistencia',
             lado: g.lado, guildas: clone(g.guildas), resultado: g.resultado,
             jogadores: g.ordem.map(function (id) {
               return { dono: id, nome: nomeGuerra(id), lado: id === g.meuId ? g.lado : g.js[id].lado, eu: id === g.meuId };
             }) };
  }
  function sessaoGuerra() {
    var g = S.guerra, aut = autoridadeGuerra();
    return { gid: g.gid, lado: g.lado, autoridade: aut, autoridadeNome: nomeGuerra(aut), guildas: clone(g.guildas), resultado: g.resultado,
             entrando: !!(S.bid && !S.fim && !dentroGuerra()),
             euCai: !!g.euCai, tarde: !!g.tarde,
             // 19/09: os dois adversários fora — desde quando, e o prazo do W.O. (a contagem no topo da batalha)
             wo: S.woDesde ? { desde: S.woDesde, prazo: Coop.WO_MS } : null,
             jogadores: g.ordem.map(function (id) {
               if (id === g.meuId) return { id: id, nome: nomeGuerra(id), lado: g.lado, eu: true, on: true, fora: g.euFora, saiu: false, caiu: !!g.euCai };
               var j = g.js[id];
               return { id: id, nome: j.nome, lado: j.lado, eu: false, on: !j.sumidoDesde && !j.saiu, fora: j.marcado, saiu: j.saiu, caiu: !!j.caiuAlgumaVez };
             }) };
  }
  /* o fechamento no servidor: o registro deste motor (lances dos quatro e as marcas); o W.O. vai sem o hash do fim
   * (o encerra não é fim do motor: o servidor refaz até onde houve lance e não vê vencedor) e, 19/09, com `wo: true`
   * — o servidor só o confirma com a queda dos DOIS anotada pelo relé. O corpo fica na luta aberta da conta antes de
   * sair (quem não manda fecha GUERRA_FECHA_MS depois: a página que for embora nesse meio reenvia ao abrir). */
  function fechaGuerraNoServidor() {
    var Gu = JOGO.Guerra, g = S.guerra;
    if (!Gu || !Gu.fechar || !g || g.fechou) return;
    g.fechou = true;
    var corpo = { gid: g.gid, lances: (S.logSrv || []).slice(), hashFinal: (S.fim && S.fimMotivo !== 'wo') ? S.fim.h : null,
                  fotografada: !!S.fotografada };
    if (S.fimMotivo === 'wo') corpo.wo = true;
    anotaLutaGuerra(true, corpo);
    var vai = function () {
      try {
        Promise.resolve(Gu.fechar(corpo)).then(function (r) {
          if (S.guerra === g) { g.resultado = r || null; muda(); }
        }, function () {});
      } catch (e) {}
    };
    if (souAutoridade() || Coop._semIntervalo || typeof setTimeout !== 'function') vai();
    else setTimeout(vai, Coop.GUERRA_FECHA_MS);
  }

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
  /* 19/09: as marcas `ia` que esperam a vez do herói (a marca entra na vez dele para o hash não divergir com
   * quem já está à frente) — as provas leem a marca EFETIVA: a aplicada mais a que está na fila */
  Coop._iaPendentes = function () { return clone(S.iaPendentes || []); };
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
    if (S.tipo === 'guerra') return aceitaGuerra(ev);
    var p = parceiro();
    if (!p || !ev || ev.de !== p.id) return false;
    if (p.cx && ev.cx && ev.cx !== p.cx) return false;     // o cx carimbado barra quem copia o `de`
    return true;
  }
  function recebe(ev) {
    if (!ev || !aceita(ev)) return;
    var d = ev.dados || {};
    S.ultimoSinal = agora();
    if (S.tipo === 'guerra') {
      // 15/09: na guerra só o trilho da batalha (nada de ata, pronto, próxima: a ata veio do servidor)
      if (GUERRA_ACOES.indexOf(ev.acao) < 0) return;
      var jg = jogadorGuerra(ev.de);
      jg.ultimoSinal = agora();
      if (jg.sumidoDesde) Coop.parceiroVoltou(jg.id, ev.cx || null);
      adotaCaidos(d.caidos, ev.de);       // 19/09: a memória da queda que viaja — só acrescenta
    }
    // ele falou pela conexão que eu conheço: não sumiu (um `saiu` de outra aba
    // dele, ou um `ausente` que se cruzou com a volta, não o tira mais)
    var p = parceiro();
    if (S.sumidoDesde && p && p.cx && ev.cx === p.cx) Coop.parceiroVoltou(p.id, p.cx);
    switch (ev.acao) {
      case 'pronto': rPronto(d); break;
      case 'prep': rPrep(d); break;
      case 'ata': rAta(d); break;
      case 'dentro': rDentro(d, ev.de); break;
      case 'lance': rLance(d, ev.de); break;
      case 'pede': rPede(d); break;
      case 'foto-pede': rFotoPede(d); break;
      case 'foto': rFoto(d, ev.de); break;
      case 'ia': rIa(d, ev.de); break;
      case 'sai': rSai(d, ev.de); break;
      case 'proxima': rProxima(d); break;
      case 'desiste': rDesiste(d); break;
      case 'vivo': rVivo(d, ev.de); break;
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
    if (S.tipo === 'guerra' && (ev.tipo === 'caiu' || ev.tipo === 'saiu')) {
      var jq = jogadorGuerra(ev.id);
      if (!jq || (jq.cx && ev.cx && ev.cx !== jq.cx)) return;
      if (ev.tipo === 'saiu' && !saiuVale(jq, ev)) return;
      Coop.parceiroSumiu(jq.id, agora());
      return;
    }
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
    // 14/09: quem volta da queda joga o próximo turno com 30 s, sem o banco de antes
    if (emBatalha() && g._voltouDaQueda) { try { g._voltouDaQueda(); } catch (eV) {} }
    // (se a foto já veio depois da volta — o `ia` do outro chegou antes —, não pede outra)
    var jaRestaurou = !!(S.restauradaEm && S.restauradaEm >= S.religouEm);
    /* 19/09, A GUERRA: quem caiu NÃO volta a mandar até o fim (euCai) e pede a foto SEMPRE. Antes, a A1 que voltava se
     * via como autoridade (no motor dela ninguém a marcou: a voz `ia` foi ao cx velho), não pedia foto, reaplicava os
     * lances pedidos e — divergindo — mandava `dessinc` aos três, que pediam a foto DELA, do turno em que caiu: a
     * guerra dos outros três rebobinava 45 turnos. Os três a mantêm fora da linha de autoridade pelo `caiu` que todos
     * viram (caiuAlgumaVez), então a decisão é igual nos quatro. O `pede` sai só se a foto já veio (o que se perdeu no
     * cx velho a foto traz inteiro; pedir os lances de 45 turnos aos três era a enxurrada). */
    if (S.tipo === 'guerra' && S.guerra) {
      S.guerra.euCai = true;
      // 19/09: a conexão nova se apresenta aos três SEM cx (não sei mais o cx deles, nem eles o meu): um `dentro`
      // com `religou` vindo de um cx novo vale como "caiu e voltou" — mesmo sem o `caiu` do relé (o relé reiniciou)
      S.guerra.euReligou = true;
      enviaGuerra('dentro', { bid: S.bid, viu: false, religou: true }, true);
      if (emBatalha() && !jaRestaurou) { pedeFoto(); return; }
      if (emBatalha()) envia('pede', { b: S.bid, T: st.turno || 0, k: (S.log[st.turno || 0] || []).length });
      muda();
      return;
    }
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
