var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

// ============================================================================
// SOTERRA — O PAINEL DO MESTRE DENTRO DO JOGO (02/10) — dono: interface.
//
// Pedido do dono: "hoje o Mestre precisa sair para o menu/site para agir". O
// painel abre POR CIMA de qualquer tela (a praça, a antessala, a batalha), só
// para a conta do Mestre, por um botão discreto (⚖, em cima do "🔧 teste")
// e pelo atalho F9 (ou Ctrl+Alt+M). Abas:
//   Itens        busca por nome/slot/nível/raridade/elemento, estrelas, forja e
//                quantidade → "pôr no meu inventário" PELO SERVIDOR
//                (POST /api/mestre/dar: o juiz põe no estado do servidor e o
//                jogo adota o estado novo sem recarregar)
//   Moedas       vinténs, barras e selos para si ou para um jogador (as rotas de
//                presente que o site do Mestre já usa, e /api/mestre/dar)
//   Jogadores    buscar conta, a ficha, presentear do catálogo, silenciar, banir
//   Denúncias    a fila, os estados e a ação ligada (silenciar/banir)
//   Banimentos   os em vigor (e o histórico), desbanir, dessilenciar
//   Auditoria    as últimas ações de todo Mestre
//   Ferramentas  o MESMO corpo do painel de teste (js/ui/debug.js, JOGO.Debug
//                .desenhaEm) — liberar classes, nível, elemento, efeitos — e o
//                PA/PP do Mestre (JOGO.GM.definePaPp). Nada duplicado.
//
// QUEM VÊ: a conta que o servidor marcou (a sessão com gm:true) ou, em casa, o
// modo Mestre ligado pela chave (JOGO.GM.ativo). Quem MANDA é o servidor: cada
// rota /api/mestre/* responde 403 a quem não tem a marca no banco, e toda ação
// fica na auditoria (servidor/moderacao.py). Sem sessão (o jogo local) só as
// Ferramentas e os Itens (no save deste navegador, que é o dono ali) funcionam.
//
// Camada filha do <body>, fora do #ui-root (pointer-events: none), com
// pointer-events: auto explícito. As teclas digitadas nela não chegam ao jogo.
// Depende de js/ui/moderacao.js (JOGO.Moderacao: api, idem, datas, janela).
// ============================================================================

