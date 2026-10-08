var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

// ============================================================================
// SOTERRA — O PAINEL DO MESTRE DENTRO DO JOGO (02/10) — dono: interface.
//
// Pedido do dono: "hoje o Mestre precisa sair para o menu/site para agir". O
// painel abre POR CIMA de qualquer tela (a praça, a antessala, a batalha), só
// para a conta do Mestre, por um botão discreto (⚖, em cima do "🔧 teste"),
// pelo F9 (ou Ctrl+Alt+M) e — 03/10 — pela tecla M e pelos botões ⚔ da HUD.
//
// O PAINEL ÚNICO (03/10, o dono: "junte"): o painel de antes da tecla M (o
// grimório, a Caixa do Mestre, os eventos do mundo — fichas da HUD) virou ABAS
// deste, sem função perdida e sem nada em dobro. Abas:
//   Caixa        as sete abas redondas de sempre (Itens, Conjuntos, Bichos,
//                Pedras, Selos e insígnias, Cartas, Pergaminhos). O Itens é a
//                busca por nome/slot/nível/raridade/elemento com estrelas, forja
//                e quantidade; o resto é desenhado pela HUD (UI.gmCaixaEm).
//                PARA QUEM: o "Para:" escolhe o próprio Mestre ou QUALQUER
//                jogador. Tudo entra PELO SERVIDOR (POST /api/mestre/dar: o
//                juiz põe no estado da conta; o jogador recebe "O Mestre te
//                enviou …" e uma carta da Equipe; o Mestre adota o próprio
//                estado sem recarregar). Em casa, sem sessão, no save local.
//   Moedas       vinténs (presente pela loja) e barras, para o mesmo "Para:"
//   Jogadores    buscar conta, a ficha, presentear do catálogo, a Caixa e as
//                moedas para ela, silenciar, banir
//   Denúncias    a fila, os estados e a ação ligada (silenciar/banir)
//   Banimentos   os em vigor (e o histórico), desbanir, dessilenciar
//   Auditoria    as últimas ações de todo Mestre
//   Eventos      os eventos do mundo (Agora, Agendar, Calendário — UI.gmAgendaEm)
//   Grimório     qualquer feitiço na barra do Mestre do Fundo (UI.gmGrimorioEm)
//   Ferramentas  PA/PP e "Aparelhar o Mestre" (JOGO.GM) e o MESMO corpo do
//                painel de teste (js/ui/debug.js, JOGO.Debug.desenhaEm) —
//                liberar classes, nível, elemento, efeitos.
// Os nomes de antes seguem valendo: UI.openSheet('gm' | 'gmcaixa' | 'gmagenda')
// abre o Grimório, a Caixa e os Eventos daqui.
//
// QUEM VÊ: a conta que o servidor marcou (a sessão com gm:true) ou, em casa, o
// modo Mestre ligado pela chave (JOGO.GM.ativo). Quem MANDA é o servidor: cada
// rota /api/mestre/* responde 403 a quem não tem a marca no banco, e toda ação
// fica na auditoria (servidor/moderacao.py). Sem sessão (o jogo local) a Caixa
// (no save deste navegador, que é o dono ali, e só para o próprio Mestre), o
// Grimório e as Ferramentas funcionam; os Eventos ficam só de leitura.
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
  PM.ABAS = [['caixa', 'Caixa'], ['moedas', 'Moedas'], ['jogadores', 'Jogadores'], ['guildas', 'Guildas'],
             ['denuncias', 'Denúncias'],
             ['banimentos', 'Banimentos'], ['auditoria', 'Auditoria'], ['eventos', 'Eventos'], ['grimorio', 'Grimório'],
             ['ferramentas', 'Ferramentas']];
  // os nomes de antes: 'itens' (a primeira aba deste painel até 03/10) e as fichas da HUD
  var APELIDOS = { itens: 'caixa', gm: 'grimorio', gmcaixa: 'caixa', gmagenda: 'eventos' };
  PM.LISTA_ITENS = 60;             // linhas de item desenhadas de uma vez (o resto pede filtro)
  var SLOTS = [['punho', 'Punho'], ['passo', 'Passo'], ['casca', 'Casca'], ['lume', 'Lume']];
  var ELEMENTOS = [['fogo', 'Fogo'], ['agua', 'Água'], ['terra', 'Terra'], ['ar', 'Ar'], ['neutro', 'Neutro']];

  var aba = 'caixa', capa = null, corpo = null, botao = null, abasEl = null, avisoEl = null;
  var filtro = { q: '', slot: '', raridade: '', elemento: '', nivelMax: '', estrelas: 0, nivel: 0, qtd: 1 };
  var destino = null;              // PARA QUEM a Caixa e as Moedas entregam: {id, nome} — null = o próprio Mestre
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
  /* 03/10: com o painel aberto, o aviso sai DENTRO dele — o da HUD (UI.toast) mora no #app, por baixo do
   * véu do painel, e o Mestre não via se a entrega tinha entrado */
  function aviso(texto, tipo) {
    if (!PM.aberto() || !avisoEl) { M.aviso(texto, tipo); return; }
    avisoEl.textContent = texto;
    avisoEl.className = 'pm-toast is-on' + (tipo === 'good' ? ' is-bom' : '');
    clearTimeout(aviso._t);
    aviso._t = setTimeout(function () { if (avisoEl) avisoEl.classList.remove('is-on'); }, 3600);
  }
  PM.aviso = aviso;
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
    // 03/10 (revisão): na batalha esse canto é do cadeado, do recentrar e do som — o ⚖ cobria o ⌖ e roubava o
    // toque. Lá o Mestre já tem o bt-gm; o painel abre da praça (ou pelo F9 no teclado)
    'html.celular body:has(.bt-top) .pm-abrir{display:none}',
    '.pm-capa{position:fixed;inset:0;z-index:9400;display:flex;align-items:center;justify-content:center;padding:12px;',
    'background:rgba(6,8,10,.62);pointer-events:auto;font:13px/1.45 var(--ui-sans,system-ui,sans-serif);color:#e8eef6}',
    '.pm-caixa{position:relative;width:min(940px,100%);height:min(88vh,760px);display:flex;flex-direction:column;border-radius:12px;',
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
    // 03/10: o aviso dentro do painel, o "Para:" da Caixa e das Moedas, e a Caixa da HUD dentro do corpo
    '.pm-toast{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);max-width:90%;padding:8px 14px;',
    'border-radius:9px;background:rgba(12,15,19,.96);color:#f0ead8;border:1px solid #3a4655;opacity:0;',
    'transition:opacity .2s;pointer-events:none;font:13px system-ui,sans-serif;z-index:2}',
    '.pm-toast.is-on{opacity:1}.pm-toast.is-bom{border-color:#2b6b46;color:#8fe0a0}',
    '.pm-para{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 10px;margin:0 0 8px;border-radius:9px;',
    'background:rgba(232,194,90,.06);border:1px solid rgba(232,194,90,.28)}',
    '.pm-para b{color:#ffe2a0}.pm-para.is-outro{background:rgba(120,170,255,.08);border-color:rgba(120,170,255,.35)}',
    '.pm-corpo .ms-caixa{max-height:none}',
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
    var x = bt('✕', 'pm-x', PM.fechar);
    x.title = 'Fechar (Esc)';
    cab.appendChild(x);
    cx.appendChild(cab);
    abasEl = el('div', 'pm-abas');
    cx.appendChild(abasEl);
    corpo = el('div', 'pm-corpo');
    cx.appendChild(corpo);
    avisoEl = el('div', 'pm-toast');
    avisoEl.setAttribute('role', 'status');
    avisoEl.setAttribute('aria-live', 'polite');
    cx.appendChild(avisoEl);
    capa.appendChild(cx);
    capa.addEventListener('click', function (ev) { if (ev.target === capa) PM.fechar(); });
    capa.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') { ev.stopPropagation(); PM.fechar(); } });
    M.prendeTeclas(capa);
    M.lacoTab(capa);                     // 03/10 (revisão): o Tab dá a volta dentro do painel
    capa._quem = quem;
  }
  PM.aberto = function () { return !!(capa && capa.parentNode); };
  PM.abrir = function (qual) {
    if (!PM.ehMestre()) return false;
    monta();
    if (qual === 'itens' && JOGO.UI && JOGO.UI.gmCaixaAba) JOGO.UI.gmCaixaAba('itens');
    if (qual) aba = APELIDOS[qual] || qual;
    if (!ABAS[aba]) aba = 'caixa';
    var c = eu();
    capa._quem.textContent = PM.noServidor() ? (c.nome || '') + ' · #' + c.id : 'jogo local (sem servidor)';
    if (!capa.parentNode) document.body.appendChild(capa);
    desenha();
    // o foco vem para o painel: as teclas digitadas aqui não viram atalho do jogo (o I, o M)
    try { if (!capa.contains(document.activeElement)) capa.focus(); } catch (e) {}
    return true;
  };
  PM.fechar = function () { if (capa && capa.parentNode) capa.parentNode.removeChild(capa); };
  PM.alterna = function (qual) { return PM.aberto() ? (PM.fechar(), false) : PM.abrir(qual); };
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
  /* A busca de peças (a aba Itens da Caixa): nome, slot, raridade, elemento e nível de uso; estrelas, forja e
   * quantidade de cada entrega. Desenhada pela própria Caixa da HUD (ctx.itensEm) ou, sem HUD, sozinha. */
  function itensEm(alvo) {
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
      ? 'entra pelo servidor (o juiz põe no estado da conta e o jogo dela adota na hora)'
      : 'jogo local: entra no save deste navegador'));
    alvo.appendChild(l2);
    var lista = el('div', 'pm-lista');
    alvo.appendChild(lista);
    var rotulo = destino ? 'Enviar a ' + destino.nome : 'Pôr no meu inventário';
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
        row.appendChild(bt(rotulo, 'mod-b mod-b-ok', function (ev) { PM.poeItem(it.id, ev && ev.target); }));
        lista.appendChild(row);
      });
    }
    pinta();
  }
  PM.itensEm = itensEm;

  /* PARA QUEM: o próprio Mestre ou um jogador (a busca de contas). Só no servidor: em casa, sem sessão, a
   * Caixa é a do save deste navegador. */
  function paraBar(alvo) {
    var c = eu();
    var bar = el('div', 'pm-para' + (destino ? ' is-outro' : ''));
    bar.appendChild(el('span', 'pm-dim', 'Para:'));
    bar.appendChild(el('b', null, destino ? destino.nome + ' · #' + destino.id : (c.nome ? c.nome + ' (você)' : 'você')));
    alvo.appendChild(bar);
    if (!PM.noServidor()) {
      bar.appendChild(el('span', 'pm-dim', 'jogo local: entregar a um jogador pede a conta do Mestre no servidor'));
      return;
    }
    if (destino) {
      bar.appendChild(el('span', 'pm-dim', 'ele recebe "O Mestre te enviou …" e uma carta da Equipe'));
      bar.appendChild(bt('Voltar para mim', 'mod-b', function () { destino = null; desenha(); }));
      return;
    }
    var escolher = bt('Escolher um jogador…', 'mod-b', function () {
      escolher.disabled = true;
      var caixa = el('div', 'pm-cartao');
      bar.parentNode.insertBefore(caixa, bar.nextSibling);
      var q = escolheConta(caixa, function (ct) { PM.paraConta(ct); desenha(); }, 'Entregar a esta conta');
      try { q.focus(); } catch (e) {}
    });
    bar.appendChild(escolher);
  }
  PM.destino = function () { return destino; };
  /* 03/10 (revisão): a própria conta escolhida na busca (ou a ficha dela) é o "você" — senão a entrega ia como
   * "para outro" e o jogo do Mestre não adotava a resposta (a peça só aparecia na op seguinte, sem aviso) */
  PM.paraConta = function (c) {
    destino = (c && c.id !== eu().id) ? { id: c.id, nome: c.nome } : null;
    return destino;
  };

  /* A ENTREGA (03/10): o pedido {tipo, …} no formato do POST /api/mestre/dar (servidor/moderacao.py,
   * TIPOS_DAR). No ar, SÓ pelo servidor, na conta do "Para:"; em casa (sem sessão), no save local, pelas
   * mesmas portas da Caixa (JOGO.GM). `rotulo` = o que o aviso diz se o servidor não mandar o texto dele.
   * Resolve a resposta ({ok, …}) ou null. */
  var LOCAL = {
    item: function (p) {
      var G = JOGO.GM, P = JOGO.Progress, q = p.qtd || 1;
      if (!G || !G.cru || !G.ativo()) return false;
      if (P && P.bagFree && !P.bagFree(q)) { aviso('O saco não tem vaga para ' + q + '.'); return null; }
      for (var i = 0; i < q; i++) if (!G.cru.item(p.itemId, p.nivel || 0, p.estrelas || 0)) return false;
      return true;
    },
    set: function (p) { return JOGO.GM.pegaSet(p.setId) > 0; },
    pet: function (p) { return JOGO.GM.pegaPet(p.petId, !!p.topo); },
    pedras: function (p) { return JOGO.GM.pegaPedras(p.stoneId, p.n); },
    selos: function (p) { return JOGO.GM.pegaSelos(p.elemento, p.n); },
    insignias: function (p) { return JOGO.GM.pegaInsignias(p.n); },
    cartas: function (p) { return JOGO.GM.pegaCartas(p.classId, p.topo ? 'topo' : p.n); },
    pergaminho: function (p) {
      var n = JOGO.GM.pegaPergaminho(p.pergaminho, p.n);
      if (!n) { aviso('Já está no teto do inventário.'); return null; }
      return true;
    },
    'bonus-xp': function (p) { return JOGO.GM.pegaBonusXp(p.dias); }
  };
  PM.entrega = function (pedido, rotulo, b) {
    rotulo = rotulo || 'a entrega';
    if (!PM.noServidor()) {
      var S = JOGO.Sessao;
      if (S && S.ativa && S.ativa()) {
        aviso('Esta conta não tem a marca de Mestre no servidor: nada entra por aqui.');
        return Promise.resolve(null);
      }
      var f = LOCAL[pedido.tipo], ok = false;
      try { ok = (f && JOGO.GM) ? f(pedido) : false; } catch (e) { ok = false; }
      if (ok === null) return Promise.resolve(null);       // a própria porta já avisou (o saco cheio, o teto)
      if (ok) {
        try { if (JOGO.UI && JOGO.UI.repaint) JOGO.UI.repaint(); } catch (e2) {}
        aviso(rotulo + ' no seu inventário (jogo local).', 'good');
        return Promise.resolve({ ok: true, local: true });
      }
      aviso('não deu — o modo Mestre está desligado nesta conta?');
      return Promise.resolve(null);
    }
    var para = destino;
    var corpoP = { idem: M.idem() };
    Object.keys(pedido).forEach(function (k) { corpoP[k] = pedido[k]; });
    if (para) corpoP.conta = para.id;
    var A = JOGO.Autoridade;
    // a marca de agora: se o Mestre fizer outra coisa enquanto a entrega viaja, a resposta não apaga isso
    var marca = (A && A.marca) ? A.marca() : null;
    var antes = (!para && A && A.descarrega) ? Promise.resolve(A.descarrega()).then(null, function () {}) : Promise.resolve();
    if (b) b.disabled = true;
    return antes.then(function () {
      return api('/api/mestre/dar', { method: 'POST', body: corpoP });
    }).then(function (r) {
      if (b) b.disabled = false;
      if (r && r.ok) {
        if (!para) {
          try {
            if (A && A.adotaDeFora) A.adotaDeFora(r, marca);
            else if (A && A.adotaResposta) A.adotaResposta(r);
          } catch (e) {}
        }
        aviso((r.texto || rotulo) + (para ? ' a caminho de ' + para.nome + '.' : ' no seu inventário.'), 'good');
      } else aviso(M.erro(r, 'não entrou'));
      return r;
    });
  };

  /* A peça da busca: a quantidade, as estrelas e a forja escolhidas lá em cima. */
  PM.poeItem = function (itemId, b) {
    var it = (D().items || {})[itemId];
    if (!it) return Promise.resolve(null);
    var qtd = inteiro(filtro.qtd, 1, 20) || 1;
    var rot = qtd + '× ' + (it.name || itemId) + (filtro.nivel ? ' +' + filtro.nivel : '') + (filtro.estrelas ? ' ★' + filtro.estrelas : '');
    return PM.entrega({ tipo: 'item', itemId: itemId, estrelas: filtro.estrelas, nivel: filtro.nivel, qtd: qtd }, rot, b);
  };

  /* ------------------------------------------------------------ Caixa */
  function ctxDoPainel(qual) {
    return {
      entrega: function (pedido, rotulo) { return PM.entrega(pedido, rotulo); },
      destino: destino,
      aviso: aviso,
      confirma: confirmaJanela,
      refaz: desenha,
      aberta: function () { return PM.aberto() && aba === qual; },
      itensEm: itensEm
    };
  }
  /* a pergunta antes de apagar (os eventos do mundo): uma janela por cima do painel (z 9600) */
  function confirmaJanela(titulo, html, fn) {
    var j = M.janela(titulo);
    var p = el('p');
    p.innerHTML = html;            // o texto vem da HUD, já escapado por ela (esc)
    j.caixa.appendChild(p);
    var acoes = el('div', 'mod-acoes');
    acoes.appendChild(bt('Cancelar', 'mod-b', j.fecha));
    acoes.appendChild(bt('Confirmar', 'mod-b mod-b-perigo', function () { j.fecha(); fn(); }));
    j.caixa.appendChild(acoes);
    return j;
  }
  PM.confirma = confirmaJanela;
  ABAS.caixa = function (alvo) {
    paraBar(alvo);
    var U = JOGO.UI;
    if (U && U.gmCaixaEm) { U.gmCaixaEm(alvo, ctxDoPainel('caixa')); return; }
    // sem a HUD (uma página de prova, o site): só as peças
    alvo.appendChild(el('p', 'pm-dim', 'Conjuntos, bichos, pedras, selos, cartas e pergaminhos aparecem com o jogo inteiro aberto.'));
    itensEm(alvo);
  };
  ABAS.eventos = function (alvo) {
    var U = JOGO.UI;
    if (U && U.gmAgendaEm) U.gmAgendaEm(alvo, ctxDoPainel('eventos'));
    else alvo.appendChild(el('p', 'pm-aviso', 'Os eventos do mundo aparecem com o jogo inteiro aberto.'));
  };
  ABAS.grimorio = function (alvo) {
    var U = JOGO.UI;
    if (U && U.gmGrimorioEm) U.gmGrimorioEm(alvo, ctxDoPainel('grimorio'));
    else alvo.appendChild(el('p', 'pm-aviso', 'O grimório aparece com o jogo inteiro aberto.'));
  };

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
  // as moedas: vinténs e barras (os selos e as insígnias são da Caixa, "Selos e insígnias")
  ABAS.moedas = function (alvo) {
    if (!PM.noServidor()) { semServidor(alvo, 'Dar moedas'); return; }
    var c = eu();
    var para = destino || { id: c.id, nome: c.nome };
    paraBar(alvo);
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
    alvo.appendChild(el('p', 'pm-dim', 'Selos do Colecionador e insígnias: na Caixa, em "Selos e insígnias".'));
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
      // 03/10: a Caixa inteira (peças com estrelas, conjuntos, bichos, pedras, selos, cartas, pergaminhos) para ESTA conta
      var lc = el('div', 'pm-linha');
      lc.appendChild(bt('A Caixa para esta conta…', 'mod-b mod-b-ok', function () { PM.paraConta(c); aba = 'caixa'; desenha(); }));
      lc.appendChild(bt('Vinténs e barras…', 'mod-b', function () { PM.paraConta(c); aba = 'moedas'; desenha(); }));
      pres.appendChild(lc);
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

  /* ------------------------------------------------------------ Guildas (04/10)
   * Dono: "analise a guilda, está confuso; a da minha conta teste sumiu.. na verdade exclua a guilda Game Over
   * do jogo.. vou refazer para sair os bugs". A aba mostra TODAS as guildas do servidor — até a da equipe, que
   * no jogo não sai em lista nem em ranking — com o líder, quem está dentro e o que há no banco: é aqui que se
   * vê em que guilda uma conta está de verdade. E desfaz uma guilda inteira (servidor/guilda.py, _g_desfaz):
   * as peças do banco voltam aos donos, o empréstimo é recolhido, os membros recebem uma carta e o nome fica
   * livre. Não tem volta, então a confirmação é DIGITAR o nome da guilda. */
  ABAS.guildas = function (alvo) {
    if (!PM.noServidor()) { semServidor(alvo, 'A lista de guildas'); return; }
    alvo.appendChild(el('p', 'pm-dim', 'Todas as guildas do servidor, até a da equipe (que os jogadores não veem em lista ' +
      'nem em ranking). Desfazer devolve as peças do banco aos donos e avisa cada membro por carta.'));
    var lista = el('div');
    alvo.appendChild(lista);
    carregando(lista);
    api('/api/mestre/guildas').then(function (r) {
      lista.textContent = '';
      if (!r || !r.ok) { lista.appendChild(el('p', 'pm-aviso', M.erro(r, 'a lista não abriu'))); return; }
      var gs = r.guildas || [];
      lista.appendChild(el('h3', null, 'Guildas (' + gs.length + ')'));
      if (!gs.length) { lista.appendChild(el('p', 'pm-dim', 'nenhuma guilda no servidor')); return; }
      gs.forEach(function (g) {
        var row = el('div', 'pm-item pm-guilda');
        var nm = el('div', 'pm-nome');
        var t = el('b', null, g.nome + ' · nº ' + g.id);
        if (g.daEquipe) t.appendChild(etiqueta('da equipe · escondida dos jogadores', 'is-gm'));
        nm.appendChild(t);
        var lider = g.lider || {};
        nm.appendChild(el('span', 'pm-dim', 'nível ' + g.nivel + ' · ' + g.xp + ' XP · líder ' + (lider.nome || '?') +
          ' (#' + lider.id + ') · ' + g.totalMembros + ' membro(s) · ' + g.pecas + ' peça(s) no banco' +
          (g.emprestadas ? ' (' + g.emprestadas + ' emprestada(s))' : '') +
          ' · porta ' + (g.porta === 'convite' ? 'por convite' : 'aberta')));
        var ms = (g.membros || []).map(function (m) {
          return m.nome + ' #' + m.id + (m.cargo === 'lider' ? ' (líder)' : m.cargo === 'oficial' ? ' (oficial)' : '');
        });
        if (g.totalMembros > ms.length) ms.push('… e mais ' + (g.totalMembros - ms.length));
        nm.appendChild(el('span', 'pm-dim', 'membros: ' + (ms.join(', ') || 'ninguém')));
        row.appendChild(nm);
        row.appendChild(bt('Desfazer…', 'mod-b mod-b-perigo', function () { PM.desfazGuilda(g); }));
        lista.appendChild(row);
      });
    });
  };
  PM.desfazGuilda = function (g) {
    var j = M.janela('Desfazer a guilda ' + g.nome);
    j.caixa.appendChild(el('p', null, 'A guilda sai do jogo inteira e não tem volta: os ' + g.totalMembros +
      ' membro(s) ficam sem guilda e recebem uma carta da Equipe; as ' + g.pecas + ' peça(s) do banco voltam aos donos ' +
      '(para o saco, ou para o cofre do Acampamento se o saco estiver cheio); a cópia emprestada é recolhida de quem ' +
      'pegou; mural, cofre, dízimos, pedidos, convites e a inscrição na guerra são apagados. O nome fica livre.'));
    var inp = entrada('text', '', function () { ok.disabled = inp.value.trim() !== g.nome; },
                      { placeholder: g.nome, maxlength: '24', autocomplete: 'off' });
    j.caixa.appendChild(campo('para confirmar, digite o nome da guilda', inp));
    var erro = el('p', 'pm-aviso');
    erro.style.display = 'none';
    j.caixa.appendChild(erro);
    var acoes = el('div', 'mod-acoes');
    acoes.appendChild(bt('Cancelar', 'mod-b', j.fecha));
    var ok = bt('Desfazer a guilda', 'mod-b mod-b-perigo pm-desfaz', function () {
      if (inp.value.trim() !== g.nome) return;
      ok.disabled = true;
      api('/api/mestre/guilda/desfazer', { method: 'POST', body: { gid: g.id, nome: inp.value.trim() } }).then(function (r) {
        if (!r || !r.ok) {
          ok.disabled = false;
          erro.textContent = M.erro(r, 'a guilda não foi desfeita') + ' — nada foi apagado.';
          erro.style.display = '';
          return;
        }
        j.fecha();
        var d = r.desfeita;
        aviso(d ? 'A guilda ' + d.nome + ' foi desfeita: ' + d.membros + ' membro(s) avisado(s), ' + d.pecas +
                  ' peça(s) devolvida(s), ' + d.recolhidos + ' empréstimo(s) recolhido(s).'
                : 'A guilda ' + g.nome + ' já tinha sido desfeita.', 'good');
        if (PM.aberto() && aba === 'guildas') desenha();
      });
    });
    ok.disabled = true;
    acoes.appendChild(ok);
    j.caixa.appendChild(acoes);
    return j;
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
      // 03/10: o "Aparelhar o Mestre" morava na ficha da tecla M — o painel único o guarda aqui, junto do PA/PP
      if (G.aparelha) {
        l.appendChild(bt('Aparelhar o Mestre', 'mod-b', function () {
          if (G.aparelha()) aviso('Panóplia no saco e os quatro caminhos abertos.', 'good');
          else aviso('não deu — o Progress não respondeu');
        }));
      }
      c.appendChild(l);
      c.appendChild(el('p', 'pm-dim', 'Mora neste navegador. No ar, uma batalha do Mestre com PA/PP fora do padrão (12/8) pode ' +
        'divergir no juiz do servidor (docs/SEGURANCA.md, limites conhecidos).'));
      alvo.appendChild(c);
    }
    // 05/10 (o dono: "preciso que no menu do mestre ele consiga liberar [...] o ranking da coroa também"):
    // o Mestre escolhia aqui qual das dez coroas do ranking carregava. 08/10 à noite (o dono: "fiz a arte
    // da coroa do GM que deve ser liberada somente para ele"): a coroa do Mestre é a DELE, fixa
    // (JOGO.Brasa.MESTRE), e o seletor saiu — o cartão só diz isso, para ninguém procurar a escolha aqui
    if (G && G.ativo && G.ativo()) {
      var cc = el('div', 'pm-cartao pm-coroa-fixa');
      cc.appendChild(el('h3', null, 'Coroa do Mestre'));
      cc.appendChild(el('p', 'pm-dim', 'A coroa acima da cabeça do Mestre é a dele, fixa — a arte do dono, com o brilho vermelho. ' +
        'Só a conta do Mestre a carrega (o servidor carimba quem é); as dez coroas do ranking são dos jogadores. ' +
        'Pontos, partidas e placar da Arena não mudam; "Esconder a coroa" na ficha continua valendo por cima.'));
      alvo.appendChild(cc);
    }
    // 04/10 (o dono: "o modo teste retire também, qualquer coisa dou nível para outra conta minha"): o corpo
    // do painel de teste (js/ui/debug.js) não é mais desenhado aqui — nível e item saem pela Caixa
  };

  // ============================================================ o botão e o atalho
  function pintaBotao() {
    // 04/10 (o dono: "remova o binóculo"): o ⚖ flutuante abria o MESMO painel do "⚔ Mestre" da praça e da
    // batalha — saiu. O painel abre por esse botão e pelo M/F9; aqui só sobra fechá-lo quando a conta deixa
    // de ser a do Mestre (saiu, trocou de conta, a marca foi tirada).
    if (!PM.ehMestre() && PM.aberto()) PM.fechar();
  }
  PM.pintaBotao = pintaBotao;
  PM.ehAtalho = function (ev) {
    if (!ev) return false;
    if (ev.key === 'F9' && !ev.ctrlKey && !ev.altKey && !ev.metaKey) return true;
    return !!(ev.ctrlKey && ev.altKey && !ev.metaKey && (ev.key === 'm' || ev.key === 'M' || ev.code === 'KeyM'));
  };
  PM.ehTeclaM = function (ev) {
    if (!ev || ev.ctrlKey || ev.altKey || ev.metaKey || String(ev.key || '').toLowerCase() !== 'm') return false;
    var t = ev.target;
    return !(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable));
  };
  window.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && PM.aberto() && !document.querySelector('.mod-capa')) {
      ev.stopPropagation();                 // o Esc fecha o painel, e não a ficha da HUD que está por baixo
      PM.fechar();
      return;
    }
    // 03/10: a tecla M abre o painel pela HUD (hud.js) — e o fecha aqui, porque a capa prende as teclas
    if (PM.aberto() && !document.querySelector('.mod-capa') && PM.ehTeclaM(ev)) {
      ev.preventDefault();
      ev.stopPropagation();
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
