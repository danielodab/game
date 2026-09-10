// A Troca — itens e vinténs de mão em mão (dono: lógica).
var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

/* O QUE ISTO É
 * ============
 * O terceiro pilar da visão online ("se ver, conversar por chat, fazer troca
 * de itens") — os dois primeiros já existem; este fecha o tripé. A janela é
 * a clássica: cada lado monta a oferta (itens do saco + vinténs), TRAVA
 * quando está satisfeito, e com os dois travados vem o CONFIRMAR. Qualquer
 * mudança em qualquer oferta DESTRAVA os dois — ninguém troca o que não viu.
 *
 * O PROTOCOLO viaja no envelope `troca` da Rede (só o destinatário processa):
 *   convite / aceite / recusa
 *   oferta  { itens: [{itemId, level, stars}], moedas }   (estado COMPLETO —
 *            idempotente; delta é convite a divergência)
 *   tranca  { travado }
 *   confirma
 *   cancela
 *
 * EXECUÇÃO LOCAL-PRIMEIRO: com os dois confirmados, cada lado aplica em si —
 * tira o que ofereceu, põe o que recebeu, moedas pelo DB (o funil de sempre)
 * e registra no histórico (DB.registrarTroca). Quando o servidor chegar, ele
 * vira o cartório e a execução muda de lado sem mexer na janela.
 *
 * MESMA CONTA, DUAS ABAS: na máquina do autor as duas abas dividem o MESMO
 * save — executar os dois lados seria corrida de escrita (dupla ou perda de
 * item). A troca detecta o próprio id do outro lado, deixa o FLUXO inteiro
 * acontecer (dá para ver a janela funcionando), e no fim NÃO mexe em nada,
 * dizendo o porquê. A troca que move coisas é entre CONTAS — mais um motivo
 * para o servidor.
 */
