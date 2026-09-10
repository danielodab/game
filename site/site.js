/* site.js — o que as páginas públicas do SOTERRA têm em comum.
 *
 *   SITE.base()            onde mora a API: mesma origem em produção
 *                          (/api/* passa pelo Caddy); em file:// ou com
 *                          `?api=http://127.0.0.1:8300` na URL, aponta lá
 *                          (e lembra em localStorage, como o `?rede=` do jogo).
 *   SITE.api(rota, op)     fetch com JSON nos dois sentidos e o token da
 *                          sessão no header Authorization. Resolve SEMPRE com
 *                          {status, ...json}; erro de rede vira {status:0}.
 *   SITE.sessao()          a sessão em localStorage 'soterra-sessao' =
 *                          {token, conta:{id, nome, gm}} — o jogo lê a mesma
 *                          chave para saber quem está logado.
 *   SITE.guarda(s)/sair()  entra e sai.
 *   SITE.cabecalho()       preenche #sessao no topo: "Olá, nome · sair".
 *   SITE.esc(texto)        escapa HTML (nome de jogador e de guilda vêm do
 *                          servidor, e o servidor guarda o que o cliente mandou).
 *
 * 10/09 — eventos do mundo, retratos e fusões:
 *   SITE.acertaRelogio(s)  guarda a diferença para o relógio do servidor;
 *   SITE.agora()           o "agora" do servidor, em segundos (como a API).
 *   SITE.quando(ts)        "qui, 10/09, 09:00" no fuso de quem vê.
 *   SITE.falta(ts)         "termina em 3 h 20 min".
 *   SITE.img(tipo, id, b)  o nome do retrato em site/img/ (classe, fusao, obra).
 *   SITE.fator(tipo, n)    "XP ×2".
 *   SITE.textoRegra(r)     "Todo sábado, 10:00–22:00 (Brasília)".
 *   SITE.agenda(r)         ativos e próximos recalculados pelo relógio.
 *   SITE.busto(op)         a miniatura redonda com a inicial de reserva.
 *
 * Sem framework e sem CDN, no espírito do jogo (globais JOGO.*). */
