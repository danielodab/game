// A Rede — presença e conversa entre abas, antes do servidor (dono: lógica).
var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

/* O QUE ISTO É
 * ============
 * A fase 2 de docs/A_VIDA_ONLINE.html: dois SOTERRA abertos na mesma máquina
 * se VEEM no Acampamento — fantasma andando, nome na cabeça, chat — usando
 * BroadcastChannel como transporte. Quando o servidor chegar, troca-se o
 * transporte por WebSocket e o protocolo continua o mesmo: este módulo é a
 * fronteira.
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
 *   tchau  { de }                               saí
 *
 * PRESENÇA POR PULSO: cada par manda `pulso` a cada 2s; quem fica 8s calado
 * é dado como desligado (aba fechada sem `tchau` — F5, queda). O `tchau`
 * educado só adianta o inevitável.
 *
 * ONDE NÃO FUNCIONA: em file:// cada aba pode ser uma origem opaca e o canal
 * não cruza — o módulo vira um no-op silencioso e o jogo segue solo. Servido
 * (http://), que é o caminho do multiplayer, funciona inteiro.
 */
(function () {
  'use strict';

  var R = {};
  JOGO.Rede = R;

  var CANAL = 'soterra-rede-v1';
  R.PULSO_MS = 2000;
  R.SUMICO_MS = 8000;

  var canal = null;
  var eu = null;                    // { id, nome, titulo, classe, x, z }
  var pares = {};                   // id -> { nome, titulo, classe, x, z, visto }
  var timerPulso = null;

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
    try { canal.postMessage(corpo); } catch (e) {}
  }
  function agora() { return Date.now(); }

  function conhece(m) {
    var novo = !pares[m.de];
    pares[m.de] = { nome: m.nome || '?', titulo: m.titulo || '',
                    classe: m.classe || 'sumo',
                    resumo: m.resumo || null,
                    x: m.x || 0, z: m.z || 0, visto: agora() };
    if (novo) {
      avisa({ tipo: 'entrou', id: m.de, nome: pares[m.de].nome,
              titulo: pares[m.de].titulo, classe: pares[m.de].classe,
              resumo: pares[m.de].resumo,
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
      if (!pares[m.de]) { conhece(m); }
      else {
        pares[m.de].visto = agora();
        pares[m.de].x = m.x; pares[m.de].z = m.z;
      }
      avisa({ tipo: 'pulso', id: m.de, x: m.x, z: m.z });
    } else if (m.t === 'chat') {
      if (pares[m.de]) pares[m.de].visto = agora();
      avisa({ tipo: 'chat', id: m.de, nome: m.nome || (pares[m.de] || {}).nome || '?',
              texto: String(m.texto || '').slice(0, 240) });
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
    if (typeof BroadcastChannel === 'undefined') return false;   // file:// solo
    if (canal) R.sair();
    try { canal = new BroadcastChannel(CANAL); } catch (e) { canal = null; return false; }
    canal.onmessage = aoMensagem;
    eu = { id: perfil.id || ('anon-' + Math.random().toString(36).slice(2, 8)),
           nome: perfil.nome || '?', titulo: perfil.titulo || '',
           classe: perfil.classe || 'sumo',
           resumo: perfil.resumo || null,
           x: perfil.x || 0, z: perfil.z || 0 };
    manda('oi', { nome: eu.nome, titulo: eu.titulo, classe: eu.classe,
                  resumo: eu.resumo, x: eu.x, z: eu.z });
    timerPulso = setInterval(function () {
      manda('pulso', { x: eu.x, z: eu.z });
      R._varre();
    }, R.PULSO_MS);
    return true;
  };

  R.sair = function () {
    if (canal) {
      manda('tchau', {});
      try { canal.close(); } catch (e) {}
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

  R.falar = function (texto) {
    if (!eu) return false;
    texto = String(texto || '').trim().slice(0, 240);
    if (!texto) return false;
    manda('chat', { nome: eu.nome, texto: texto });
    return true;
  };

  R.pares = function () {
    var fora = [];
    Object.keys(pares).forEach(function (id) {
      var p = pares[id];
      fora.push({ id: id, nome: p.nome, titulo: p.titulo, classe: p.classe,
                  resumo: p.resumo || null, x: p.x, z: p.z });
    });
    return fora;
  };
  R.ligado = function () { return !!canal; };

  // aba fechando: despedida educada (a varredura pega quem não conseguir)
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', function () { R.sair(); });
  }
})();
