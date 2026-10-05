var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

// ============================================================================
// SOTERRA — A MODERAÇÃO NO JOGO, LADO DO JOGADOR (02/10) — dono: interface.
//
// Pedido do dono, para o lançamento: o jogador banido vê uma tela CLARA com o
// motivo e a data do fim; o jogador DENUNCIA quem o incomodou (no perfil da
// praça, numa linha do chat com toque longo ou clique direito, na lista de
// amigos) e recebe o retorno da Equipe pelo correio do jogo. A regra mora no
// servidor (servidor/moderacao.py; docs/SEGURANCA.md §10) — aqui só a tela.
//
//   JOGO.Moderacao   o miúdo que o painel do Mestre também usa: api, idem,
//                    quando (a data em hora de Brasília), duracoes
//   JOGO.Banimento   .mostra(banimento): a capa do banido. Quem chama é o
//                    JOGO.Sessao.banida (o 403 de qualquer rota, ou o relé)
//   JOGO.Denuncia    .anota(id, nome, texto): as falas que ESTE jogador viu
//                    (a HUD chama a cada linha do chat) · .abrir(alvo) · .botao
//                    · .silenciado(sil): o aviso de quem fala silenciado
//   JOGO.CorreioEquipe  as cartas da Equipe (o retorno da denúncia; 03/10, o presente do Mestre)
//   JOGO.EntregasMestre o aviso "O Mestre te enviou …" e a adoção do estado (03/10)
//
// Arquivo NOVO de propósito: a HUD (hud.js) só ganha ganchos de uma linha. Toda
// camada daqui é filha do <body> (fora do #ui-root, que tem pointer-events:
// none) e diz pointer-events: auto — a armadilha que já travou a fusão.
// ============================================================================

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
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  var M = JOGO.Moderacao = JOGO.Moderacao || {};
  var FUSO_S = -3 * 3600;          // o relógio de parede do servidor: Brasília, deslocamento fixo (api.py, FUSO)
  M.DURACOES = [['1h', '1 hora'], ['24h', '24 horas'], ['7d', '7 dias'], ['30d', '30 dias'],
                ['permanente', Tx('para sempre')], ['personalizado', Tx('até uma data…')]];
  M.CATEGORIAS = [['ofensa', Tx('Ofensa ou assédio')], ['trapaca', Tx('Trapaça ou abuso de bug')],
                  ['nome', Tx('Nome impróprio')], ['spam', Tx('Spam ou golpe')], ['outro', Tx('Outro')]];
  M.TEXTO_MAX = 500;
  M.FALAS_MAX = 20;
  M._fetch = null;                 // provas: (rota, op) → Promise<resposta>

  /* ------------------------------------------------------------ o miúdo */
  M.api = function (rota, op) {
    if (typeof M._fetch === 'function') return Promise.resolve(M._fetch(rota, op || {}));
    var S = JOGO.Sessao;
    if (!S || !S.api || !S.ativa || !S.ativa()) return Promise.resolve({ ok: false, status: 0, erro: Tx('entre na sua conta') });
    return S.api(rota, op || {});
  };
  M.idem = function () {
    var a = new Uint8Array(12), s = '';
    try { window.crypto.getRandomValues(a); } catch (e) { for (var i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256); }
    for (var j = 0; j < a.length; j++) s += (a[j] < 16 ? '0' : '') + a[j].toString(16);
    return s;
  };
  function z(n) { return (n < 10 ? '0' : '') + n; }
  /* epoch em segundos → "05/10/2026 às 14:00" no relógio de BRASÍLIA (o do servidor): o jogador
   * de outro fuso lê a mesma hora que a Equipe escreveu, com o fuso dito ao lado */
  M.quando = function (seg) {
    var n = Number(seg);
    if (!isFinite(n) || n <= 0) return '';
    var d = new Date((n + FUSO_S) * 1000);
    return z(d.getUTCDate()) + '/' + z(d.getUTCMonth() + 1) + '/' + d.getUTCFullYear() + Tx(' às ') +
           z(d.getUTCHours()) + ':' + z(d.getUTCMinutes());
  };
  /* "2026-10-05T14:00" (o <input type=datetime-local>, lido como Brasília) → epoch em segundos */
  M.deBrasilia = function (texto) {
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(texto || ''));
    if (!m) return null;
    return Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) / 1000) - FUSO_S;
  };
  M.paraBrasilia = function (seg) {
    var d = new Date((Number(seg) + FUSO_S) * 1000);
    return d.getUTCFullYear() + '-' + z(d.getUTCMonth() + 1) + '-' + z(d.getUTCDate()) + 'T' +
           z(d.getUTCHours()) + ':' + z(d.getUTCMinutes());
  };
  M.fimTexto = function (p) {
    if (!p) return '';
    if (p.permanente || p.fim == null) return Tx('para sempre');
    return Tx('até {a} (horário de Brasília)', { a: M.quando(p.fim) });
  };
  M.el = function (tag, cls, texto) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (texto != null) e.textContent = texto;
    return e;
  };
  M.botao = function (texto, cls, fn) {
    var b = M.el('button', cls || 'mod-b', texto);
    b.type = 'button';
    if (fn) b.addEventListener('click', function (ev) { ev.preventDefault(); ev.stopPropagation(); fn(ev); });
    return b;
  };
  M.aviso = function (texto, tipo) {
    try { if (JOGO.UI && JOGO.UI.toast) { JOGO.UI.toast(texto, tipo); return; } } catch (e) {}
    var t = document.getElementById('mod-aviso');
    if (!t) {
      t = M.el('div', 'mod-aviso');
      t.id = 'mod-aviso';
      document.body.appendChild(t);
    }
    t.textContent = texto;
    t.classList.add('is-on');
    clearTimeout(M._avisoT);
    M._avisoT = setTimeout(function () { t.classList.remove('is-on'); }, 3200);
  };
  M.erro = function (r, padrao) {
    if (!r) return padrao;
    var e = r.erro || padrao;
    if (r.status === 429 && r.liberaEm) e += ' ' + Tx('(de novo {a})', { a: M.quando(r.liberaEm) });
    if (r.status === 0) e = Tx('o servidor não respondeu — tente de novo');
    return e;
  };
  /* as teclas que caem num campo daqui não chegam ao jogo (a HUD abre fichas com I, M…) */
  M.prendeTeclas = function (raiz) {
    ['keydown', 'keyup', 'keypress'].forEach(function (t) {
      raiz.addEventListener(t, function (ev) { if (ev.key !== 'Escape') ev.stopPropagation(); });
    });
  };

  /* 03/10 (revisão): a capa diz aria-modal, e o Tab tem de valer isso — do último controle ele saía para a
   * página de trás, e as teclas voltavam a ser atalho da HUD por baixo do véu. O Tab dá a volta dentro da
   * caixa (Shift+Tab do primeiro ao último), a mesma regra da ficha da HUD (hud.js, sheetEl). */
  var FOCAVEIS = 'button, a[href], input:not([type="hidden"]), select, textarea, summary, [tabindex]:not([tabindex="-1"])';
  M.focaveis = function (raiz) {
    return [].filter.call(raiz.querySelectorAll(FOCAVEIS), function (n) {
      return !n.disabled && n.tabIndex >= 0 && n.getClientRects().length > 0;
    });
  };
  M.lacoTab = function (raiz) {
    raiz.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Tab') return;
      var foc = M.focaveis(raiz);
      if (!foc.length) { ev.preventDefault(); return; }
      var prim = foc[0], ult = foc[foc.length - 1], at = document.activeElement, vai = null;
      if (!raiz.contains(at) || at === raiz) vai = ev.shiftKey ? ult : prim;
      else if (ev.shiftKey && at === prim) vai = ult;
      else if (!ev.shiftKey && at === ult) vai = prim;
      if (!vai) return;
      ev.preventDefault();
      try { vai.focus(); } catch (e) {}
    });
  };

  /* ------------------------------------------------------------ o estilo */
  /* Mora aqui (e não no css/style.css) para o arquivo entrar e sair sozinho; as
   * cores leem as variáveis do tema, com o valor de reserva ao lado. */
  var CSS = [
    '.mod-capa{position:fixed;inset:0;z-index:9600;display:flex;align-items:center;justify-content:center;',
    'padding:16px;background:rgba(6,8,10,.72);pointer-events:auto;font:13px/1.5 var(--ui-sans,system-ui,sans-serif);color:var(--text,#e8eef6)}',
    '.mod-caixa{width:min(520px,100%);max-height:88vh;overflow:auto;padding:16px 18px;border-radius:12px;',
    'background:linear-gradient(180deg,var(--panel3,#1a2028),var(--panel2,#12161b));border:1px solid var(--line2,#3a4655);',
    'box-shadow:0 18px 50px rgba(0,0,0,.6)}',
    '.mod-caixa h2{margin:0 0 6px;font:700 17px var(--ui-serif,Georgia,serif);color:var(--gold,#e8c25a)}',
    '.mod-caixa p{margin:6px 0;color:var(--dim,#aab3c0)}',
    '.mod-caixa label{display:flex;gap:8px;align-items:center;margin:4px 0;cursor:pointer}',
    '.mod-caixa textarea{width:100%;box-sizing:border-box;min-height:84px;resize:vertical;background:#0f1318;color:inherit;',
    'border:1px solid var(--line2,#3a4655);border-radius:8px;padding:8px;font:inherit}',
    '.mod-falas{margin:6px 0 2px;padding:6px 8px;border-radius:8px;background:rgba(255,255,255,.04);max-height:140px;overflow:auto;',
    'font-size:12px;color:var(--dim,#aab3c0)}',
    '.mod-falas div{margin:2px 0;word-break:break-word}',
    '.mod-acoes{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:12px}',
    '.mod-b{font-weight:600;font-size:12.5px;line-height:1;font-family:inherit;padding:8px 12px;border-radius:8px;cursor:pointer;pointer-events:auto;',
    'background:#1e2733;color:#cfe0f5;border:1px solid #3a4655}',
    '.mod-b:disabled{opacity:.5;cursor:default}',
    '.mod-b-ok{background:#5a4416;color:#ffe2a0;border-color:#8a6a24}',
    '.mod-b-perigo{background:#4a1d1d;color:#ffb3a6;border-color:#7a3030}',
    '.mod-conta{font-size:11px;color:var(--dim,#8b93a0);text-align:right}',
    '.mod-aviso{position:fixed;left:50%;bottom:72px;transform:translateX(-50%);z-index:9700;max-width:90vw;',
    'padding:8px 14px;border-radius:9px;background:rgba(12,15,19,.95);color:#f0ead8;border:1px solid #3a4655;',
    'opacity:0;transition:opacity .2s;pointer-events:none;font:13px system-ui,sans-serif}',
    '.mod-aviso.is-on{opacity:1}',
    '.mod-menu{position:fixed;z-index:9650;pointer-events:auto;background:#12161b;border:1px solid #3a4655;border-radius:9px;',
    'box-shadow:0 10px 30px rgba(0,0,0,.55);padding:4px;font:13px system-ui,sans-serif}',
    '.mod-menu button{display:block;width:100%;text-align:left;background:none;border:0;color:#e8eef6;padding:8px 12px;',
    'border-radius:6px;cursor:pointer;font:inherit}',
    '.mod-menu button:hover{background:#1e2733}',
    // à direita, alto: o canto de baixo à esquerda é do chat, e o de baixo à direita, dos botões do Mestre
    '.mod-carta-botao{position:fixed;right:12px;bottom:calc(132px + var(--sa-b,0px));z-index:9300;',
    'pointer-events:auto;padding:6px 10px;border-radius:999px;cursor:pointer;font:600 12px system-ui,sans-serif;',
    'background:rgba(60,44,12,.92);color:#ffe2a0;border:1px solid #8a6a24;box-shadow:0 4px 14px rgba(0,0,0,.45)}',
    // 03/10 (revisão): no celular a pílula caía em cima do botão do painel de aproximação da praça (Banco,
    // Mercado, Arena, Poço, Forja, o Descer do portal) e roubava o toque: com o painel aberto, ela some
    'body:has(.hub-painel:not(.is-off)) .mod-carta-botao{display:none}',
    // 03/10 (revisão): a régua de toque das fichas (--tap, 44 px) e os controles nativos no tema escuro
    '.mod-caixa{color-scheme:dark}',
    '.mod-caixa input[type=radio],.mod-caixa input[type=checkbox]{accent-color:var(--gold,#e8c25a);width:18px;height:18px;',
    'margin:0;flex:0 0 auto}',
    'html.toque .mod-caixa label{min-height:var(--tap,44px);margin:0}',
    'html.toque .mod-b{min-height:var(--tap,44px)}',
    '.mod-carta{padding:8px 10px;margin:6px 0;border-radius:8px;background:rgba(255,255,255,.04);border:1px solid #2b3542}',
    '.mod-carta.is-nova{border-color:#8a6a24}',
    '.mod-carta b{color:var(--gold,#e8c25a)}',
    '.mod-carta pre{white-space:pre-wrap;font:inherit;margin:4px 0 0;color:var(--text,#e8eef6)}',
    '.hub-chat-linha[data-de]{cursor:context-menu}',
    '.mod-ban{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:24px;',
    'background:rgba(6,8,10,.94);pointer-events:auto;font:14px/1.5 var(--ui-sans,system-ui,sans-serif);color:#e8e0d0;text-align:center}',
    '.mod-ban .mod-caixa{text-align:center}',
    '.mod-ban .mod-motivo{margin:10px 0;padding:10px 12px;border-radius:9px;background:rgba(122,48,48,.25);',
    'border:1px solid rgba(255,140,120,.35);color:#ffd6cc;text-align:left;white-space:pre-wrap;word-break:break-word}',
    '.mod-ban .mod-acoes{justify-content:center}'
  ].join('');
  M.estilo = function () {
    if (document.getElementById('mod-estilo')) return;
    var s = document.createElement('style');
    s.id = 'mod-estilo';
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  };

  /* Uma janelinha: a capa escurece, a caixa recebe clique e teclas (Esc fecha). */
  M.janela = function (titulo, aoFechar) {
    M.estilo();
    var capa = M.el('div', 'mod-capa');
    capa.setAttribute('role', 'dialog');
    capa.setAttribute('aria-modal', 'true');
    var cx = M.el('div', 'mod-caixa');
    var h = M.el('h2', null, titulo);
    cx.appendChild(h);
    capa.appendChild(cx);
    function fecha() {
      if (capa.parentNode) capa.parentNode.removeChild(capa);
      if (aoFechar) try { aoFechar(); } catch (e) {}
    }
    capa.addEventListener('click', function (ev) { if (ev.target === capa) fecha(); });
    capa.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') { ev.stopPropagation(); fecha(); } });
    M.prendeTeclas(capa);
    M.lacoTab(capa);
    capa.tabIndex = -1;
    document.body.appendChild(capa);
    try { capa.focus(); } catch (e) {}       // as teclas daqui não viram atalho do jogo
    // quem chamou enche a caixa depois: o foco vai ao primeiro controle no quadro seguinte
    setTimeout(function () {
      if (!capa.parentNode || (document.activeElement !== capa && capa.contains(document.activeElement))) return;
      var foc = M.focaveis(cx);
      if (foc.length) try { foc[0].focus(); } catch (e) {}
    }, 0);
    return { capa: capa, caixa: cx, fecha: fecha };
  };

  // =========================================================== O BANIMENTO
  var B = JOGO.Banimento = {};
  var capaBan = null;
  var ouvindoBan = false;
  /* as teclas com a capa do banido no ar não chegam ao jogo; o Tab fica dentro dela (03/10, revisão: o foco
   * ficava preso no chat e a capa, que cobre tudo, não tinha saída pelo teclado). Registrados UMA vez:
   * antes cada mostra() somava mais três ouvintes na janela. */
  function ouveBan() {
    if (ouvindoBan) return;
    ouvindoBan = true;
    ['keydown', 'keyup', 'keypress'].forEach(function (tipo) {
      window.addEventListener(tipo, function (ev) {
        var capa = capaBan;
        if (!capa || !capa.parentNode) return;
        if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();
        ev.stopPropagation();
        var t = ev.target;          // a tecla mandada à janela (window) não é um nó: conta como fora da capa
        var dentro = !!(t && t.nodeType && capa.contains(t));
        if (tipo === 'keydown' && ev.key === 'Tab') {
          var foc = M.focaveis(capa);
          ev.preventDefault();
          if (!foc.length) return;
          var i = dentro ? foc.indexOf(t) : -1;
          var vai = i < 0 ? foc[0] : foc[(i + (ev.shiftKey ? foc.length - 1 : 1)) % foc.length];
          try { vai.focus(); } catch (e) {}
          return;
        }
        if (!dentro) ev.preventDefault();
      }, true);
    });
  }
  /* A capa do banido. `info` = o `banimento` do 403 ({motivo, inicio, fim, permanente}).
   * Nada de alert(): a capa cobre tudo e as teclas não chegam mais ao jogo. */
  B.mostra = function (info) {
    info = info || {};
    // o fechamento 4003 do relé pode chegar sem o {t:'banido'} (a mensagem perdida na queda):
    // sem o prazo na mão, pergunta ao servidor (GET /api/moderacao/eu passa com a conta banida)
    var sabido = Object.prototype.hasOwnProperty.call(info, 'permanente');
    if (!sabido && !B._perguntando) {
      B._perguntando = true;
      M.api('/api/moderacao/eu').then(function (r) {
        B._perguntando = false;
        if (r && r.ok && r.banimento) B.mostra(r.banimento);
      });
    }
    M.estilo();
    if (capaBan && capaBan.parentNode) capaBan.parentNode.removeChild(capaBan);
    var capa = M.el('div', 'mod-ban');
    capa.setAttribute('role', 'alertdialog');
    capa.setAttribute('aria-modal', 'true');
    capa.setAttribute('aria-labelledby', 'mod-ban-titulo');
    var cx = M.el('div', 'mod-caixa');
    var h = M.el('h2', null, Tx('Sua conta está banida'));
    h.id = 'mod-ban-titulo';
    cx.appendChild(h);
    var fim = M.el('p', 'mod-fim', !sabido ? Tx('Buscando o motivo e a data do fim…')
      : info.permanente || info.fim == null ? Tx('O banimento é permanente.')
      : Tx('O banimento termina em {a} (horário de Brasília).', { a: M.quando(info.fim) }));
    cx.appendChild(fim);
    if (sabido) {
      cx.appendChild(M.el('div', 'mod-motivo', info.motivo ? Tx('Motivo: {motivo}', { motivo: info.motivo })
        : Tx('A Equipe não registrou o motivo deste banimento.')));
    }
    cx.appendChild(M.el('p', null, info.permanente || info.fim == null
      ? Tx('Se você acha que foi um engano, procure a Equipe do jogo.')
      : Tx('Depois dessa data, é só entrar de novo. Se você acha que foi um engano, procure a Equipe do jogo.')));
    var acoes = M.el('div', 'mod-acoes');
    var S = JOGO.Sessao;
    acoes.appendChild(M.botao(Tx('Sair da conta'), 'mod-b mod-b-ok', function () {
      try { if (S && S.esquece) S.esquece(); } catch (e) {}
      if (B.semNavegar) return;
      try { if (window.__boot && window.__boot.recarregando) window.__boot.recarregando('sessao'); } catch (eB) {}
      try { location.href = (S && S.paginaConta) ? S.paginaConta() + '#entrar' : 'site/conta.html#entrar'; } catch (e2) {}
    }));
    cx.appendChild(acoes);
    capa.appendChild(cx);
    (document.body).appendChild(capa);
    capaBan = capa;
    ouveBan();
    try { acoes.querySelector('button').focus(); } catch (eF) {}   // o único botão: a saída pelo teclado
    B.ultimo = info;
    return capa;
  };
  B.semNavegar = false;           // provas: o "Sair da conta" não navega

  // ============================================================ A DENÚNCIA
  var D = JOGO.Denuncia = {};
  var FALAS_POR_ID = 30, IDS_MAX = 60;
  var vistas = {};                 // heroId → { nome, nuvem, falas: [{texto, em}] }
  var ordem = [];

  function contaDoHeroi(id) {
    try {
      var R = JOGO.Rede, ps = (R && R.pares) ? R.pares() : [];
      for (var i = 0; i < ps.length; i++) if (ps[i] && ps[i].id === id && typeof ps[i].nuvem === 'number') return ps[i].nuvem;
    } catch (e) {}
    return null;
  }
  /* As falas que ESTE jogador viu na tela, por herói (a HUD chama a cada linha do chat).
   * É isto que vai anexado à denúncia — o servidor não guarda o chat. */
  D.anota = function (id, nome, texto) {
    if (typeof id !== 'string' || !id || typeof texto !== 'string' || !texto) return;
    var v = vistas[id];
    if (!v) {
      v = vistas[id] = { nome: nome || '?', nuvem: null, falas: [] };
      ordem.push(id);
      while (ordem.length > IDS_MAX) delete vistas[ordem.shift()];
    }
    if (nome) v.nome = nome;
    var c = contaDoHeroi(id);
    if (c !== null) v.nuvem = c;
    v.falas.push({ texto: texto.slice(0, 240), em: Date.now() });
    if (v.falas.length > FALAS_POR_ID) v.falas.splice(0, v.falas.length - FALAS_POR_ID);
  };
  D.falasDe = function (id, conta) {
    var fora = [];
    Object.keys(vistas).forEach(function (k) {
      var v = vistas[k];
      if (k === id || (conta != null && v.nuvem === conta)) fora = fora.concat(v.falas);
    });
    fora.sort(function (a, b) { return a.em - b.em; });
    return fora.slice(-M.FALAS_MAX);
  };

  /* alvo = { conta (o id da conta conferida pelo relé, o `nuvem`), nome, heroId?, onde } */
  D.abrir = function (alvo) {
    alvo = alvo || {};
    var conta = (typeof alvo.conta === 'number') ? alvo.conta : (alvo.heroId ? contaDoHeroi(alvo.heroId) : null);
    if (conta === null && alvo.heroId && vistas[alvo.heroId]) conta = vistas[alvo.heroId].nuvem;
    var nome = alvo.nome || (alvo.heroId && vistas[alvo.heroId] ? vistas[alvo.heroId].nome : 'o jogador');
    var S = JOGO.Sessao;
    var j = M.janela(Tx('Denunciar {nome}', { nome: nome }));
    var cx = j.caixa;
    if (!S || !S.ativa || !S.ativa()) {
      cx.appendChild(M.el('p', null, Tx('Entre na sua conta para denunciar alguém.')));
      cx.appendChild(acoesFechar(j));
      return j;
    }
    if (conta === null) {
      cx.appendChild(M.el('p', null, Tx('Esse jogador não está com a conta conferida pelo servidor, então a denúncia não teria a quem chegar. Se for alguém insistente, use "Silenciar" no perfil dele.')));
      cx.appendChild(acoesFechar(j));
      return j;
    }
    if (S.contaId && S.contaId() === conta) {
      cx.appendChild(M.el('p', null, Tx('Essa conta é a sua.')));
      cx.appendChild(acoesFechar(j));
      return j;
    }
    cx.appendChild(M.el('p', null, Tx('A Equipe lê toda denúncia. Escolha o que aconteceu e, se quiser, conte com suas palavras.')));
    var escolhida = null;
    var grupo = M.el('div', 'mod-cats');
    M.CATEGORIAS.forEach(function (c) {
      var l = M.el('label');
      var r = document.createElement('input');
      r.type = 'radio';
      r.name = 'mod-cat';
      r.value = c[0];
      r.addEventListener('change', function () { escolhida = c[0]; confere(); });
      l.appendChild(r);
      l.appendChild(M.el('span', null, c[1]));
      grupo.appendChild(l);
    });
    cx.appendChild(grupo);
    var ta = document.createElement('textarea');
    ta.maxLength = M.TEXTO_MAX;
    ta.placeholder = Tx('O que aconteceu? (até {TEXTO_MAX} caracteres)', { TEXTO_MAX: M.TEXTO_MAX });
    var conta2 = M.el('div', 'mod-conta', '0/' + M.TEXTO_MAX);
    ta.addEventListener('input', function () { conta2.textContent = ta.value.length + '/' + M.TEXTO_MAX; confere(); });
    cx.appendChild(ta);
    cx.appendChild(conta2);
    var falas = D.falasDe(alvo.heroId, conta);
    var anexa = null;
    if (falas.length) {
      var lf = M.el('label');
      anexa = document.createElement('input');
      anexa.type = 'checkbox';
      anexa.checked = true;
      lf.appendChild(anexa);
      lf.appendChild(M.el('span', null, Tx('Anexar as últimas falas de {nome} que você viu ({length})', { nome: nome, length: falas.length })));
      cx.appendChild(lf);
      var caixaF = M.el('div', 'mod-falas');
      falas.forEach(function (f) { caixaF.appendChild(M.el('div', null, '“' + f.texto + '”')); });
      cx.appendChild(caixaF);
      cx.appendChild(M.el('p', 'mod-conta', Tx('Vão como relato seu: o servidor não guarda o chat.')));
    }
    var acoes = M.el('div', 'mod-acoes');
    acoes.appendChild(M.botao(Tx('Cancelar'), 'mod-b', j.fecha));
    var envia = M.botao(Tx('Enviar denúncia'), 'mod-b mod-b-ok', function () {
      if (envia.disabled) return;
      envia.disabled = true;
      var corpo = { alvo: conta, categoria: escolhida, texto: ta.value.trim(), onde: alvo.onde || 'outro' };
      if (anexa && anexa.checked) corpo.falas = falas;
      M.api('/api/denuncia', { method: 'POST', body: corpo }).then(function (r) {
        if (r && r.ok) {
          j.fecha();
          M.aviso(Tx('Denúncia enviada. A Equipe vai olhar — o retorno chega pelo correio do jogo.'), 'good');
          D.ultima = corpo;
          return;
        }
        envia.disabled = false;
        M.aviso(M.erro(r, Tx('não deu para enviar a denúncia')));
      });
    });
    acoes.appendChild(envia);
    cx.appendChild(acoes);
    function confere() {
      envia.disabled = !escolhida || (escolhida === 'outro' && ta.value.trim().length < 10);
    }
    confere();
    D.janela = j;
    return j;
  };
  function acoesFechar(j) {
    var a = M.el('div', 'mod-acoes');
    a.appendChild(M.botao(Tx('Fechar'), 'mod-b', j.fecha));
    return a;
  }
  /* O botão "Denunciar" para as listas da HUD (o perfil da praça, a ficha do perfil, os amigos):
   * a classe vem de quem chama, para casar com os botões vizinhos. */
  D.botao = function (alvo, antes, cls) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = cls || 'btn btn-ghost';
    b.textContent = Tx('Denunciar');
    b.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      if (typeof antes === 'function') try { antes(); } catch (e) {}
      D.abrir(alvo);
    });
    return b;
  };

  /* O MENU DA LINHA DO CHAT: clique direito, ou toque longo (o dedo parado 550 ms). A HUD marca a
   * linha com data-de (o herói que falou); a minha linha não tem. */
  var menuAberto = null, toqueT = null, toqueXY = null;
  function fechaMenu() {
    if (menuAberto && menuAberto.parentNode) menuAberto.parentNode.removeChild(menuAberto);
    menuAberto = null;
  }
  D.menuDaLinha = function (linha, x, y) {
    var de = linha && linha.getAttribute('data-de');
    if (!de) return null;
    M.estilo();
    fechaMenu();
    var v = vistas[de] || {};
    // o nome que a Rede deu (a linha do /g leva "[Guilda] Nome" no data-nome)
    var nome = v.nome || linha.getAttribute('data-nome') || 'o jogador';
    var menu = M.el('div', 'mod-menu');
    menu.appendChild(M.botao(Tx('Denunciar {nome}', { nome: nome }), null, function () {
      fechaMenu();
      D.abrir({ heroId: de, nome: nome, onde: 'chat' });
    }));
    menu.appendChild(M.botao(Tx('Fechar'), null, fechaMenu));
    menu.style.left = Math.max(4, Math.min(x, window.innerWidth - 200)) + 'px';
    menu.style.top = Math.max(4, Math.min(y, window.innerHeight - 90)) + 'px';
    document.body.appendChild(menu);
    menuAberto = menu;
    return menu;
  };
  function linhaDe(alvo) {
    return (alvo && alvo.closest) ? alvo.closest('.hub-chat-linha[data-de]') : null;
  }
  document.addEventListener('contextmenu', function (ev) {
    var l = linhaDe(ev.target);
    if (!l) return;
    ev.preventDefault();
    D.menuDaLinha(l, ev.clientX, ev.clientY);
  });
  document.addEventListener('pointerdown', function (ev) {
    if (menuAberto && !menuAberto.contains(ev.target)) fechaMenu();
    var l = linhaDe(ev.target);
    if (!l || ev.pointerType === 'mouse') return;
    toqueXY = [ev.clientX, ev.clientY];
    clearTimeout(toqueT);
    toqueT = setTimeout(function () { D.menuDaLinha(l, toqueXY[0], toqueXY[1]); }, 550);
  }, true);
  ['pointerup', 'pointercancel'].forEach(function (t) {
    document.addEventListener(t, function () { clearTimeout(toqueT); }, true);
  });
  document.addEventListener('pointermove', function (ev) {
    if (toqueXY && (Math.abs(ev.clientX - toqueXY[0]) > 10 || Math.abs(ev.clientY - toqueXY[1]) > 10)) clearTimeout(toqueT);
  }, true);

  /* O relé calou a fala ({t:'silenciado'}, rele.py): um aviso a cada 10 s, no máximo */
  var silAvisado = 0;
  D.silenciado = function (sil) {
    var t = Date.now();
    if (t - silAvisado < 10000) return false;
    silAvisado = t;
    sil = sil || {};
    M.aviso(Tx('A Equipe silenciou você no chat {a}{b}. Ninguém recebeu essa mensagem.', { a: M.fimTexto(sil), b: sil.motivo ? ' — ' + sil.motivo : '' }));
    return true;
  };

  // ======================================================= O CORREIO DA EQUIPE
  var C = JOGO.CorreioEquipe = {};
  var botaoCarta = null, pollT = null;
  C.INTERVALO_MS = 5 * 60 * 1000;
  C.confere = function () {
    var S = JOGO.Sessao;
    if (!S || !S.ativa || !S.ativa() || (S.derrubadaJa && S.derrubadaJa())) return Promise.resolve(null);
    return M.api('/api/correio').then(function (r) {
      if (r && r.ok) pintaBotao(r.naoLidas || 0);
      return r;
    });
  };
  function pintaBotao(n) {
    M.estilo();
    if (!n) {
      if (botaoCarta && botaoCarta.parentNode) botaoCarta.parentNode.removeChild(botaoCarta);
      botaoCarta = null;
      return;
    }
    if (!botaoCarta) {
      botaoCarta = M.botao('', 'mod-carta-botao', C.abrir);
      botaoCarta.title = Tx('Cartas da Equipe do jogo');
    }
    botaoCarta.textContent = (n === 1
      ? Tx('✉ {n} carta da Equipe', { n: n })
      : Tx('✉ {n} cartas da Equipe', { n: n }));
    if (!botaoCarta.parentNode) document.body.appendChild(botaoCarta);
  }
  C.abrir = function () {
    var j = M.janela(Tx('Cartas da Equipe'));
    var lista = M.el('div');
    j.caixa.appendChild(lista);
    lista.appendChild(M.el('p', null, 'carregando…'));
    j.caixa.appendChild(acoesFechar(j));
    M.api('/api/correio').then(function (r) {
      lista.textContent = '';
      if (!r || !r.ok) { lista.appendChild(M.el('p', null, M.erro(r, Tx('não deu para abrir o correio')))); return; }
      if (!r.cartas.length) lista.appendChild(M.el('p', null, Tx('Nenhuma carta por enquanto.')));
      r.cartas.forEach(function (c) {
        var d = M.el('div', 'mod-carta' + (c.lida ? '' : ' is-nova'));
        d.appendChild(M.el('b', null, c.assunto));
        d.appendChild(M.el('div', 'mod-conta', M.quando(c.criadoEm)));
        d.appendChild(M.el('pre', null, c.texto));
        lista.appendChild(d);
      });
      if (r.naoLidas) {
        M.api('/api/correio/lida', { method: 'POST', body: { todas: true } }).then(function () { pintaBotao(0); });
      }
    });
    return j;
  };
  C.liga = function () {
    if (pollT) return;
    C.confere();
    pollT = setInterval(function () { if (!document.hidden) C.confere(); }, C.INTERVALO_MS);
  };

  // ======================================================= O QUE O MESTRE TE ENVIOU (03/10)
  /* O painel único do Mestre põe peça, conjunto, bicho, pedras… no inventário de QUALQUER jogador, pelo
   * servidor (servidor/moderacao.py, /api/mestre/dar). O jogador fica sabendo assim:
   *   - online: o /api/eu que o jogo já pergunta a cada 30 s com a aba à vista (sessao.js) traz quantas
   *     entregas ele não viu, e dispara 'soterra:entregas';
   *   - offline: a mesma pergunta, uma vez, logo depois do boot.
   * Aqui a lista vem de GET /api/entregas, o aviso diz "O Mestre te enviou …", o estado é adotado SEM
   * apagar o que o jogador fez (JOGO.Autoridade.sincroniza: a fila dele sobe antes, por cima da entrega) e
   * só então as entregas são marcadas como vistas. Na batalha espera: o aviso e a adoção ficam para fora
   * dela (o fechar da sala já devolve o estado com a entrega dentro). A carta da Equipe fica no correio. */
  var E = JOGO.EntregasMestre = {};
  var pedindoE = false;
  function emBatalha() {
    try { return !!(JOGO.Game && JOGO.Game.screen === 'battle'); } catch (e) { return false; }
  }
  function enumera(lista) {
    var t = lista.map(function (x) { return x.texto; }).filter(Boolean);
    if (!t.length) return '';
    if (t.length > 3) t = t.slice(0, 3).concat([Tx('e mais {a}', { a: lista.length - 3 })]);
    return t.length === 1 ? t[0] : t.slice(0, -1).join(', ') + ' e ' + t[t.length - 1];
  }
  /* 04/10: a mesma caixa traz o que a LOJA entregou na hora (tipo 'loja': o servidor aplicou a compra
   * dentro dela mesma, servidor/loja.py) — o aviso diz de onde veio cada coisa. */
  E.texto = function (lista) {
    var loja = (lista || []).filter(function (x) { return x && x.tipo === 'loja'; });
    var mestre = (lista || []).filter(function (x) { return x && x.tipo !== 'loja'; });
    var frases = [], m = enumera(mestre), l = enumera(loja);
    if (m) frases.push(Tx('O Mestre te enviou {m}.', { m: m }));
    if (l) frases.push(Tx('Chegou da loja: {l}.', { l: l }));
    return frases.join(' ');
  };
  E.confere = function () {
    var S = JOGO.Sessao;
    if (pedindoE || !S || !S.ativa || !S.ativa() || (S.derrubadaJa && S.derrubadaJa())) return Promise.resolve(null);
    if (emBatalha()) return Promise.resolve(null);      // o próximo /api/eu (30 s) pergunta de novo
    pedindoE = true;
    return M.api('/api/entregas').then(function (r) {
      if (!r || !r.ok || !r.entregas || !r.entregas.length) { pedindoE = false; return r; }
      var A = JOGO.Autoridade;
      var sinc = (A && A.sincroniza) ? A.sincroniza() : Promise.resolve(null);
      return Promise.resolve(sinc).then(null, function () { return null; }).then(function () {
        M.aviso(E.texto(r.entregas), 'good');
        try { if (JOGO.UI && JOGO.UI.repaint) JOGO.UI.repaint(); } catch (e2) {}
        try { if (JOGO.CorreioEquipe) JOGO.CorreioEquipe.confere(); } catch (e3) {}
        return M.api('/api/entregas/vistas', { method: 'POST', body: { ids: r.entregas.map(function (x) { return x.id; }) } });
      }).then(function () { pedindoE = false; return r; }, function () { pedindoE = false; return r; });
    }, function () { pedindoE = false; return null; });
  };
  try { window.addEventListener('soterra:entregas', function () { E.confere(); }); } catch (e) {}

  /* No boot: com sessão, o correio olha uma vez (e depois a cada 5 min), e as entregas do Mestre que
   * chegaram com o jogo fechado são avisadas. Sem sessão, nada. */
  function liga() {
    try {
      if (JOGO.Sessao && JOGO.Sessao.ativa && JOGO.Sessao.ativa()) { C.liga(); E.confere(); }
    } catch (e) {}
  }
  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', function () { setTimeout(liga, 4000); });
  else setTimeout(liga, 4000);
})();