(function () {
  'use strict';
  var CHAVE_SESSAO = 'soterra-sessao';
  var CHAVE_API = 'soterra-api-base';
  var SITE = window.SITE = {};

  function leLocal(chave) {
    try { return localStorage.getItem(chave); } catch (e) { return null; }
  }
  function gravaLocal(chave, valor) {
    try {
      if (valor === null) localStorage.removeItem(chave); else localStorage.setItem(chave, valor);
    } catch (e) { /* navegador sem storage: a sessão dura a página */ }
  }

  SITE.base = function () {
    // NO AR a API é sempre a mesma origem: um link com ?api= de fora mandaria a
    // senha para outro servidor (e ficaria gravado). Só em casa o ?api= vale.
    var h = location.hostname;
    var local = location.protocol === 'file:' || h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1';
    if (!local) { gravaLocal(CHAVE_API, null); return ''; }
    var m = /[?&]api=([^&]+)/.exec(location.search);
    if (m) {
      var pedida = decodeURIComponent(m[1]).replace(/\/+$/, '');
      gravaLocal(CHAVE_API, pedida);
      return pedida;
    }
    var lembrada = leLocal(CHAVE_API);
    if (lembrada) return lembrada;
    // aberto do disco (o dono testando o site sem Caddy): a API de casa
    if (location.protocol === 'file:') return 'http://127.0.0.1:8300';
    return '';
  };

  SITE.sessao = function () {
    try {
      var s = JSON.parse(leLocal(CHAVE_SESSAO) || 'null');
      return (s && s.token && s.conta) ? s : null;
    } catch (e) { return null; }
  };
  SITE.guarda = function (s) { gravaLocal(CHAVE_SESSAO, JSON.stringify(s)); };
  SITE.esquece = function () { gravaLocal(CHAVE_SESSAO, null); };

  SITE.api = function (rota, op) {
    op = op || {};
    var cab = { 'Content-Type': 'application/json' };
    var s = SITE.sessao();
    var token = op.token || (s && op.semToken !== true ? s.token : null);
    if (token) cab.Authorization = 'Bearer ' + token;
    var pedido = { method: op.method || 'GET', headers: cab };
    if (op.body !== undefined) pedido.body = JSON.stringify(op.body);
    return fetch(SITE.base() + rota, pedido).then(function (r) {
      return r.json().catch(function () { return { ok: false, erro: 'resposta que não é JSON' }; })
        .then(function (j) { j.status = r.status; return j; });
    }).catch(function () {
      return { ok: false, status: 0, erro: 'o servidor está fora (não respondeu)' };
    });
  };

  SITE.sair = function () {
    var s = SITE.sessao();
    SITE.esquece();                       // primeiro o local: mesmo sem rede a página sai
    SITE.cabecalho();
    // o token vai explícito: a sessão local já foi apagada e o servidor
    // precisa dele para saber QUAL sessão matar
    if (s) SITE.api('/api/logout', { method: 'POST', body: {}, token: s.token });
  };

  SITE.esc = function (t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  SITE.cabecalho = function () {
    var caixa = document.getElementById('sessao');
    if (!caixa) return;
    var s = SITE.sessao();
    if (!s) {
      caixa.innerHTML = '<a href="conta.html#entrar">Entrar</a>';
      return;
    }
    caixa.innerHTML = 'Olá, <b>' + SITE.esc(s.conta.nome) + '</b>' + (s.conta.gm ? ' <span title="Mestre do Fundo">◆</span>' : '') +
      ' · <button type="button" id="bt-sair">sair</button>';
    document.getElementById('bt-sair').addEventListener('click', SITE.sair);
  };

  /* número com ponto de milhar, do jeito brasileiro */
  SITE.num = function (n) {
    n = Math.round(Number(n) || 0);
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  };

  /* ==========================================================================
   * 10/09 — EVENTOS DO MUNDO, RETRATOS E FUSÕES
   * ======================================================================== */

  /* O RELÓGIO DO SERVIDOR. Evento vale por horário, e o horário que manda é o
   * do servidor: com o PC de quem vê adiantado, o site diria "no ar" para um
   * evento que o jogo ainda não paga. A diferença fica guardada a partir da
   * resposta de /api/eventos (o jogo faz a mesma conta em js/core/agenda.js);
   * sem servidor, vale o relógio da máquina. Tudo em SEGUNDOS, como a API. */
  var desvioMs = 0;
  SITE.acertaRelogio = function (agoraSeg) {
    var n = Number(agoraSeg);
    if (isFinite(n) && n > 0) desvioMs = n * 1000 - Date.now();
  };
  SITE.agora = function () { return (Date.now() + desvioMs) / 1000; };

  /* Datas no fuso de QUEM VÊ (o navegador sabe qual é). Só a regra semanal
   * fala em Brasília, porque é assim que o servidor a guarda. */
  var DIA_CURTO = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  function dd(n) { return (n < 10 ? '0' : '') + n; }
  function dataDe(ts) {
    var d = new Date(Number(ts) * 1000);
    return isNaN(d.getTime()) ? null : d;
  }
  SITE.dia = function (ts) {
    var d = dataDe(ts);
    return d ? DIA_CURTO[d.getDay()] + ', ' + dd(d.getDate()) + '/' + dd(d.getMonth() + 1) : '';
  };
  SITE.hora = function (ts) {
    var d = dataDe(ts);
    return d ? dd(d.getHours()) + ':' + dd(d.getMinutes()) : '';
  };
  SITE.quando = function (ts) {
    return dataDe(ts) ? SITE.dia(ts) + ', ' + SITE.hora(ts) : '';
  };
  /* A meia-noite LOCAL, `mais` dias depois do dia de `ts`. O setDate atravessa
   * mês e ano sozinho, sem a conta de 86400 que erra em dia de fuso trocado. */
  SITE.inicioDoDia = function (ts, mais) {
    var d = dataDe(ts) || new Date();
    d.setHours(0, 0, 0, 0);
    if (mais) d.setDate(d.getDate() + mais);
    return d.getTime() / 1000;
  };

  /* número com vírgula e até 2 casas: 1.5 → "1,5", 2 → "2" */
  SITE.decimal = function (n) {
    var v = Math.round(Number(n) * 100) / 100;
    return isFinite(v) ? String(v).replace('.', ',') : '';
  };

  /* "3 h 20 min". O minuto arredonda PARA CIMA: um evento de 14 h aberto
   * agora diz "14 h", e não "13 h 59 min" por causa dos milissegundos da
   * resposta. */
  SITE.duracao = function (seg) {
    var min = Math.ceil(Math.max(0, Number(seg) || 0) / 60);
    if (min < 1) return 'menos de 1 min';
    if (min < 60) return min + ' min';
    var h = Math.floor(min / 60), m = min % 60;
    if (h < 24) return h + ' h' + (m ? ' ' + m + ' min' : '');
    var d = Math.floor(h / 24), hh = h % 24;
    return d + (d === 1 ? ' dia' : ' dias') + (hh ? ' e ' + hh + ' h' : '');
  };
  SITE.falta = function (ts, prefixo) {
    prefixo = prefixo || 'termina em';
    var s = Number(ts) - SITE.agora();
    if (!(s > 0)) return /^começa/.test(prefixo) ? 'já começou' : 'já terminou';
    return prefixo + ' ' + SITE.duracao(s);
  };

  /* OS CINCO TIPOS DE EVENTO (lista fechada do contrato de 10/09). Um tipo que
   * o site não conhece é ignorado, como no jogo, e nunca vira "undefined ×2". */
  SITE.TIPOS = ['xp', 'vintem', 'pedras', 'saque', 'aviso'];
  var NOME_TIPO = { xp: 'XP', vintem: 'Vinténs', pedras: 'Pedras', saque: 'Saque', aviso: 'Aviso' };
  SITE.nomeTipo = function (tipo) { return NOME_TIPO[tipo] || ''; };
  SITE.fator = function (tipo, n) {
    var nome = NOME_TIPO[tipo];
    if (!nome) return '';
    return (tipo === 'aviso' || !(Number(n) > 1)) ? nome : nome + ' ×' + SITE.decimal(n);
  };

  /* A REGRA SEMANAL em português: {dias:[6], hora:'10:00', duracaoMin:720}
   * vira "Todo sábado, 10:00–22:00 (Brasília)". Os dias são os do
   * Date.getDay() (0 = domingo), e a lista sai de segunda a domingo, que é
   * como se fala a semana. */
  var DIA_UM = ['Todo domingo', 'Toda segunda', 'Toda terça', 'Toda quarta', 'Toda quinta', 'Toda sexta', 'Todo sábado'];
  var DIA_VARIOS = ['aos domingos', 'às segundas', 'às terças', 'às quartas', 'às quintas', 'às sextas', 'aos sábados'];
  function hhmm(min) { return dd(Math.floor(min / 60) % 24) + ':' + dd(min % 60); }
  function dataBrasilia(ts) {
    // o servidor guarda a regra no fuso fixo de −3 h (sem horário de verão)
    var d = new Date((Number(ts) - 3 * 3600) * 1000);
    return dd(d.getUTCDate()) + '/' + dd(d.getUTCMonth() + 1);
  }
  SITE.textoRegra = function (r) {
    if (!r) return '';
    var dias = [];
    (Array.isArray(r.dias) ? r.dias : []).forEach(function (d) {
      d = Number(d);
      if (d >= 0 && d <= 6 && d === Math.floor(d) && dias.indexOf(d) < 0) dias.push(d);
    });
    if (!dias.length) return '';
    dias.sort(function (a, b) { return ((a + 6) % 7) - ((b + 6) % 7); });
    var chave = dias.join(','), quando;
    if (dias.length === 7) quando = 'Todo dia';
    else if (chave === '1,2,3,4,5') quando = 'De segunda a sexta';
    else if (chave === '6,0') quando = 'Todo fim de semana';
    else if (dias.length === 1) quando = DIA_UM[dias[0]];
    else {
      var nomes = dias.map(function (d) { return DIA_VARIOS[d]; });
      quando = nomes.slice(0, -1).join(', ') + ' e ' + nomes[nomes.length - 1];
      quando = quando.charAt(0).toUpperCase() + quando.slice(1);
    }
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(r.hora || ''));
    var dur = Math.round(Number(r.duracaoMin) || 0);
    if (!m || dur <= 0) return quando;
    var ini = Number(m[1]) * 60 + Number(m[2]), fim = ini + dur, faixa;
    if (ini === 0 && dur >= 1440) faixa = 'o dia inteiro';
    else if (fim === 1440) faixa = hhmm(ini) + ' até a meia-noite';
    else if (fim > 1440) faixa = hhmm(ini) + '–' + hhmm(fim - 1440) + ' do dia seguinte';
    else faixa = hhmm(ini) + '–' + hhmm(fim);
    var txt = quando + ', ' + faixa + ' (Brasília)';
    if (r.vigenteDe != null && Number(r.vigenteDe) > SITE.agora()) txt += ', a partir de ' + dataBrasilia(r.vigenteDe);
    if (r.vigenteAte != null && isFinite(Number(r.vigenteAte))) txt += ', até ' + dataBrasilia(r.vigenteAte);
    return txt;
  };

  /* O NOME DO CALABOUÇO pelo id, lido de ../js/core/data/dungeons.js quando a
   * página carrega esse arquivo. O Poço não mora nessa lista: é o calabouço
   * sintético de js/core/poco.js. */
  SITE.calabouco = function (id) {
    if (id === 'poco') return 'O Poço sem Fundo';
    var dgs = (window.JOGO && JOGO.DATA && JOGO.DATA.dungeons) || [];
    var ks = Object.keys(dgs);
    for (var i = 0; i < ks.length; i++) {
      var d = dgs[ks[i]];
      if (d && d.id === id) return d.name;
    }
    return '';
  };
  SITE.semArtigo = function (nome) { return String(nome || '').replace(/^(A|O|As|Os) /, ''); };
  var CONTRAI = { A: 'na', O: 'no', As: 'nas', Os: 'nos' };
  /* "em todos os calabouços" / "só na Cisterna dos Afogados" */
  SITE.onde = function (id) {
    if (!id) return 'em todos os calabouços';
    var nome = SITE.calabouco(id);
    if (!nome) return 'num calabouço só';
    var m = /^(A|O|As|Os) (.*)$/.exec(nome);
    return 'só ' + (m ? CONTRAI[m[1]] + ' ' + m[2] : 'em ' + nome);
  };

  /* O CALABOUÇO DO DIA de `ts` (segundos), pela MESMA função do jogo:
   * JOGO.Diario.hoje, que usa o dia local e já pula portal fechado. */
  SITE.diaDoCalabouco = function (ts) {
    var D = window.JOGO && JOGO.Diario;
    if (!D || !D.hoje) return null;
    var h = D.hoje(Number(ts) * 1000);
    if (!h || !h.dungeonId) return null;
    return { id: h.dungeonId, nome: SITE.calabouco(h.dungeonId) || h.dungeonId,
             bonus: Math.round((Number(h.bonusDrop) - 1) * 100) };
  };

  /* A AGENDA recalculada PELO RELÓGIO, e não pela resposta: a lista que
   * chegou há 4 minutos continua certa (um evento acaba sozinho, o próximo
   * entra sozinho), e uma resposta velha nunca estende um evento. É o mesmo
   * que o jogo faz. O multiplicador fica preso no teto que o próprio servidor
   * manda, para a tela nunca prometer mais do que o jogo paga. */
  SITE.agenda = function (r, t) {
    r = r || {};
    t = (t == null) ? SITE.agora() : t;
    var tetos = r.tetos || {}, vistos = {}, todos = [];
    [].concat(r.ativos || [], r.proximos || []).forEach(function (e) {
      if (!e || SITE.TIPOS.indexOf(e.tipo) < 0) return;
      var ini = Number(e.inicio), fim = Number(e.fim);
      if (!isFinite(ini) || !isFinite(fim) || fim <= ini) return;
      var id = String(e.id);
      if (vistos[id]) return;
      vistos[id] = true;
      var m = Number(e.multiplicador), teto = Number(tetos[e.tipo]);
      if (!isFinite(m) || m < 1) m = 1;
      if (teto >= 1 && m > teto) m = teto;
      todos.push({ id: id, tipo: e.tipo, mult: m, calabouco: e.calabouco || null,
                   titulo: String(e.titulo == null ? '' : e.titulo),
                   texto: String(e.texto == null ? '' : e.texto),
                   inicio: ini, fim: fim, regra: e.regra == null ? null : e.regra });
    });
    return {
      todos: todos,
      ativos: todos.filter(function (e) { return e.inicio <= t && t < e.fim; })
                   .sort(function (a, b) { return a.fim - b.fim; }),
      proximos: todos.filter(function (e) { return e.inicio > t; })
                     .sort(function (a, b) { return a.inicio - b.inicio; })
    };
  };

  /* O cartão de um evento no ar e a linha de um evento que vem aí. Tudo que
   * veio do servidor passa pelo esc; o tipo já é da lista fechada. */
  SITE.cartaoEvento = function (e) {
    var E = SITE.esc;
    return '<div class="evento no-ar t-' + e.tipo + '">' +
      '<div class="evento-topo"><span class="chip-tipo t-' + e.tipo + '">' + E(SITE.fator(e.tipo, e.mult)) + '</span>' +
      '<span class="etiqueta aberto">No ar</span></div>' +
      '<h4>' + E(e.titulo) + '</h4>' + (e.texto ? '<p>' + E(e.texto) + '</p>' : '') +
      '<div class="evento-pe"><span>' + E(SITE.onde(e.calabouco)) + '</span>' +
      '<span class="falta">' + E(SITE.falta(e.fim)) + '</span></div></div>';
  };
  SITE.linhaEvento = function (e) {
    var E = SITE.esc;
    return '<li><span class="chip-tipo t-' + e.tipo + '">' + E(SITE.fator(e.tipo, e.mult)) + '</span> ' +
      '<b>' + E(e.titulo) + '</b><span class="apoio"> · ' + E(SITE.quando(e.inicio)) +
      ' · ' + E(SITE.onde(e.calabouco)) + '</span></li>';
  };

  /* OS RETRATOS (contrato de 10/09): o nome sai do id do JOGO, com o par da
   * fusão em ordem alfabética, sempre .webp, em site/img/. O id pode vir do
   * servidor (o avatar do ranking), então só passa o que tem cara de id: um
   * nome torto vira '' e quem chama mostra direto a moldura com a inicial. */
  var ID_OK = /^[a-z][a-z0-9]*$/;
  SITE.parDe = function (x) {
    var p = Array.isArray(x) ? x.slice() : String(x == null ? '' : x).replace(/^fus:/, '').split('+');
    if (p.length !== 2 || p[0] === p[1] || !ID_OK.test(p[0]) || !ID_OK.test(p[1])) return null;
    return p.sort();
  };
  SITE.img = function (tipo, id, busto) {
    var nome = '';
    if (tipo === 'classe' && ID_OK.test(String(id))) nome = String(id);
    else if (tipo === 'fusao') { var p = SITE.parDe(id); if (p) nome = p.join('-'); }
    else if (tipo === 'obra' && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(String(id))) nome = String(id);
    return nome ? 'img/' + tipo + '-' + nome + (busto ? '-busto' : '') + '.webp' : '';
  };
  /* O onerror de toda foto gerada por script: tenta a reserva (o busto da
   * classe quando o da fusão falta) e, sem ela, liga a moldura com a inicial
   * — a mesma .sem-foto das fotos da landing. */
  SITE.semFoto = function (img) {
    var reserva = img.getAttribute('data-reserva');
    if (reserva) { img.removeAttribute('data-reserva'); img.src = reserva; return; }
    img.onerror = null;
    if (img.parentNode) img.parentNode.classList.add('sem-foto');
  };
  SITE.inicial = function (nome) {
    var c = Array.from(String(nome == null ? '' : nome).trim())[0];
    return c ? c.toUpperCase() : '?';
  };
  /* style="--cor:…;--cor-b:…" só com cor de verdade. Um --cor vazio não cai
   * no valor de reserva do var(): anula o fundo inteiro da moldura. */
  SITE.estiloCores = function (a, b) {
    var ok = /^#[0-9a-fA-F]{3,8}$/, s = '';
    if (ok.test(a || '')) s += '--cor:' + a + ';';
    if (ok.test(b || '')) s += '--cor-b:' + b + ';';
    return s ? ' style="' + s + '"' : '';
  };
  /* A miniatura redonda: {src, reserva, letra, cor}. Sem src nenhum, já nasce
   * mostrando a inicial sobre a cor (que só entra se for cor mesmo). */
  SITE.busto = function (op) {
    op = op || {};
    var src = op.src || op.reserva || '', reserva = op.src ? (op.reserva || '') : '';
    var cor = /^#[0-9a-fA-F]{3,8}$/.test(op.cor || '') ? op.cor : '';
    var h = '<span class="busto' + (src ? '' : ' sem-foto') + '" data-letra="' + SITE.esc(op.letra || '?') + '"' +
      (cor ? ' style="--cor:' + cor + '"' : '') + '>';
    if (src) {
      h += '<img src="' + SITE.esc(src) + '" alt="" loading="lazy"' +
        (reserva ? ' data-reserva="' + SITE.esc(reserva) + '"' : '') + ' onerror="SITE.semFoto(this)">';
    }
    return h + '</span>';
  };
  /* O busto de um jogador do ranking: o avatar de fusão que ele escolheu; sem
   * ele, o busto da classe do seu melhor herói; sem nenhum, a inicial. A
   * classe só vale se o jogo a conhece (e nunca a do Mestre). */
  SITE.bustoJogador = function (j) {
    j = j || {};
    var C = (window.JOGO && JOGO.DATA && JOGO.DATA.classes) || {};
    function eh(id) { return id !== 'gm' && Object.prototype.hasOwnProperty.call(C, id); }
    function cor(id) { return (eh(id) && C[id].palette && C[id].palette.primary) || ''; }
    var par = SITE.parDe(j.avatar);
    var fus = (par && eh(par[0]) && eh(par[1])) ? SITE.img('fusao', par, true) : '';
    var cls = eh(j.classe) ? SITE.img('classe', j.classe, true) : '';
    return SITE.busto({ src: fus || cls, reserva: fus ? cls : '', letra: SITE.inicial(j.nome),
                        cor: cor(j.classe) || (fus ? cor(par[0]) : '') });
  };

  document.addEventListener('DOMContentLoaded', SITE.cabecalho);
})();
