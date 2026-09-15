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
 *   (11/09) OS DIRIGIDOS — o grupo, o duelo, a batalha em dupla e a mensagem
 *   particular (js/core/grupo.js e js/core/coop.js falam por aqui):
 *   grupo | duelo | batalha  { de, cx, para, paraCx?, acao, dados }
 *   sussurro                 { de, cx, para, paraCx?, nome, texto }
 *   vigia                    { de, para, paraCx?, solta? }   (o relé não repassa)
 *          Só ao destino: o relé NUNCA espalha um dirigido (sem `para` ele
 *          cai; destino ausente = a voz `ausente` a quem mandou) e carimba o
 *          `cx` (o id da conexão que mandou) por cima do que o cliente pôs.
 *          O `paraCx` entrega a UMA conexão do id (as duas abas da mesma
 *          conta não se confundem). O R.dirige fatia sozinho o que passa de
 *          R.ENVELOPE_MAX (a fatia é a acao 'parte'; do outro lado a Rede
 *          remonta e entrega UM evento): acima de 8 KB o relé FECHA a
 *          conexão (1009). A troca e a guilda também são dirigidas sem recuo.
 *   A voz ganha: rele { …, cx } (o id desta conexão), ausente { para,
 *   paraCx, tipo, acao, ref } e caiu { id, cx } (a conexão vigiada fechou,
 *   com tchau ou sem). Só o relé novo (anunciou com a marca e deu `cx`) é
 *   privado; pelo relé antigo o sussurro, o grupo, o duelo e a batalha ficam
 *   recusados ('rele-antigo': ele espalharia); no canal de abas o grupo, o
 *   duelo e a batalha andam entre as abas (cada página sorteia o próprio cx,
 *   'l…') e o sussurro fica desligado.
 *   E o R.entrar ficou IDEMPOTENTE: a HUD o chama a cada tela, e cada
 *   chamada derrubava a conexão (tchau + conexão nova) — o parceiro do grupo
 *   caía a cada troca de tela.
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
  R.ENVELOPE_MAX = 6000;            // 11/09: bytes UTF-8 de um dirigido (o relé FECHA a conexão acima de 8 KB: 1009)
  R.LIMITE_RELE = 8000;             // o teto de QUALQUER outro envelope (o oi com o resumo, o chat): acima, nem sai
  R.FATIA = 5500;                   // bytes de cada pedaço do R.dirige (o JSON do pedaço, com as aspas escapadas)
  R.FATIAS_MAX = 16;                // pedaços por mensagem (~88 KB); cabem na rajada do balde geral do relé (40)
  R.FATIA_PRAZO_MS = 20000;         // a remontagem espera tanto; pedaço solto depois disto é jogado fora
  R.TEXTO_MAX = 240;                // o chat e o sussurro
  R.EMBLEMA_MAX = 64;               // 12/09: o brasão da guilda é um CÓDIGO (o TEXTO_MAX do relé, e o EMBLEMA_MAX do servidor)
  R.TAXA_SAIDA = 18;                // 11/09 (revisão): o balde de SAÍDA do ws — por segundo (o geral do relé é 20/s)
  R.RAJADA_SAIDA = 36;              //   e a rajada (a do relé é 40): o que passa espera na fila, nunca estoura lá
  R.FILA_SAIDA_MAX = 400;           //   a fila do balde, com o ws no ar (fora do ar, a fila de sempre: 50)
  R._agora = null;                  // o relógio das provas (null = Date.now)
  var FATIA_PADRAO = 5500;          // com o R.FATIA abaixo disto (R._fatia), até dado pequeno vai em pedaços
  var FATIAS_PENDENTES_MAX = 32;    // remontagens em curso ao mesmo tempo (cheio: a mais velha sai)
  var DIRIGIDOS = { grupo: 1, duelo: 1, batalha: 1 };   // os tipos do R.dirige
  var TETO_DIRIGIDO = { grupo: 1, duelo: 1, batalha: 1, sussurro: 1, troca: 1, guilda: 1, vigia: 1 };
  var RE_CX = /^[0-9a-f]{8,16}$/;   // o cx que o relé sorteia (8 hex)

  var canal = null;                 // o transporte vivo: { tipo:'canal'|'ws', envia(obj), fecha() }
  var eu = null;                    // { id, nome, titulo, classe, x, z }
  var pares = {};                   // id -> { nome, titulo, classe, x, z, visto }
  var timerPulso = null;
  var ultPulso = null;              // o último sinal de presença que saiu: { x, z, sala, t }
  var urlAtual = null;              // o relé desta entrada (o token só vai ao da própria origem)
  var identidade = null;            // o que o relé disse do ident: null (nada), false (não conferiu) ou { mestre }
  var identTarde = false;           // o anúncio chegou depois do oi (rede lenta): o ident-ok reapresenta
  var identMandado = false;         // esta conexão mandou o ident: só então a resposta do relé vale
  var tokenIdent = null;            // 13/09: o token que foi no ident (a queda por outro aparelho compara)
  R.FECHA_DERRUBADO = 4001;         // 13/09: o código com que o relé fecha a conta que entrou em outro aparelho (rele_ident.py)
  var cxRele = null;                // 11/09: o id DESTA conexão, do anúncio do relé novo (null: religando, canal, antigo)
  var releNovo = false;             // este transporte já ouviu um anúncio com cx (o relé que não espalha dirigidos)
  var cxLocal = null;               // no canal de abas não há relé: o cx é da página ('l' + 7)
  var ouvintes = {};                // tipo -> [fn] (R.ouvir); '*' = todos. Sobrevivem a R.sair/R.entrar
  var vistos = {};                  // id -> quando chegou o último envelope dele, de qualquer tipo (R.visto)
  var fatias = {}, nFatias = 0;     // as remontagens em curso (o R.dirige do outro lado)
  var refsFatia = {};               // ref de uma fatia MINHA -> { ref, acao, t, avisado } (o `ausente` fala da conversa, não do pedaço)
  var vigiados = {};                // id -> { cx } que eu vigio (o vigia vale por conexão: ao religar, sai de novo)
  var recusa = null;                // o porquê do último false do R.dirige/R.sussurrar (R.ultimaRecusa)
  var provaTarde = false;           // 11/09 (achado 17): a prova saiu depois da fila (anúncio atrasado): o oi sai de novo

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
  /* O SEGREDO DO APARELHO (11/09, achado 17 da revisão do multijogador). Quem
   * joga sem conta conferida tem o id do DB local — que vai em todo oi e
   * pulso —, e o relé aceitava qualquer conexão nova com esse `de`: quem o
   * copiasse ouvia o que era dirigido a ele (o sussurro, o convite, a
   * `volta`) e respondia por ele. Agora cada navegador guarda um segredo (32
   * hex, localStorage, o mesmo para todas as contas da máquina) e o manda SÓ
   * ao relé que se anunciou com cx, logo depois do anúncio, num envelope
   * próprio ({t:'prova'}) que o relé nunca repassa nem grava: ele prende o id
   * a este aparelho. Sem localStorage, o segredo vale enquanto a página
   * estiver aberta (e o id do DB, que mora no mesmo lugar, também). */
  var CHAVE_PROVA = 'soterra-rede-prova-v1';
  var provaMem = null;
  function segredoNovo() {
    var s = '';
    try {
      var a = new Uint32Array(4);
      window.crypto.getRandomValues(a);
      for (var i = 0; i < a.length; i++) s += ('00000000' + a[i].toString(16)).slice(-8);
    } catch (e) { s = ''; }
    while (s.length < 32) s += Math.floor(Math.random() * 16).toString(16);
    return s.slice(0, 32);
  }
  function provaDoAparelho() {
    if (provaMem) return provaMem;
    var s = null;
    try { s = window.localStorage.getItem(CHAVE_PROVA); } catch (e) { s = null; }
    if (typeof s !== 'string' || !/^[0-9a-f]{32}$/.test(s)) {
      s = segredoNovo();
      try { window.localStorage.setItem(CHAVE_PROVA, s); } catch (e) {}
    }
    provaMem = s;
    return s;
  }
  function transporteWs(url, aoFalhar, aoReligar, aoRele, aoCair, aoAnunciou, aoDerrubado) {
    var ws = null, abriu = false, fechado = false, fila = [];
    var pronto = false, anunciou = false, espera = null, liberou = false;
    /* 11/09 (revisão): O BALDE DE SAÍDA — o desenho do balde geral do relé
     * (20/s, rajada 40), um pouco abaixo dele. O que passa espera na fila e
     * sai no ritmo: lá nunca estoura (200 descartes em 10 s DESLIGAM a
     * conexão) — e ninguém consegue, com pedidos, fazer esta aba estourar. */
    var saldo = R.RAJADA_SAIDA, saldoT = 0, drenando = null;
    function ficha() {
      var t = Date.now();
      if (saldoT) saldo = Math.min(R.RAJADA_SAIDA, saldo + Math.max(0, t - saldoT) * R.TAXA_SAIDA / 1000);
      saldoT = t;
      if (saldo < 1) return false;
      saldo -= 1;
      return true;
    }
    function aberto() { return !!(ws && ws.readyState === 1 && pronto); }
    function drena() {
      drenando = null;
      while (fila.length && aberto()) {
        if (!ficha()) { agendaDrena(); return; }
        try { ws.send(fila.shift()); } catch (e) { break; }
      }
    }
    function agendaDrena() { if (!drenando && fila.length) drenando = setTimeout(drena, 60); }
    function libera(primeira) {
      if (pronto) return;
      pronto = true;
      liberou = true;
      clearTimeout(espera);
      // 11/09 (revisão): numa RECONEXÃO, o que os ouvintes do religou mandam
      // (o oi de novo, a `volta` do grupo com o cx novo, o `pede`) sai ANTES do
      // que esperava na fila — senão o outro recebia os lances guardados com o
      // cx novo antes da `volta`, e os recusava: o último lance do turno sumia
      var velha = fila;
      fila = [];
      if (!primeira && aoReligar) aoReligar();
      if (anunciou && aoAnunciou) aoAnunciou(primeira);   // 11/09: o cx (a primeira) ou o religou
      fila = fila.concat(velha);
      drena();
    }
    function conecta(deNovo) {
      var este, primeiraDesta = false, n = marca(), caiu = false;
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
        if (ws !== este || fechado) return;        // 11/09: a conexão que caiu (ou saiu) não fala mais
        var m = null;
        try { m = JSON.parse(String(ev.data)); } catch (e) { return; }
        if (m && typeof m === 'object' && !m.de) {
          // a voz do relé: o anúncio (só com a marca desta conexão) e,
          // depois dele, a resposta do ident, o ausente e o caiu (11/09)
          if (m.t === 'rele' && !anunciou && m.n === n) {
            anunciou = true;
            var tarde = pronto;                      // a fila já saiu sem ele (o anúncio atrasou)
            // o que vai ANTES da fila: o ident e, desde 11/09, a prova do aparelho
            var fora = aoRele ? aoRele(m, tarde) : null;
            fora = fora ? [].concat(fora) : [];
            for (var q = 0; q < fora.length; q++) { try { ws.send(JSON.stringify(fora[q])); } catch (e) {} }
            if (!tarde) libera(primeiraDesta);
            else if (aoAnunciou) aoAnunciou(primeiraDesta);
          } else if (anunciou && m.t !== 'rele' && aoRele) {
            aoRele(m, false);
          }
          return;
        }
        aoMensagem({ data: m });
      };
      ws.onclose = ws.onerror = function (ev) {
        // 11/09: o erro e o fechamento da MESMA conexão chegam os dois — e
        // cada um religava: eram duas conexões vivas com o mesmo id
        if (caiu) return;
        caiu = true;
        if (fechado || ws !== este) return;
        // 13/09 (um aparelho só): o relé fechou com o código da conta que entrou
        // em outro aparelho. Se a Sessao derrubar o jogo, a Rede sai (fechado) e
        // não religa; se ela adotou um token novo, religa como sempre, com ele
        if (ev && ev.code === R.FECHA_DERRUBADO && aoDerrubado) {
          aoDerrubado();
          if (fechado) return;
        }
        if (!abriu) { falha(); return; }
        pronto = false;
        clearTimeout(espera);
        if (aoCair) aoCair();
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
      envia: function (o, s) {
        if (typeof s !== 'string') { try { s = JSON.stringify(o); } catch (e) { return; } }
        if (aberto() && !fila.length && ficha()) { try { ws.send(s); } catch (e) {} return; }
        // no ar, o balde só atrasa; fora do ar, a fila guarda pouco, como sempre
        // (o que importa sai de novo ao religar)
        if (fila.length < (aberto() ? R.FILA_SAIDA_MAX : 50)) fila.push(s);
        agendaDrena();
      },
      fecha: function () {
        fechado = true;
        clearTimeout(espera);
        try { if (ws) ws.close(); } catch (e) {}
      },
      anunciou: function () { return anunciou; },  // o relé desta conexão se anunciou (com a marca)
      liberou: function () { return liberou; },    // a fila já saiu alguma vez (com anúncio ou sem: o relé antigo)
      estado: function () { return (ws && ws.readyState === 1 && pronto) ? 'ws' : 'religando'; },
      derruba: function () {                        // a prova (R._derruba): fecha SEM tchau, a aba morta; religa sozinho
        if (fechado || !ws) return false;
        pronto = false;
        try { ws.close(); } catch (e) { return false; }
        return true;
      }
    };
  }

  /* A HUD pendura aqui UM ouvinte de eventos já digeridos:
   *   { tipo:'entrou', id, nome, titulo, classe, x, z }
   *   { tipo:'alvo',   id, x, z }
   *   { tipo:'pulso',  id, x, z }
   *   { tipo:'chat',   id, nome, texto }
   *   { tipo:'saiu',   id }
   * (11/09) e, para quem pendura por tipo (R.ouvir, vários por tipo; '*' =
   * todos — o R.aoEvento também recebe tudo):
   *   { tipo:'grupo'|'duelo'|'batalha', de, cx, acao, dados }  (fatias já remontadas)
   *   { tipo:'sussurro', de, cx, nome, texto, mestre }
   *   { tipo:'ausente', para, paraCx, tipoMsg, acao, ref }
   *   { tipo:'caiu', id, cx }       a conexão vigiada fechou
   *   { tipo:'cx', cx }             a primeira conexão anunciada
   *   { tipo:'religou', cx }        conexão nova depois de uma queda (depois do anúncio novo) */
  R.aoEvento = null;

  function avisa(ev) {
    var lst = (ouvintes[ev.tipo] || []).concat(ouvintes['*'] || []);
    for (var i = 0; i < lst.length; i++) { try { lst[i](ev); } catch (e) {} }
    if (R.aoEvento) { try { R.aoEvento(ev); } catch (e) {} }
  }
  /* O CINTO (11/09): acima de 8 KB o relé FECHA a conexão (1009) — e o
   * cliente religava em laço. O dirigido vai até R.ENVELOPE_MAX (o R.dirige
   * fatia antes); o resto até R.LIMITE_RELE. Em bytes UTF-8, que é o que o
   * relé conta. Devolve se saiu. */
  function bytesUtf8(s) {
    var n = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 0x80) n += 1;
      else if (c < 0x800) n += 2;
      else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length &&
               s.charCodeAt(i + 1) >= 0xDC00 && s.charCodeAt(i + 1) <= 0xDFFF) { n += 4; i++; }
      else n += 3;
    }
    return n;
  }
  function serializa(tipo, corpo) {
    corpo.t = tipo;
    corpo.de = eu.id;
    try { return JSON.stringify(corpo); } catch (e) { return null; }
  }
  function cabe(s, teto) { return s !== null && s.length <= teto && bytesUtf8(s) <= teto; }
  function manda(tipo, corpo) {
    if (!canal || !eu) return false;
    corpo = corpo || {};
    var s = serializa(tipo, corpo);
    if (!cabe(s, TETO_DIRIGIDO[tipo] ? R.ENVELOPE_MAX : R.LIMITE_RELE)) {
      try { console.warn('Rede: o envelope "' + tipo + '" passou do teto e não saiu (o relé fecharia a conexão)'); } catch (e) {}
      return false;
    }
    canal.envia(corpo, s);
    return true;
  }
  /* O `oi` de apresentação — sai na entrada, na queda para o canal e na
   * reconexão do ws (para os pares, um `oi` repetido é só um re-conhece). */
  /* 13/09: está numa tela de batalha? (solo, grupo ou duelo — a mesma tela) */
  function emLuta() {
    try { return !!(JOGO.Game && JOGO.Game.screen === 'battle'); } catch (e) { return false; }
  }
  /* 14/09, A ZONA (o Campo de PvP): a praça e o Campo são a mesma sala do relé, mas cada um só vê os
   * fantasmas da sua zona (o hub3d filtra por `zona`). Quem diz é o Hub (Hub.naCampo); sem ele, 'praca'.
   * No Campo a aparência (`classe`) que a HUD põe é a do 1º herói da dupla — o 2º não viaja em nada. */
  function zonaAtual() {
    try { return (JOGO.Hub && typeof JOGO.Hub.naCampo === 'function' && JOGO.Hub.naCampo()) ? 'campo' : 'praca'; }
    catch (e) { return 'praca'; }
  }
  function zonaDe(v) { return v === 'campo' ? 'campo' : 'praca'; }
  R.zona = zonaAtual;
  function cartao(para) {
    if (eu) eu.zona = zonaAtual();
    var c = { v: R.VERSAO, nome: eu.nome, titulo: eu.titulo, classe: eu.classe,
              resumo: eu.resumo, aura: eu.aura, x: eu.x, z: eu.z, sala: eu.sala, nuvem: eu.nuvem,
              luta: emLuta(), zona: eu.zona };
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
  function agora() { return (typeof R._agora === 'function') ? R._agora() : Date.now(); }

  /* A VOZ DO RELÉ (10/09): o anúncio diz se ele confere identidade; se sim,
   * há sessão no cartório e o relé é o da própria origem (ou estamos em
   * casa), o ident sai na frente da fila. Se o anúncio chegou DEPOIS do oi
   * (rede lenta), o ident-ok reapresenta — o oi novo leva o carimbo. */
  function vozDoRele(m, tarde) {
    if (m.t === 'rele') {
      // 11/09: o id desta conexão (o relé o carimba nos dirigidos que ela manda)
      cxRele = (typeof m.cx === 'string' && RE_CX.test(m.cx)) ? m.cx : null;
      if (cxRele) releNovo = true;
      identidade = null;
      var permitido = !!(eu && R._identPermitido(urlAtual));
      var tk = (m.ident === true && permitido) ? tokenDaSessao() : null;
      identMandado = !!tk;
      tokenIdent = tk;                   // 13/09: o token desta conexão (a Sessao compara ao do localStorage)
      identTarde = !!(tk && tarde);
      var fora = tk ? [{ t: 'ident', de: eu.id, token: tk }] : [];
      // 11/09 (achado 17): a PROVA DO APARELHO, que prende o id sem conta a
      // este navegador. Só ao relé que se anunciou com cx (o que a entende e
      // nunca a repassa: o de antes a espalharia pela sala) e que é o da
      // própria origem, ou em casa — como o token: um ?rede= de fora a levaria
      // embora. Vai depois do ident e antes da fila
      if (cxRele && permitido) fora.push({ t: 'prova', de: eu.id, prova: provaDoAparelho() });
      provaTarde = !!(cxRele && permitido && tarde);
      return fora.length ? fora : null;
    }
    // 13/09 (um aparelho só): a conta desta conexão entrou em outro aparelho. Só
    // vale para a conexão que mandou o token (o relé só o manda a ela)
    if (m.t === 'derrubado') { if (identMandado) derrubadoPeloRele(m); return null; }
    if (m.t === 'ausente') { vozAusente(m); return null; }     // 11/09
    // 13/09: o online dos amigos e inimigos (JOGO.Amigos) e a recusa do chat da guilda
    if (m.t === 'amigos') {
      avisa({ tipo: 'amigos', lista: Array.isArray(m.lista) ? m.lista.slice(0, 200) : [], motivo: txt(m.motivo) });
      return null;
    }
    if (m.t === 'gchat-nao') { avisa({ tipo: 'gchat-nao', motivo: txt(m.motivo) }); return null; }
    if (m.t === 'caiu') { vozCaiu(m); return null; }
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
  /* A queda vai ao ponto único (JOGO.Sessao.derrubada): ela confere se há um
   * token novo da mesma conta neste navegador antes de derrubar, e derrubando
   * chama o R.sair (sem religar). */
  function derrubadoPeloRele(m) {
    var S = JOGO.Sessao;
    if (!S || typeof S.derrubada !== 'function') { R.sair(); return; }
    S.derrubada((m && m.motivo) || 'outro-aparelho', tokenIdent);
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
  /* O BRASÃO DA GUILDA NÃO É NOME (12/09). Desde que o escudo virou vetor, o
   * campo `emblema` guarda um CÓDIGO — "shield|2|#2d7a3a|#c9a227|#f5d76e|
   * tree|0|#1d3f8a", 45 letras. Esta régua reprova qualquer texto com mais de
   * R.NOME_MAX (24) sem nem olhar, e está certa nisso; o efeito colateral era
   * que o brasão de todo mundo chegava ao vizinho trocado pela bandeirinha ⚑
   * — a guilda aparecia com o nome certo e o escudo errado. Foi o defeito que
   * o dono viu com duas janelas abertas. (O relé não tinha esse problema: o
   * TEXTO_MAX dele é 64 e a regra de nomes do servidor não reprova o código.)
   *
   * A exceção é ESTREITA de propósito: passa só o que casa com a GRAMÁTICA do
   * brasão — shield, um dígito de forma, três cores em hexadecimal, um símbolo
   * de [a-z-] e, opcionalmente, a divisão e a 2ª cor. Texto livre não entra
   * por aqui, então ninguém escreve 'GM' no campo do emblema e passa; o que
   * não casar volta para a régua de nome de sempre. E a palavra final continua
   * sendo do servidor, que julga o mesmo campo com a régua dele. */
  var RE_BRASAO = /^shield\|[0-9]\|#[0-9a-fA-F]{3,8}\|#[0-9a-fA-F]{3,8}\|#[0-9a-fA-F]{3,8}\|[a-z-]{1,12}(\|[0-9]\|#[0-9a-fA-F]{3,8})?$/;
  R.ehBrasao = function (v) {
    return typeof v === 'string' && v.length <= R.EMBLEMA_MAX && RE_BRASAO.test(v);
  };
  function reservadoAqui(s) {
    if (s === null || s === undefined || s === '') return false;
    if (R.ehBrasao(s)) return false;          // brasão vetorial: passa inteiro
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
    var zonaAntes = atual ? zonaDe(atual.zona) : 'praca';
    var mestre = m.mestre === true && confiaMestre();
    var vit = vitrine(m, mestre);             // 10/09: o nome reservado de quem não é Mestre sai trocado
    pares[m.de] = { nome: vit.nome || '?', titulo: vit.titulo || '',
                    classe: classeDe(m.classe, mestre),   // 10/09: o corpo do Mestre só no Mestre
                    resumo: vit.resumo || null,
                    mestre: mestre,
                    nuvem: m.nuvem || null,           // a conta no cartório (10/09)
                    aura: m.aura === true,
                    sala: m.sala || null,       // 03/09: a antessala em que ele está (null = praça)
                    zona: zonaDe(m.zona),       // 14/09: 'praca' | 'campo' (o Campo de PvP)
                    luta: m.luta === true,      // 14/09: numa batalha (o Campo não ataca quem já luta)
                    x: m.x || 0, z: m.z || 0, visto: agora() };
    if (novo) {
      avisa({ tipo: 'entrou', id: m.de, nome: pares[m.de].nome,
              titulo: pares[m.de].titulo, classe: pares[m.de].classe,
              resumo: pares[m.de].resumo, aura: pares[m.de].aura,
              sala: pares[m.de].sala, mestre: pares[m.de].mestre, zona: pares[m.de].zona,
              x: pares[m.de].x, z: pares[m.de].z });
    } else if (salaAntes !== pares[m.de].sala || zonaAntes !== pares[m.de].zona) {
      // trocou de sala (desceu, subiu, saiu) ou de zona (entrou no Campo): quem escuta some ou mostra o corpo
      avisa({ tipo: 'mudouSala', id: m.de, nome: pares[m.de].nome,
              titulo: pares[m.de].titulo, classe: pares[m.de].classe,
              resumo: pares[m.de].resumo, aura: pares[m.de].aura, zona: pares[m.de].zona,
              sala: pares[m.de].sala, x: pares[m.de].x, z: pares[m.de].z });
    }
    return novo;
  }

  function aoMensagem(ev) {
    var m = ev && ev.data;
    if (!m || !m.t || !m.de || !eu || m.de === eu.id) return;
    // 11/09: R.visto — qualquer envelope dele renova (menos o tchau: a despedida não é sinal de vida)
    if (m.t !== 'tchau') vistos[m.de] = agora();
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
        pares[m.de].luta = m.luta === true;                // 14/09
        var salaP = m.sala || null;
        // 14/09: o pulso sem `zona` (a página de antes) não muda a zona que o oi disse
        var zonaP = (m.zona === undefined) ? zonaDe(pares[m.de].zona) : zonaDe(m.zona);
        if (pares[m.de].nome && ((pares[m.de].sala || null) !== salaP || zonaDe(pares[m.de].zona) !== zonaP)) {
          pares[m.de].sala = salaP;
          pares[m.de].zona = zonaP;
          avisa({ tipo: 'mudouSala', id: m.de, nome: pares[m.de].nome,
                  titulo: pares[m.de].titulo, classe: pares[m.de].classe,
                  resumo: pares[m.de].resumo, aura: pares[m.de].aura, zona: zonaP,
                  sala: salaP, x: m.x, z: m.z });
        }
      }
      avisa({ tipo: 'pulso', id: m.de, x: m.x, z: m.z, sala: m.sala || null,
              zona: pares[m.de] ? zonaDe(pares[m.de].zona) : 'praca' });
    } else if (m.t === 'chat') {
      if (pares[m.de]) pares[m.de].visto = agora();
      var nomeChat = m.nome || (pares[m.de] || {}).nome || '?';
      if (!(m.mestre === true && confiaMestre()) && reservadoAqui(nomeChat)) nomeChat = nomeDeTroca(m.de);
      avisa({ tipo: 'chat', id: m.de, nome: nomeChat,
              texto: String(m.texto || '').slice(0, 240) });
    } else if (m.t === 'gchat') {
      // 13/09 (dono: "/g manda mensagem pra guild"): o relé novo entrega só aos
      // membros, conferidos pela CONTA no banco — no canal de abas qualquer aba ouviria
      if (!R.privado()) return;
      var textoG = String(m.texto === undefined || m.texto === null ? '' : m.texto).trim().slice(0, 240);
      if (!textoG) return;
      if (pares[m.de]) pares[m.de].visto = agora();
      var nomeG = m.nome || (pares[m.de] || {}).nome || '?';
      if (!(m.mestre === true && confiaMestre()) && reservadoAqui(nomeG)) nomeG = nomeDeTroca(m.de);
      avisa({ tipo: 'gchat', id: m.de, nome: nomeG, texto: textoG,
              guilda: (typeof m.guilda === 'string') ? m.guilda.slice(0, 24) : '' });
    } else if (m.t === 'troca') {
      // só o destinatário processa — a praça inteira ouve, um responde
      if (paraMim(m)) {
        if (pares[m.de]) pares[m.de].visto = agora();
        avisa({ tipo: 'troca', de: m.de, acao: m.acao, dados: m.dados || null });
      }
    } else if (m.t === 'guilda') {
      // o envelope da GUILDA (25/08): convite e aceite — mesmo desenho da troca
      if (paraMim(m)) {
        if (pares[m.de]) pares[m.de].visto = agora();
        avisa({ tipo: 'guilda', de: m.de, nome: (pares[m.de] || {}).nome || '?',
                acao: m.acao, dados: dadosDeGuilda(m.dados, (pares[m.de] || {}).mestre === true) });
      }
    } else if (DIRIGIDOS[m.t]) {
      // 11/09: o grupo, o duelo e a batalha em dupla (js/core/grupo.js,
      // js/core/coop.js). O relé só entrega ao destino; no canal de abas
      // todas as abas ouvem, e as outras largam aqui (paraMim)
      if (!paraMim(m) || !dirigidoConfiavel()) return;
      if (pares[m.de]) pares[m.de].visto = agora();
      var acaoD = (typeof m.acao === 'string') ? m.acao.slice(0, 24) : '';
      if (!acaoD) return;
      var cxD = (typeof m.cx === 'string' && m.cx.length <= 16) ? m.cx : null;
      if (acaoD === 'parte') { remonta(m, cxD); return; }
      avisa({ tipo: m.t, de: m.de, cx: cxD, acao: acaoD, dados: (m.dados === undefined) ? null : m.dados });
    } else if (m.t === 'sussurro') {
      // 11/09: a MENSAGEM PARTICULAR — só pelo relé novo, que não espalha (no
      // canal de abas qualquer aba ouviria). O nome vem do registro (já
      // passou pela regra no oi/eco); sem registro, do envelope, com a regra
      // do chat — o relé novo já julgou, e aqui vale contra o antigo também
      if (!paraMim(m) || !R.privado()) return;
      var textoS = String(m.texto === undefined || m.texto === null ? '' : m.texto).trim().slice(0, R.TEXTO_MAX);
      if (!textoS) return;
      if (pares[m.de]) pares[m.de].visto = agora();
      var mestreS = m.mestre === true && confiaMestre();
      var regS = pares[m.de];
      var nomeS = (regS && regS.nome) ? regS.nome
                : (mestreS && typeof m.nome === 'string' && m.nome) ? m.nome.slice(0, R.NOME_MAX)
                : R.nomeDe(m.de, m.nome);
      avisa({ tipo: 'sussurro', de: m.de, cx: (typeof m.cx === 'string') ? m.cx : null,
              nome: nomeS, texto: textoS, mestre: mestreS });
    } else if (m.t === 'tchau') {
      if (pares[m.de]) {
        delete pares[m.de];
        // 11/09 (revisão): no canal de abas o tchau traz o cx da PÁGINA — quem
        // escuta sabe se foi a aba do par ou outra aba da mesma conta. Pelo
        // relé não: o relé não carimba o tchau (e o de uma aba com outra viva
        // nem se espalha mais)
        var cxT = (canal && canal.tipo === 'canal' && typeof m.cx === 'string' && m.cx.length <= 16) ? m.cx : null;
        avisa(cxT ? { tipo: 'saiu', id: m.de, cx: cxT } : { tipo: 'saiu', id: m.de });
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
    var luta = emLuta();           // 13/09: os amigos veem "em batalha" (o relé guarda o último)
    var saiu = false;
    var zona = zonaAtual();        // 14/09: entrou ou saiu do Campo — o oi leva a zona à sala inteira
    if (zona !== eu.zona) {
      apresenta();
      saiu = true;
    }
    if (!u || u.x !== eu.x || u.z !== eu.z || u.sala !== sala || u.luta !== luta ||
        t - u.t >= R.VIDA_MS - R.PULSO_MS / 2) {
      manda('pulso', { x: eu.x, z: eu.z, sala: eu.sala, luta: luta, zona: eu.zona });
      ultPulso = { x: eu.x, z: eu.z, sala: sala, luta: luta, t: t };
      saiu = true;
    }
    R._varre(t);
    limpaFatias(t);
    return saiu;
  };

  // ------------------------------------------------------------- superfície
  /* R.entrar é IDEMPOTENTE (11/09): a HUD o chama a cada tela (buildHub), e
   * antes cada chamada derrubava a conexão — tchau, conexão nova, oi —, o que
   * trocava o `cx` e tirava o parceiro do grupo a cada tela. Com a conexão
   * viva e o MESMO id, só o que mudou viaja: a sala nova (R.mudaSala) ou o
   * perfil novo (um oi de re-apresentação); nada mudou, nada sai. Id
   * diferente é conexão nova, como antes — e também quem caiu para o canal
   * de abas porque o relé não respondeu (tenta o relé de novo, como antes). */
  R.entrar = function (perfil) {
    perfil = perfil || {};
    // 13/09 (um aparelho só): o jogo desta aba caiu — a Rede não liga de novo
    if (JOGO.Sessao && JOGO.Sessao.derrubadaJa && JOGO.Sessao.derrubadaJa()) return false;
    if (canal && eu && perfil.id && perfil.id === eu.id && !(urlDoRele() && canal.tipo !== 'ws')) {
      return atualiza(perfil);
    }
    if (canal) R.sair();
    var url = urlDoRele();
    urlAtual = url;
    identidade = null;
    identTarde = false;
    identMandado = false;
    cxRele = null;
    releNovo = false;
    provaTarde = false;
    cxLocal = 'l' + sorteio(7);
    if (url) {
      canal = transporteWs(url,
        function () {           // o relé não respondeu: vida entre abas
          if (!eu) return;      // já saímos nesse meio-tempo
          canal = transporteCanal();
          apresenta();
        },
        function () { apresenta(); },    // religou (apresenta é no-op sem eu)
        vozDoRele,                       // 10/09: o anúncio do relé e a resposta do ident
        function () { cxRele = null; },  // 11/09: caiu — o cx velho morreu com a conexão
        aoAnunciar,                      // 11/09: a conexão anunciada (o cx; depois de uma queda, o religou)
        function () { if (identMandado) derrubadoPeloRele({ motivo: 'outro-aparelho' }); });   // 13/09: fechou com 4001
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
      manda('tchau', carimboLocal({}));      // no canal de abas, com o cx da página
      canal.fecha();
    }
    canal = null;
    if (timerPulso) { clearInterval(timerPulso); timerPulso = null; }
    pares = {};
    eu = null;
    ultPulso = null;
    identidade = null;
    identMandado = false;
    tokenIdent = null;                // 13/09
    cxRele = null;                    // 11/09 (os ouvintes do R.ouvir ficam)
    provaTarde = false;
    releNovo = false;
    fatias = {};
    nFatias = 0;
    refsFatia = {};
    vigiados = {};
    vistos = {};
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
    return manda('troca', carimboLocal({ para: para, acao: acao, dados: dados || null }));
  };
  R.guildaManda = function (para, acao, dados) {
    if (!eu || !para) return false;
    return manda('guilda', carimboLocal({ para: para, acao: acao, dados: dados || null }));
  };
  R.meuId = function () { return eu ? eu.id : null; };

  // ------------------------------------------------------ os dirigidos (11/09)
  /* Quem fala por aqui: js/core/grupo.js (o grupo, o duelo, a mensagem
   * particular) e js/core/coop.js (a batalha em dupla); a Rede só carrega. */
  function sorteio(k) {
    var s = '';
    while (s.length < k) s += Math.random().toString(36).slice(2);
    return s.slice(0, k);
  }
  function txt(v) { return (typeof v === 'string' && v) ? v : null; }
  function recusou(motivo) { recusa = motivo; return false; }
  /* é para mim? Pelo relé ele já só entrega ao destino; no canal de abas
   * toda aba ouve, e as outras largam aqui */
  function paraMim(m) {
    return m.para === eu.id && (!m.paraCx || m.paraCx === R.meuCx());
  }
  /* no canal de abas o cx é da página; pelo relé, é ele que carimba */
  function carimboLocal(c) {
    if (canal && canal.tipo === 'canal' && cxLocal) c.cx = cxLocal;
    return c;
  }
  /* o dirigido que chega por um relé que não se anunciou com cx (o antigo,
   * que repassa tudo a todos) não vale: o cx dele é o que o par quis pôr */
  function dirigidoConfiavel() {
    return !!canal && (canal.tipo === 'canal' || releNovo);
  }

  /* R.ouvir(tipo, fn) → desliga(): vários ouvintes por tipo; '*' = todos. */
  R.ouvir = function (tipo, fn) {
    if (typeof tipo !== 'string' || !tipo || typeof fn !== 'function') return function () {};
    (ouvintes[tipo] = ouvintes[tipo] || []).push(fn);
    var ligado = true;
    return function () {
      if (!ligado) return;
      ligado = false;
      var l = ouvintes[tipo] || [];
      var i = l.indexOf(fn);
      if (i >= 0) l.splice(i, 1);
    };
  };
  /* PRIVADO = pelo relé novo, ligado agora: ele se anunciou com a marca
   * desta conexão, deu o cx e é o da própria origem (ou em casa) — o único
   * que garante que um dirigido não se espalha */
  R.privado = function () {
    return !!(canal && canal.tipo === 'ws' && cxRele && canal.anunciou && canal.anunciou() &&
              canal.estado && canal.estado() === 'ws' && R._identPermitido(urlAtual));
  };
  R.meuCx = function () {
    if (!canal) return null;
    if (canal.tipo === 'canal') return cxLocal;
    return (canal.estado && canal.estado() === 'ws') ? cxRele : null;
  };
  R.estadoConexao = function () {
    if (!canal) return 'off';
    if (canal.tipo === 'canal') return 'canal';
    return canal.estado ? canal.estado() : 'ws';
  };
  R.ultimaRecusa = function () { return recusa; };
  R.visto = function (id) { return (id && vistos[id]) || 0; };
  /* o nome de alguém: o registro (já passou pela regra); sem registro, a
   * sugestão, se não for reservada; senão 'Aventureiro-xxxx' */
  R.nomeDe = function (id, sugestao) {
    var p = id ? pares[id] : null;
    if (p && p.nome) return p.nome;
    var s = (typeof sugestao === 'string') ? sugestao.trim() : '';
    if (s && !reservadoAqui(s)) return s;
    return nomeDeTroca(id);
  };

  /* Os pedaços de `texto` cujo JSON (com as aspas escapadas e os bytes
   * UTF-8) cabe em `alvo`; null se passar de R.FATIAS_MAX. Nunca parte um
   * emoji (o par de substitutos) ao meio. */
  function fatiar(texto, alvo) {
    var partes = [], p = 0;
    while (p < texto.length) {
      var len = Math.min(texto.length - p, alvo);
      for (;;) {
        var fim = p + len;
        if (fim < texto.length && fim - p > 1) {
          var c = texto.charCodeAt(fim - 1);
          if (c >= 0xD800 && c <= 0xDBFF) fim--;
        }
        var peca = texto.slice(p, fim);
        var custo = bytesUtf8(JSON.stringify(peca));
        if (custo <= alvo || fim - p <= 1) { partes.push(peca); p = fim; break; }
        len = Math.max(1, Math.floor((fim - p) * alvo / custo) - 1);
      }
      if (partes.length > R.FATIAS_MAX) return null;
    }
    return partes.length ? partes : [''];
  }
  function lembraRef(ref, dados, acao) {
    var t = agora(), orig = null;
    if (dados && typeof dados === 'object') {
      var ks = ['ref', 'gid', 'did', 'bid'];
      for (var i = 0; i < ks.length && !orig; i++) {
        if (typeof dados[ks[i]] === 'string' && dados[ks[i]]) orig = dados[ks[i]].slice(0, 24);
      }
    }
    for (var k in refsFatia) {
      if (Object.prototype.hasOwnProperty.call(refsFatia, k) && t - refsFatia[k].t > 60000) delete refsFatia[k];
    }
    refsFatia[ref] = { ref: orig, acao: acao, t: t, avisado: false };
  }
  /* R.dirige(tipo, para, acao, dados, { cx: paraCx }) → true|false — o
   * envelope do grupo, do duelo e da batalha. Grande demais para um
   * envelope, vai em pedaços (a acao 'parte', até R.FATIAS_MAX); do outro
   * lado a Rede remonta e entrega UM evento. false → R.ultimaRecusa():
   * 'tipo', 'sem-conexao', 'sem-para', 'rele-antigo' (ele espalharia o
   * dirigido quando o destino some) ou 'grande'. */
  R.dirige = function (tipo, para, acao, dados, opts) {
    if (!DIRIGIDOS[tipo] || typeof acao !== 'string' || !acao || acao.length > 24 || acao === 'parte') return recusou('tipo');
    if (!canal || !eu) return recusou('sem-conexao');
    if (typeof para !== 'string' || !para || para.length > 80) return recusou('sem-para');
    if (canal.tipo === 'ws' && !releNovo) {
      return recusou((canal.liberou && canal.liberou()) ? 'rele-antigo' : 'sem-conexao');
    }
    var paraCx = (opts && typeof opts.cx === 'string' && opts.cx) ? opts.cx : null;
    if (dados === undefined) dados = null;
    function envelope(a, d) {
      var c = carimboLocal({ para: para, acao: a, dados: d });
      if (paraCx) c.paraCx = paraCx;
      return c;
    }
    var inteiro = envelope(acao, dados);
    var s = serializa(tipo, inteiro);
    if (s === null) return recusou('tipo');
    if (cabe(s, (R.FATIA < FATIA_PADRAO) ? R.FATIA : R.ENVELOPE_MAX)) {
      canal.envia(inteiro, s);
      recusa = null;
      return true;
    }
    var pedacos = fatiar(JSON.stringify(dados), Math.max(1, Math.min(R.FATIA, R.ENVELOPE_MAX - 400)));
    if (!pedacos) return recusou('grande');
    var ref = sorteio(8), fora = [];
    for (var i = 0; i < pedacos.length; i++) {
      var c = envelope('parte', { ref: ref, i: i, n: pedacos.length, a: acao, s: pedacos[i] });
      var sc = serializa(tipo, c);
      if (!cabe(sc, R.ENVELOPE_MAX)) return recusou('grande');
      fora.push([c, sc]);
    }
    lembraRef(ref, dados, acao);
    for (var j = 0; j < fora.length; j++) canal.envia(fora[j][0], fora[j][1]);
    recusa = null;
    return true;
  };
  /* a remontagem por (tipo, de, cx, ref), com prazo de R.FATIA_PRAZO_MS */
  function remonta(m, cxDe) {
    var d = m.dados;
    if (!d || typeof d !== 'object') return;
    var ref = txt(d.ref), a = txt(d.a), s = d.s, n = d.n, i = d.i;
    if (!ref || ref.length > 24 || !a || a.length > 24 || a === 'parte' || typeof s !== 'string') return;
    if (typeof n !== 'number' || n !== Math.floor(n) || n < 1 || n > R.FATIAS_MAX) return;
    if (typeof i !== 'number' || i !== Math.floor(i) || i < 0 || i >= n) return;
    var t = agora();
    limpaFatias(t);
    var k = m.t + '|' + m.de + '|' + (cxDe || '') + '|' + ref;
    var f = fatias[k];
    if (!f) {
      if (nFatias >= FATIAS_PENDENTES_MAX) {
        var velha = null;
        for (var k2 in fatias) {
          if (Object.prototype.hasOwnProperty.call(fatias, k2) && (!velha || fatias[k2].t0 < fatias[velha].t0)) velha = k2;
        }
        if (velha) { delete fatias[velha]; nFatias--; }
      }
      f = fatias[k] = { tipo: m.t, de: m.de, cx: cxDe, n: n, a: a, partes: [], faltam: n, t0: t };
      nFatias++;
    }
    if (f.n !== n || f.a !== a) return;              // pedaço de outra conversa com o mesmo ref
    if (f.partes[i] === undefined) { f.partes[i] = s; f.faltam--; }
    if (f.faltam > 0) return;
    delete fatias[k];
    nFatias--;
    var dados;
    try { dados = JSON.parse(f.partes.join('')); } catch (e) { return; }
    avisa({ tipo: f.tipo, de: f.de, cx: f.cx, acao: f.a, dados: dados });
  }
  function limpaFatias(t) {
    for (var k in fatias) {
      if (Object.prototype.hasOwnProperty.call(fatias, k) && t - fatias[k].t0 > R.FATIA_PRAZO_MS) {
        delete fatias[k];
        nFatias--;
      }
    }
  }

  /* R.sussurrar(para, texto, { cx }) → true|false — a MENSAGEM PARTICULAR.
   * Só com R.privado(): no canal de abas e no relé antigo todo mundo ouviria.
   * false → R.ultimaRecusa(): 'sem-conexao', 'privado', 'sem-para', 'texto', 'grande'. */
  R.sussurrar = function (para, texto, opts) {
    if (!eu || !canal) return recusou('sem-conexao');
    if (!R.privado()) return recusou('privado');
    if (typeof para !== 'string' || !para || para.length > 80) return recusou('sem-para');
    texto = String(texto === undefined || texto === null ? '' : texto).trim().slice(0, R.TEXTO_MAX);
    if (!texto) return recusou('texto');
    var c = { para: para, nome: eu.nome, texto: texto };
    if (opts && typeof opts.cx === 'string' && opts.cx) c.paraCx = opts.cx;
    if (!manda('sussurro', c)) return recusou('grande');
    recusa = null;
    return true;
  };

  /* R.vigia(id, cx) / R.solta(id, cx): o relé avisa `caiu` quando aquela
   * conexão fechar. O vigia vale por conexão (a minha): ao religar, sai de
   * novo sozinho. No canal de abas não há quem avise (a varredura cuida). */
  function mandaVigia(id, cx, solta) {
    var c = { para: id };
    if (cx) c.paraCx = cx;
    if (solta) c.solta = true;
    return manda('vigia', c);
  }
  function revigia() {
    Object.keys(vigiados).forEach(function (id) { mandaVigia(id, vigiados[id].cx, false); });
  }
  R.vigia = function (id, cx) {
    if (typeof id !== 'string' || !id || !eu || !canal || canal.tipo !== 'ws' || !releNovo) return false;
    var c = (typeof cx === 'string' && cx) ? cx : null;
    var antes = vigiados[id];
    if (antes && antes.cx !== c && R.privado()) mandaVigia(id, antes.cx, true);
    vigiados[id] = { cx: c };
    if (R.privado()) mandaVigia(id, c, false);       // religando: sai sozinho ao religar (revigia)
    return true;
  };
  R.solta = function (id, cx) {
    if (typeof id !== 'string' || !id) return false;
    var v = vigiados[id];
    var c = (typeof cx === 'string' && cx) ? cx : (v ? v.cx : null);
    if (v && v.cx === c) delete vigiados[id];
    if (eu && canal && canal.tipo === 'ws' && R.privado()) mandaVigia(id, c, true);
    return !!v;
  };

  /* R.cala(id, solta) → true|false — o SILÊNCIO no relé (11/09, achado 21).
   * O Silenciar da HUD é por id (DB.mutados), e quem abre uma conexão nova a
   * cada envio tem um id novo a cada vez. Então quem silencia avisa o relé
   * ({t:'cala'}, nunca repassado), e ele cala para mim, por 1 h, o ENDEREÇO
   * de onde vinham os sussurros e convites daquele id — id novo do mesmo
   * endereço segue calado. `solta` devolve a voz. Só pelo relé novo (R.privado:
   * o antigo entregaria o `cala` ao próprio calado); fora dele fica o silêncio
   * por id do cliente. */
  R.cala = function (id, solta) {
    if (typeof id !== 'string' || !id || id.length > 80 || !eu || id === eu.id) return false;
    if (!R.privado()) return false;
    var c = { para: id };
    if (solta) c.solta = true;
    return manda('cala', c);
  };

  function vozAusente(m) {
    var ev = { tipo: 'ausente', para: txt(m.para), paraCx: txt(m.paraCx), tipoMsg: txt(m.tipo),
               acao: txt(m.acao), ref: txt(m.ref) };
    if (ev.acao === 'parte' && ev.ref && refsFatia[ev.ref]) {
      var f = refsFatia[ev.ref];
      if (f.avisado) return;                         // um aviso por mensagem fatiada, não um por pedaço
      f.avisado = true;
      ev.acao = f.acao;
      ev.ref = f.ref;
    }
    if (ev.tipoMsg === 'vigia' && ev.para && vigiados[ev.para] && vigiados[ev.para].cx === ev.paraCx) {
      delete vigiados[ev.para];                      // não há quem vigiar: não sai de novo ao religar
    }
    avisa(ev);
  }
  function vozCaiu(m) {
    var id = txt(m.id), cx = txt(m.cx);
    if (!id) return;
    if (vigiados[id] && vigiados[id].cx === cx) delete vigiados[id];   // morreu: vigiar de novo é com o cx novo
    avisa({ tipo: 'caiu', id: id, cx: cx });
  }
  /* a conexão se anunciou com cx: a primeira dá o evento `cx`; depois de uma
   * queda, o vigia sai de novo (ele vale por conexão) e o evento `religou` */
  function aoAnunciar(primeira) {
    if (!cxRele) return;
    // 11/09 (achado 17): a fila saiu antes do anúncio (e da prova) — o primeiro
    // oi pode ter caído num id preso a este aparelho: sai de novo, já depois dela
    if (provaTarde) { provaTarde = false; apresenta(); }
    if (primeira) { avisa({ tipo: 'cx', cx: cxRele }); return; }
    revigia();
    avisa({ tipo: 'religou', cx: cxRele });
  }
  /* o R.entrar da mesma pessoa com a conexão viva: só o que mudou viaja */
  function atualiza(perfil) {
    var novo = { nome: perfil.nome || '?', titulo: perfil.titulo || '', classe: perfil.classe || 'sumo',
                 resumo: perfil.resumo || null, aura: perfil.aura === true,
                 nuvem: perfil.nuvem || ((JOGO.Sessao && JOGO.Sessao.contaId) ? JOGO.Sessao.contaId() : null) };
    var mudou = false;
    for (var k in novo) {
      if (!Object.prototype.hasOwnProperty.call(novo, k)) continue;
      var a = eu[k], b = novo[k];
      var igual = ((a && typeof a === 'object') || (b && typeof b === 'object'))
        ? JSON.stringify(a) === JSON.stringify(b) : a === b;
      if (!igual) { eu[k] = b; mudou = true; }
    }
    if (typeof perfil.x === 'number') eu.x = perfil.x;
    if (typeof perfil.z === 'number') eu.z = perfil.z;
    var sala = perfil.sala || null;
    if (sala !== (eu.sala || null)) R.mudaSala(sala);   // o oi da sala nova já leva o perfil novo
    else if (mudou) apresenta();
    return true;
  }

  // ganchos de prova
  R._derruba = function () {                         // fecha o socket SEM tchau (a aba morta); religa em 3 a 5,5 s
    return !!(canal && canal.tipo === 'ws' && canal.derruba && canal.derruba());
  };
  R._fatia = function (n) {                          // o tamanho da fatia (abaixo do padrão, fatia até dado pequeno)
    n = Math.floor(Number(n));
    R.FATIA = (n >= 1) ? n : FATIA_PADRAO;
    return R.FATIA;
  };
  R._fatiasPendentes = function () { limpaFatias(agora()); return nFatias; };

  R.falar = function (texto) {
    if (!eu) return false;
    texto = String(texto || '').trim().slice(0, 240);
    if (!texto) return false;
    manda('chat', { nome: eu.nome, texto: texto });
    return true;
  };
  /* 13/09 (dono): o chat da GUILDA ("/g texto"). Só pelo relé novo: ele acha a
   * guilda pela conta conferida e entrega só aos membros (a recusa volta como
   * a voz gchat-nao). Nunca pelo canal de abas, onde todas ouviriam. */
  R.falarGuilda = function (texto) {
    if (!eu || !R.privado()) return false;
    texto = String(texto || '').trim().slice(0, 240);
    if (!texto) return false;
    return manda('gchat', { nome: eu.nome, texto: texto });
  };
  /* 13/09: o online dos amigos e inimigos (a voz {t:'amigos'} volta só a mim) e
   * o aviso de que a lista mudou (o relé esquece o que guardou dos inimigos) */
  R.pedeAmigos = function () { return !!(eu && R.privado() && manda('amigos', {})); };
  R.amigosMudou = function () {
    if (!eu || !R.privado()) return false;
    manda('amigos-muda', {});
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
                  zona: zonaDe(p.zona), luta: p.luta === true,     // 14/09: o Campo de PvP
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
