// Os AMIGOS e os INIMIGOS da conta (dono: lógica).
var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

/* O QUE ISTO É (13/09, pedido do dono)
 * ====================================
 * "no menu inferior deve ter uma lista de amigos e inimigos — os amigos
 *  mostram quando estão online e se estão em batalha; os inimigos não podem
 *  mandar mensagem nem troca, mas podem desafiar pvp".
 *
 * A LISTA é da CONTA e mora no cartório (servidor/amigos.py). O ONLINE — em
 * que sala e se está em batalha — só o relé sabe: ele responde ao
 * {t:'amigos'} (R.pedeAmigos) com o herói de cada um que está ligado. É o
 * relé também que não entrega sussurro nem troca entre inimigos; a cópia
 * daqui (ehInimigo, SÍNCRONA) é para a HUD e o grupo.js largarem o que um
 * relé antigo deixasse passar e para avisar antes de tentar. Sem sessão não
 * há lista. */
(function () {
  'use strict';

  var A = {};
  JOGO.Amigos = A;

  var lista = { amigos: [], inimigos: [] };
  var status = {};                 // conta -> { online, id, sala, luta, tipo }
  var carregada = false;
  var ouvindo = null;              // o R.ouvir('amigos') pendurado (a Rede pode trocar)

  function sessao() {
    try { var S = JOGO.Sessao; return (S && S.ativa && S.ativa() && S.api) ? S : null; } catch (e) { return null; }
  }
  A.pode = function () { return !!sessao(); };

  /* quem ouve a lista ou o online mudar (a ficha aberta repinta) */
  A.aoMudar = null;
  function mudou() { if (typeof A.aoMudar === 'function') { try { A.aoMudar(); } catch (e) {} } }

  function guarda(r) {
    if (r && r.ok && Array.isArray(r.amigos) && Array.isArray(r.inimigos)) {
      lista = { amigos: r.amigos, inimigos: r.inimigos };
      carregada = true;
      mudou();
    }
    return r;
  }
  function responde(r) {
    r = (r && typeof r === 'object') ? r : { ok: false };
    if (!r.ok && !r.erro) r.erro = r.status === 0 ? 'o servidor está fora (não respondeu)' : 'não deu';
    return r;
  }

  A.carrega = function () {
    var S = sessao();
    if (!S) return Promise.resolve({ ok: false, erro: 'entre na conta para ter amigos' });
    return S.api('/api/amigos').then(function (r) { return guarda(responde(r)); });
  };

  /* alvo = { conta } (o toque na praça) ou { nome }; tipo = 'amigo' | 'inimigo' | null (tira) */
  A.definir = function (alvo, tipo) {
    var S = sessao();
    if (!S) return Promise.resolve({ ok: false, erro: 'entre na conta para ter amigos' });
    var corpo = { tipo: (tipo === 'amigo' || tipo === 'inimigo') ? tipo : null };
    if (alvo && typeof alvo.conta === 'number') corpo.conta = alvo.conta;
    else if (alvo && typeof alvo.nome === 'string') corpo.nome = alvo.nome.slice(0, 40);
    return S.api('/api/amigos/definir', { method: 'POST', body: corpo }).then(function (r) {
      r = guarda(responde(r));
      if (r.ok) {
        // o relé guarda os inimigos por uns segundos: avisa que mudou, e pede o online de novo
        try { var R = JOGO.Rede; if (R && R.amigosMudou) R.amigosMudou(); } catch (e) {}
      }
      return r;
    });
  };

  A.lista = function () { return JSON.parse(JSON.stringify(lista)); };
  A.carregada = function () { return carregada; };
  function tem(arr, conta) {
    for (var i = 0; i < arr.length; i++) if (arr[i] && arr[i].conta === conta) return true;
    return false;
  }
  A.ehAmigo = function (conta) { return typeof conta === 'number' && tem(lista.amigos, conta); };
  A.ehInimigo = function (conta) { return typeof conta === 'number' && tem(lista.inimigos, conta); };

  /* a conta de um herói da praça (o `nuvem` que o relé conferiu), ou null */
  A.contaDoHeroi = function (id) {
    if (!id) return null;
    try {
      var ps = (JOGO.Rede && JOGO.Rede.pares) ? JOGO.Rede.pares() : [];
      for (var i = 0; i < ps.length; i++) {
        if (ps[i] && ps[i].id === id) return (typeof ps[i].nuvem === 'number') ? ps[i].nuvem : null;
      }
    } catch (e) {}
    for (var c in status) {
      if (status.hasOwnProperty(c) && status[c].id === id) return Number(c);
    }
    return null;
  };
  A.inimigoPorHeroi = function (id) { return A.ehInimigo(A.contaDoHeroi(id)); };

  /* O ONLINE (a voz {t:'amigos'} do relé, já digerida pela Rede) */
  A.status = function (conta) { return status[conta] || null; };
  A._recebe = function (ev) {
    var novo = {};
    (ev && Array.isArray(ev.lista) ? ev.lista : []).forEach(function (s) {
      if (!s || typeof s.conta !== 'number') return;
      novo[s.conta] = { online: s.online === true, id: (typeof s.id === 'string') ? s.id : null,
                        sala: (typeof s.sala === 'string') ? s.sala : null, luta: s.luta === true,
                        tipo: s.tipo === 'inimigo' ? 'inimigo' : 'amigo' };
    });
    status = novo;
    mudou();
  };
  /* pendura o ouvinte na Rede (idempotente) e pede o online */
  A.liga = function () {
    var R = JOGO.Rede;
    if (!R || !R.ouvir) return false;
    if (ouvindo !== R) {
      R.ouvir('amigos', A._recebe);
      ouvindo = R;
    }
    if (!carregada) A.carrega();
    return !!(R.pedeAmigos && R.pedeAmigos());
  };
})();
