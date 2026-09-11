// A Rede — presença e conversa entre abas, antes do servidor (dono: lógica).
var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

/* O QUE ISTO É
 * ============
 * A fase 2 de docs/A_VIDA_ONLINE.html: jogadores se VEEM no Acampamento —
 * fantasma andando, nome na cabeça, chat. O protocolo é um só; o TRANSPORTE
 * são dois, escolhidos sozinhos (urlDoRele):
 *
 *   CANAL  BroadcastChannel — abas do mesmo navegador (dev local, file://
 *          servido em localhost). Foi o primeiro transporte e segue vivo.
 *   WS     WebSocket até o RELÉ (servidor/rele.py, o carteiro que abre o
 *          envelope e entrega a quem precisa: a mesma sala, o destino da
 *          mensagem dirigida, os mais próximos numa praça cheia).
 *          Entra em cena quando o jogo está num servidor de verdade
 *          (hostname que não é localhost → wss://<host>/ws), ou forçado
 *          por `?rede=ws://...` na URL (é como as provas testam). Se o relé
 *          não responder, cai para o canal sem drama; se cair DEPOIS de
 *          ligado, reconecta sozinho e se reapresenta com um novo `oi`.
 *
 * O PROTOCOLO (mensagens pequenas, JSON puro):
 *   oi     { de, nome, titulo, classe, resumo, x, z }   entrei — quem está aí?
 *   eco    { de, nome, titulo, classe, resumo, x, z }   resposta ao oi
 *          (`resumo` = a foto da conta para o PLACAR: classes com níveis e
 *           total — muda raro, então só viaja no oi/eco, não no pulso)
 *   alvo   { de, x, z }                         vou andar até ali (o fantasma
 *                                               ANDA o caminho, não teleporta)
 *   pulso  { de, x, z }                         correção periódica de posição
 *   chat   { de, nome, texto }                  conversa
 *   troca  { de, para, acao, dados }            o canal da TROCA: só o
 *          destinatário processa; as ações (convite, oferta, tranca,
 *          confirma...) são assunto de JOGO.Troca — a Rede só carrega
 *   tchau  { de }                               saí
 *
 *   (10/09) oi e eco levam `v: 2` (a versão: o relé sabe que este cliente
 *   aguenta o pulso ralo) e podem levar `para`: o eco vai só a quem
 *   perguntou, e o oi com `para` é a pergunta "quem é você?" a um par que
 *   só se viu por pulso. Cliente antigo ignora os dois campos.
 *
 *   (10/09) A VOZ DO RELÉ, sem `de` (o cliente antigo a ignora):
 *   rele      { v, ident, n }  o relé novo se anuncia ao aceitar a conexão; `n`
 *                              é a MARCA que esta conexão sorteou e pôs no
 *                              endereço (?n=) — um par não a conhece, então um
 *                              anúncio forjado por um relé antigo não vale
 *   ident     { de, token }    o token da sessão do cartório: só DEPOIS do
 *                              anúncio com ident:true e a marca certa, e só ao
 *                              relé da própria origem (ou em casa); o relé
 *                              nunca o repassa
 *   ident-ok  { mestre }  /  ident-nao      a resposta, só para quem mandou
 *   Pelo relé novo, o oi, o eco e o chat do Mestre conferido chegam com
 *   mestre:true, e o nome reservado de quem não é o Mestre já chega trocado
 *   (servidor/rele_ident.py) — o emblema da guilda e o corpo do Mestre (a
 *   classe 'gm') também. A Rede faz a mesma troca na chegada: vale no canal
 *   de abas e no relé antigo, que não trocam nada. O mestre:true só vale do
 *   relé da própria origem, e a resposta do ident só vale se o ident saiu.
 *
 * PRESENÇA POR PULSO: o tique é de 2s; o `pulso` só sai quando a posição (ou
 * a sala) mudou, ou como sinal de vida a cada ~6s parado. Quem fica calado
 * além do prazo é dado como desligado (aba fechada sem `tchau` — F5, queda):
 * 8s no canal de abas (todo pulso chega a todos) e 45s pelo relé, que numa
 * praça cheia manda ao longe só 1 pulso a cada 5 (mas ao menos um a cada
 * 12s: parado, o jogador pulsa a cada 6s, e 5 pulsos eram 30s de silêncio
 * contra os 45s — o `alvo` também só chega aos 40 mais próximos, então o
 * pulso ralo é o único sinal de quem está longe) e que, quando a conexão de
 * alguém cai sem `tchau`, despede por ele. O `tchau` educado só adianta o
 * inevitável.
 *
 * ONDE NÃO FUNCIONA: em file:// cada aba pode ser uma origem opaca e o canal
 * não cruza — o módulo vira um no-op silencioso e o jogo segue solo. Servido
 * (http://), que é o caminho do multiplayer, funciona inteiro — e com o relé
 * no ar, funciona entre MÁQUINAS.
 */
