// A autoridade do servidor no jogo — bilhete, lances, recibo e as operações de economia (dono: lógica).
var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

/* O QUE ISTO É (13/09, a segurança — docs/SEGURANCA.md §6)
 * ============
 * Com sessão do site, o servidor é o DONO da economia da conta: ele refaz a
 * sala e paga a recompensa, e roda cada operação (equipar, forjar, cofre…)
 * com a mesma função do jogo no estado que ele guarda. Este módulo é a ponte:
 *
 *   - O BILHETE: antes de a sala nascer, o servidor dá a semente
 *     (`prepara`/`bilheteDe`). A batalha é criada com ela.
 *   - O FECHAR: na vitória (ou derrota) vão o bilhete, os lances e o hash; volta
 *     o recibo e o estado novo, que este módulo ADOTA sem recarregar a página.
 *     Sem rede, o fechar fica guardado e tenta de novo sozinho.
 *   - AS OPERAÇÕES: a função do jogo roda na hora (a tela não espera) e a op vai
 *     numa fila para o servidor, com o hash de antes e o de depois. Hash
 *     diferente = adota o estado do servidor. As que SORTEIAM (forja, roleta)
 *     esperam o servidor: `opAgora`.
 *
 * Sem sessão (em casa, file://), `ligada()` é false e o jogo é o local de sempre. */
