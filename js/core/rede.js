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
 *   WS     WebSocket até o RELÉ (servidor/rele.py, um carteiro burro que
 *          repassa cada mensagem aos demais — a MESMA semântica do canal).
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
 * PRESENÇA POR PULSO: cada par manda `pulso` a cada 2s; quem fica 8s calado
 * é dado como desligado (aba fechada sem `tchau` — F5, queda). O `tchau`
 * educado só adianta o inevitável.
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
  R.PULSO_MS = 2000;
  R.SUMICO_MS = 8000;

  var canal = null;                 // o transporte vivo: { tipo:'canal'|'ws', envia(obj), fecha() }
  var eu = null;                    // { id, nome, titulo, classe, x, z }
  var pares = {};                   // id -> { nome, titulo, classe, x, z, visto }
  var timerPulso = null;

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
   * para o canal); queda depois de aberto reconecta a cada 4s e chama
   * `aoReligar` (o chamador se reapresenta com um `oi` novo). */
  function transporteWs(url, aoFalhar, aoReligar) {
    var ws = null, abriu = false, fechado = false, fila = [];
    function conecta(deNovo) {
      try { ws = new WebSocket(url); } catch (e) { falha(); return; }
      ws.onopen = function () {
        var primeira = !abriu;
        abriu = true;
        while (fila.length) { try { ws.send(fila.shift()); } catch (e) { break; } }
        if (!primeira && aoReligar) aoReligar();
      };
      ws.onmessage = function (ev) {
        var m = null;
        try { m = JSON.parse(String(ev.data)); } catch (e) { return; }
        aoMensagem({ data: m });
      };
      ws.onclose = ws.onerror = function () {
        if (fechado) return;
        if (!abriu) { falha(); return; }
        // já esteve ligado: o relé caiu ou a rede piscou — insiste
        setTimeout(function () { if (!fechado) conecta(true); }, 4000);
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
        if (ws && ws.readyState === 1) { try { ws.send(s); } catch (e) {} }
        else if (fila.length < 50) fila.push(s);
      },
      fecha: function () {
        fechado = true;
        try { if (ws) ws.close(); } catch (e) {}
      }
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
  function apresenta() {
    if (!eu) return;
    manda('oi', { nome: eu.nome, titulo: eu.titulo, classe: eu.classe,
                  resumo: eu.resumo, aura: eu.aura, x: eu.x, z: eu.z });
  }
  function agora() { return Date.now(); }

  function conhece(m) {
    var atual = pares[m.de];
    // "novo" também cobre quem foi visto SÓ por pulso (guardado sem nome,
    // calado): o anúncio de entrada espera a mensagem que traz o nome
    var novo = !atual || !atual.nome;
    pares[m.de] = { nome: m.nome || '?', titulo: m.titulo || '',
                    classe: m.classe || 'sumo',
                    resumo: m.resumo || null,
                    aura: m.aura === true,
                    x: m.x || 0, z: m.z || 0, visto: agora() };
    if (novo) {
      avisa({ tipo: 'entrou', id: m.de, nome: pares[m.de].nome,
              titulo: pares[m.de].titulo, classe: pares[m.de].classe,
              resumo: pares[m.de].resumo, aura: pares[m.de].aura,
              x: pares[m.de].x, z: pares[m.de].z });
    }
    return novo;
  }

  function aoMensagem(ev) {
    var m = ev && ev.data;
    if (!m || !m.t || !m.de || !eu || m.de === eu.id) return;
    if (m.t === 'oi') {
      conhece(m);
      // o eco apresenta a MIM para o recém-chegado — sem ele, quem entra
      // por último não veria ninguém que já estava
      manda('eco', { nome: eu.nome, titulo: eu.titulo, classe: eu.classe,
                     resumo: eu.resumo, x: eu.x, z: eu.z });
    } else if (m.t === 'eco') {
      conhece(m);
    } else if (m.t === 'alvo') {
      if (pares[m.de]) { pares[m.de].visto = agora(); }
      avisa({ tipo: 'alvo', id: m.de, x: m.x, z: m.z });
    } else if (m.t === 'pulso') {
      if (!pares[m.de]) {
        /* pulso de DESCONHECIDO (oi perdido, ou o par expirou numa aba de
         * fundo desacelerada): nada de anunciar "? chegou" — guarda calado
         * e se apresenta, porque o oi provoca o eco que traz o nome. */
        pares[m.de] = { nome: null, titulo: '', classe: 'sumo', resumo: null,
                        x: m.x || 0, z: m.z || 0, visto: agora() };
        apresenta();
      } else {
        pares[m.de].visto = agora();
        pares[m.de].x = m.x; pares[m.de].z = m.z;
      }
      avisa({ tipo: 'pulso', id: m.de, x: m.x, z: m.z });
    } else if (m.t === 'chat') {
      if (pares[m.de]) pares[m.de].visto = agora();
      avisa({ tipo: 'chat', id: m.de, nome: m.nome || (pares[m.de] || {}).nome || '?',
              texto: String(m.texto || '').slice(0, 240) });
    } else if (m.t === 'troca') {
      // só o destinatário processa — a praça inteira ouve, um responde
      if (m.para === eu.id) {
        if (pares[m.de]) pares[m.de].visto = agora();
        avisa({ tipo: 'troca', de: m.de, acao: m.acao, dados: m.dados || null });
      }
    } else if (m.t === 'tchau') {
      if (pares[m.de]) {
        delete pares[m.de];
        avisa({ tipo: 'saiu', id: m.de });
      }
    }
  }

  /* A varredura dos calados: quem não pulsa há SUMICO_MS caiu. Exposta com o
   * relógio injetável para o teste não esperar 8 segundos reais. */
  R._varre = function (tAgora) {
    var t = tAgora || agora();
    Object.keys(pares).forEach(function (id) {
      if (t - pares[id].visto > R.SUMICO_MS) {
        delete pares[id];
        avisa({ tipo: 'saiu', id: id });
      }
    });
  };

  // ------------------------------------------------------------- superfície
  R.entrar = function (perfil) {
    if (canal) R.sair();
    var url = urlDoRele();
    if (url) {
      canal = transporteWs(url,
        function () {           // o relé não respondeu: vida entre abas
          if (!eu) return;      // já saímos nesse meio-tempo
          canal = transporteCanal();
          apresenta();
        },
        function () { apresenta(); });   // religou (apresenta é no-op sem eu)
    }
    if (!canal) canal = transporteCanal();
    if (!canal) return false;                                    // file:// solo
    eu = { id: perfil.id || ('anon-' + Math.random().toString(36).slice(2, 8)),
           nome: perfil.nome || '?', titulo: perfil.titulo || '',
           classe: perfil.classe || 'sumo',
           resumo: perfil.resumo || null,
           aura: perfil.aura === true,          // o Traje do Colecionador fechado
           x: perfil.x || 0, z: perfil.z || 0 };
    apresenta();
    timerPulso = setInterval(function () {
      manda('pulso', { x: eu.x, z: eu.z });
      R._varre();
    }, R.PULSO_MS);
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
                  resumo: p.resumo || null, aura: p.aura === true, x: p.x, z: p.z });
    });
    return fora;
  };
  R.ligado = function () { return !!canal; };
  R.transporte = function () { return canal ? canal.tipo : null; };

  // aba fechando: despedida educada (a varredura pega quem não conseguir)
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', function () { R.sair(); });
  }
})();