(function () {
  'use strict';

  var R = {};
  JOGO.Rede = R;

  var CANAL = 'soterra-rede-v1';
  R.VERSAO = 2;                     // vai no oi/eco: o relé pode mandar o pulso ralo a este cliente
  R.PULSO_MS = 2000;                // o tique: a posição mudou, o pulso sai
  R.VIDA_MS = 6000;                 // parado, o sinal de vida (cabe nos 8s do cliente antigo)
  R.SUMICO_MS = 8000;               // prazo da varredura no canal de abas
  R.SUMICO_RELE_MS = 45000;         // prazo pelo relé: ao longe chega 1 pulso a cada 5, e ao menos um a cada 12s (margem de 3,75x)
  R.PERGUNTA_MS = 10000;            // par visto só por pulso: pergunta de novo depois disto
  R.ANUNCIO_MS = 1500;              // o relé novo se anuncia ao aceitar; calado até aqui, é o antigo: a fila sai sem ident
  R.NOME_MAX = 24;                  // nome/título/guilda/emblema de par maior que isto sai trocado sem passar pela regra (o TEXTO_MAX do relé)

  var canal = null;                 // o transporte vivo: { tipo:'canal'|'ws', envia(obj), fecha() }
  var eu = null;                    // { id, nome, titulo, classe, x, z }
  var pares = {};                   // id -> { nome, titulo, classe, x, z, visto }
  var timerPulso = null;
  var ultPulso = null;              // o último sinal de presença que saiu: { x, z, sala, t }
  var urlAtual = null;              // o relé desta entrada (o token só vai ao da própria origem)
  var identidade = null;            // o que o relé disse do ident: null (nada), false (não conferiu) ou { mestre }
  var identTarde = false;           // o anúncio chegou depois do oi (rede lenta): o ident-ok reapresenta
  var identMandado = false;         // esta conexão mandou o ident: só então a resposta do relé vale

  /* Qual relé esta janela deve procurar. `?rede=ws://...` manda em tudo
   * (dev e provas); página servida fora de localhost procura o relé na
   * própria origem (/ws, atrás do Caddy); localhost e file:// ficam no
   * canal de abas de sempre. */
  function urlDoRele() {
    try {
      var m = /[?&]rede=(wss?:\/\/[^&\s]+)/.exec(String(window.location.search || ''));
      if (m) return decodeURIComponent(m[1]);
      var p = window.location.protocol;
      if (p !== 'http:' && p !== 'https:') return null;
      var h = window.location.hostname;
      if (h === 'localhost' || h === '127.0.0.1' || h === '') return null;
      return (p === 'https:' ? 'wss://' : 'ws://') + window.location.host + '/ws';
    } catch (e) { return null; }
  }

  function transporteCanal() {
    if (typeof BroadcastChannel === 'undefined') return null;   // file:// solo
    var bc;
    try { bc = new BroadcastChannel(CANAL); } catch (e) { return null; }
    bc.onmessage = aoMensagem;
    return {
      tipo: 'canal',
      envia: function (o) { try { bc.postMessage(o); } catch (e) {} },
      fecha: function () { try { bc.close(); } catch (e) {} }
    };
  }

  /* O WebSocket até o relé. Mensagens de antes do abrir esperam na fila;
   * `aoFalhar` dispara se a PRIMEIRA conexão não vingar (o chamador cai
   * para o canal); queda depois de aberto reconecta em ~4s (sorteado) e chama
   * `aoReligar` (o chamador se reapresenta com um `oi` novo).
   *
   * O ANÚNCIO (10/09): cada conexão sorteia uma MARCA e a põe no endereço
   * (?n=); o relé novo se anuncia ao aceitar ({t:'rele', ident, n}) e só
   * então a fila sai — com o ident na frente, se `aoRele` devolver um. O
   * anúncio só vale com a marca DESTA conexão: um par que o forje pelo relé
   * antigo (que repassa tudo) não a conhece. O relé antigo não se anuncia: a
   * fila sai depois de ANUNCIO_MS, sem ident — e ele nunca vê token. A voz
   * do relé (sem `de`) vai a `aoRele(m, tarde)`, nunca ao aoMensagem. */
  function marca() {
    var s = '';
    try {
      var a = new Uint32Array(3);
      window.crypto.getRandomValues(a);
      for (var i = 0; i < a.length; i++) s += a[i].toString(36);
    } catch (e) {}
    while (s.length < 16) s += Math.random().toString(36).slice(2);
    return s.slice(0, 20);
  }
  function transporteWs(url, aoFalhar, aoReligar, aoRele) {
    var ws = null, abriu = false, fechado = false, fila = [];
    var pronto = false, anunciou = false, espera = null;
    function libera(primeira) {
      if (pronto) return;
      pronto = true;
      clearTimeout(espera);
      while (fila.length) { try { ws.send(fila.shift()); } catch (e) { break; } }
      if (!primeira && aoReligar) aoReligar();
    }
    function conecta(deNovo) {
      var este, primeiraDesta = false, n = marca();
      try {
        ws = este = new WebSocket(url + (url.indexOf('?') >= 0 ? '&' : '?') + 'n=' + n);
      } catch (e) { falha(); return; }
      pronto = false;
      anunciou = false;
      ws.onopen = function () {
        primeiraDesta = !abriu;
        abriu = true;
        clearTimeout(espera);
        espera = setTimeout(function () { if (ws === este) libera(primeiraDesta); }, R.ANUNCIO_MS);
      };
      ws.onmessage = function (ev) {
        var m = null;
        try { m = JSON.parse(String(ev.data)); } catch (e) { return; }
        if (m && typeof m === 'object' && !m.de) {
          // a voz do relé: o anúncio (só com a marca desta conexão) e,
          // depois dele, a resposta do ident
          if (ws !== este) return;
          if (m.t === 'rele' && !anunciou && m.n === n) {
            anunciou = true;
            var id = aoRele ? aoRele(m, pronto) : null;   // pronto: a fila já saiu sem ele
            if (id) { try { ws.send(JSON.stringify(id)); } catch (e) {} }
            libera(primeiraDesta);
          } else if (anunciou && m.t !== 'rele' && aoRele) {
            aoRele(m, false);
          }
          return;
        }
        aoMensagem({ data: m });
      };
      ws.onclose = ws.onerror = function () {
        if (fechado) return;
        if (!abriu) { falha(); return; }
        // já esteve ligado: o relé caiu ou a rede piscou — insiste, em 3 a
        // 5,5 s sorteados: depois de um deploy a praça inteira religa junta,
        // e o relé confere a sessão de cada um (a rajada de idents)
        setTimeout(function () { if (!fechado) conecta(true); }, 3000 + Math.floor(Math.random() * 2500));
      };
    }
    function falha() {
      if (fechado) return;
      fechado = true;
      if (aoFalhar) aoFalhar();
    }
    conecta(false);
    return {
      tipo: 'ws',
      envia: function (o) {
        var s;
        try { s = JSON.stringify(o); } catch (e) { return; }
        if (ws && ws.readyState === 1 && pronto) { try { ws.send(s); } catch (e) {} }
        else if (fila.length < 50) fila.push(s);
      },
      fecha: function () {
        fechado = true;
        clearTimeout(espera);
        try { if (ws) ws.close(); } catch (e) {}
      },
      anunciou: function () { return anunciou; }   // o relé desta conexão se anunciou (com a marca)
    };
  }

  /* A HUD pendura aqui UM ouvinte de eventos já digeridos:
   *   { tipo:'entrou', id, nome, titulo, classe, x, z }
   *   { tipo:'alvo',   id, x, z }
   *   { tipo:'pulso',  id, x, z }
   *   { tipo:'chat',   id, nome, texto }
   *   { tipo:'saiu',   id }                                              */
  R.aoEvento = null;

  function avisa(ev) {
    if (R.aoEvento) { try { R.aoEvento(ev); } catch (e) {} }
  }
  function manda(tipo, corpo) {
    if (!canal || !eu) return;
    corpo = corpo || {};
    corpo.t = tipo;
    corpo.de = eu.id;
    canal.envia(corpo);
  }
  /* O `oi` de apresentação — sai na entrada, na queda para o canal e na
   * reconexão do ws (para os pares, um `oi` repetido é só um re-conhece). */
  function cartao(para) {
    var c = { v: R.VERSAO, nome: eu.nome, titulo: eu.titulo, classe: eu.classe,
              resumo: eu.resumo, aura: eu.aura, x: eu.x, z: eu.z, sala: eu.sala, nuvem: eu.nuvem };
    if (para) c.para = para;
    return c;
  }
  function apresenta() {
    if (!eu) return;
    manda('oi', cartao(null));
    // o oi vai à sala inteira com a posição: vale como sinal de vida
    ultPulso = { x: eu.x, z: eu.z, sala: eu.sala || null, t: agora() };
  }
  /* A pergunta a UM par ("quem é você?"): o oi dirigido. Pelo relé só ele
   * ouve e responde com o eco; no canal de abas todos ouvem, e para os
   * outros é só um re-conhece (o eco sai só de quem foi perguntado). */
  function pergunta(id) {
    if (!eu || !id) return;
    manda('oi', cartao(id));
  }
  function agora() { return Date.now(); }

  /* A VOZ DO RELÉ (10/09): o anúncio diz se ele confere identidade; se sim,
   * há sessão no cartório e o relé é o da própria origem (ou estamos em
   * casa), o ident sai na frente da fila. Se o anúncio chegou DEPOIS do oi
   * (rede lenta), o ident-ok reapresenta — o oi novo leva o carimbo. */
  function vozDoRele(m, tarde) {
    if (m.t === 'rele') {
      identidade = null;
      var tk = (m.ident === true && eu && R._identPermitido(urlAtual)) ? tokenDaSessao() : null;
      identMandado = !!tk;
      identTarde = !!(tk && tarde);
      return tk ? { t: 'ident', de: eu.id, token: tk } : null;
    }
    if (m.t !== 'ident-ok' && m.t !== 'ident-nao') return null;
    // resposta a um ident que esta conexão não mandou não vale: o relé de um
    // ?rede= de fora se anuncia com a marca (ela está no endereço dele) e
    // diria "ident-ok, mestre" sem nunca ter visto token nenhum
    if (!identMandado) return null;
    var antes = identidade;
    identidade = (m.t === 'ident-ok') ? { mestre: m.mestre === true } : false;
    // o relé pode mudar de ideia depois (a sessão revogada, o Mestre tirado,
    // o banco que só conferiu atrasado): o oi novo leva o carimbo novo
    var mudou = antes !== null && !mesmaIdentidade(antes, identidade);
    var reapresenta = (identTarde && identidade !== false) || mudou;
    identTarde = false;
    if (reapresenta) apresenta();
    return null;
  }
  function mesmaIdentidade(a, b) {
    return (a === false && b === false) || (!!a && !!b && a.mestre === b.mestre);
  }
  function tokenDaSessao() {
    try {
      var S = JOGO.Sessao;
      if (!S || typeof S.token !== 'function') return null;
      if (typeof S.ativa === 'function' && !S.ativa()) return null;
      var t = S.token();
      return (typeof t === 'string' && t) ? t : null;
    } catch (e) { return null; }
  }
  /* O token só vai ao relé da PRÓPRIA origem (o wss://<host>/ws que o jogo
   * acha sozinho) — ou em casa (file://, localhost), onde o ?rede= é das
   * provas. No ar, um link com ?rede= de fora levaria o token a outro
   * servidor: lá o ident não sai (a Sessao faz o mesmo com o ?api=). */
  R._identPermitido = function (url, loc) {
    try {
      loc = loc || window.location;
      var h = String(loc.hostname || '');
      if (loc.protocol === 'file:' || h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]') return true;
      var m = /^wss?:\/\/([^\/?#]+)/i.exec(String(url || ''));
      return !!m && m[1].toLowerCase() === String(loc.host || '').toLowerCase();
    } catch (e) { return false; }
  };

  /* A DEFESA NA CHEGADA (10/09): o relé novo já troca o nome reservado de
   * quem não é o Mestre conferido (servidor/rele_ident.py); aqui a mesma
   * troca, com a mesma regra (JOGO.Nomes), vale também sem ele — no canal de
   * abas e no relé antigo. Só se confia no mestre:true de um relé que se
   * ANUNCIOU (esse joga fora o `mestre` que o cliente põe) e que é o da
   * própria origem (confiaMestre): no canal, no relé antigo e no de um
   * ?rede= de fora ninguém é Mestre. Texto que não é texto, ou maior que
   * NOME_MAX, sai trocado sem passar pela regra (ela custa com texto
   * comprido); os veredictos ficam guardados. Sem JOGO.Nomes carregado, só
   * o relé protege. */
  var vereditos = {}, nVereditos = 0;
  function reservadoAqui(s) {
    if (s === null || s === undefined || s === '') return false;
    if (typeof s !== 'string' || s.length > R.NOME_MAX) return true;
    var N = JOGO.Nomes;
    if (!N || typeof N.reservado !== 'function') return false;
    if (Object.prototype.hasOwnProperty.call(vereditos, s)) return vereditos[s];
    var v;
    try { v = !!N.reservado(s); } catch (e) { v = true; }
    if (nVereditos >= 2000) { vereditos = {}; nVereditos = 0; }
    vereditos[s] = v;
    nVereditos++;
    return v;
  }
  /* o gêmeo do rele_ident.nome_de_troca: 'Aventureiro-' e as 4 últimas
   * letras/dígitos do id (minúsculas); se até isso cair na regra, só
   * 'Aventureiro' */
  function nomeDeTroca(id) {
    var suf = String(id === null || id === undefined ? '' : id).toLowerCase().replace(/[^0-9a-z]/g, '').slice(-4);
    if (suf) {
      var c = 'Aventureiro-' + suf;
      if (!reservadoAqui(c)) return c;
    }
    return 'Aventureiro';
  }
  /* o mestre:true só vale do relé que se anunciou com a marca desta conexão
   * E é o da própria origem (ou em casa): a marca prova só que o anúncio veio
   * do servidor do outro lado do fio — e qualquer servidor a lê no próprio
   * endereço. Um link com ?rede= de fora, no ar, punha um "Administrator"
   * Mestre na página verdadeira do jogo (a Sessao ignora o ?api= por isso) */
  function confiaMestre() {
    return !!(canal && canal.tipo === 'ws' && canal.anunciou && canal.anunciou() &&
              R._identPermitido(urlAtual));
  }
  function copia(o) {
    var c = {};
    for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) c[k] = o[k];
    return c;
  }
  var EMBLEMA_TROCA = '⚑';          // o gêmeo do rele_ident.EMBLEMA_TROCA
  /* o corpo do Mestre (a classe 'gm', o Cavaleiro Negro, e a fusão com ela)
   * só vale para o Mestre conferido; os outros vestem 'sumo' (o gêmeo do
   * rele_ident.veste_o_mestre) */
  function vesteOMestre(c) {
    if (typeof c !== 'string') return false;
    if (c === 'gm') return true;
    return c.indexOf('fus:') === 0 && c.slice(4).split('+').indexOf('gm') >= 0;
  }
  function classeDe(c, mestre) {
    return (!mestre && vesteOMestre(c)) ? 'sumo' : (c || 'sumo');
  }
  /* nome, título e resumo como o par deve aparecer — sem mexer no que chegou.
   * A placa da guilda é emblema + nome: os dois passam pela regra; e a ficha
   * 'gm' do placar sai do resumo de quem não é o Mestre */
  function vitrine(m, mestre) {
    var v = { nome: m.nome, titulo: m.titulo, resumo: m.resumo };
    if (mestre) return v;
    if (reservadoAqui(m.nome)) v.nome = nomeDeTroca(m.de);
    if (reservadoAqui(m.titulo)) v.titulo = '';
    var r = (m.resumo && typeof m.resumo === 'object') ? m.resumo : null;
    var g = (r && r.guilda && typeof r.guilda === 'object') ? r.guilda : null;
    var gNome = !!g && reservadoAqui(g.nome), gEmb = !!g && reservadoAqui(g.emblema);
    var cls = (r && r.classes && typeof r.classes === 'object') ? r.classes : null;
    var gmCls = !!cls && Object.prototype.hasOwnProperty.call(cls, 'gm');
    if (gNome || gEmb || gmCls) {
      v.resumo = copia(r);
      if (gNome || gEmb) {
        v.resumo.guilda = copia(g);
        if (gNome) v.resumo.guilda.nome = 'Guilda';
        if (gEmb) v.resumo.guilda.emblema = EMBLEMA_TROCA;
      }
      if (gmCls) {
        v.resumo.classes = copia(cls);
        delete v.resumo.classes.gm;
      }
    }
    return v;
  }
  function dadosDeGuilda(d, mestre) {
    if (!d || typeof d !== 'object') return d || null;
    if (mestre) return d;
    var n = reservadoAqui(d.nome), e = reservadoAqui(d.emblema);
    if (!n && !e) return d;
    var c = copia(d);
    if (n) c.nome = 'Guilda';
    if (e) c.emblema = EMBLEMA_TROCA;
    return c;
  }

  function conhece(m) {
    var atual = pares[m.de];
    // "novo" também cobre quem foi visto SÓ por pulso (guardado sem nome,
    // calado): o anúncio de entrada espera a mensagem que traz o nome
    var novo = !atual || !atual.nome;
    var salaAntes = atual ? (atual.sala || null) : null;
    var mestre = m.mestre === true && confiaMestre();
    var vit = vitrine(m, mestre);             // 10/09: o nome reservado de quem não é Mestre sai trocado
    pares[m.de] = { nome: vit.nome || '?', titulo: vit.titulo || '',
                    classe: classeDe(m.classe, mestre),   // 10/09: o corpo do Mestre só no Mestre
                    resumo: vit.resumo || null,
                    mestre: mestre,
                    nuvem: m.nuvem || null,           // a conta no cartório (10/09)
                    aura: m.aura === true,
                    sala: m.sala || null,       // 03/09: a antessala em que ele está (null = praça)
                    x: m.x || 0, z: m.z || 0, visto: agora() };
    if (novo) {
      avisa({ tipo: 'entrou', id: m.de, nome: pares[m.de].nome,
              titulo: pares[m.de].titulo, classe: pares[m.de].classe,
              resumo: pares[m.de].resumo, aura: pares[m.de].aura,
              sala: pares[m.de].sala, mestre: pares[m.de].mestre,
              x: pares[m.de].x, z: pares[m.de].z });
    } else if (salaAntes !== pares[m.de].sala) {
      // trocou de sala (desceu, subiu, saiu): quem escuta some ou mostra o corpo
      avisa({ tipo: 'mudouSala', id: m.de, nome: pares[m.de].nome,
              titulo: pares[m.de].titulo, classe: pares[m.de].classe,
              resumo: pares[m.de].resumo, aura: pares[m.de].aura,
              sala: pares[m.de].sala, x: pares[m.de].x, z: pares[m.de].z });
    }
    return novo;
  }

  function aoMensagem(ev) {
    var m = ev && ev.data;
    if (!m || !m.t || !m.de || !eu || m.de === eu.id) return;
    if (m.t === 'oi') {
      conhece(m);
      // o eco apresenta a MIM para o recém-chegado — sem ele, quem entra
      // por último não veria ninguém que já estava. Vai dirigido a quem
      // perguntou; oi dirigido a OUTRO par é só um re-conhece
      if (!m.para || m.para === eu.id) manda('eco', cartao(m.de));
    } else if (m.t === 'eco') {
      conhece(m);
    } else if (m.t === 'alvo') {
      if (pares[m.de]) { pares[m.de].visto = agora(); }
      avisa({ tipo: 'alvo', id: m.de, x: m.x, z: m.z });
    } else if (m.t === 'pulso') {
      if (!pares[m.de]) {
        /* pulso de DESCONHECIDO (oi perdido, ou o par expirou numa aba de
         * fundo desacelerada): nada de anunciar "? chegou" — guarda calado
         * e PERGUNTA a ele (oi dirigido), porque o oi provoca o eco que traz
         * o nome. Antes o oi ia à praça inteira, e a praça inteira ecoava. */
        pares[m.de] = { nome: null, titulo: '', classe: 'sumo', resumo: null,
                        x: m.x || 0, z: m.z || 0, visto: agora(), pedido: agora() };
        pergunta(m.de);
      } else {
        if (!pares[m.de].nome && agora() - (pares[m.de].pedido || 0) > R.PERGUNTA_MS) {
          pares[m.de].pedido = agora();       // a resposta não veio: pergunta de novo
          pergunta(m.de);
        }
        pares[m.de].visto = agora();
        pares[m.de].x = m.x; pares[m.de].z = m.z;
        var salaP = m.sala || null;
        if (pares[m.de].nome && (pares[m.de].sala || null) !== salaP) {
          pares[m.de].sala = salaP;
          avisa({ tipo: 'mudouSala', id: m.de, nome: pares[m.de].nome,
                  titulo: pares[m.de].titulo, classe: pares[m.de].classe,
                  resumo: pares[m.de].resumo, aura: pares[m.de].aura,
                  sala: salaP, x: m.x, z: m.z });
        }
      }
      avisa({ tipo: 'pulso', id: m.de, x: m.x, z: m.z, sala: m.sala || null });
    } else if (m.t === 'chat') {
      if (pares[m.de]) pares[m.de].visto = agora();
      var nomeChat = m.nome || (pares[m.de] || {}).nome || '?';
      if (!(m.mestre === true && confiaMestre()) && reservadoAqui(nomeChat)) nomeChat = nomeDeTroca(m.de);
      avisa({ tipo: 'chat', id: m.de, nome: nomeChat,
              texto: String(m.texto || '').slice(0, 240) });
    } else if (m.t === 'troca') {
      // só o destinatário processa — a praça inteira ouve, um responde
      if (m.para === eu.id) {
        if (pares[m.de]) pares[m.de].visto = agora();
        avisa({ tipo: 'troca', de: m.de, acao: m.acao, dados: m.dados || null });
      }
    } else if (m.t === 'guilda') {
      // o envelope da GUILDA (25/08): convite e aceite — mesmo desenho da troca
      if (m.para === eu.id) {
        if (pares[m.de]) pares[m.de].visto = agora();
        avisa({ tipo: 'guilda', de: m.de, nome: (pares[m.de] || {}).nome || '?',
                acao: m.acao, dados: dadosDeGuilda(m.dados, (pares[m.de] || {}).mestre === true) });
      }
    } else if (m.t === 'tchau') {
      if (pares[m.de]) {
        delete pares[m.de];
        avisa({ tipo: 'saiu', id: m.de });
      }
    }
  }

  /* A varredura dos calados: quem não dá sinal há mais que o prazo caiu —
   * SUMICO_MS no canal de abas, SUMICO_RELE_MS pelo relé. Exposta com o
   * relógio injetável para o teste não esperar os segundos reais. */
  R.prazoSumico = function () {
    return (canal && canal.tipo === 'ws') ? R.SUMICO_RELE_MS : R.SUMICO_MS;
  };
  R._varre = function (tAgora) {
    var t = tAgora || agora();
    var prazo = R.prazoSumico();
    Object.keys(pares).forEach(function (id) {
      if (t - pares[id].visto > prazo) {
        delete pares[id];
        avisa({ tipo: 'saiu', id: id });
      }
    });
  };

  /* O TIQUE (a cada PULSO_MS): o pulso só sai se a posição ou a sala mudou
   * desde o último sinal, ou como sinal de vida — no primeiro tique depois
   * de VIDA_MS - PULSO_MS/2 calado, isto é, a cada ~6s (cabe nos 8s da
   * varredura dos clientes antigos, com folga para o relógio que atrasa).
   * Relógio injetável, como a varredura; devolve se o pulso saiu. */
  R._tique = function (tAgora) {
    if (!eu) return false;
    var t = tAgora || agora();
    var u = ultPulso;
    var sala = eu.sala || null;
    var saiu = false;
    if (!u || u.x !== eu.x || u.z !== eu.z || u.sala !== sala ||
        t - u.t >= R.VIDA_MS - R.PULSO_MS / 2) {
      manda('pulso', { x: eu.x, z: eu.z, sala: eu.sala });
      ultPulso = { x: eu.x, z: eu.z, sala: sala, t: t };
      saiu = true;
    }
    R._varre(t);
    return saiu;
  };

  // ------------------------------------------------------------- superfície
  R.entrar = function (perfil) {
    if (canal) R.sair();
    var url = urlDoRele();
    urlAtual = url;
    identidade = null;
    identTarde = false;
    identMandado = false;
    if (url) {
      canal = transporteWs(url,
        function () {           // o relé não respondeu: vida entre abas
          if (!eu) return;      // já saímos nesse meio-tempo
          canal = transporteCanal();
          apresenta();
        },
        function () { apresenta(); },    // religou (apresenta é no-op sem eu)
        vozDoRele);                      // 10/09: o anúncio do relé e a resposta do ident
    }
    if (!canal) canal = transporteCanal();
    if (!canal) return false;                                    // file:// solo
    eu = { id: perfil.id || ('anon-' + Math.random().toString(36).slice(2, 8)),
           nome: perfil.nome || '?', titulo: perfil.titulo || '',
           classe: perfil.classe || 'sumo',
           resumo: perfil.resumo || null,
           aura: perfil.aura === true,          // o Traje do Colecionador fechado
           sala: perfil.sala || null,           // 03/09: null = praça; 'garden:1' = antessala
           nuvem: perfil.nuvem || ((JOGO.Sessao && JOGO.Sessao.contaId) ? JOGO.Sessao.contaId() : null),
           x: perfil.x || 0, z: perfil.z || 0 };
    apresenta();
    timerPulso = setInterval(function () { R._tique(); }, R.PULSO_MS);
    return true;
  };

  R.sair = function () {
    if (canal) {
      manda('tchau', {});
      canal.fecha();
    }
    canal = null;
    if (timerPulso) { clearInterval(timerPulso); timerPulso = null; }
    pares = {};
    eu = null;
    ultPulso = null;
    identidade = null;
    identMandado = false;
  };

  /* O corpo local se moveu: os outros mandam o fantasma ANDAR até lá. */
  R.mover = function (x, z) {
    if (!eu) return;
    eu.x = x; eu.z = z;
    manda('alvo', { x: x, z: z });
  };

  /* O canal da troca: um verbo só, com a ação dentro — quem sabe de troca
   * é JOGO.Troca; a Rede carrega o envelope. */
  R.trocaManda = function (para, acao, dados) {
    if (!eu || !para) return false;
    manda('troca', { para: para, acao: acao, dados: dados || null });
    return true;
  };
  R.guildaManda = function (para, acao, dados) {
    if (!eu || !para) return false;
    manda('guilda', { para: para, acao: acao, dados: dados || null });
    return true;
  };
  R.meuId = function () { return eu ? eu.id : null; };

  R.falar = function (texto) {
    if (!eu) return false;
    texto = String(texto || '').trim().slice(0, 240);
    if (!texto) return false;
    manda('chat', { nome: eu.nome, texto: texto });
    return true;
  };

  /* O FILTRO DO CHAT (moderação mínima, 25/08): palavrão vira asteriscos —
   * por PALAVRA INTEIRA e sem acento ("pôrra!" cai, "computador" não, mesmo
   * carregando "puta" no meio). Puro de propósito: a página de teste chama
   * direto. A lista é curta e pesada; refinamento vem com o servidor. */
  var PALAVROES = ['merda', 'bosta', 'caralho', 'porra', 'puta', 'puto',
    'putinha', 'fdp', 'foda', 'fodase', 'fudido', 'buceta', 'cu', 'cuzao',
    'arrombado', 'arrombada', 'viado', 'vagabunda', 'desgracado', 'krl', 'vsf', 'pqp'];
  R.filtra = function (texto) {
    return String(texto || '').split(/(\s+)/).map(function (tk) {
      var miolo = tk.replace(/^[^0-9A-Za-zÀ-ÿ]+|[^0-9A-Za-zÀ-ÿ]+$/g, '');
      if (!miolo) return tk;
      var norm = miolo.toLowerCase();
      try { norm = norm.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (e) {}
      norm = norm.replace(/[^a-z0-9]/g, '');
      if (PALAVROES.indexOf(norm) < 0) return tk;
      return tk.replace(miolo, miolo.charAt(0) + new Array(miolo.length).join('*'));
    }).join('');
  };

  R.pares = function () {
    var fora = [];
    Object.keys(pares).forEach(function (id) {
      var p = pares[id];
      if (!p.nome) return;             // visto só por pulso: sem apresentação ainda
      fora.push({ id: id, nome: p.nome, titulo: p.titulo, classe: p.classe,
                  resumo: p.resumo || null, aura: p.aura === true, nuvem: p.nuvem || null,
                  mestre: p.mestre === true,
                  sala: p.sala || null, x: p.x, z: p.z });
    });
    return fora;
  };
  /* A SALA (03/09): a antessala em que EU estou — quem escuta só materializa
   * o fantasma de quem está na mesma. Mudar de sala re-apresenta (o oi leva
   * a sala nova e provoca o eco dos outros). */
  R.minhaSala = function () { return eu ? (eu.sala || null) : null; };
  R.mudaSala = function (sala) {
    if (!eu) return false;
    eu.sala = sala || null;
    apresenta();
    return true;
  };
  R.paresNaSala = function () {
    var minha = R.minhaSala();
    return R.pares().filter(function (p) { return (p.sala || null) === minha; });
  };
  R.ligado = function () { return !!canal; };
  R.transporte = function () { return canal ? canal.tipo : null; };
  /* o que o relé disse do ident desta entrada: null (nada — canal de abas,
   * relé antigo, sem sessão), false (não conferiu) ou { mestre } */
  R.identidade = function () { return identidade; };

  // aba fechando: despedida educada (a varredura pega quem não conseguir)
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', function () { R.sair(); });
  }
})();