(function () {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  var M = JOGO.Moderacao;
  var PM = JOGO.PainelMestre = {};
  PM.ABAS = [['itens', 'Itens'], ['moedas', 'Moedas'], ['jogadores', 'Jogadores'], ['denuncias', 'Denúncias'],
             ['banimentos', 'Banimentos'], ['auditoria', 'Auditoria'], ['ferramentas', 'Ferramentas']];
  PM.LISTA_ITENS = 60;             // linhas de item desenhadas de uma vez (o resto pede filtro)
  var SLOTS = [['punho', 'Punho'], ['passo', 'Passo'], ['casca', 'Casca'], ['lume', 'Lume']];
  var ELEMENTOS = [['fogo', 'Fogo'], ['agua', 'Água'], ['terra', 'Terra'], ['ar', 'Ar'], ['neutro', 'Neutro']];
  var SELOS = [['fogo', 'Fogo'], ['agua', 'Água'], ['terra', 'Terra'], ['ar', 'Ar']];

  var aba = 'itens', capa = null, corpo = null, botao = null, abasEl = null;
  var filtro = { q: '', slot: '', raridade: '', elemento: '', nivelMax: '', estrelas: 0, nivel: 0, qtd: 1 };
  var alvoMoedas = null;           // {id, nome} — null = eu
  var fichaId = null;              // a conta aberta na aba Jogadores
  var busca = { q: '', contas: null };
  var denFiltro = 'abertas', denAlvo = null, banTodos = false;

  /* ------------------------------------------------------------ quem é */
  function sessaoConta() {
    var S = JOGO.Sessao;
    try { return (S && S.ativa && S.ativa()) ? S.conta() : null; } catch (e) { return null; }
  }
  PM.noServidor = function () { var c = sessaoConta(); return !!(c && c.gm === true); };
  PM.ehMestre = function () {
    try { var G = JOGO.GM; if (G && G.ativo && G.ativo()) return true; } catch (e) {}
    return PM.noServidor();
  };
  function eu() { return sessaoConta() || {}; }
  function D() { return JOGO.DATA || {}; }

  /* ------------------------------------------------------------ o miúdo */
  var el = M.el, bt = M.botao;
  function campo(rotulo, filho) {
    var c = el('label', 'pm-campo');
    c.appendChild(el('span', null, rotulo));
    c.appendChild(filho);
    return c;
  }
  function seletor(opcoes, valor, aoMudar) {
    var s = document.createElement('select');
    s.className = 'pm-sel';
    opcoes.forEach(function (o) {
      var op = document.createElement('option');
      op.value = o[0];
      op.textContent = o[1];
      if (String(o[0]) === String(valor)) op.selected = true;
      s.appendChild(op);
    });
    if (aoMudar) s.addEventListener('change', function () { aoMudar(s.value); });
    return s;
  }
  function entrada(tipo, valor, aoMudar, attrs) {
    var i = document.createElement('input');
    i.type = tipo;
    i.className = 'pm-in';
    if (valor != null) i.value = valor;
    Object.keys(attrs || {}).forEach(function (k) { i.setAttribute(k, attrs[k]); });
    if (aoMudar) i.addEventListener(tipo === 'text' || tipo === 'search' ? 'input' : 'change', function () { aoMudar(i.value); });
    return i;
  }
  function inteiro(v, lo, hi) {
    var n = Math.floor(Number(v));
    return (isFinite(n) && n >= lo && n <= hi) ? n : null;
  }
  function aviso(texto, tipo) { M.aviso(texto, tipo); }
  function carregando(alvo) { alvo.textContent = ''; alvo.appendChild(el('p', 'pm-dim', 'carregando…')); }
  function semServidor(alvo, oque) {
    alvo.appendChild(el('p', 'pm-aviso', oque + ' fala com o servidor: entre com a conta do Mestre (a que o servidor ' +
      'marcou) para usar esta aba.'));
  }
  /* o botão de duas batidas: a primeira arma ("Confirmar: …"), a segunda faz */
  function confirma(texto, rotuloConfirma, fn, cls) {
    var b = bt(texto, cls || 'mod-b mod-b-perigo', function () {
      if (!b.armado) {
        b.armado = true;
        b.textContent = rotuloConfirma;
        b.classList.add('is-armado');
        setTimeout(function () { if (b.armado) { b.armado = false; b.textContent = texto; b.classList.remove('is-armado'); } }, 6000);
        return;
      }
      b.armado = false;
      b.disabled = true;
      fn(b);
    });
    return b;
  }
  function etiqueta(texto, cls) { return el('span', 'pm-tag ' + (cls || ''), texto); }
  function api(rota, op) { return M.api(rota, op); }
  PM.api = api;

  /* O formulário da punição (silenciar ou banir): duração (com a data do personalizado,
   * em hora de Brasília) e o motivo. ler() → {duracao, ate?, motivo} ou {erro}. */
  function formPunicao(motivoObrigatorio) {
    var raiz = el('div', 'pm-linha');
    var data = entrada('datetime-local', M.paraBrasilia(Math.floor(Date.now() / 1000) + 3 * 86400));
    var campoData = campo('até (Brasília)', data);
    campoData.style.display = 'none';           // só no "personalizado"
    var dur = seletor(M.DURACOES, '24h', function (v) { campoData.style.display = v === 'personalizado' ? '' : 'none'; });
    var motivo = entrada('text', '', null, { maxlength: '300', placeholder: motivoObrigatorio ? 'motivo (o jogador vê)' : 'motivo (opcional)' });
    raiz.appendChild(campo('duração', dur));
    raiz.appendChild(campoData);
    raiz.appendChild(campo('motivo', motivo));
    return {
      raiz: raiz,
      ler: function () {
        var c = { duracao: dur.value };
        if (dur.value === 'personalizado') {
          c.ate = M.deBrasilia(data.value);
          if (!c.ate) return { erro: 'escolha a data do fim' };
        }
        var m = motivo.value.trim();
        if (m) c.motivo = m;
        else if (motivoObrigatorio) return { erro: 'escreva o motivo (o jogador vê)' };
        return c;
      },
      rotulo: function () {
        var d = dur.value;
        if (d === 'personalizado') return 'até ' + M.quando(M.deBrasilia(data.value));
        for (var i = 0; i < M.DURACOES.length; i++) if (M.DURACOES[i][0] === d) return M.DURACOES[i][1];
        return d;
      }
    };
  }

  /* ------------------------------------------------------------ o estilo */
  var CSS = [
    // o canto de baixo à ESQUERDA é do chat da praça: o botão mora em cima do "🔧 teste" (debug.js), à direita
    '.pm-abrir{position:fixed;right:10px;bottom:calc(50px + var(--sa-b,0px));z-index:9300;',
    'pointer-events:auto;width:30px;height:30px;padding:0;border-radius:8px;cursor:pointer;opacity:.6;',
    'font:16px/1 system-ui,sans-serif;color:#ffd479;background:#1b222c;border:1px solid #3a4655}',
    '.pm-abrir:hover,.pm-abrir:focus-visible{opacity:1}',
    'html.celular .pm-abrir{bottom:auto;top:calc(4px + var(--sa-t,0px));right:calc(66px + var(--canto,0px));opacity:.45}',
    '.pm-capa{position:fixed;inset:0;z-index:9400;display:flex;align-items:center;justify-content:center;padding:12px;',
    'background:rgba(6,8,10,.62);pointer-events:auto;font:13px/1.45 var(--ui-sans,system-ui,sans-serif);color:#e8eef6}',
    '.pm-caixa{width:min(940px,100%);height:min(88vh,760px);display:flex;flex-direction:column;border-radius:12px;',
    'background:#12161b;border:1px solid #3a4655;box-shadow:0 18px 50px rgba(0,0,0,.65);overflow:hidden}',
    '.pm-cab{display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid #2b3542}',
    '.pm-cab b{font:700 15px var(--ui-serif,Georgia,serif);color:#e8c25a}',
    '.pm-cab .pm-dim{margin-left:auto}',
    '.pm-x{background:none;border:0;color:#8b93a0;font-size:16px;cursor:pointer;padding:4px 6px}',
    '.pm-abas{display:flex;gap:4px;flex-wrap:wrap;padding:8px 12px;border-bottom:1px solid #2b3542}',
    '.pm-aba{font:600 12px system-ui,sans-serif;padding:7px 11px;border-radius:7px;cursor:pointer;',
    'background:#1b222c;color:#cfe0f5;border:1px solid #2b3542}',
    '.pm-aba.is-on{background:#5a4416;color:#ffe2a0;border-color:#8a6a24}',
    '.pm-corpo{flex:1;overflow:auto;padding:12px 14px 18px}',
    '.pm-linha{display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;margin:6px 0}',
    '.pm-campo{display:flex;flex-direction:column;gap:3px;font-size:11px;color:#8b93a0}',
    '.pm-in,.pm-sel{background:#1b222c;color:#e8eef6;border:1px solid #3a4655;border-radius:6px;padding:6px 8px;font:12.5px system-ui,sans-serif}',
    '.pm-in[type=number]{width:76px}',
    '.pm-lista{display:flex;flex-direction:column;gap:5px;margin-top:8px}',
    '.pm-item{display:flex;align-items:center;gap:10px;padding:6px 8px;border-radius:8px;background:rgba(255,255,255,.03);',
    'border:1px solid #2b3542}',
    '.pm-item .pm-nome{flex:1;min-width:0}',
    '.pm-item .pm-nome b{display:block}',
    '.pm-dim{color:#8b93a0;font-size:11.5px}',
    '.pm-aviso{padding:8px 10px;border-radius:8px;background:rgba(232,194,90,.08);border:1px solid rgba(232,194,90,.3);color:#e8d9a8}',
    '.pm-tag{display:inline-block;padding:1px 7px;border-radius:999px;font:600 10.5px system-ui;margin-left:4px;',
    'background:#2b3542;color:#cfe0f5}',
    '.pm-tag.is-ban{background:#4a1d1d;color:#ffb3a6}.pm-tag.is-sil{background:#3a3214;color:#ffe2a0}',
    '.pm-tag.is-gm{background:#2b2047;color:#d6c6ff}.pm-tag.is-aberta{background:#1d3524;color:#8fe0a0}',
    '.pm-tag.is-em-analise{background:#1d2c45;color:#9cc7ff}',
    '.pm-cartao{padding:10px 12px;border-radius:10px;background:rgba(255,255,255,.03);border:1px solid #2b3542;margin:8px 0}',
    '.pm-cartao h3{margin:0 0 6px;font:700 14px system-ui;color:#e8c25a}',
    '.pm-falas{margin:6px 0;padding:6px 8px;border-radius:7px;background:#0f1318;font-size:12px}',
    '.pm-falas div{margin:2px 0;word-break:break-word}',
    '.pm-grade{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:4px 14px;margin:6px 0}',
    '.pm-grade div span{color:#8b93a0;font-size:11px;display:block}',
    '.pm-tabela{width:100%;border-collapse:collapse;font-size:12px}',
    '.pm-tabela td,.pm-tabela th{padding:5px 6px;border-bottom:1px solid #222a35;text-align:left;vertical-align:top}',
    '.pm-tabela th{color:#8b93a0;font-weight:600}',
    '.pm-tabela code{font-size:11px;color:#aab3c0;word-break:break-all}',
    '.mod-b.is-armado{outline:2px solid #ff9b8a}',
    '@media (max-width:640px){.pm-caixa{height:94vh}.pm-corpo{padding:10px}}'
  ].join('');
  function estilo() {
    M.estilo();
    if (document.getElementById('pm-estilo')) return;
    var s = document.createElement('style');
    s.id = 'pm-estilo';
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  /* ------------------------------------------------------------ abrir e fechar */
  function monta() {
    if (capa) return;
    estilo();
    capa = el('div', 'pm-capa');
    capa.tabIndex = -1;
    capa.setAttribute('role', 'dialog');
    capa.setAttribute('aria-modal', 'true');
    capa.setAttribute('aria-label', 'Painel do Mestre');
    var cx = el('div', 'pm-caixa');
    var cab = el('div', 'pm-cab');
    cab.appendChild(el('b', null, 'Painel do Mestre'));
    var quem = el('span', 'pm-dim');
    cab.appendChild(quem);
    // o painel de antes (a tecla M, hud.js): o grimório, a Caixa, os eventos do mundo — os dois se apontam
    var velho = bt('⚔ Grimório, Caixa e eventos (M)', 'mod-b', function () {
      PM.fechar();
      try { if (JOGO.UI && JOGO.UI.openSheet) JOGO.UI.openSheet('gm'); } catch (e) {}
    });
    velho.style.marginLeft = '8px';
    if (JOGO.UI && JOGO.UI.openSheet) cab.appendChild(velho);
    var x = bt('✕', 'pm-x', PM.fechar);
    x.title = 'Fechar (Esc)';
    cab.appendChild(x);
    cx.appendChild(cab);
    abasEl = el('div', 'pm-abas');
    cx.appendChild(abasEl);
    corpo = el('div', 'pm-corpo');
    cx.appendChild(corpo);
    capa.appendChild(cx);
    capa.addEventListener('click', function (ev) { if (ev.target === capa) PM.fechar(); });
    capa.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') { ev.stopPropagation(); PM.fechar(); } });
    M.prendeTeclas(capa);
    capa._quem = quem;
  }
  PM.aberto = function () { return !!(capa && capa.parentNode); };
  PM.abrir = function (qual) {
    if (!PM.ehMestre()) return false;
    monta();
    if (qual) aba = qual;
    var c = eu();
    capa._quem.textContent = PM.noServidor() ? (c.nome || '') + ' · #' + c.id : 'jogo local (sem servidor)';
    if (!capa.parentNode) document.body.appendChild(capa);
    desenha();
    // o foco vem para o painel: as teclas digitadas aqui não viram atalho do jogo (o I, o M)
    try { if (!capa.contains(document.activeElement)) capa.focus(); } catch (e) {}
    return true;
  };
  PM.fechar = function () { if (capa && capa.parentNode) capa.parentNode.removeChild(capa); };
  PM.alterna = function () { return PM.aberto() ? (PM.fechar(), false) : PM.abrir(); };
  PM.aba = function () { return aba; };

  function desenha() {
    if (!capa) return;
    abasEl.textContent = '';
    PM.ABAS.forEach(function (a) {
      abasEl.appendChild(bt(a[1], 'pm-aba' + (aba === a[0] ? ' is-on' : ''), function () { aba = a[0]; desenha(); }));
    });
    corpo.textContent = '';
    var f = ABAS[aba];
    try { f(corpo); } catch (e) {
      corpo.appendChild(el('p', 'pm-aviso', 'Esta aba falhou ao desenhar: ' + (e && e.message)));
    }
  }
  PM.redesenha = desenha;

  // =============================================================== AS ABAS
  var ABAS = {};

  /* ------------------------------------------------------------ Itens */
  function itensFiltrados() {
    var its = D().items || {}, q = filtro.q.trim().toLowerCase();
    var nmax = inteiro(filtro.nivelMax, 0, 999);
    return Object.keys(its).map(function (k) { return its[k]; }).filter(function (it) {
      if (!it || !it.id) return false;
      if (filtro.slot && it.slot !== filtro.slot) return false;
      if (filtro.raridade && it.rarity !== filtro.raridade) return false;
      if (filtro.elemento && (it.element || 'neutro') !== filtro.elemento) return false;
      if (nmax !== null && filtro.nivelMax !== '' && (Number(it.nivelUso) || 0) > nmax) return false;
      if (q && String(it.name || '').toLowerCase().indexOf(q) < 0 && String(it.id).toLowerCase().indexOf(q) < 0) return false;
      return true;
    }).sort(function (a, b) {
      return (Number(a.nivelUso) || 0) - (Number(b.nivelUso) || 0) || String(a.name).localeCompare(String(b.name));
    });
  }
  PM.itensFiltrados = itensFiltrados;
  PM.filtro = filtro;
  function maxEstrelas() {
    try { return JOGO.Progress.starCfg().max; } catch (e) { return 5; }
  }
  function maxForja() { return Math.floor(Number((D().upgrade || {}).maxLevel)) || 10; }
  ABAS.itens = function (alvo) {
    var raridades = {};
    var its = D().items || {};
    Object.keys(its).forEach(function (k) { if (its[k] && its[k].rarity) raridades[its[k].rarity] = 1; });
    var l1 = el('div', 'pm-linha');
    var q = entrada('search', filtro.q, function (v) { filtro.q = v; pinta(); }, { placeholder: 'nome ou id da peça' });
    l1.appendChild(campo('buscar', q));
    l1.appendChild(campo('slot', seletor([['', 'todos']].concat(SLOTS), filtro.slot, function (v) { filtro.slot = v; pinta(); })));
    l1.appendChild(campo('raridade', seletor([['', 'todas']].concat(Object.keys(raridades).sort().map(function (r) { return [r, r]; })),
      filtro.raridade, function (v) { filtro.raridade = v; pinta(); })));
    l1.appendChild(campo('elemento', seletor([['', 'todos']].concat(ELEMENTOS), filtro.elemento, function (v) { filtro.elemento = v; pinta(); })));
    l1.appendChild(campo('nível de uso até', entrada('number', filtro.nivelMax, function (v) { filtro.nivelMax = v; pinta(); },
      { min: '0', max: '99' })));
    alvo.appendChild(l1);
    var l2 = el('div', 'pm-linha');
    var est = [];
    for (var s = 0; s <= maxEstrelas(); s++) est.push([s, s ? '★' + s : 'sem estrela']);
    var frj = [];
    for (var n = 0; n <= maxForja(); n++) frj.push([n, '+' + n]);
    l2.appendChild(campo('estrelas', seletor(est, filtro.estrelas, function (v) { filtro.estrelas = +v; })));
    l2.appendChild(campo('forja', seletor(frj, filtro.nivel, function (v) { filtro.nivel = +v; })));
    l2.appendChild(campo('quantidade', entrada('number', filtro.qtd, function (v) { filtro.qtd = inteiro(v, 1, 20) || 1; },
      { min: '1', max: '20' })));
    l2.appendChild(el('span', 'pm-dim', PM.noServidor()
      ? 'entra pelo servidor (o juiz põe no seu estado e o jogo adota na hora)'
      : 'jogo local: entra no save deste navegador'));
    alvo.appendChild(l2);
    var lista = el('div', 'pm-lista');
    alvo.appendChild(lista);
    function pinta() {
      lista.textContent = '';
      var achados = itensFiltrados();
      lista.appendChild(el('div', 'pm-dim', achados.length > PM.LISTA_ITENS
        ? 'mostrando ' + PM.LISTA_ITENS + ' de ' + achados.length + ' — refine a busca'
        : achados.length + (achados.length === 1 ? ' peça' : ' peças')));
      achados.slice(0, PM.LISTA_ITENS).forEach(function (it) {
        var row = el('div', 'pm-item');
        row.setAttribute('data-item', it.id);
        try {
          var A = JOGO.Art;
          if (A && A.itemIcon && A.node) row.appendChild(A.node(A.itemIcon(it.id, 36), 32));
        } catch (e) {}
        var nm = el('div', 'pm-nome');
        nm.appendChild(el('b', null, it.name || it.id));
        nm.appendChild(el('span', 'pm-dim', [it.slot, it.rarity, it.element || 'neutro', 'nv ' + (it.nivelUso || 0), it.id].join(' · ')));
        row.appendChild(nm);
        row.appendChild(bt('Pôr no meu inventário', 'mod-b mod-b-ok', function (ev) { PM.poeItem(it.id, ev && ev.target); }));
        lista.appendChild(row);
      });
    }
    pinta();
  };

  /* Pôr no inventário: no ar, SÓ pelo servidor; em casa (sem sessão), no save local (o dono ali). */
  PM.poeItem = function (itemId, b) {
    var it = (D().items || {})[itemId];
    if (!it) return Promise.resolve(null);
    var qtd = inteiro(filtro.qtd, 1, 20) || 1;
    var rot = qtd + '× ' + (it.name || itemId) + (filtro.estrelas ? ' ★' + filtro.estrelas : '') + (filtro.nivel ? ' +' + filtro.nivel : '');
    if (!PM.noServidor()) {
      var S = JOGO.Sessao;
      if (S && S.ativa && S.ativa()) {
        aviso('Esta conta não tem a marca de Mestre no servidor: nada entra por aqui.');
        return Promise.resolve(null);
      }
      return Promise.resolve(poeLocal(itemId, qtd, rot));
    }
    if (b) b.disabled = true;
    return api('/api/mestre/dar', { method: 'POST', body: {
      tipo: 'item', itemId: itemId, estrelas: filtro.estrelas, nivel: filtro.nivel, qtd: qtd, idem: M.idem() } })
      .then(function (r) {
        if (b) b.disabled = false;
        if (r && r.ok) {
          try {
            var A = JOGO.Autoridade;
            if (A && A.adotaResposta) A.adotaResposta(r);
          } catch (e) {}
          aviso(rot + ' no seu inventário.', 'good');
        } else aviso(M.erro(r, 'não entrou'));
        return r;
      });
  };
  function poeLocal(itemId, qtd, rot) {
    var P = JOGO.Progress;
    if (!P || !P.state || !P.novaCopia) return null;
    if (P.bagFree && !P.bagFree(qtd)) { aviso('O saco não tem vaga para ' + qtd + '.'); return null; }
    for (var i = 0; i < qtd; i++) {
      var e = P.novaCopia(itemId, 'caixa', filtro.nivel, filtro.estrelas);
      if (e) P.state.inventory.push(e);
    }
    if (P.save) P.save();
    try { if (JOGO.UI && JOGO.UI.repaint) JOGO.UI.repaint(); } catch (e2) {}
    aviso(rot + ' no seu inventário (jogo local).', 'good');
    return { ok: true, local: true };
  }

  /* ------------------------------------------------------------ Moedas */
  function escolheConta(alvo, aoEscolher, rotulo) {
    var linha = el('div', 'pm-linha');
    var q = entrada('search', '', null, { placeholder: 'nome, e-mail inteiro ou #número' });
    var res = el('div', 'pm-lista');
    function procura() {
      var t = q.value.trim();
      if (!t) return;
      carregando(res);
      api('/api/mestre/contas', { method: 'POST', body: { q: t } }).then(function (r) {
        res.textContent = '';
        if (!r || !r.ok) { res.appendChild(el('p', 'pm-dim', M.erro(r, 'a busca falhou'))); return; }
        if (!r.contas.length) res.appendChild(el('p', 'pm-dim', 'ninguém achado'));
        r.contas.forEach(function (c) {
          var row = el('div', 'pm-item');
          var nm = el('div', 'pm-nome');
          var b = el('b', null, c.nome);
          if (c.gm) b.appendChild(etiqueta('Mestre', 'is-gm'));
          if (c.banido) b.appendChild(etiqueta('banida', 'is-ban'));
          nm.appendChild(b);
          nm.appendChild(el('span', 'pm-dim', '#' + c.id + ' · ' + c.email));
          row.appendChild(nm);
          row.appendChild(bt(rotulo || 'Escolher', 'mod-b', function () { aoEscolher(c); }));
          res.appendChild(row);
        });
        if (r.mais) res.appendChild(el('p', 'pm-dim', 'há mais: refine a busca'));
      });
    }
    q.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') procura(); });
    linha.appendChild(campo('buscar conta', q));
    linha.appendChild(bt('Buscar', 'mod-b', procura));
    alvo.appendChild(linha);
    alvo.appendChild(res);
    return q;
  }
  ABAS.moedas = function (alvo) {
    if (!PM.noServidor()) { semServidor(alvo, 'Dar moedas'); return; }
    var c = eu();
    var para = alvoMoedas || { id: c.id, nome: c.nome };
    var ehEu = para.id === c.id;
    var cab = el('div', 'pm-cartao');
    cab.appendChild(el('h3', null, 'Para: ' + para.nome + (ehEu ? ' (você)' : ' · #' + para.id)));
    if (!ehEu) cab.appendChild(bt('Voltar para mim', 'mod-b', function () { alvoMoedas = null; desenha(); }));
    alvo.appendChild(cab);
    escolheConta(alvo, function (ct) { alvoMoedas = { id: ct.id, nome: ct.nome }; desenha(); }, 'Dar para esta');
    function bloco(titulo, nota, campos, rotulo, fazer) {
      var b = el('div', 'pm-cartao');
      b.appendChild(el('h3', null, titulo));
      if (nota) b.appendChild(el('p', 'pm-dim', nota));
      var l = el('div', 'pm-linha');
      campos.forEach(function (x) { l.appendChild(x); });
      var go = bt(rotulo, 'mod-b mod-b-ok', function () { fazer(go); });
      l.appendChild(go);
      b.appendChild(l);
      alvo.appendChild(b);
    }
    var vin = entrada('number', '1000', null, { min: '1', max: '100000' });
    bloco('Vinténs', 'Um presente pela loja: conta no "a caminho" na hora e entra no jogo na próxima retirada da loja ' +
      '(até 100.000 por presente).', [campo('quantos', vin)], 'Dar vinténs', function (go) {
      var n = inteiro(vin.value, 1, 100000);
      if (!n) { aviso('vinténs de 1 a 100.000'); return; }
      go.disabled = true;
      api('/api/mestre/presentear', { method: 'POST', body: { conta: para.id, vintens: n, idem: M.idem() } }).then(function (r) {
        go.disabled = false;
        aviso(r && r.ok ? n + ' vinténs a caminho de ' + para.nome + '.' : M.erro(r, 'não deu'), r && r.ok ? 'good' : undefined);
      });
    });
    var bar = entrada('number', '10', null, { min: '1', max: '5000' });
    bloco('Barras de ouro', 'Entram na hora no saldo da conta (moram só no servidor).', [campo('quantas', bar)],
      'Dar barras', function (go) {
        var n = inteiro(bar.value, 1, 5000);
        if (!n) { aviso('barras de 1 a 5.000'); return; }
        go.disabled = true;
        api('/api/mestre/barras', { method: 'POST', body: { conta: para.id, barras: n, idem: M.idem() } }).then(function (r) {
          go.disabled = false;
          aviso(r && r.ok ? n + ' barras para ' + para.nome + ' (saldo ' + r.barras.saldo + ').' : M.erro(r, 'não deu'),
                r && r.ok ? 'good' : undefined);
        });
      });
    var sel = seletor(SELOS, 'fogo');
    var sn = entrada('number', '10', null, { min: '1', max: '999' });
    bloco('Selos do Colecionador', 'Pelo servidor, no estado da conta (o juiz conta).', [campo('elemento', sel), campo('quantos', sn)],
      'Dar selos', function (go) {
        var n = inteiro(sn.value, 1, 999);
        if (!n) { aviso('selos de 1 a 999'); return; }
        go.disabled = true;
        api('/api/mestre/dar', { method: 'POST', body: { conta: para.id, tipo: 'selos', elemento: sel.value, n: n, idem: M.idem() } })
          .then(function (r) {
            go.disabled = false;
            if (r && r.ok && ehEu) { try { JOGO.Autoridade.adotaResposta(r); } catch (e) {} }
            aviso(r && r.ok ? n + ' selos de ' + sel.value + ' para ' + para.nome + '.' : M.erro(r, 'não deu'), r && r.ok ? 'good' : undefined);
          });
      });
  };

  /* ------------------------------------------------------------ Jogadores */
  ABAS.jogadores = function (alvo) {
    if (!PM.noServidor()) { semServidor(alvo, 'A busca de contas'); return; }
    if (fichaId !== null) { ficha(alvo, fichaId); return; }
    var q = escolheConta(alvo, function (c) { fichaId = c.id; desenha(); }, 'Abrir ficha');
    try { q.focus(); } catch (e) {}
  };
  PM.abreFicha = function (id) { fichaId = id; aba = 'jogadores'; return PM.abrir('jogadores'); };
  function ficha(alvo, id) {
    var topo = el('div', 'pm-linha');
    topo.appendChild(bt('← Voltar à busca', 'mod-b', function () { fichaId = null; desenha(); }));
    alvo.appendChild(topo);
    var caixa = el('div');
    alvo.appendChild(caixa);
    carregando(caixa);
    api('/api/mestre/conta?id=' + id).then(function (r) {
      caixa.textContent = '';
      if (!r || !r.ok) { caixa.appendChild(el('p', 'pm-aviso', M.erro(r, 'a ficha não abriu'))); return; }
      var c = r.conta, mod = r.moderacao || {}, souEu = c.id === eu().id;
      var cart = el('div', 'pm-cartao');
      var h = el('h3', null, c.nome + ' · #' + c.id);
      if (c.gm) h.appendChild(etiqueta('Mestre', 'is-gm'));
      if (mod.banimento) h.appendChild(etiqueta('banida', 'is-ban'));
      if (mod.silencio) h.appendChild(etiqueta('silenciada', 'is-sil'));
      cart.appendChild(h);
      var g = el('div', 'pm-grade');
      function dado(rot, val) { var d = el('div'); d.appendChild(el('span', null, rot)); d.appendChild(document.createTextNode(val == null ? '—' : String(val))); g.appendChild(d); }
      dado('e-mail', c.email);
      dado('criada em', M.quando(c.criadoEm));
      dado('última sessão', c.ultimaSessao ? M.quando(c.ultimaSessao) : '—');
      dado('nível máximo', r.save ? r.save.nivelMax : '—');
      dado('vinténs (save)', r.save ? r.save.vintens : '—');
      dado('barras de ouro', r.barras ? r.barras.saldo : '—');
      dado('classes', (r.classes || []).map(function (x) { return x.id + (x.nivel ? ' ' + x.nivel : ''); }).join(', ') || '—');
      var den = mod.denuncias || {}, totalDen = 0;
      Object.keys(den).forEach(function (k) { totalDen += den[k]; });
      dado('denúncias contra', totalDen ? totalDen + ' (' + Object.keys(den).map(function (k) { return k + ' ' + den[k]; }).join(', ') + ')' : 'nenhuma');
      cart.appendChild(g);
      if (mod.banimento) cart.appendChild(el('p', 'pm-aviso', 'Banida ' + M.fimTexto(mod.banimento) + ' — ' + (mod.banimento.motivo || 'sem motivo registrado')));
      if (mod.silencio) cart.appendChild(el('p', 'pm-aviso', 'Silenciada ' + M.fimTexto(mod.silencio) + ' — ' + mod.silencio.motivo));
      if (totalDen) cart.appendChild(bt('Ver as denúncias contra', 'mod-b', function () { denAlvo = { id: c.id, nome: c.nome }; denFiltro = 'todas'; aba = 'denuncias'; desenha(); }));
      caixa.appendChild(cart);

      // presentear do catálogo (a regra do produto é do servidor: `pode`)
      var pres = el('div', 'pm-cartao');
      pres.appendChild(el('h3', null, 'Presentear'));
      var ok = (r.catalogo || []).filter(function (x) { return x.pode; });
      if (!ok.length) pres.appendChild(el('p', 'pm-dim', 'nada do catálogo cabe nesta conta agora'));
      else {
        var s = seletor(ok.map(function (x) { return [x.sku, x.nome + ' (' + x.secao + ')']; }), ok[0].sku);
        var l = el('div', 'pm-linha');
        l.appendChild(campo('do catálogo', s));
        var go = bt('Dar presente', 'mod-b mod-b-ok', function () {
          go.disabled = true;
          api('/api/mestre/presentear', { method: 'POST', body: { conta: c.id, sku: s.value, idem: M.idem() } }).then(function (r2) {
            go.disabled = false;
            aviso(r2 && r2.ok ? 'Presente a caminho: ' + r2.presente.nome + '.' : M.erro(r2, 'não deu'), r2 && r2.ok ? 'good' : undefined);
          });
        });
        l.appendChild(go);
        pres.appendChild(l);
      }
      pres.appendChild(bt('Vinténs, barras e selos…', 'mod-b', function () { alvoMoedas = { id: c.id, nome: c.nome }; aba = 'moedas'; desenha(); }));
      caixa.appendChild(pres);

      // silenciar e banir (o Mestre não pune a si mesmo nem outro Mestre: o servidor também recusa)
      if (!souEu && !c.gm) {
        caixa.appendChild(blocoPunicao('silenciar', c, mod.silencio));
        caixa.appendChild(blocoPunicao('banir', c, mod.banimento));
      } else {
        caixa.appendChild(el('p', 'pm-dim', souEu ? 'O Mestre não silencia nem bane a si mesmo.'
          : 'Conta com a marca de Mestre: tire a marca no Terminal (admin tirar-mestre) antes de punir.'));
      }
      // o histórico
      var hist = (mod.banimentos || []).map(function (b) { return ['banimento', b]; })
        .concat((mod.silencios || []).map(function (b) { return ['silêncio', b]; }))
        .sort(function (a, b) { return (b[1].inicio || 0) - (a[1].inicio || 0); });
      if (hist.length) {
        var hc = el('div', 'pm-cartao');
        hc.appendChild(el('h3', null, 'Histórico'));
        hist.slice(0, 12).forEach(function (x) {
          var b = x[1];
          hc.appendChild(el('div', 'pm-dim', M.quando(b.inicio) + ' · ' + x[0] + ' ' + M.fimTexto(b) + ' · ' + b.motivo +
            (b.encerradoComo ? ' · ' + b.encerradoComo + (b.encerradoMotivo ? ' (' + b.encerradoMotivo + ')' : '') : ' · em vigor')));
        });
        caixa.appendChild(hc);
      }
    });
  }
  function blocoPunicao(tipo, c, atual) {
    var b = el('div', 'pm-cartao');
    var banir = tipo === 'banir';
    b.appendChild(el('h3', null, banir ? 'Banir' : 'Silenciar no chat'));
    if (atual) {
      b.appendChild(el('p', 'pm-dim', (banir ? 'Banida ' : 'Silenciada ') + M.fimTexto(atual) + '. Aplicar de novo troca o prazo.'));
      var desf = entrada('text', '', null, { maxlength: '300', placeholder: 'motivo de desfazer (opcional)' });
      var l0 = el('div', 'pm-linha');
      l0.appendChild(campo('desfazer', desf));
      l0.appendChild(confirma(banir ? 'Desbanir' : 'Devolver a voz', banir ? 'Confirmar: desbanir ' + c.nome : 'Confirmar: devolver a voz',
        function (go) {
          var corpo = { conta: c.id };
          if (desf.value.trim()) corpo.motivo = desf.value.trim();
          api(banir ? '/api/mestre/desbanir' : '/api/mestre/dessilenciar', { method: 'POST', body: corpo }).then(function (r) {
            go.disabled = false;
            aviso(r && r.ok ? (banir ? c.nome + ' pode voltar a jogar.' : c.nome + ' pode falar de novo.') : M.erro(r, 'não deu'), r && r.ok ? 'good' : undefined);
            if (r && r.ok) desenha();
          });
        }, 'mod-b mod-b-ok'));
      b.appendChild(l0);
    }
    var f = formPunicao(true);
    b.appendChild(f.raiz);
    var l = el('div', 'pm-linha');
    l.appendChild(confirma(banir ? 'Banir' : 'Silenciar', 'Confirmar: ' + (banir ? 'banir ' : 'silenciar ') + c.nome, function (go) {
      var p = f.ler();
      if (p.erro) { go.disabled = false; aviso(p.erro); return; }
      p.conta = c.id;
      api(banir ? '/api/mestre/banir' : '/api/mestre/silenciar', { method: 'POST', body: p }).then(function (r) {
        go.disabled = false;
        var x = r && (r.banimento || r.silencio);
        aviso(r && r.ok ? c.nome + (banir ? ' banida ' : ' silenciada ') + M.fimTexto(x) + '.' : M.erro(r, 'não deu'), r && r.ok ? 'good' : undefined);
        if (r && r.ok) desenha();
      });
    }));
    b.appendChild(l);
    return b;
  }

  /* ------------------------------------------------------------ Denúncias */
  ABAS.denuncias = function (alvo) {
    if (!PM.noServidor()) { semServidor(alvo, 'A fila de denúncias'); return; }
    var topo = el('div', 'pm-linha');
    topo.appendChild(campo('mostrar', seletor([['abertas', 'abertas e em análise'], ['todas', 'todas'], ['procedente', 'procedentes'],
      ['improcedente', 'improcedentes']], denFiltro, function (v) { denFiltro = v; desenha(); })));
    if (denAlvo) topo.appendChild(bt('só ' + denAlvo.nome + ' ✕', 'mod-b', function () { denAlvo = null; desenha(); }));
    topo.appendChild(bt('Atualizar', 'mod-b', desenha));
    alvo.appendChild(topo);
    var lista = el('div');
    alvo.appendChild(lista);
    carregando(lista);
    api('/api/mestre/denuncias?estado=' + encodeURIComponent(denFiltro) + (denAlvo ? '&alvo=' + denAlvo.id : '')).then(function (r) {
      lista.textContent = '';
      if (!r || !r.ok) { lista.appendChild(el('p', 'pm-aviso', M.erro(r, 'a fila não abriu'))); return; }
      var cnt = r.contagem || {};
      lista.appendChild(el('p', 'pm-dim', 'abertas ' + (cnt.aberta || 0) + ' · em análise ' + (cnt['em-analise'] || 0) +
        ' · procedentes ' + (cnt.procedente || 0) + ' · improcedentes ' + (cnt.improcedente || 0)));
      if (!r.denuncias.length) lista.appendChild(el('p', 'pm-dim', 'nenhuma denúncia aqui'));
      r.denuncias.forEach(function (d) { lista.appendChild(cartaoDenuncia(d)); });
    });
  };
  function cartaoDenuncia(d) {
    var c = el('div', 'pm-cartao');
    c.setAttribute('data-denuncia', d.id);
    var h = el('h3', null, '#' + d.id + ' · ' + d.categoriaNome);
    h.appendChild(etiqueta(d.estado, 'is-' + d.estado));
    c.appendChild(h);
    var alvoTxt = (d.alvo.nome || '(conta apagada)') + (d.alvo.id ? ' #' + d.alvo.id : '');
    c.appendChild(el('div', 'pm-dim', M.quando(d.criadoEm) + ' · ' + (d.denunciante.nome || '(conta apagada)') + ' denunciou ' + alvoTxt +
      (d.onde ? ' · em ' + d.onde : '') + (d.contraAlvo > 1 ? ' · ' + d.contraAlvo + ' denúncias contra' : '')));
    var marcas = el('div');
    if (d.alvo.banido) marcas.appendChild(etiqueta('banida agora', 'is-ban'));
    if (d.alvo.silenciado) marcas.appendChild(etiqueta('silenciada agora', 'is-sil'));
    c.appendChild(marcas);
    if (d.texto) c.appendChild(el('p', null, d.texto));
    if (d.falas && d.falas.length) {
      var fl = el('div', 'pm-falas');
      fl.appendChild(el('div', 'pm-dim', 'Falas anexadas — relato do cliente (o servidor não guarda o chat):'));
      d.falas.forEach(function (f) { fl.appendChild(el('div', null, (f.em ? M.quando(f.em) + ' — ' : '') + '“' + f.texto + '”')); });
      c.appendChild(fl);
    }
    if (d.mestre) c.appendChild(el('div', 'pm-dim', 'com ' + d.mestre.nome + (d.acao ? ' · ação: ' + d.acao.tipo + ' ' + (d.acao.duracao || '') : '') +
      (d.nota ? ' · nota: ' + d.nota : '')));
    if (d.resposta) c.appendChild(el('div', 'pm-dim', 'resposta ao denunciante: ' + d.resposta));
    if (d.estado === 'procedente' || d.estado === 'improcedente') return c;
    var resp = document.createElement('textarea');
    resp.className = 'pm-in';
    resp.maxLength = 500;
    resp.rows = 2;
    resp.placeholder = 'resposta ao denunciante (vai na carta; opcional)';
    resp.style.width = '100%';
    var nota = entrada('text', d.nota || '', null, { maxlength: '1000', placeholder: 'nota interna (só a Equipe vê)' });
    c.appendChild(resp);
    var ln = el('div', 'pm-linha');
    ln.appendChild(campo('nota', nota));
    c.appendChild(ln);
    var tipo = seletor([['', 'sem ação'], ['silenciar', 'silenciar'], ['banir', 'banir']], '');
    var f = formPunicao(false);
    f.raiz.style.display = 'none';
    tipo.addEventListener('change', function () { f.raiz.style.display = tipo.value ? '' : 'none'; });
    var la = el('div', 'pm-linha');
    la.appendChild(campo('na procedente', tipo));
    c.appendChild(la);
    c.appendChild(f.raiz);
    var acoes = el('div', 'pm-linha');
    function muda(estado, go) {
      var corpo = { id: d.id, estado: estado };
      if (resp.value.trim()) corpo.resposta = resp.value.trim();
      if (nota.value.trim()) corpo.nota = nota.value.trim();
      if (estado === 'procedente' && tipo.value) {
        var p = f.ler();
        if (p.erro) { go.disabled = false; aviso(p.erro); return; }
        p.tipo = tipo.value;
        corpo.acao = p;
      }
      api('/api/mestre/denuncia', { method: 'POST', body: corpo }).then(function (r) {
        go.disabled = false;
        aviso(r && r.ok ? 'Denúncia #' + d.id + ': ' + estado + '.' : M.erro(r, 'não deu'), r && r.ok ? 'good' : undefined);
        if (r && r.ok) desenha();
      });
    }
    if (d.estado === 'aberta') acoes.appendChild(bt('Em análise', 'mod-b', function (ev) { ev.target.disabled = true; muda('em-analise', ev.target); }));
    acoes.appendChild(confirma('Procedente', 'Confirmar: procedente', function (go) { muda('procedente', go); }, 'mod-b mod-b-ok'));
    acoes.appendChild(confirma('Improcedente', 'Confirmar: improcedente', function (go) { muda('improcedente', go); }, 'mod-b'));
    if (d.alvo.id) acoes.appendChild(bt('Ficha de ' + d.alvo.nome, 'mod-b', function () { fichaId = d.alvo.id; aba = 'jogadores'; desenha(); }));
    c.appendChild(acoes);
    return c;
  }

  /* ------------------------------------------------------------ Banimentos */
  ABAS.banimentos = function (alvo) {
    if (!PM.noServidor()) { semServidor(alvo, 'A lista de banimentos'); return; }
    var topo = el('div', 'pm-linha');
    topo.appendChild(campo('mostrar', seletor([['0', 'em vigor'], ['1', 'histórico (últimos 100)']], banTodos ? '1' : '0',
      function (v) { banTodos = v === '1'; desenha(); })));
    alvo.appendChild(topo);
    var lista = el('div');
    alvo.appendChild(lista);
    carregando(lista);
    api('/api/mestre/banimentos' + (banTodos ? '?todos=1' : '')).then(function (r) {
      lista.textContent = '';
      if (!r || !r.ok) { lista.appendChild(el('p', 'pm-aviso', M.erro(r, 'a lista não abriu'))); return; }
      function secao(titulo, itens, banir) {
        lista.appendChild(el('h3', null, titulo + ' (' + itens.length + ')'));
        if (!itens.length) { lista.appendChild(el('p', 'pm-dim', 'nenhum')); return; }
        itens.forEach(function (b) {
          var row = el('div', 'pm-item');
          var nm = el('div', 'pm-nome');
          var t = el('b', null, b.conta.nome + ' · #' + b.conta.id);
          if (b.ativo) t.appendChild(etiqueta('em vigor', banir ? 'is-ban' : 'is-sil'));
          if (b.legado) t.appendChild(etiqueta('de antes (sem motivo)'));
          nm.appendChild(t);
          nm.appendChild(el('span', 'pm-dim', (b.inicio ? 'desde ' + M.quando(b.inicio) + ' · ' : '') + M.fimTexto(b) +
            (b.motivo ? ' · ' + b.motivo : '') + (b.porNome ? ' · por ' + b.porNome : '') +
            (b.encerradoComo ? ' · ' + b.encerradoComo + (b.encerradoPorNome ? ' por ' + b.encerradoPorNome : '') : '')));
          row.appendChild(nm);
          if (b.ativo) {
            row.appendChild(confirma(banir ? 'Desbanir' : 'Devolver a voz', 'Confirmar', function (go) {
              api(banir ? '/api/mestre/desbanir' : '/api/mestre/dessilenciar', { method: 'POST', body: { conta: b.conta.id } })
                .then(function (r2) {
                  go.disabled = false;
                  aviso(r2 && r2.ok ? 'Feito: ' + b.conta.nome + '.' : M.erro(r2, 'não deu'), r2 && r2.ok ? 'good' : undefined);
                  if (r2 && r2.ok) desenha();
                });
            }, 'mod-b mod-b-ok'));
          }
          row.appendChild(bt('Ficha', 'mod-b', function () { fichaId = b.conta.id; aba = 'jogadores'; desenha(); }));
          lista.appendChild(row);
        });
      }
      secao('Banimentos', (r.banimentos || []).concat(banTodos ? [] : r.legado || []), true);
      secao('Silêncios', r.silencios || [], false);
    });
  };

  /* ------------------------------------------------------------ Auditoria */
  ABAS.auditoria = function (alvo) {
    if (!PM.noServidor()) { semServidor(alvo, 'A auditoria'); return; }
    var lista = el('div');
    alvo.appendChild(lista);
    carregando(lista);
    api('/api/mestre/auditoria?limite=100').then(function (r) {
      lista.textContent = '';
      if (!r || !r.ok) { lista.appendChild(el('p', 'pm-aviso', M.erro(r, 'a auditoria não abriu'))); return; }
      lista.appendChild(el('p', 'pm-dim', 'As 100 últimas ações de todo Mestre, gravadas pelo servidor junto com a ação.'));
      var tb = el('table', 'pm-tabela');
      var cab = el('tr');
      ['quando', 'Mestre', 'ação', 'conta', 'detalhes'].forEach(function (x) { cab.appendChild(el('th', null, x)); });
      tb.appendChild(cab);
      r.registros.forEach(function (a) {
        var tr = el('tr');
        tr.appendChild(el('td', null, M.quando(a.criadoEm)));
        tr.appendChild(el('td', null, (a.mestre && a.mestre.nome) || '—'));
        tr.appendChild(el('td', null, a.acao));
        tr.appendChild(el('td', null, a.alvo ? (a.alvo.nome || '?') + ' #' + a.alvo.id : '—'));
        var td = el('td');
        td.appendChild(el('code', null, typeof a.dados === 'string' ? a.dados : JSON.stringify(a.dados)));
        tr.appendChild(td);
        tb.appendChild(tr);
      });
      lista.appendChild(tb);
    });
  };

  /* ------------------------------------------------------------ Ferramentas */
  ABAS.ferramentas = function (alvo) {
    var G = JOGO.GM;
    if (G && G.paPp && G.definePaPp && G.ativo && G.ativo()) {
      var c = el('div', 'pm-cartao');
      c.appendChild(el('h3', null, 'PA e PP do Mestre'));
      var pp = G.paPp();
      var pa = entrada('number', pp.pa, null, { min: '1', max: '30' });
      var pv = entrada('number', pp.pp, null, { min: '1', max: '30' });
      var l = el('div', 'pm-linha');
      l.appendChild(campo('PA', pa));
      l.appendChild(campo('PP', pv));
      l.appendChild(bt('Aplicar', 'mod-b mod-b-ok', function () {
        G.definePaPp(pa.value, pv.value);
        aviso('O Mestre decidiu: ' + G.paPp().pa + ' PA e ' + G.paPp().pp + ' PP.', 'good');
      }));
      c.appendChild(l);
      c.appendChild(el('p', 'pm-dim', 'Mora neste navegador. No ar, uma batalha do Mestre com PA/PP fora do padrão (12/8) pode ' +
        'divergir no juiz do servidor (docs/SEGURANCA.md, limites conhecidos).'));
      alvo.appendChild(c);
    }
    var dbg = el('div', 'pm-cartao dbg-corpo');
    alvo.appendChild(dbg);
    var Dg = JOGO.Debug;
    if (!Dg || !Dg.desenhaEm || !Dg.desenhaEm(dbg)) {
      dbg.appendChild(el('p', 'pm-dim', 'O painel de teste (js/ui/debug.js) não está carregado nesta página.'));
    }
  };

  // ============================================================ o botão e o atalho
  function pintaBotao() {
    var deve = PM.ehMestre();
    if (deve && !botao) {
      estilo();
      botao = bt('⚖', 'pm-abrir', function () { PM.alterna(); });
      botao.title = 'Painel do Mestre (F9)';
      botao.setAttribute('aria-label', 'Painel do Mestre');
      document.body.appendChild(botao);
    } else if (!deve && botao) {
      if (botao.parentNode) botao.parentNode.removeChild(botao);
      botao = null;
      PM.fechar();
    }
  }
  PM.pintaBotao = pintaBotao;
  PM.ehAtalho = function (ev) {
    if (!ev) return false;
    if (ev.key === 'F9' && !ev.ctrlKey && !ev.altKey && !ev.metaKey) return true;
    return !!(ev.ctrlKey && ev.altKey && !ev.metaKey && (ev.key === 'm' || ev.key === 'M' || ev.code === 'KeyM'));
  };
  window.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && PM.aberto() && !document.querySelector('.mod-capa')) {
      ev.stopPropagation();                 // o Esc fecha o painel, e não a ficha da HUD que está por baixo
      PM.fechar();
      return;
    }
    if (!PM.ehAtalho(ev) || !PM.ehMestre()) return;
    // o atalho não chega ao jogo (o M sozinho abre o mapa; o F9 nada) nem ao navegador
    ev.preventDefault();
    ev.stopPropagation();
    PM.alterna();
  }, true);
  function liga() {
    pintaBotao();
    setInterval(pintaBotao, 3000);          // a sessão muda (entrar, sair, a marca tirada): o botão acompanha
    ['soterra:sessao', 'soterra:nuvem'].forEach(function (n) {
      try { window.addEventListener(n, function () { setTimeout(pintaBotao, 0); }); } catch (e) {}
    });
  }
  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', liga);
  else liga();
})();