(function () {
  'use strict';

  var T = {};
  JOGO.Troca = T;

  /* fases: null · 'convidei' · 'convidado' · 'aberta' · 'feita' */
  var st = null;
  T.aoMudar = null;                 // a HUD pendura UM ouvinte: redesenha
  T.aoConvite = null;               // { de, nome } — a HUD pergunta ao jogador

  function R() { return JOGO.Rede || null; }
  function P() { return JOGO.Progress || null; }
  function DB() { return JOGO.DB || null; }

  function avisa() { if (T.aoMudar) { try { T.aoMudar(T.estado()); } catch (e) {} } }
  function manda(acao, dados) {
    var r = R();
    if (r && st) r.trocaManda(st.par, acao, dados);
  }
  function nomeDoPar(id) {
    var r = R();
    if (!r) return id;
    var achado = null;
    r.pares().forEach(function (p2) { if (p2.id === id) achado = p2; });
    return (achado && achado.nome) || id;
  }

  T.estado = function () {
    if (!st) return null;
    return {
      fase: st.fase, par: st.par, nomePar: st.nomePar,
      mesmaConta: st.mesmaConta,
      minha: { itens: st.minha.itens.slice(), moedas: st.minha.moedas,
               travada: st.minha.travada, confirmada: st.minha.confirmada },
      dele: { itens: st.dele.itens.slice(), moedas: st.dele.moedas,
              travada: st.dele.travada, confirmada: st.dele.confirmada }
    };
  };

  function novaMesa(fase, parId) {
    var r = R();
    st = {
      fase: fase, par: parId, nomePar: nomeDoPar(parId),
      mesmaConta: !!(r && r.meuId() === parId),
      minha: { itens: [], moedas: 0, travada: false, confirmada: false },
      dele: { itens: [], moedas: 0, travada: false, confirmada: false }
    };
  }

  // ------------------------------------------------------------- o fluxo meu
  T.convidar = function (parId) {
    if (st) return false;                       // uma mesa por vez
    novaMesa('convidei', parId);
    manda('convite', {});
    avisa();
    return true;
  };

  T.responder = function (sim) {
    if (!st || st.fase !== 'convidado') return;
    if (sim) {
      st.fase = 'aberta';
      manda('aceite', {});
    } else {
      manda('recusa', {});
      st = null;
    }
    avisa();
  };

  /* Toda mudança de oferta manda o ESTADO COMPLETO e destrava os dois. */
  function ofertaMudou() {
    st.minha.travada = false;
    st.minha.confirmada = false;
    st.dele.travada = false;
    st.dele.confirmada = false;
    manda('oferta', { itens: st.minha.itens, moedas: st.minha.moedas });
    avisa();
  }

  T.porItem = function (entrada) {
    if (!st || st.fase !== 'aberta' || !entrada || !entrada.itemId) return false;
    st.minha.itens.push({ itemId: entrada.itemId,
                          level: entrada.level || 0, stars: entrada.stars || 0,
                          iid: (typeof entrada.iid === 'string' && entrada.iid) ? entrada.iid : null });
    ofertaMudou();
    return true;
  };
  T.tiraItem = function (indice) {
    if (!st || st.fase !== 'aberta') return false;
    if (indice < 0 || indice >= st.minha.itens.length) return false;
    st.minha.itens.splice(indice, 1);
    ofertaMudou();
    return true;
  };
  T.porMoedas = function (n) {
    if (!st || st.fase !== 'aberta') return false;
    n = Math.floor(Number(n));
    if (!isFinite(n) || n < 0) return false;
    st.minha.moedas = n;
    ofertaMudou();
    return true;
  };

  T.travar = function () {
    if (!st || st.fase !== 'aberta' || st.minha.travada) return;
    st.minha.travada = true;
    manda('tranca', { travado: true });
    avisa();
  };

  T.confirmar = function () {
    if (!st || st.fase !== 'aberta') return;
    if (!st.minha.travada || !st.dele.travada) return;
    st.minha.confirmada = true;
    manda('confirma', {});
    talvezExecuta();
    avisa();
  };

  T.cancelar = function () {
    if (!st) return;
    manda('cancela', {});
    st = null;
    avisa();
  };

  // ------------------------------------------------------- o fluxo do outro
  /* A HUD encaminha para cá os eventos { tipo:'troca' } da Rede. */
  T.aoEvento = function (ev) {
    if (!ev || ev.tipo !== 'troca') return;

    if (ev.acao === 'convite') {
      if (st) {                                  // ocupado: recusa educada
        var r = R();
        if (r) r.trocaManda(ev.de, 'recusa', { motivo: 'ocupado' });
        return;
      }
      novaMesa('convidado', ev.de);
      avisa();
      if (T.aoConvite) { try { T.aoConvite({ de: ev.de, nome: st.nomePar }); } catch (e) {} }
      return;
    }

    if (!st || ev.de !== st.par) return;         // conversa de outra mesa

    if (ev.acao === 'aceite' && st.fase === 'convidei') {
      st.fase = 'aberta';
    } else if (ev.acao === 'recusa') {
      st = null;
    } else if (ev.acao === 'oferta' && st.fase === 'aberta') {
      st.dele.itens = (ev.dados && ev.dados.itens || []).slice(0, 24);
      st.dele.moedas = Math.max(0, Math.floor((ev.dados && ev.dados.moedas) || 0));
      // oferta nova destrava os DOIS — ninguém troca o que não viu
      st.minha.travada = false; st.minha.confirmada = false;
      st.dele.travada = false; st.dele.confirmada = false;
    } else if (ev.acao === 'tranca' && st.fase === 'aberta') {
      st.dele.travada = !!(ev.dados && ev.dados.travado);
    } else if (ev.acao === 'confirma' && st.fase === 'aberta') {
      st.dele.confirmada = true;
      talvezExecuta();
    } else if (ev.acao === 'cancela') {
      st = null;
    }
    avisa();
  };

  // ------------------------------------------------------------- a execução
  /* Com os DOIS confirmados, cada lado aplica em si mesmo. Se algo que eu
   * ofereci já não está no saco (gastei no meio?), a troca cai — melhor
   * cair do que entregar item fantasma. */
  function talvezExecuta() {
    if (!st || !st.minha.confirmada || !st.dele.confirmada) return;

    if (st.mesmaConta) {
      // duas abas do MESMO save: aplicar os dois lados seria corrida de
      // escrita (dupla ou perda). O fluxo valeu como demonstração; nada move.
      st.fase = 'feita';
      st.resultado = 'mesma-conta';
      avisa();
      st = null;
      return;
    }

    var prog = P(), db = DB();
    var inv = prog && prog.state ? prog.state.inventory : null;
    if (!inv || !db) { T.cancelar(); return; }

    // 1) acha e reserva os MEUS itens (a forma inteira tem de casar)
    var indices = [];
    var falta = st.minha.itens.some(function (of) {
      for (var i = 0; i < inv.length; i++) {
        if (indices.indexOf(i) >= 0) continue;
        var e2 = inv[i];
        // com série, é ELA que casa (10/09); sem, a forma inteira
        if (of.iid) { if (e2.iid === of.iid) { indices.push(i); return false; } continue; }
        if (e2.itemId === of.itemId && (e2.level || 0) === (of.level || 0) &&
            (e2.stars || 0) === (of.stars || 0) && !e2.iid) { indices.push(i); return false; }
      }
      return true;
    });
    if (falta) {
      manda('cancela', {});
      st = null;
      avisa();
      return;
    }

    // 1b) O SACO TEM FUNDO (25/08): o que vem tem de caber no lugar do que
    // vai. Sem vaga, a troca cai como no caso do item sumido — melhor cair
    // do que estourar o limite por uma porta lateral.
    var limite = (prog.bagLimit) ? prog.bagLimit() : Infinity;
    if (inv.length - indices.length + st.dele.itens.length > limite) {
      manda('cancela', {});
      st = null;
      avisa();
      return;
    }

    var meusItens = st.minha.itens.slice();
    var moedasVao = st.minha.moedas;
    var itensVem = st.dele.itens.slice();
    var moedasVem = st.dele.moedas;
    var par = st.par, nomePar = st.nomePar;

    // 2) tira os meus (índices de trás para frente), põe os dele
    indices.sort(function (a, b) { return b - a; });
    indices.forEach(function (i) { inv.splice(i, 1); });
    itensVem.forEach(function (of) {
      // a série do parceiro vem junto: no cartório a posse muda pela rota de troca
      var e3 = { itemId: of.itemId, level: of.level || 0, stars: of.stars || 0 };
      if (of.iid) e3.iid = of.iid; else if (prog.carimba) e3 = prog.carimba(e3, 'troca');
      inv.push(e3);
    });
    try { prog.save(); } catch (e) {}
    // A NUVEM (10/09): os dois lados registram a intenção espelhada no cartório;
    // sem sessão (ou sem a conta do parceiro na presença) fica só o local.
    try {
      var N = JOGO.Nuvem, Rd = R();
      var parNuvem = null;
      if (Rd && Rd.pares) Rd.pares().forEach(function (p) { if (p.id === par) parNuvem = p.nuvem || null; });
      if (N && N.troca && parNuvem) {
        N.troca(parNuvem,
                meusItens.map(function (o) { return o.iid; }).filter(Boolean),
                itensVem.map(function (o) { return o.iid; }).filter(Boolean));
      }
    } catch (e4) {}

    // 3) as moedas pelo funil de sempre, e o histórico
    var cadeia = Promise.resolve({ ok: true });
    if (moedasVao > 0) cadeia = cadeia.then(function () { return db.gastarMoedas(moedasVao); });
    if (moedasVem > 0) cadeia = cadeia.then(function () { return db.ganharMoedas(moedasVem); });
    cadeia.then(function () {
      if (db.registrarTroca) {
        try {
          db.registrarTroca({ com: nomePar, comId: par,
                              dei: { itens: meusItens, moedas: moedasVao },
                              recebi: { itens: itensVem, moedas: moedasVem } });
        } catch (e) {}
      }
    });

    st.fase = 'feita';
    st.resultado = 'trocado';
    avisa();
    st = null;
  }
})();
