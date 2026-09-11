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
 *      inexistente/que nasce liberada/gm, quantidade torta, bônus sem o
 *      `agora` do servidor → 'item-invalido'; classe já liberada →
 *      'classe-ja-liberada' (estorno; nunca vira carta de estrela);
 *   4. DB.lojaAplica decide e grava por dentro (sem saldo → 'sem-saldo') —
 *      ou, no CRÉDITO de vinténs, DB.lojaCredita (soma e anota; nada a entregar);
 *   5. no .then IMEDIATO, sem rede no meio, a entrega pelo Progress; se ela
 *      lançar, DB.lojaDesfaz devolve os vinténs ('erro-local');
 *   6. window 'soterra:loja' {tipo:'entregue'|'recusado', pedido, motivo,
 *      origem[, ate]}.
 *
 * AS ENTREGAS DA LOJA 2 (10/09) — a mesma fila, três tipos a mais:
 *   bonus-xp  {alvo:'xp', qtd: dias 1..366, agora}: o bônus de XP por TEMPO.
 *             `agora` é o relógio do SERVIDOR (epoch em segundos) no instante
 *             da retirada: o prazo corre a partir da ENTREGA, e comprar de novo
 *             SOMA dias (Progress.addBonusXpDias). Sem `agora`, 'item-invalido'.
 *   insignias {alvo:'fundacao', qtd 1..999}: Progress.addInsignia.
 *   vintens   {alvo:'carteira', qtd 1..10.000.000}: um CRÉDITO de preço 0 (um
 *             pacote pago no site, ou um presente do Mestre). Não passa pelo
 *             lojaAplica: DB.lojaCredita decide, soma no bolso e anota num
 *             gravar só. O retirar vem em ORDEM DE ID e o crédito nasce antes
 *             de qualquer compra feita com ele: na mesma busca ele entra antes.
 * AS ORIGENS: o pedido pode trazer `origem` — 'presente' (o Mestre deu, pelo
 * painel dele: preço 0, o MESMO caminho, nenhuma regra à parte) ou 'pagamento'
 * (os vinténs de um pacote pago). Sem ela, ou com outra coisa, é compra da
 * loja. O aviso leva `detail.origem` ('loja' | 'presente' | 'pagamento') — a
 * HUD escreve "Presente do Mestre: …" ou "Chegaram N vinténs do seu pacote" —
 * e, no bônus entregue, `detail.ate` (o fim do prazo, em segundos do servidor).
 *
 * JOGO.Loja: buscar(), aplicar(pedido) → Promise<{ok, motivo, origem}>, estado().
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

  // as entregas que esta versão sabe aplicar (a tabela 4.6 do plano da loja 2)
  var TIPOS = { pedras: 1, classe: 1, pergaminho: 1, 'bonus-xp': 1, insignias: 1, vintens: 1 };
  var TETO_DIAS = 366;            // bônus de XP: dias numa entrega
  var TETO_VINTENS = 10000000;    // crédito de vinténs: por pedido
  var TETO_EPOCH_S = 4e9;         // o `agora` do servidor, em segundos (o mesmo teto do Progress)
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

  /* de onde veio o pedido: 'presente' (o Mestre deu), 'pagamento' (os vinténs
   * de um pacote pago) ou 'loja' (a compra de sempre — e qualquer outra coisa) */
  function origemDe(p) {
    var o = (p && typeof p === 'object') ? p.origem : null;
    return (o === 'presente' || o === 'pagamento') ? o : 'loja';
  }
  function registra(p, tipo, motivo) {
    historico.push({ id: p && p.id, sku: (p && p.sku) || null, nome: (p && p.nome) || null,
                     tipo: tipo, motivo: motivo || null, origem: origemDe(p), em: Date.now() });
    if (historico.length > 50) historico.shift();
  }
  // `extra` (opcional) entra no detail: o bônus de XP entregue leva `ate`
  function avisa(tipo, p, motivo, extra) {
    registra(p, tipo, motivo);
    var det = { tipo: tipo, pedido: copia(p), motivo: motivo || null, origem: origemDe(p) };
    if (extra && typeof extra === 'object') {
      for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) det[k] = extra[k];
    }
    try {
      window.dispatchEvent(new CustomEvent('soterra:loja', { detail: det }));
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
    // loja 2: o bônus de XP por tempo só entra com o relógio do SERVIDOR
    if (ent.tipo === 'bonus-xp') {
      if (ent.alvo !== 'xp' || !inteiroPos(ent.qtd, TETO_DIAS)) return 'item-invalido';
      if (!(typeof ent.agora === 'number' && isFinite(ent.agora) && ent.agora > 0 && ent.agora < TETO_EPOCH_S)) {
        return 'item-invalido';
      }
      return null;
    }
    if (ent.tipo === 'insignias') {
      if (ent.alvo !== 'fundacao' || !inteiroPos(ent.qtd, 999)) return 'item-invalido';
      return null;
    }
    if (ent.tipo === 'vintens') {
      if (ent.alvo !== 'carteira' || !inteiroPos(ent.qtd, TETO_VINTENS)) return 'item-invalido';
      return null;
    }
    return 'item-invalido';
  }
  /* 5. a entrega — lança se o Progress não aceitar (o chamador desfaz); o
   * bônus de XP devolve {ate}, para o aviso dizer até quando ele vale */
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
    if (ent.tipo === 'bonus-xp') {
      var rb = prog.addBonusXpDias ? prog.addBonusXpDias(ent.qtd, ent.agora) : null;
      if (!rb || !rb.ok) throw new Error('o bônus de XP não entrou');
      return { ate: rb.ate };
    }
    if (ent.tipo === 'insignias') {
      if (!prog.addInsignia || !prog.addInsignia(ent.qtd)) throw new Error('as insígnias não entraram');
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

  /* o resultado de cada pedido leva o id e a origem dele (a busca devolve a lista) */
  L.aplicar = function (p) {
    var id = (p && typeof p === 'object') ? p.id : null;
    return aplicaUm(p).then(function (r) {
      if (r && typeof r === 'object') { r.id = id; r.origem = origemDe(p); }
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
      if (TIPOS[ent.tipo] !== 1 || (ent.tipo === 'vintens' && !db.lojaCredita)) {
        registra(p, 'ignorado', 'tipo-desconhecido');
        return { ok: false, motivo: 'tipo-desconhecido' };
      }
      // 3. a checagem de leitura
      var ruim = confere(ent);
      if (ruim) return recusa(p, id, ruim);
      // 4b. o CRÉDITO de vinténs (pacote pago, presente do Mestre) não passa
      // pelo lojaAplica: o DB decide, soma no bolso e anota num gravar só. Com
      // a página recarregando nada se escreve (o crédito volta na próxima)
      if (ent.tipo === 'vintens') {
        if (congelada) return { ok: false, motivo: 'recarregando' };
        return db.lojaCredita(id, ent.qtd).then(function (rc) {
          if (rc && rc.ja) return { ok: false, motivo: 'ja' };
          if (!rc || !rc.ok) return { ok: false, motivo: 'erro-local' };
          avisa('entregue', p, null);
          return { ok: true, motivo: null, moedas: rc.moedas };
        });
      }
      // 4. decide e grava por dentro
      return db.lojaAplica(id, preco).then(function (r) {
        if (r && r.ja) return { ok: false, motivo: 'ja' };
        if (r && r.semSaldo) return recusa(p, id, 'sem-saldo');
        if (!r || !r.ok) return { ok: false, motivo: 'erro-local' };
        // 5. a entrega, neste mesmo tique. Se a página começou a recarregar
        // no meio (outra máquina mandou o save dela), não se escreve mais
        // nada: o save de lá já está no disco, e este débito morre com a página
        if (congelada) return { ok: false, motivo: 'recarregando' };
        var fim = null;
        try {
          fim = entrega(ent);
        } catch (e) {
          return db.lojaDesfaz(id, preco, 'erro-local').then(function () {
            avisa('recusado', p, 'erro-local');
            return { ok: false, motivo: 'erro-local', erro: String(e && e.message || e) };
          });
        }
        var extra = (fim && typeof fim.ate === 'number') ? { ate: fim.ate } : null;
        avisa('entregue', p, null, extra);
        var feito = { ok: true, motivo: null, moedas: r.moedas };
        if (extra) feito.ate = extra.ate;
        return feito;
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
