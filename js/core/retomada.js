/* SOTERRA — REFAZER A SALA SOLO (15/10): a luta que ficou aberta volta do ponto em que parou.
 *
 * A análise de mercado: o celular dorme, a ligação entra, o Android mata a aba — e a luta solo
 * morria (na volta o cliente fechava a sala como abandonada e os heróis ficavam com a vida do ponto
 * em que parou). Aqui a sala é REFEITA do bilhete, exatamente como o juiz a refaz no servidor
 * (servidor/juiz/sala.js, refazEm): a batalha nasce da semente, o PV da porta entra, e os lances
 * guardados (js/core/autoridade.js, o registro da luta aberta) são jogados de novo com a IA correndo
 * entre eles. Nada de guardar o estado do motor: o que se guarda é o que o servidor já conhece
 * (bilhete + lances), e o cliente e o juiz chegam ao mesmo estado — o `ok` de cada lance confere.
 *
 * Puro: `refaz(J, rec, ganchos)` recebe o mundo (o JOGO da página, ou o do motor headless nas
 * provas), o registro {dungeonId, roomIndex, dificuldade, party, semente, carry, afixo, versaoRegras,
 * lances} e `ganchos.aplicaCarry(st, carry)` (o do game.js ou o do juiz). Devolve {st, fase} ou {erro}. */
(function (raiz) {
  'use strict';
  var JOGO = raiz.JOGO = raiz.JOGO || {};
  var R = JOGO.Retomada = JOGO.Retomada || {};

  R.PASSOS_MAX = 5000;
  R.LANCES_MAX = 4000;
  var FIM = { won: true, lost: true, fim: true, acabou: true };

  function ehDoJogador(st, u) { return !!(u && u.side === 'player'); }

  function executa(J, st, l) {
    var E = J.Engine;
    if (l.a === 'p') return !!E.place(st, l.x, l.y, { escolhas: l.e || {}, uid: l.eu || null });
    if (l.a === 'm') return !!E.move(st, l.u, l.x, l.y);
    if (l.a === 'c') return !!E.cast(st, l.u, l.s, l.x, l.y);
    if (l.a === 'e') { if (st.phase === 'playing') E.endTurn(st); return true; }
    if (l.a === 'f') {
      var fa = E.findUnit(st, l.u), fb = E.findUnit(st, l.alvo);
      if (!fa || !fb) return false;
      return !!(J.Fusion && J.Fusion.declare && J.Fusion.declare(st, l.u, l.alvo));
    }
    throw new Error('lance desconhecido: ' + String(l.a));
  }

  R.refaz = function (J, rec, ganchos) {
    var E = J && J.Engine;
    if (!E || !rec || typeof rec.dungeonId !== 'string' || typeof rec.roomIndex !== 'number' || typeof rec.semente !== 'number') {
      return { erro: 'entrada' };
    }
    if (Object.prototype.toString.call(rec.party) !== '[object Array]' || !rec.party.length) return { erro: 'entrada' };
    if (rec.versaoRegras != null && E.VERSAO_REGRAS != null && rec.versaoRegras !== E.VERSAO_REGRAS) return { erro: 'regras-mudaram' };
    var lances = Object.prototype.toString.call(rec.lances) === '[object Array]' ? rec.lances : [];
    if (lances.length > R.LANCES_MAX) return { erro: 'lances' };
    var andar = (rec.dungeonId === 'poco') ? rec.roomIndex + 1 : 0;
    if (andar) {
      if (!J.Poco || !J.Poco.salaSemeada || !J.Poco.poeSala(andar, J.Poco.salaSemeada(andar, rec.semente))) return { erro: 'poco' };
    }
    var st;
    try {
      st = E.createBattle(rec.dungeonId, rec.roomIndex, rec.party,
        { seed: rec.semente, dificuldade: rec.dificuldade || 'normal', escolhePosicao: true, afixo: rec.afixo || null });
    } catch (e) { return { erro: 'sala' }; }
    if (!st || !st.units) return { erro: 'sala' };
    if (andar && J.Poco.escalaEstado) J.Poco.escalaEstado(st, andar);
    if (ganchos && typeof ganchos.aplicaCarry === 'function') ganchos.aplicaCarry(st, rec.carry || null);
    E.events.length = 0;

    var passos = 0;
    function conta() { if (++passos > R.PASSOS_MAX) throw new Error('a sala não termina'); }
    function rodaIA() {
      while (st.phase === 'playing') {
        var u = E.activeUnit(st);
        if (!u || ehDoJogador(st, u)) return;
        var plano = null;
        try { plano = J.AI.planTurn(st, u.uid); } catch (e) { plano = null; }
        if (!plano || !plano.length) plano = [{ action: 'end' }];
        var acabou = false;
        for (var i = 0; i < plano.length && st.phase === 'playing'; i++) {
          var a = plano[i];
          try {
            if (a.action === 'move') E.move(st, u.uid, a.x, a.y);
            else if (a.action === 'cast') E.cast(st, u.uid, a.spellId, a.x, a.y);
            else if (a.action === 'end') { E.endTurn(st); acabou = true; break; }
          } catch (e) { /* o Game também engole erro de execução da IA */ }
        }
        if (!acabou && st.phase === 'playing') E.endTurn(st);
        E.events.length = 0;
        conta();
      }
    }

    try {
      for (var i = 0; i < lances.length; i++) {
        var l = lances[i];
        if (!l || typeof l !== 'object' || typeof l.a !== 'string') return { erro: 'lance', em: i };
        if (FIM[st.phase]) return { erro: 'depois-do-fim', em: i };
        if (l.a === 'r' || l.a === 'x' || l.a === 'po') return { erro: 'lance', em: i };   // o Eco, a rede e a poção não são da sala solo
        if (l.a === 'p') {
          if (st.phase !== 'placing') return { erro: 'vez', em: i };
        } else {
          rodaIA();
          if (FIM[st.phase]) return { erro: 'depois-do-fim', em: i };
          var ativo = E.activeUnit(st);
          if (st.phase !== 'playing' || !ehDoJogador(st, ativo)) return { erro: 'vez', em: i };
          if ((l.a === 'm' || l.a === 'c' || l.a === 'f') && l.u !== ativo.uid) return { erro: 'unidade', em: i };
          if (l.a === 'e') conta();
        }
        var ok;
        try { ok = executa(J, st, l); } catch (e) { return { erro: 'lance', em: i }; }
        E.events.length = 0;
        if (typeof l.ok === 'boolean' && l.ok !== ok) return { erro: 'divergiu', em: i };
      }
      rodaIA();
    } catch (e) { return { erro: 'passos' }; }
    return { st: st, fase: st.phase, hash: E.hash ? E.hash(st) : null, passos: passos };
  };
  R.FIM = FIM;
})(typeof window !== 'undefined' ? window : globalThis);