(function () {
  'use strict';

  var A = {};
  JOGO.Autoridade = A;

  A.FILA_MS = 300;             // as ops acumulam isto antes de subir juntas
  A.RETENTA_MS = 4000;         // fechar/op sem rede tentam de novo depois disto
  A.OPS_POR_PEDIDO = 40;       // a régua do servidor
  A._fetch = null;             // provas: (rota, op) → Promise<resposta>

  var bilhetes = {};           // chave da sala → { estado: 'pedindo'|'pronto'|'falhou', bilhete, semente, carry, espera: [] }
  var fila = [], timerFila = null, subindo = false;
  var hashAntesDaFila = null;  // o hash do estado quando a 1ª op da fila foi aplicada
  var profundidade = 0;        // op dentro de op (vestirTraje chama equipar): só a de fora vai
  var adotando = false;
  var fechamentos = [];        // fechar pendentes (sem rede): tentam de novo
  var ultimo = { versao: null, hash: null, erro: null };
  /* `parado` (13/09, um aparelho só): a conta entrou em outro aparelho e o jogo
   * caiu aqui (Sessao.derrubada → A.parar). As filas morrem e nada mais sobe. */
  var parado = false;
  function outroAparelho(r) { return !!r && r.status === 401 && r.motivo === 'outro-aparelho'; }
  A.parar = function () {
    parado = true;
    fila = [];
    hashAntesDaFila = null;
    if (timerFila) { clearTimeout(timerFila); timerFila = null; }
    bilhetes = {};
  };

  function S() { return JOGO.Sessao || null; }
  function N() { return JOGO.Nuvem || null; }
  function P() { return JOGO.Progress || null; }
  function DB() { return JOGO.DB || null; }
  function Ec() { return JOGO.Economia || null; }
  function aviso(txt, tipo) { try { if (JOGO.UI && JOGO.UI.toast) JOGO.UI.toast(txt, tipo); } catch (e) {} }

  /* ------------------------------------------------------------ ligada? */
  A.ligada = function () {
    if (parado) return false;
    var s = S(), n = N();
    if (!s || !s.ativa || !s.ativa()) return false;
    if (!n || !n.estado) return false;
    var e = n.estado();
    return !!(e.ligada && e.principal);
  };

  function api(rota, corpo) {
    if (typeof A._fetch === 'function') return A._fetch(rota, { method: 'POST', body: corpo });
    var s = S();
    if (!s || !s.api) return Promise.resolve({ ok: false, status: 0, erro: 'sem sessão' });
    return s.api(rota, { method: 'POST', body: corpo });
  }
  function foraDoAr(r) { return !r || r.status === 0 || r.status >= 500; }

  A.hashLocal = function () {
    var p = P(), db = DB(), e = Ec();
    if (!p || !db || !e) return null;
    return e.hash(p.state, db.exportar());
  };
  A.estado = function () {
    return { ligada: A.ligada(), fila: fila.length, subindo: subindo, versao: ultimo.versao, hash: ultimo.hash,
             erro: ultimo.erro, fechamentos: fechamentos.length };
  };

  /* ------------------------------------------------------------ adotar */
  /* O estado do servidor vira o desta página, sem recarregar: o Progress relê
   * (saneia e refaz os feitiços), e o DB fica com a economia do servidor e o
   * cosmético daqui (nome, avatar, placar…). A HUD repinta. */
  A.adota = function (progress, db) {
    var p = P(), d = DB(), e = Ec(), C = JOGO.Contas;
    if (!p || !d || !e) return false;
    adotando = true;
    try {
      var chave = (C && C.chaveSave) ? C.chaveSave() : (p.SAVE_KEY || 'soterra-save-v2');
      if (progress && typeof progress === 'object') {
        try { window.localStorage.setItem(chave, JSON.stringify(progress)); } catch (e1) {}
        p.load();
      }
      if (db && typeof db === 'object' && d.importar) d.importar(e.junta(db, d.exportar()));
      fila = [];                                       // o que estava na fila já não vale sobre o estado novo
      hashAntesDaFila = null;
    } finally {
      adotando = false;
    }
    try { if (JOGO.UI && JOGO.UI.repaint) JOGO.UI.repaint(); } catch (e2) {}
    return true;
  };
  function anotaResposta(r) {
    if (!r) return;
    if (typeof r.versao === 'number') {
      ultimo.versao = r.versao;
      var n = N();
      if (n && n.defineVersao) n.defineVersao(r.versao);
    }
    if (typeof r.hash === 'string') ultimo.hash = r.hash;
  }

  /* A resposta de uma rota que mudou o estado FORA do /api/op (13/09: o mercadinho entre
   * contas, js/core/mercado.js): anota versão e hash e adota o estado que veio junto. */
  A.adotaResposta = function (r) {
    if (!r || typeof r !== 'object') return false;
    anotaResposta(r);
    if (r.progress || r.db) { A.adota(r.progress, r.db); return true; }
    return false;
  };

  /* ------------------------------------------------------------ o bilhete */
  function chaveSala(p) {
    return [p.dungeonId, p.roomIndex, p.dificuldade || 'normal', (p.herois || []).join('+')].join('|');
  }
  /* pede o bilhete em segundo plano; `quandoPronto` roda quando ele chegar */
  A.prepara = function (pedido, quandoPronto) {
    if (!A.ligada() || !pedido) return;
    var k = chaveSala(pedido);
    var b = bilhetes[k];
    if (b && b.estado === 'pronto') { if (quandoPronto) quandoPronto(b); return; }
    if (b && b.estado === 'pedindo') { if (quandoPronto) b.espera.push(quandoPronto); return; }
    b = bilhetes[k] = { estado: 'pedindo', espera: quandoPronto ? [quandoPronto] : [] };
    api('/api/sala/abrir', { dungeonId: pedido.dungeonId, roomIndex: pedido.roomIndex,
                             dificuldade: pedido.dificuldade || 'normal', herois: pedido.herois })
      .then(function (r) {
        if (r && r.ok && typeof r.bilhete === 'string' && typeof r.semente === 'number') {
          b.estado = 'pronto';
          b.bilhete = r.bilhete;
          b.semente = r.semente;
          b.carry = r.carry || null;
          var fns = b.espera; b.espera = [];
          fns.forEach(function (fn) { try { fn(b); } catch (e) {} });
          return;
        }
        b.estado = 'falhou';
        b.espera = [];
        delete bilhetes[k];
        if (parado || outroAparelho(r)) return;         // 13/09: o jogo caiu aqui; a capa já diz por quê
        aviso(foraDoAr(r) ? 'O servidor não respondeu para abrir a sala — tente de novo em instantes.'
                          : ((r && r.erro) || 'O servidor não abriu a sala.'));
      });
  };
  /* o bilhete pronto desta sala (e o consome: cada bilhete abre UMA batalha) */
  A.tomaBilhete = function (pedido) {
    var k = chaveSala(pedido);
    var b = bilhetes[k];
    if (!b || b.estado !== 'pronto') return null;
    delete bilhetes[k];
    return { bilhete: b.bilhete, semente: b.semente, carry: b.carry };
  };
  A.esqueceBilhetes = function () { bilhetes = {}; };

  /* ------------------------------------------------------------ o fechar */
  /* Resolve SEMPRE: {ok, fase, recompensa} ou {ok:false, erro, recusada}. Sem
   * rede, tenta de novo sozinho até o servidor responder (a tela diz). */
  A.fecha = function (bilhete, lances, hashFinal) {
    return fechaEm('/api/sala/fechar', { bilhete: bilhete, lances: lances, hashFinal: hashFinal });
  };
  /* A SALA EM GRUPO (coop.js): o líder pede a semente ao servidor antes da ata */
  A.abreGrupo = function (corpo) { return api('/api/grupo/abrir', corpo); };
  /* e cada membro fecha com o registro do motor dele (os lances dos dois e as marcas) */
  A.fechaGrupo = function (corpo) { return fechaEm('/api/grupo/fechar', corpo); };
  /* O DUELO RANQUEADO: o servidor refaz a arena e muda a Brasa dos dois */
  A.fechaDuelo = function (corpo) { return fechaEm('/api/duelo/fechar', corpo); };

  /* A POÇÃO NA SALA DE ESPERA (13/09, o dono: "a poção seria para curar a vida e não precisar
   * esperar para ir para a próxima sala"). O servidor tira a poção do estado dele e soma a cura
   * no registro da vida do herói, numa transação; a página adota o estado que volta (a
   * contagem das poções) — também no 409 de quem estava com o estado velho. As ops na fila
   * sobem antes. Resolve a resposta ({ok, cura, hp, hpMax}) ou {ok:false, erro, motivo}.
   * corpo solo {bilhete, heroId, pocaoId}; em grupo {gid, heroId, pocaoId}. */
  A.bebeNaSala = function (corpo) { return bebeEm('/api/sala/pocao', corpo); };
  A.bebeNoGrupo = function (corpo) { return bebeEm('/api/grupo/pocao', corpo); };
  function bebeEm(rota, corpo) {
    return descarregaFila().then(function () { return api(rota, corpo); }).then(function (r) {
      if (parado || outroAparelho(r)) return { ok: false, erro: 'sua conta entrou em outro aparelho', motivo: 'outro-aparelho' };
      if (foraDoAr(r)) return { ok: false, foraDoAr: true, erro: 'o servidor não respondeu', motivo: 'servidor' };
      A.adotaResposta(r);
      if (!r.ok) return { ok: false, erro: r.erro || 'o servidor recusou a poção', motivo: r.motivo || null };
      return r;
    });
  }

  function fechaEm(rota, corpo) {
    return new Promise(function (resolve) {
      var pend = { corpo: corpo, resolve: resolve };
      fechamentos.push(pend);
      function tenta(avisou) {
        // as ops na fila sobem ANTES: o servidor paga a sala sobre o estado com elas
        descarregaFila().then(function () {
          return api(rota, corpo);
        }).then(function (r) {
          if (parado || outroAparelho(r)) {
            // 13/09: a conta entrou em outro aparelho — sem tentar de novo (nem sem rede)
            var i = fechamentos.indexOf(pend);
            if (i >= 0) fechamentos.splice(i, 1);
            resolve({ ok: false, recusada: true, derrubada: true, erro: 'sua conta entrou em outro aparelho',
                      motivo: 'outro-aparelho' });
            return;
          }
          if (foraDoAr(r)) {
            if (!avisou) aviso('Conferindo a sala com o servidor… (sem resposta, tentando de novo)');
            setTimeout(function () { tenta(true); }, A.RETENTA_MS);
            return;
          }
          fechamentos.splice(fechamentos.indexOf(pend), 1);
          if (r && r.ok) {
            anotaResposta(r);
            if (r.progress || r.db) A.adota(r.progress, r.db);
            resolve(r);
            return;
          }
          ultimo.erro = (r && r.erro) || 'recusada';
          resolve({ ok: false, recusada: true, erro: (r && r.erro) || 'o servidor recusou a sala',
                    motivo: r && r.motivo });
        });
      }
      tenta(false);
    });
  }

  /* ------------------------------------------------------------ as operações */
  /* A op já rodou aqui (a função do jogo); entra na fila para o servidor. */
  A.op = function (nome, args) {
    if (!A.ligada() || adotando || profundidade > 0) return;
    if (!fila.length) hashAntesDaFila = ultimo.hash;
    fila.push({ nome: nome, args: args || {} });
    if (fila.length >= A.OPS_POR_PEDIDO) { descarregaFila(); return; }
    if (!timerFila) timerFila = setTimeout(function () { timerFila = null; descarregaFila(); }, A.FILA_MS);
  };
  /* roda uma função do jogo como UMA op: a de dentro não vai de novo */
  A.embrulha = function (nome, fn, argsDe) {
    return function () {
      if (profundidade > 0 || adotando || !A.ligada()) return fn.apply(this, arguments);
      profundidade++;
      var r;
      try { r = fn.apply(this, arguments); }
      finally { profundidade--; }
      var args = null;
      try { args = argsDe.apply(null, arguments); } catch (e) { args = null; }
      if (args) A.op(nome, args);
      return r;
    };
  };

  var descarregando = null;
  function descarregaFila() {
    if (timerFila) { clearTimeout(timerFila); timerFila = null; }
    if (descarregando) return descarregando.then(function () { return fila.length ? descarregaFila() : null; });
    if (!fila.length || !A.ligada()) return Promise.resolve(null);
    var lote = fila.splice(0, A.OPS_POR_PEDIDO);
    var corpo = { hashAntes: hashAntesDaFila, ops: lote, hashDepois: A.hashLocal() };
    hashAntesDaFila = fila.length ? corpo.hashDepois : null;
    subindo = true;
    descarregando = api('/api/op', corpo).then(function (r) {
      subindo = false;
      descarregando = null;
      if (parado || outroAparelho(r)) return r;        // 13/09: o jogo caiu aqui; o lote não volta para a fila
      if (foraDoAr(r)) {
        // sem rede: o lote volta para a frente da fila e tenta depois
        fila = lote.concat(fila);
        hashAntesDaFila = corpo.hashAntes;
        if (!timerFila) timerFila = setTimeout(function () { timerFila = null; descarregaFila(); }, A.RETENTA_MS);
        return r;
      }
      anotaResposta(r);
      if (r && (r.status === 409 || r.progress || r.db)) {
        // o servidor tinha outro estado (outra aba, ou a tela divergiu): ele manda
        A.adota(r.progress, r.db);
      } else if (r && !r.ok) {
        ultimo.erro = r.erro || 'op recusada';
        aviso('O servidor recusou uma ação: ' + (r.erro || 'op recusada'));
        // o estado local já tem a op que o servidor não aceitou: busca o dele
        return A.puxaEstado();
      }
      return r;
    });
    return descarregando;
  }
  A.descarrega = descarregaFila;

  /* A op que SORTEIA no servidor (forja com risco, roleta): sobe a fila, manda
   * esta sozinha e devolve o resultado dela, com o estado já adotado. */
  A.opAgora = function (nome, args) {
    return descarregaFila().then(function () {
      var corpo = { hashAntes: ultimo.hash, ops: [{ nome: nome, args: args || {} }], hashDepois: null };
      return api('/api/op', corpo);
    }).then(function (r) {
      if (foraDoAr(r)) return { ok: false, foraDoAr: true, erro: 'o servidor não respondeu' };
      anotaResposta(r);
      if (r && (r.progress || r.db)) A.adota(r.progress, r.db);
      if (!r || !r.ok) return { ok: false, erro: (r && r.erro) || 'o servidor recusou' };
      return { ok: true, resultado: (r.resultados || [])[0] };
    });
  };

  /* O estado inteiro do servidor (GET /api/save), adotado. */
  A.puxaEstado = function () {
    var s = S();
    if (!s || !s.api) return Promise.resolve(null);
    return s.api('/api/save').then(function (r) {
      if (r && r.ok && (r.progress || r.db)) {
        anotaResposta(r);
        A.adota(r.progress, r.db);
        // o estado agora É o do servidor: o hash conhecido parte daqui
        if (typeof r.hash !== 'string') ultimo.hash = A.hashLocal();
      }
      return r;
    });
  };

  /* NA ABERTURA (13/09): quando a Nuvem fala com o servidor pela primeira vez
   * nesta página, a economia daqui é trocada pela do servidor. Um save mexido
   * no localStorage não sobe (o servidor ignora) e não fica na tela esperando
   * a próxima op para ser desfeito. */
  var puxouNaAbertura = false;
  function ouveNuvem(det) {
    if (puxouNaAbertura || !det || (det.tipo !== 'emdia' && det.tipo !== 'subiu')) return;
    if (!A.ligada()) return;
    puxouNaAbertura = true;
    A.puxaEstado();
  }
  try { window.addEventListener('soterra:nuvem', function (ev) { ouveNuvem(ev && ev.detail); }); } catch (e) {}
  try {
    var hN = (N() && N().historico) ? N().historico() : [];
    for (var iN = 0; iN < hN.length; iN++) ouveNuvem(hN[iN]);
  } catch (e) {}

  /* ------------------------------------------------------------ os embrulhos */
  /* As funções do jogo que mudam a economia sem sorteio: rodam aqui na hora e
   * vão para a fila. Instalado uma vez; sem sessão cada embrulho só repassa. */
  var instalado = false;
  A.instala = function () {
    if (instalado) return;
    var p = P(), db = DB(), M = JOGO.Missoes, G = JOGO.GM;
    if (!p || !db) return;
    instalado = true;
    function em(obj, fnNome, opNome, argsDe) {
      if (!obj || typeof obj[fnNome] !== 'function') return;
      obj[fnNome] = A.embrulha(opNome, obj[fnNome], argsDe);
    }
    em(p, 'equip', 'equipar', function (heroId, itemId, invIndex) {
      return { heroId: heroId, itemId: itemId, invIndex: (typeof invIndex === 'number') ? invIndex : null };
    });
    em(p, 'unequip', 'desequipar', function (heroId, slot) { return { heroId: heroId, slot: slot }; });
    em(p, 'equipPet', 'equiparPet', function (heroId, petId) { return { heroId: heroId, petId: petId }; });
    em(p, 'unequipPet', 'soltarPet', function (heroId) { return { heroId: heroId }; });
    em(p, 'saveTraje', 'salvarTraje', function (heroId, n) { return { heroId: heroId, n: n }; });
    em(p, 'wearTraje', 'vestirTraje', function (heroId, n) { return { heroId: heroId, n: n }; });
    em(p, 'fuseItem', 'fundirPeca', function (invIndex) { return { invIndex: invIndex }; });
    em(p, 'chooseElement', 'escolherElemento', function (heroId, el) { return { heroId: heroId, elemento: el }; });
    em(p, 'liberaElemento', 'liberarElemento', function (heroId, el) { return { heroId: heroId, elemento: el }; });
    em(p, 'trocaElemento', 'trocarElemento', function (heroId, el) { return { heroId: heroId, elemento: el }; });
    em(p, 'reescreveElemento', 'reescreverElemento', function (heroId, velho, novo) {
      return { heroId: heroId, velho: velho, novo: novo };
    });
    em(p, 'escolheSeloElemento', 'escolherSeloElemento', function (el) { return { elemento: el }; });
    em(p, 'lePergaminhoXp', 'lerPergaminhoXp', function () { return {}; });
    em(p, 'devolvidasPorNivel', 'devolvidasPorNivel', function (limpar) { return limpar ? {} : null; });
    em(db, 'depositarMoedas', 'depositarMoedas', function (n) { return { n: Math.floor(Number(n) || 0) }; });
    em(db, 'sacarMoedas', 'sacarMoedas', function (n) { return { n: Math.floor(Number(n) || 0) }; });
    em(db, 'definirTitulo', 'definirTitulo', function (t) { return { titulo: t || null }; });
    em(M, 'reivindicar', 'reivindicarMissao', function (id) { return { id: id }; });
    // 13/09: a banca do mercador — a compra roda aqui na hora e a MESMA sobe como op
    em(JOGO.Mercado, 'comprarPocao', 'comprarPocao', function (id, qtd) {
      var q = Math.floor(Number(qtd));
      return (typeof id === 'string' && q >= 1 && q <= 1000) ? { id: id, qtd: q } : null;
    });
    if (G) {
      em(G, 'aparelha', 'gmAparelha', function () { return {}; });
      em(G, 'pegaItem', 'gmPegaItem', function (itemId) { return { itemId: itemId }; });
      em(G, 'pegaSet', 'gmPegaSet', function (setId) { return { setId: setId }; });
      em(G, 'pegaPet', 'gmPegaPet', function (petId, topo) { return { petId: petId, topo: !!topo }; });
      em(G, 'pegaPedras', 'gmPegaPedras', function (sid, n) { return { stoneId: sid, n: n }; });
      em(G, 'pegaSelos', 'gmPegaSelos', function (el, n) { return { elemento: el, n: n }; });
      em(G, 'pegaInsignias', 'gmPegaInsignias', function (n) { return { n: n }; });
      em(G, 'pegaCartas', 'gmPegaCartas', function (cid, n) { return { classId: cid, n: n }; });
      em(G, 'pegaPergaminho', 'gmPegaPergaminho', function (tipo, n) { return { tipo: tipo, n: n }; });
      em(G, 'pegaBonusXp', 'gmPegaBonusXp', function (dias) { return { dias: dias }; });
    }
  };
  // os módulos do jogo já carregaram (index.html põe este arquivo depois deles)
  try { A.instala(); } catch (e) {}

  // a página indo embora: a fila sobe na hora
  try {
    window.addEventListener('pagehide', function () { descarregaFila(); });
  } catch (e) {}
})();
