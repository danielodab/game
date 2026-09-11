/* loja.js — a loja de vinténs do site entregando no jogo (Fase C, 10/09).
 *
 * O jogador compra no site (site/loja.html → POST /api/loja/comprar) e o
 * pedido fica PENDENTE no cartório, com a entrega congelada. O jogo, aberto
 * logado na conta local Principal, RETIRA os pedidos (POST /api/loja/retirar:
 * o pendente vira retirado), aplica cada um no save local e anota o id em
 * `db.loja` (DB.lojaAplica / lojaRecusa). A anotação sobe no PUT /api/save de
 * sempre, e o SERVIDOR fecha o pedido (entregue/estornado) no mesmo BEGIN
 * IMMEDIATE que grava o save: a entrega nunca se separa da versão do save que
 * a contém — um 409 de outra máquina descarta as duas juntas e o pedido volta
 * na próxima retirada. Por isso não há rota de confirmação, e a nuvem.js não
 * muda: as gravações de sempre agendam a subida.
 *
 * QUANDO BUSCA — só com sessão, na conta local Principal, com a Nuvem ligada
 * e sem `parada`, e só na aba visível (dentro de navigator.locks, se houver):
 *   · a 1ª vez depois do 1º aviso `soterra:nuvem` de tipo emdia ou subiu
 *     (antes disso o save local ainda pode ser trocado pelo do servidor);
 *   · quando a aba volta para a frente (no máximo 1 a cada 30 s);
 *   · a cada 5 minutos;
 *   · quando o site avisa que comprou (BroadcastChannel 'soterra-loja').
 * Um aviso de que a página vai recarregar (puxou, desatualizado, limpou,
 * conta) CONGELA tudo: nada se aplica num save que está para ser trocado.
 *
 * APLICAR, na ordem:
 *   1. id já anotado: pula;
 *   2. tipo desconhecido: pula SEM anotar (uma versão nova do jogo aplica);
 *   3. checagem de leitura: pedra fora de DATA.stones ou a Âncora, classe
 *      inexistente/que nasce liberada/gm → 'item-invalido'; classe já
 *      liberada → 'classe-ja-liberada' (estorno; nunca vira carta de estrela);
 *   4. DB.lojaAplica decide e grava por dentro (sem saldo → 'sem-saldo');
 *   5. no .then IMEDIATO, sem rede no meio, a entrega pelo Progress; se ela
 *      lançar, DB.lojaDesfaz devolve os vinténs ('erro-local');
 *   6. window 'soterra:loja' {tipo:'entregue'|'recusado', pedido, motivo}.
 *
 * JOGO.Loja: buscar(), aplicar(pedido) → Promise<{ok, motivo}>, estado().
 * Ganchos de teste: `_semRede` (uma função (rota, op) → resposta, no lugar do
 * cartório), `_semTrava` (sem a trava entre abas) e `_reinicia()` (o módulo
 * volta ao estado de página nova). */
