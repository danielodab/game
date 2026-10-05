// A agenda do mundo — os eventos que o Mestre liga para todo mundo (dono: lógica).
var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

/* O QUE ISTO É
 * ============
 * Os EVENTOS DO MUNDO (10/09, pedido do dono: "eventos ligados pelo jogo +
 * calendário automático, mostrados no site"). O Mestre liga um "XP ×2 até
 * domingo" ou agenda "todo sábado, saque ×1,5 na Cisterna"; o servidor guarda
 * e expande o calendário (GET /api/eventos, público), e este módulo é o CACHE
 * dessa resposta dentro do jogo — o papel que o Calabouço do Dia sempre
 * previu para si mesmo (diario.js, "este módulo vira o cache da resposta").
 *
 * "AGENDA", E NÃO "EVENTOS": a palavra evento já tem quatro donos no código
 * (a auditoria da API, os eventos do chão, a fila do motor e Rede.aoEvento).
 * Para o jogador a tela sempre diz "Eventos do mundo".
 *
 * A LEITURA É SÍNCRONA: computeRewards (game.js) pergunta o fator no meio da
 * recompensa, sem esperar nada. Então a busca é assíncrona e rara (a cada
 * 10 min), e a leitura é uma conta sobre a lista em memória, NA HORA: o
 * evento vale na janela [inicio, fim) e expira no meio da sessão sem nova
 * busca. Um cache velho nunca estende um evento — ele só carrega as datas
 * que o servidor deu. O relógio é o do SERVIDOR (o desvio medido a cada
 * resposta): o PC com a hora errada não liga evento antes da hora.
 *
 * OS TETOS moram aqui também (a mesma tabela do servidor, api.py): contra
 * erro de digitação do Mestre e contra cache torto, NÃO contra trapaça — o
 * cliente calcula a recompensa, e quem finge um evento já fingia um drop.
 * A economia é dura de propósito ("o drop de itens bons deve ser MUITO
 * difícil"): nenhum tipo mexe na raridade, na Âncora, nos selos, nas
 * insígnias nem nas cartas. Eventos do MESMO tipo não se multiplicam: vale
 * o maior.
 *
 * SERVIDOR FORA OU VELHO (status 0 ou 404): nada muda — o cache fica, e sem
 * cache todo fator é 1. O 404 cobre o jogo novo subindo antes do servidor.
 */
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

  var Ag = {};
  JOGO.Agenda = Ag;

  // sem sufixo de conta: o evento é do MUNDO, não de quem está jogando
  Ag.CHAVE = 'soterra-agenda-v1';
  // 12/09: o Mestre escolhe o multiplicador ("o rate que eu quiser"); o ×10 só segura o zero a mais
  Ag.TETOS = { xp: 10.0, vintem: 10.0, pedras: 10.0, saque: 10.0, aviso: 1.0 };
  /* o teto do XP COMPRADO (Pergaminho da Sabedoria e bônus por tempo) somado
   * ao evento: os dois juntos não passam de ×2, a promessa da loja. Um evento
   * maior que isso vale sozinho — o comprado pausa, sem gastar carga. */
  Ag.TETO_XP_COMPRADO = 2.0;
  Ag.TIPOS = ['xp', 'vintem', 'pedras', 'saque', 'aviso'];
  Ag.NOMES = { xp: 'XP', vintem: Tx('Vinténs'), pedras: Tx('Pedras de forja'), saque: Tx('Saque'), aviso: Tx('Aviso') };
  // os 7 que o servidor aceita; quem está fechado quem sabe é DATA.portalFechado
  Ag.CALABOUCOS = ['greenhouse', 'cistern', 'emberlock', 'windscaffold', 'quakemine', 'brokenheart', 'poco'];
  // Brasília fixo: o contêiner não tem tzdata, e o Brasil não tem horário de verão desde 2019
  Ag.FUSO_MIN = -180;
  Ag.JANELA_DIAS = 14;
  Ag.BUSCA_MS = 10 * 60 * 1000;
  Ag.TIQUE_MS = 60 * 1000;
  Ag.NOTA_MESTRE = Tx('Para ligar evento, entre no site com a conta do Mestre: o servidor confere a marca.');

  /* relógio injetável (as provas andam no tempo sem esperar) */
  Ag._agora = null;
  function relogio() { return typeof Ag._agora === 'function' ? Ag._agora() : Date.now(); }
  /* O relógio que SÓ ANDA PARA A FRENTE (performance.now; as provas injetam
   * Ag._mono) — conserto da loja 2, 11/09. Mexer na hora do aparelho não o move: é
   * ele que segura o relógio do servidor entre uma resposta e a próxima. O
   * bônus de XP pago corre no relógio do SERVIDOR; atrasar a hora do Windows
   * com o jogo aberto não pode esticar o prazo. */
  Ag._mono = null;
  function mono() {
    if (typeof Ag._mono === 'function') return Ag._mono();
    try { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : NaN; }
    catch (e) { return NaN; }
  }

  var lista = [];        // ativos ∪ próximos, já normalizados (tempos em SEGUNDOS, como o servidor)
  var regras = [];
  var desvio = 0;        // ms: relógio do servidor − relógio daqui
  var buscaOk = 0;       // relógio daqui na última resposta boa
  var tentativa = 0;     // relógio daqui na última tentativa
  var servEm = 0;        // ms: o relógio do SERVIDOR na última resposta boa DESTA página (0 = não mediu)
  var monoEm = NaN;      // o mono() nesse instante
  var noAr = false;      // a última busca respondeu? (o painel do Mestre liga os botões por isto)
  var seq = 0;           // resposta atrasada de uma busca antiga não passa por cima da nova
  var ouvintes = [];
  var assinatura = '';
  var iniciado = false, tique = null;

  function has(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }
  function isArr(v) { return Object.prototype.toString.call(v) === '[object Array]'; }
  function numOu(v, def) { return (typeof v === 'number' && isFinite(v)) ? v : def; }

  // ------------------------------------------------------------ o disco
  function armazem() {
    try { return (typeof window !== 'undefined' && window.localStorage) ? window.localStorage : null; }
    catch (e) { return null; }
  }
  function gravaCache() {
    var s = armazem();
    if (!s) return;
    try {
      s.setItem(Ag.CHAVE, JSON.stringify({ v: 1, lista: lista, regras: regras, desvio: desvio, buscaEm: buscaOk }));
    } catch (e) { /* cheio ou negado: a memória segue valendo */ }
  }
  /* Lê o que a última sessão guardou. NÃO poda os vencidos aqui: a janela é
   * conferida a cada leitura, e podar com o relógio de agora faria o teste
   * depender do dia em que ele roda. */
  function leCache() {
    var s = armazem();
    var d = null;
    try { d = JSON.parse((s && s.getItem(Ag.CHAVE)) || 'null'); } catch (e) { d = null; }
    if (!d || typeof d !== 'object' || d.v !== 1) return false;
    lista = (isArr(d.lista) ? d.lista : []).map(normaliza).filter(Boolean);
    regras = (isArr(d.regras) ? d.regras : []).map(normalizaRegra).filter(Boolean);
    desvio = numOu(d.desvio, 0);
    buscaOk = numOu(d.buscaEm, 0);
    assinatura = assina();
    return true;
  }

  // ------------------------------------------------------------ o formato
  /* Um item de `ativos`/`proximos` do servidor (contrato 1.3). Tipo
   * desconhecido é IGNORADO (um tipo novo no servidor não pode virar fator
   * aqui); janela torta, idem. O multiplicador fica cru: quem prende nos
   * tetos é a leitura, para que um cache antigo não fuja do teto de hoje. */
  function normaliza(e) {
    if (!e || typeof e !== 'object') return null;
    if (!has(Ag.TETOS, e.tipo)) return null;
    var ini = Number(e.inicio), fim = Number(e.fim);
    if (!isFinite(ini) || !isFinite(fim) || !(fim > ini)) return null;
    if (e.id === undefined || e.id === null || e.id === '') return null;
    var m = Number(e.multiplicador);
    return {
      id: String(e.id),
      origem: e.origem === 'calendario' ? 'calendario' : 'pontual',
      regra: (e.regra === undefined) ? null : e.regra,
      tipo: e.tipo,
      multiplicador: isFinite(m) ? m : 1,
      calabouco: (typeof e.calabouco === 'string' && e.calabouco) ? e.calabouco : null,
      titulo: String(e.titulo == null ? '' : e.titulo),
      texto: String(e.texto == null ? '' : e.texto),
      inicio: ini,
      fim: fim
    };
  }
  function normalizaRegra(r) {
    if (!r || typeof r !== 'object' || !has(Ag.TETOS, r.tipo)) return null;
    var dias = isArr(r.dias) ? r.dias.filter(function (d) {
      return typeof d === 'number' && d === Math.floor(d) && d >= 0 && d <= 6;
    }) : [];
    if (!dias.length || !/^\d{2}:\d{2}$/.test(String(r.hora || ''))) return null;
    var dur = Number(r.duracaoMin);
    if (!isFinite(dur) || dur <= 0) return null;
    var m = Number(r.multiplicador);
    return {
      id: r.id, tipo: r.tipo, multiplicador: isFinite(m) ? m : 1,
      calabouco: (typeof r.calabouco === 'string' && r.calabouco) ? r.calabouco : null,
      titulo: String(r.titulo == null ? '' : r.titulo), texto: String(r.texto == null ? '' : r.texto),
      dias: dias, hora: String(r.hora), duracaoMin: dur,
      vigenteDe: numOu(r.vigenteDe, null), vigenteAte: numOu(r.vigenteAte, null)
    };
  }
  function copia(e) {
    var c = {};
    for (var k in e) if (has(e, k)) c[k] = isArr(e[k]) ? e[k].slice() : e[k];
    c.fator = fatorDoEvento(e);
    return c;
  }

  /* O fator de UM evento, já preso: [1, teto do tipo]. Aviso é sempre 1. */
  function fatorDoEvento(e) {
    if (!e || !has(Ag.TETOS, e.tipo)) return 1;
    var m = Number(e.multiplicador);
    if (!isFinite(m)) return 1;
    return Math.min(Ag.TETOS[e.tipo], Math.max(1, m));
  }
  Ag.fatorDoEvento = fatorDoEvento;

  function tempo(ts) { return (typeof ts === 'number' && isFinite(ts)) ? ts : Ag.agora(); }
  function vale(e, t) { return e.inicio * 1000 <= t && t < e.fim * 1000; }
  function valeAqui(e, dungeonId) { return !e.calabouco || e.calabouco === dungeonId; }

  // ------------------------------------------------------------ a leitura (síncrona)
  /* o relógio do SERVIDOR, em ms: o desta máquina mais o desvio medido — e
   * nunca atrás do que o relógio que só anda para a frente diz desde a última
   * resposta (a hora do aparelho que VOLTOU não volta o relógio do servidor).
   * Vale o maior dos dois: o performance.now pode parar com o computador
   * dormindo, e aí a hora da máquina, que andou, é a certa; a próxima resposta
   * acerta o resto. As provas que injetam só Ag._agora ficam na regra antiga
   * (o relógio delas manda sozinho). */
  Ag.agora = function () {
    var t = relogio() + desvio;
    if (servEm && (typeof Ag._agora !== 'function' || typeof Ag._mono === 'function')) {
      var m = mono();
      if (isFinite(m) && isFinite(monoEm)) t = Math.max(t, servEm + (m - monoEm));
    }
    return t;
  };
  /* o relógio do servidor foi MEDIDO nesta página (uma resposta boa; o cache
   * de outra sessão não conta). O bônus de XP pago só pesa com ele medido. As
   * provas que injetam só Ag._agora contam como medidas (a regra antiga). */
  Ag.medido = function () {
    return !!servEm || (typeof Ag._agora === 'function' && typeof Ag._mono !== 'function');
  };

  Ag.ativos = function (ts) {
    var t = tempo(ts);
    return lista.filter(function (e) { return vale(e, t); })
      .sort(function (a, b) { return a.fim - b.fim; }).map(copia);
  };
  Ag.proximos = function (ts) {
    var t = tempo(ts);
    return lista.filter(function (e) { return e.inicio * 1000 > t; })
      .sort(function (a, b) { return a.inicio - b.inicio; }).map(copia);
  };
  Ag.regras = function () { return regras.map(function (r) { var c = copia(r); delete c.fator; return c; }); };

  /* A REGRA DE RESOLUÇÃO (a mesma no servidor, no jogo e no site):
   *   fator = min(TETO, max(1, maior multiplicador entre os eventos daquele
   *           tipo, no ar em t, gerais ou daquele calabouço))
   * Síncrono de propósito — é o que o funil de recompensa chama. */
  Ag.fator = function (tipo, dungeonId, ts) {
    if (!has(Ag.TETOS, tipo)) return 1;
    var teto = Ag.TETOS[tipo];
    if (!(teto > 1)) return 1;
    var t = tempo(ts), maior = 1;
    for (var i = 0; i < lista.length; i++) {
      var e = lista[i];
      if (e.tipo !== tipo || !vale(e, t) || !valeAqui(e, dungeonId)) continue;
      if (e.multiplicador > maior) maior = e.multiplicador;
    }
    return Math.min(teto, Math.max(1, maior));
  };

  /* Quem venceu a disputa de um tipo (para dizer ao jogador QUAL evento
   * pesou): o de maior fator; no empate, o que termina primeiro. */
  Ag.vencedor = function (tipo, dungeonId, ts) {
    if (!has(Ag.TETOS, tipo)) return null;
    var t = tempo(ts), melhor = null, fMelhor = 1;
    for (var i = 0; i < lista.length; i++) {
      var e = lista[i];
      if (e.tipo !== tipo || !vale(e, t) || !valeAqui(e, dungeonId)) continue;
      var f = fatorDoEvento(e);
      if (f > fMelhor || (f === fMelhor && melhor && f > 1 && e.fim < melhor.fim)) { melhor = e; fMelhor = f; }
    }
    return (melhor && fMelhor > 1) ? copia(melhor) : null;
  };

  /* os eventos no ar que valem num calabouço (o painel do portal) */
  Ag.valemEm = function (dungeonId, ts) {
    var t = tempo(ts);
    return lista.filter(function (e) { return vale(e, t) && valeAqui(e, dungeonId); })
      .sort(function (a, b) { return a.fim - b.fim; }).map(copia);
  };

  Ag.noAr = function () { return noAr; };
  /* a hora do aparelho que voltou deixava isto NEGATIVO, e o refresca pulava
   * a busca para sempre (até recarregar): hora que andou para trás = busca vencida */
  Ag.buscouHa = function () {
    if (!tentativa) return Infinity;
    var d = relogio() - tentativa;
    return d < 0 ? Infinity : d;
  };
  Ag.ultimaBoa = function () { return buscaOk; };

  // ------------------------------------------------------------ quem escuta
  /* ouvinte chamado quando a lista muda — inclusive quando um evento entra
   * ou sai do ar com o tempo (o tique confere). Devolve a função que o solta:
   * a HUD remonta o Acampamento a cada entrada e não pode empilhar ouvintes. */
  Ag.aoMudar = function (fn) {
    if (typeof fn !== 'function') return function () {};
    ouvintes.push(fn);
    return function () {
      var i = ouvintes.indexOf(fn);
      if (i >= 0) ouvintes.splice(i, 1);
    };
  };
  function assina() {
    var t = Ag.agora();
    var partes = lista.map(function (e) {
      return [e.id, e.tipo, e.multiplicador, e.calabouco || '', e.inicio, e.fim, e.titulo, e.texto,
              vale(e, t) ? 'no-ar' : ''].join('~');
    }).sort();
    var pr = regras.map(function (r) { return [r.id, r.tipo, r.multiplicador, r.dias.join(','), r.hora, r.duracaoMin].join('~'); }).sort();
    return partes.join('|') + '#' + pr.join('|');
  }
  function confereMudanca() {
    var nova = assina();
    if (nova === assinatura) return false;
    assinatura = nova;
    ouvintes.slice().forEach(function (fn) { try { fn(); } catch (e) { /* ouvinte não derruba a agenda */ } });
    return true;
  }

  // ------------------------------------------------------------ a busca
  function aplica(r) {
    if (!r || typeof r !== 'object' || r.ok === false) return false;
    // 02/10: `semanais` = os eventos FIXOS do mundo (a semana do Eco Primordial, servidor/supremo.py) — tipo
    // 'aviso', fator 1: entram na faixa com a contagem regressiva e não mexem em recompensa nenhuma
    var bruto = [].concat(isArr(r.ativos) ? r.ativos : [], isArr(r.proximos) ? r.proximos : [],
                          isArr(r.semanais) ? r.semanais : []);
    var vistos = {}, nova = [];
    for (var i = 0; i < bruto.length; i++) {
      var n = normaliza(bruto[i]);
      if (!n || vistos[n.id]) continue;
      vistos[n.id] = true;
      nova.push(n);
    }
    if (typeof r.agora === 'number' && isFinite(r.agora)) {
      desvio = r.agora * 1000 - relogio();
      servEm = r.agora * 1000;
      monoEm = mono();
    }
    var t = Ag.agora();
    lista = nova.filter(function (e) { return e.fim * 1000 > t; });   // o vencido sai com a resposta nova
    regras = (isArr(r.regras) ? r.regras : []).map(normalizaRegra).filter(Boolean);
    buscaOk = relogio();
    noAr = true;
    gravaCache();
    confereMudanca();
    return true;
  }

  /* GET /api/eventos (público, sem token). Resolve SEMPRE — nunca rejeita:
   * {ok, status, mudou}. Status 0 (rede fora) ou 404 (servidor velho) = sem
   * mudança: o cache fica. */
  Ag.atualizar = function () {
    var meu = ++seq;
    tentativa = relogio();
    var S = JOGO.Sessao;
    if (!S || typeof S.api !== 'function') {
      noAr = false;
      return Promise.resolve({ ok: false, status: 0, mudou: false });
    }
    var p = null;
    try { p = S.api('/api/eventos', { semToken: true }); } catch (e) { p = null; }
    if (!p || typeof p.then !== 'function') {
      noAr = false;
      return Promise.resolve({ ok: false, status: 0, mudou: false });
    }
    return p.then(function (r) {
      r = (r && typeof r === 'object') ? r : { ok: false, status: 0 };
      if (meu !== seq) return { ok: false, status: r.status || 0, velha: true, mudou: false };
      if (r.ok === true && isArr(r.ativos) && isArr(r.proximos)) {
        var antes = assinatura;
        aplica(r);
        return { ok: true, status: r.status || 200, mudou: assinatura !== antes };
      }
      noAr = false;
      return { ok: false, status: r.status || 0, erro: r.erro || null, mudou: false };
    }, function () {
      if (meu === seq) noAr = false;
      return { ok: false, status: 0, mudou: false };
    });
  };

  /* EM CASA (file://) a API padrão é a do próprio PC (127.0.0.1:8300), que
   * quase nunca está de pé: buscar sozinho a cada 10 min só pintaria de
   * vermelho o console do dono — e "erro que não é erro não pode ficar
   * gritando" (index.html, o favicon). Então, em file://, a busca AUTOMÁTICA
   * só vai com sessão do site ou com uma API apontada (?api=, que o Sessao
   * lembra). Servido por um domínio, vai sempre. A busca PEDIDA (atualizar)
   * vai sempre, em qualquer lugar. */
  function buscaAutomatica() {
    try {
      if (typeof location === 'undefined' || location.protocol !== 'file:') return true;
      var S = JOGO.Sessao;
      if (!S) return false;
      if (typeof S.ativa === 'function' && S.ativa()) return true;
      if (typeof S.base === 'function') S.base();       // grava o ?api= da URL, se houver
      var s = armazem();
      return !!(s && S.CHAVE_API && s.getItem(S.CHAVE_API));
    } catch (e) { return false; }
  }
  /* a busca automática: só se a última tentativa tiver mais de `idadeMs`
   * (padrão 10 min) e se buscar fizer sentido aqui. Resolve {pulou:true}
   * quando não busca. */
  Ag.refresca = function (idadeMs) {
    var idade = (typeof idadeMs === 'number' && isFinite(idadeMs)) ? idadeMs : Ag.BUSCA_MS;
    if (Ag.buscouHa() < idade || !buscaAutomatica()) {
      return Promise.resolve({ ok: false, status: 0, pulou: true, mudou: false });
    }
    return Ag.atualizar();
  };

  /* idempotente: lê o cache, busca, e confere a cada minuto se algum evento
   * entrou ou saiu do ar (busca de novo a cada 10 min). Aba escondida atrasa
   * o tique, mas a avaliação é pelo horário na hora da recompensa. */
  Ag.iniciar = function () {
    if (iniciado) return false;
    iniciado = true;
    if (!lista.length && !regras.length) leCache();
    Ag.refresca(0);
    try {
      tique = setInterval(function () {
        confereMudanca();
        Ag.refresca(Ag.BUSCA_MS);
      }, Ag.TIQUE_MS);
    } catch (e) { tique = null; }
    return true;
  };
  Ag.parar = function () {
    if (tique) { try { clearInterval(tique); } catch (e) {} }
    tique = null; iniciado = false;
  };

  // ------------------------------------------------------------ a escrita (só o Mestre)
  /* POST com o token da sessão do site. Quem confere a marca de Mestre é o
   * SERVIDOR (403 para conta sem contas.gm); aqui só se evita a viagem sem
   * sessão nenhuma. O que o servidor confirmou entra na lista na hora, e a
   * busca completa vem logo depois. */
  function escreve(rota, corpo, depois) {
    var S = JOGO.Sessao;
    if (!S || typeof S.api !== 'function') {
      return Promise.resolve({ ok: false, status: 0, erro: Tx('o jogo não achou a sessão do site') });
    }
    if (!(typeof S.ativa === 'function' && S.ativa())) {
      return Promise.resolve({ ok: false, status: 401, erro: Ag.NOTA_MESTRE });
    }
    var p = null;
    try { p = S.api(rota, { method: 'POST', body: corpo }); } catch (e) { p = null; }
    if (!p || typeof p.then !== 'function') {
      return Promise.resolve({ ok: false, status: 0, erro: Tx('o servidor está fora (não respondeu)') });
    }
    return p.then(function (r) {
      r = (r && typeof r === 'object') ? r : { ok: false, status: 0 };
      if (!r.ok) {
        if (!r.erro) {
          r.erro = r.status === 0 ? Tx('o servidor está fora (não respondeu)')
                 : r.status === 404 ? Tx('o servidor ainda não conhece os eventos do mundo')
                 : Tx('o servidor recusou ({status})', { status: r.status });
        }
        return r;
      }
      try { if (depois) depois(r); } catch (e) { /* a busca abaixo corrige */ }
      gravaCache();
      confereMudanca();
      return Ag.atualizar().then(function () { return r; }, function () { return r; });
    }, function () {
      return { ok: false, status: 0, erro: Tx('o servidor está fora (não respondeu)') };
    });
  }
  function mescla(evs) {
    (isArr(evs) ? evs : []).forEach(function (e) {
      var n = normaliza(e);
      if (!n) return;
      lista = lista.filter(function (x) { return x.id !== n.id; });
      lista.push(n);
    });
  }

  /* evento pontual: sem `inicio`, o servidor liga AGORA ("ligar agora") */
  Ag.criar = function (ev) {
    return escreve('/api/eventos', ev, function (r) { if (r.evento) mescla([r.evento]); });
  };
  /* regra semanal do calendário automático */
  Ag.criarRegra = function (regra) {
    return escreve('/api/eventos/regras', regra, function (r) {
      var n = normalizaRegra(r.regra);
      if (n) {
        regras = regras.filter(function (x) { return x.id !== n.id; });
        regras.push(n);
      }
      mescla(r.proximas);
    });
  };
  /* cancelar não apaga nada no servidor: grava cancelado_em. "Encerrar agora"
   * um evento no ar é este mesmo cancelamento. Aceita o id numérico ou o da
   * lista ("e12", "r3@1789218000"). */
  Ag.cancelar = function (alvo, id) {
    var n = (typeof id === 'number') ? id : parseInt(String(id == null ? '' : id).replace(/^[er]/, ''), 10);
    if (alvo !== 'evento' && alvo !== 'regra') {
      return Promise.resolve({ ok: false, status: 400, erro: Tx('cancelar o quê? (evento ou regra)') });
    }
    if (!isFinite(n)) return Promise.resolve({ ok: false, status: 400, erro: Tx('id de {alvo} inválido', { alvo: alvo }) });
    return escreve('/api/eventos/cancelar', { alvo: alvo, id: n }, function () {
      if (alvo === 'evento') {
        lista = lista.filter(function (e) { return e.id !== 'e' + n; });
      } else {
        regras = regras.filter(function (r) { return r.id !== n; });
        lista = lista.filter(function (e) { return e.id.indexOf('r' + n + '@') !== 0; });
      }
    });
  };
  /* o que se cancela a partir de um item da lista */
  Ag.alvoDe = function (e) {
    var id = String((e && typeof e === 'object') ? e.id : e);
    var m = /^e(\d+)$/.exec(id);
    if (m) return { alvo: 'evento', id: +m[1] };
    m = /^r(\d+)@/.exec(id);
    if (m) return { alvo: 'regra', id: +m[1] };
    return null;
  };

  // ------------------------------------------------------------ as palavras
  /* "×2", "×1,5", "×1,25" */
  Ag.fmtFator = function (f) {
    var n = Math.round(Number(f) * 100) / 100;
    return '×' + String(isFinite(n) ? n : 1).replace('.', ',');
  };
  /* "XP ×2" (o de um item da lista, ou o de uma recompensa {tipo, fator}) */
  Ag.rotulo = function (e) {
    if (!e) return '';
    if (e.tipo === 'aviso') return Ag.NOMES.aviso;
    var f = (typeof e.fator === 'number') ? e.fator : fatorDoEvento(e);
    return (Ag.NOMES[e.tipo] || String(e.tipo)) + ' ' + Ag.fmtFator(f);
  };
  /* "5 h", "3 h 20 min", "2 d 4 h" — para "termina em …" */
  Ag.falta = function (ms) {
    var min = Math.max(0, Math.round(Number(ms) / 60000));
    if (!isFinite(min) || min < 1) return Tx('menos de 1 min');
    var d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60), m = min % 60;
    if (d > 0) return d + ' d' + (h ? ' ' + h + ' h' : '');
    if (h > 0) return h + ' h' + (m ? ' ' + m + ' min' : '');
    return m + ' min';
  };

  var DIA_CURTO = [Tx('dom'), Tx('seg'), Tx('ter'), Tx('qua'), Tx('qui'), Tx('sex'), Tx('sáb')];
  var DIA_TODO = [Tx('todo domingo'), Tx('toda segunda'), Tx('toda terça'), Tx('toda quarta'), Tx('toda quinta'), Tx('toda sexta'), Tx('todo sábado')];
  var DIA_PLURAL = [Tx('aos domingos'), Tx('às segundas'), Tx('às terças'), Tx('às quartas'), Tx('às quintas'), Tx('às sextas'), Tx('aos sábados')];
  Ag.DIA_CURTO = DIA_CURTO.slice();
  function dois(n) { return (n < 10 ? '0' : '') + n; }
  /* um instante (epoch em s) lido no relógio de parede de Brasília */
  function brt(tsSeg) { return new Date(tsSeg * 1000 + Ag.FUSO_MIN * 60000); }
  /* "qui 10/09 09:00" (Brasília) */
  Ag.quando = function (tsSeg) {
    var d = brt(Number(tsSeg));
    if (isNaN(d.getTime())) return '?';
    return DIA_CURTO[d.getUTCDay()] + ' ' + dois(d.getUTCDate()) + '/' + dois(d.getUTCMonth() + 1) +
      ' ' + dois(d.getUTCHours()) + ':' + dois(d.getUTCMinutes());
  };
  /* "2026-09-12T10:00" (o valor de um <input type=datetime-local>) ⇄ epoch em s,
   * os dois lidos como hora de Brasília — o painel não depende do fuso do PC */
  Ag.deBrasilia = function (txt) {
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(txt || ''));
    if (!m) return null;
    var utc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
    return Math.round((utc - Ag.FUSO_MIN * 60000) / 1000);
  };
  Ag.paraBrasilia = function (tsSeg) {
    var d = brt(Number(tsSeg));
    if (isNaN(d.getTime())) return '';
    return d.getUTCFullYear() + '-' + dois(d.getUTCMonth() + 1) + '-' + dois(d.getUTCDate()) +
      'T' + dois(d.getUTCHours()) + ':' + dois(d.getUTCMinutes());
  };
  /* "Todo sábado, 10:00–22:00 (Brasília)" */
  Ag.textoRegra = function (r) {
    if (!r || !isArr(r.dias) || !r.dias.length) return '';
    var dias = r.dias.slice().sort(function (a, b) { return a - b; });
    var quando;
    if (dias.length === 7) quando = 'todo dia';
    else if (dias.length === 1) quando = DIA_TODO[dias[0]];
    else {
      var ps = dias.map(function (d) { return DIA_PLURAL[d]; });
      quando = ps.slice(0, -1).join(', ') + ' e ' + ps[ps.length - 1];
    }
    var hm = /^(\d{2}):(\d{2})$/.exec(String(r.hora || '')) || [0, '00', '00'];
    var ini = (+hm[1]) * 60 + (+hm[2]);
    var fim = (ini + Math.round(Number(r.duracaoMin) || 0)) % 1440;
    var txt = Tx('{a}{b}, {c}:{d}–{e}:{f} (Brasília)', { a: quando.charAt(0).toUpperCase(), b: quando.slice(1), c: dois(+hm[1]), d: hm[2], e: dois(Math.floor(fim / 60)), f: dois(fim % 60) });
    return txt;
  };

  /* o nome do calabouço para a tela ("todos os calabouços" quando é geral) */
  Ag.nomeCalabouco = function (id) {
    if (!id) return Tx('todos os calabouços');
    var ds = (JOGO.DATA && JOGO.DATA.dungeons) || [];
    var ks = Object.keys(ds);
    for (var i = 0; i < ks.length; i++) {
      var d = ds[ks[i]];
      if (d && (d.id || ks[i]) === id && d.name) return d.name;
    }
    if (id === 'poco') return Tx('O Poço sem Fundo');
    return id;
  };
  /* os calabouços que o painel oferece: os ABERTOS (DATA.portalFechado) e o
   * Poço. O servidor aceita os 7 e não sabe quem está fechado — assim não
   * nasce uma terceira cópia da lista de portais fechados. */
  Ag.calaboucosDoPainel = function () {
    var D = JOGO.DATA || {};
    var ds = D.dungeons || [];
    var fora = [];
    Object.keys(ds).forEach(function (k) {
      var d = ds[k];
      var id = (d && d.id) ? d.id : k;
      if (id === 'poco' || Ag.CALABOUCOS.indexOf(id) < 0) return;
      if (D.portalFechado && D.portalFechado(id)) return;
      fora.push(id);
    });
    if (!fora.length) fora = Ag.CALABOUCOS.filter(function (c) { return c !== 'poco'; });
    fora.push('poco');
    return fora;
  };

  // ------------------------------------------------------------ as provas
  /* aplica uma resposta como se tivesse vindo do servidor (tests/agenda.html) */
  Ag._injeta = function (resposta) {
    seq++;                                  // uma busca em voo não passa por cima
    tentativa = relogio();
    return aplica(resposta);
  };
  /* o que o tique de 1 min faz sem esperar o minuto: confere se algum evento
   * entrou ou saiu do ar e avisa os ouvintes (as provas andam no relógio) */
  Ag._confere = confereMudanca;
  /* volta ao zero (memória e, se pedido, o cache) */
  Ag._limpa = function (apagaCache) {
    lista = []; regras = []; desvio = 0; buscaOk = 0; tentativa = 0; noAr = false; seq++;
    servEm = 0; monoEm = NaN;
    assinatura = assina();
    if (apagaCache) { var s = armazem(); try { if (s) s.removeItem(Ag.CHAVE); } catch (e) {} }
  };

  leCache();
})();