(function () {
  'use strict';
  var JOGO = window.JOGO = window.JOGO || {};
  var L = JOGO.Loja = {};
  L.INTERVALO_MS = 5 * 60 * 1000;   // a busca de fundo
  L.VISIVEL_MS = 30 * 1000;         // a aba voltando para a frente busca no máximo 1 vez nisto
  L.CANAL = 'soterra-loja';         // o nome do BroadcastChannel e da trava
  L._semRede = null;
  /* teste: pula a trava entre abas. O Chrome sem cabeça com tempo virtual só
   * concede a trava do navigator.locks muito depois (a resposta vem de fora
   * da página), e a prova travava esperando; no navegador de verdade ela sai
   * na hora. */
  L._semTrava = false;

  var TIPOS = { pedras: 1, classe: 1, pergaminho: 1 };
  var liberada = false, congelada = false, buscando = null, ultima = 0, erro = null;
  var compraPendente = false, timer = null, historico = [];

  function S() { return JOGO.Sessao || null; }
  function N() { return JOGO.Nuvem || null; }
  function P() { return JOGO.Progress || null; }
  function DB() { return JOGO.DB || null; }
  function D() { return JOGO.DATA || {}; }
  function oculta() { try { return !!(typeof document !== 'undefined' && document.hidden); } catch (e) { return false; } }
  function inteiroPos(v, teto) {
    return typeof v === 'number' && isFinite(v) && v > 0 && Math.floor(v) === v && v <= teto;
  }
  function copia(o) { try { return JSON.parse(JSON.stringify(o)); } catch (e) { return null; } }

  /* Por que NÃO buscar agora (null = pode). */
  function porQueNao() {
    if (congelada) return 'a página vai recarregar';
    var s = S(), n = N();
    if (!s || !s.ativa || !s.ativa()) return 'sem sessão';
    if (!n || !n.estado) return 'sem a nuvem';
    var e = n.estado();
    if (!e.principal) return 'conta local';
    if (!e.ligada) return 'a nuvem está desligada';
    if (e.parada) return 'a nuvem está parada';
    if (!liberada) return 'esperando a nuvem';
    if (!DB() || !DB().lojaAplica || !P()) return 'sem o jogo';
    if (oculta()) return 'aba escondida';
    return null;
  }

  L.estado = function () {
    var nao = porQueNao();
    return { liberada: liberada, congelada: congelada, buscando: !!buscando, ultimaBusca: ultima,
             erro: erro, pode: !nao, porQueNao: nao, historico: historico.slice() };
  };

  function pede(rota, op) {
    if (typeof L._semRede === 'function') {
      try { return Promise.resolve(L._semRede(rota, op)); }
      catch (e) { return Promise.resolve({ ok: false, status: 0, erro: String(e && e.message || e) }); }
    }
    return S().api(rota, op);
  }

  /* A trava entre abas do mesmo navegador: quem não pega, não busca (a outra
   * aba já está buscando). Sem Web Locks — ou se o navegador recusar a trava
   * nesta origem —, segue sem ela: a aba visível é uma só. */
  function comTrava(fn) {
    var lk = null;
    if (L._semTrava) return fn();
    try { lk = (typeof navigator !== 'undefined' && navigator.locks && navigator.locks.request) ? navigator.locks : null; }
    catch (e) { lk = null; }
    if (!lk) return fn();
    var rodou = false, p;
    try {
      p = lk.request(L.CANAL, { ifAvailable: true }, function (trava) {
        rodou = true;
        if (!trava) return { ok: false, erro: 'outra aba está buscando' };
        return fn();
      });
    } catch (e2) { return fn(); }
    return Promise.resolve(p).then(null, function (e3) { if (!rodou) return fn(); throw e3; });
  }

  L.buscar = function () {
    var nao = porQueNao();
    if (nao) return Promise.resolve({ ok: false, erro: nao });
    if (buscando) return buscando;
    buscando = comTrava(function () {
      var nao2 = porQueNao();                      // de novo, dentro da trava
      if (nao2) return { ok: false, erro: nao2 };
      return pede('/api/loja/retirar', { method: 'POST', body: {} }).then(function (r) {
        ultima = Date.now();
        if (!r || !r.ok) {
          erro = (r && r.erro) || ('HTTP ' + (r ? r.status : '?'));
          return { ok: false, erro: erro, status: r ? r.status : 0 };
        }
        erro = null;
        var lista = Array.isArray(r.pedidos) ? r.pedidos : [];
        return emFila(lista).then(function (res) { return { ok: true, pedidos: lista.length, resultados: res }; });
      });
    }).then(function (x) { buscando = null; return x; }, function (e) {
      buscando = null;
      erro = String(e && e.message || e);
      return { ok: false, erro: erro };
    });
    return buscando;
  };

  // um pedido de cada vez: cada um vê o saldo que o anterior deixou
  function emFila(lista) {
    var res = [];
    return lista.reduce(function (p, ped) {
      return p.then(function () { return L.aplicar(ped).then(function (r) { res.push(r); }); });
    }, Promise.resolve()).then(function () { return res; });
  }

  function registra(p, tipo, motivo) {
    historico.push({ id: p && p.id, sku: (p && p.sku) || null, nome: (p && p.nome) || null,
                     tipo: tipo, motivo: motivo || null, em: Date.now() });
    if (historico.length > 50) historico.shift();
  }
  function avisa(tipo, p, motivo) {
    registra(p, tipo, motivo);
    try {
      window.dispatchEvent(new CustomEvent('soterra:loja', { detail: { tipo: tipo, pedido: copia(p), motivo: motivo || null } }));
    } catch (e) {}
  }

  function ancora() {
    var up = D().upgrade || {};
    return up.guardStone || 'stone-anchor';
  }
  /* 3. a checagem SÓ DE LEITURA: nada grava aqui */
  function confere(ent) {
    var prog = P();
    if (ent.tipo === 'pedras') {
      var sd = (typeof ent.alvo === 'string') ? (D().stones || {})[ent.alvo] : null;
      if (!sd || ent.alvo === ancora() || sd.element === 'forja') return 'item-invalido';
      if (!inteiroPos(ent.qtd, 999)) return 'item-invalido';
      return null;
    }
    if (ent.tipo === 'classe') {
      var cd = (typeof ent.alvo === 'string') ? (D().classes || {})[ent.alvo] : null;
      if (!cd || cd.startsUnlocked || ent.alvo === 'gm') return 'item-invalido';
      if (prog.isClassUnlocked(ent.alvo)) return 'classe-ja-liberada';
      return null;
    }
    if (ent.tipo === 'pergaminho') {
      if (ent.alvo !== 'xp' && ent.alvo !== 'elemento') return 'item-invalido';
      if (!inteiroPos(ent.qtd, 99)) return 'item-invalido';
      return null;
    }
    return 'item-invalido';
  }
  /* 5. a entrega — lança se o Progress não aceitar (o chamador desfaz) */
  function entrega(ent) {
    var prog = P();
    if (ent.tipo === 'pedras') {
      if (!prog.addStones(ent.alvo, ent.qtd)) throw new Error('as pedras não entraram');
      return;
    }
    if (ent.tipo === 'classe') {
      // nunca só unlockClass: as cartas vão até o custo, e o excedente fica
      // em ZERO — as próximas cartas que caírem já contam para estrela
      var info = prog.cardInfo(ent.alvo) || {};
      var falta = Math.max(0, Math.floor(Number(info.unlockCost) || 0) - Math.floor(Number(info.cards) || 0));
      if (falta > 0) prog.addCards(ent.alvo, falta);
      if (!prog.isClassUnlocked(ent.alvo)) prog.unlockClass(ent.alvo);
      if (!prog.isClassUnlocked(ent.alvo)) throw new Error('a classe não liberou');
      return;
    }
    if (ent.tipo === 'pergaminho') {
      if (!prog.addPergaminho || !prog.addPergaminho(ent.alvo, ent.qtd)) throw new Error('o pergaminho não entrou');
      return;
    }
    throw new Error('tipo sem entrega');
  }
  function recusa(p, id, motivo) {
    return DB().lojaRecusa(id, motivo).then(function (r) {
      if (r && r.ja) return { ok: false, motivo: 'ja' };
      if (!r || !r.ok) return { ok: false, motivo: 'erro-local' };
      avisa('recusado', p, motivo);
      return { ok: false, motivo: motivo };
    });
  }

  /* o resultado de cada pedido leva o id dele (a busca devolve a lista) */
  L.aplicar = function (p) {
    var id = (p && typeof p === 'object') ? p.id : null;
    return aplicaUm(p).then(function (r) {
      if (r && typeof r === 'object') r.id = id;
      return r;
    });
  };
  function aplicaUm(p) {
    var db = DB(), prog = P();
    if (!db || !db.lojaAplica || !prog) return Promise.resolve({ ok: false, motivo: 'sem-jogo' });
    if (congelada) return Promise.resolve({ ok: false, motivo: 'recarregando' });
    var id = (p && inteiroPos(p.id, 9007199254740991)) ? p.id : 0;
    if (!id) return Promise.resolve({ ok: false, motivo: 'pedido-invalido' });
    var ent = (p.entrega && typeof p.entrega === 'object') ? p.entrega : {};
    var preco = Math.max(0, Math.floor(Number(p.preco) || 0));
    return db.lojaVer().then(function (anot) {
      // 1. já tratado aqui
      if (anot.aplicadas.indexOf(id) >= 0 || anot.recusadas.some(function (r) { return r.id === id; })) {
        return { ok: false, motivo: 'ja' };
      }
      // 2. tipo que esta versão não conhece: fica para uma versão nova
      if (TIPOS[ent.tipo] !== 1) {
        registra(p, 'ignorado', 'tipo-desconhecido');
        return { ok: false, motivo: 'tipo-desconhecido' };
      }
      // 3. a checagem de leitura
      var ruim = confere(ent);
      if (ruim) return recusa(p, id, ruim);
      // 4. decide e grava por dentro
      return db.lojaAplica(id, preco).then(function (r) {
        if (r && r.ja) return { ok: false, motivo: 'ja' };
        if (r && r.semSaldo) return recusa(p, id, 'sem-saldo');
        if (!r || !r.ok) return { ok: false, motivo: 'erro-local' };
        // 5. a entrega, neste mesmo tique. Se a página começou a recarregar
        // no meio (outra máquina mandou o save dela), não se escreve mais
        // nada: o save de lá já está no disco, e este débito morre com a página
        if (congelada) return { ok: false, motivo: 'recarregando' };
        try {
          entrega(ent);
        } catch (e) {
          return db.lojaDesfaz(id, preco, 'erro-local').then(function () {
            avisa('recusado', p, 'erro-local');
            return { ok: false, motivo: 'erro-local', erro: String(e && e.message || e) };
          });
        }
        avisa('entregue', p, null);
        return { ok: true, motivo: null, moedas: r.moedas };
      });
    });
  }

  // ------------------------------------------------------------- os gatilhos
  function ouveNuvem(det) {
    if (!det || typeof det !== 'object') return;
    var t = det.tipo, n = N();
    if ((t === 'puxou' || t === 'desatualizado' || t === 'limpou' || t === 'conta') && !(n && n.semRecarga)) {
      congelada = true;
      return;
    }
    if ((t === 'emdia' || t === 'subiu') && !liberada) {
      liberada = true;
      if (!timer) timer = setInterval(function () { if (!oculta()) L.buscar(); }, L.INTERVALO_MS);
      L.buscar();
    }
  }
  try { window.addEventListener('soterra:nuvem', function (ev) { ouveNuvem(ev && ev.detail); }); } catch (e) {}
  try {
    document.addEventListener('visibilitychange', function () {
      if (oculta() || !liberada) return;
      if (compraPendente || Date.now() - ultima >= L.VISIVEL_MS) {
        compraPendente = false;
        L.buscar();
      }
    });
  } catch (e2) {}
  try {
    if (typeof BroadcastChannel === 'function') {
      var canal = new BroadcastChannel(L.CANAL);
      canal.onmessage = function (ev) {
        var m = ev && ev.data;
        if (!m || m.tipo !== 'comprou') return;
        if (oculta()) { compraPendente = true; return; }   // busca quando a aba voltar
        L.buscar();
      };
    }
  } catch (e3) {}
  // a Nuvem pode ter falado antes deste arquivo carregar: o histórico dela conta
  try {
    var hN = (N() && N().historico) ? N().historico() : [];
    for (var i = 0; i < hN.length; i++) ouveNuvem(hN[i]);
  } catch (e4) {}

  /* só páginas de teste: o módulo volta ao estado de página recém-aberta */
  L._reinicia = function () {
    if (timer) { clearInterval(timer); timer = null; }
    liberada = false; congelada = false; buscando = null; ultima = 0; erro = null;
    compraPendente = false; historico = [];
  };
})();
