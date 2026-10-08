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
 *   oferta  { itens: [{itemId, level, stars}], moedas,
 *            pets: [{petId, xp, cartas}] }   (estado COMPLETO —
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
 * COM A NUVEM (10/09): peça com número de série só muda de mão se os DOIS
 * lados podem registrar a troca no cartório (Nuvem.troca, com a conta que o
 * relé conferiu — o `nuvem` da presença). Senão a troca cai ANTES do
 * confirma, com o porquê (semCartorio): trocar só no local deixava o save de
 * quem recebeu com uma série de outra conta — 403, a nuvem parada, e o
 * "retomar" desfazia a troca e o que veio depois.
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

  var T = {};
  JOGO.Troca = T;

  /* fases: null · 'convidei' · 'convidado' · 'aberta' · 'feita' */
  var st = null;
  T.aoMudar = null;                 // a HUD pendura UM ouvinte: redesenha
  T.aoConvite = null;               // { de, nome } — a HUD pergunta ao jogador
  /* O PRAZO DO PEDIDO (06/10; o dono: "se eu dou troca ou qualquer comando com outro jogador, buga e não
   * consigo de novo"). O pedido de troca não tinha prazo NENHUM: quem propôs e fechou a ficha, e quem recebeu
   * e perdeu o cartão numa remontagem da praça, ficavam em 'convidei'/'convidado' para sempre — sem tela para
   * responder ou cancelar, recusando toda troca seguinte ("ocupado") e todo convite de grupo e de duelo ("está
   * numa troca"). Agora o pedido vale 30 s, como o convite de grupo, e quem vê o prazo acabar AVISA o outro
   * lado pelas vozes de sempre (`cancela` e `recusa`, com o motivo): o cliente de antes solta do mesmo jeito.
   * A mesa ABERTA (os dois aceitaram) segue sem prazo. Relógio injetável nas provas, como o do grupo. */
  T.PRAZO_MS = 30000;
  T._agora = function () { return Date.now(); };
  function agora() { var t; try { t = +T._agora(); } catch (e) { t = NaN; } return isFinite(t) ? t : Date.now(); }
  /* onde um pedido de troca tem tela para aparecer: a praça e a antessala (sem HUD — provas —, em toda parte) */
  function telaDeTroca() {
    var t = null;
    try { t = (JOGO.UI && JOGO.UI.telaAtual) ? JOGO.UI.telaAtual() : null; } catch (e) { t = null; }
    return !t || t === 'hub' || t === 'antessala';
  }
  /* a mesa acaba dizendo o porquê: a HUD mostra (fase 'cancelada' + motivo) e depois some */
  function acabaCom(motivo) {
    st.fase = 'cancelada';
    st.motivo = motivo;
    avisa();
    st = null;
  }

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
      mesmaConta: st.mesmaConta, motivo: st.motivo || null,
      // 06/10: até quando o PEDIDO vale (a mesa aberta não tem prazo)
      expira: (st.fase === 'convidei' || st.fase === 'convidado') ? st.expira : null,
      minha: { itens: st.minha.itens.slice(), moedas: st.minha.moedas, pets: st.minha.pets.slice(),
               travada: st.minha.travada, confirmada: st.minha.confirmada },
      dele: { itens: st.dele.itens.slice(), moedas: st.dele.moedas, pets: st.dele.pets.slice(),
              travada: st.dele.travada, confirmada: st.dele.confirmada }
    };
  };

  /* O CARTÓRIO (10/09): com a nuvem ligada (sessão, conta Principal), a peça
   * com número de série só muda de mão se os DOIS lados registrarem a troca
   * no cartório. O porquê de não dar (texto para o jogador), ou null:
   *   - o parceiro chegou sem `nuvem` (sem sessão, ou o relé não o conferiu:
   *     tira o `nuvem` de quem não se identificou);
   *   - o relé não ME conferiu (Rede.identidade() === false): o meu `nuvem`
   *     não chegou ao parceiro, e ele cai do lado de lá.
   * Sem nuvem ligada, ou só com vinténs, segue tudo como antes. Os dois lados
   * do cliente novo decidem igual, antes de mandar o `confirma`. */
  function semCartorio(mesa) {
    var N = JOGO.Nuvem, Rd = R(), est = null;
    try { est = (N && N.estado) ? N.estado() : null; } catch (e) {}
    if (!est || !est.ligada || !est.sessao) return null;
    var comSerie = mesa.minha.itens.concat(mesa.dele.itens).some(function (o) { return !!(o && o.iid); });
    if (!comSerie) return null;
    var nuvemPar = null;
    if (Rd && Rd.pares) Rd.pares().forEach(function (p) { if (p.id === mesa.par) nuvemPar = p.nuvem || null; });
    if (!nuvemPar) {
      return Tx('Troca cancelada: o servidor não conferiu a conta de {a}, e peça com número de série só muda de mão pelo cartório. Ela precisa entrar na conta e recarregar a página.', { a: mesa.nomePar || Tx('quem troca com você') });
    }
    if (Rd && Rd.identidade && Rd.identidade() === false) {
      return Tx('Troca cancelada: o servidor não conferiu a sua conta nesta conexão. Recarregue a página (F5) e tente de novo.');
    }
    return null;
  }
  var MOTIVO_DE_LA = Tx('Troca cancelada: o cartório não conferiu uma das contas, e peça com número de série só muda de mão por lá. Recarreguem a página e tentem de novo.');
  /* 11/09: o porquê que o OUTRO lado lê quando a troca cai no fim */
  var MOTIVOS_DE_LA = {
    cartorio: MOTIVO_DE_LA,
    falta: Tx('Troca cancelada: uma peça ou bicho da mesa do outro lado não estava mais com ele.'),
    saco: Tx('Troca cancelada: o saco do outro lado não tinha espaço para o que ia.'),
    pet: Tx('Troca cancelada: o outro lado já tem um dos bichos da mesa — é um de cada.')
  };
  function caiComMotivo(codigo, motivo) {
    manda('cancela', { motivo: codigo });
    st.fase = 'cancelada';
    st.motivo = motivo;
    avisa();
    st = null;
  }
  /* a troca cai com o porquê: a HUD mostra (fase 'cancelada'), o outro lado ouve o cancela */
  function caiSemCartorio(motivo) {
    manda('cancela', { motivo: 'cartorio' });
    st.fase = 'cancelada';
    st.motivo = motivo;
    avisa();
    st = null;
  }

  function novaMesa(fase, parId) {
    var r = R();
    st = {
      fase: fase, par: parId, nomePar: nomeDoPar(parId),
      mesmaConta: !!(r && r.meuId() === parId),
      expira: agora() + T.PRAZO_MS,
      minha: { itens: [], moedas: 0, pets: [], travada: false, confirmada: false },
      dele: { itens: [], moedas: 0, pets: [], travada: false, confirmada: false }
    };
  }

  /* OS BICHOS NA MESA (12/09, pedido do dono: "preciso conseguir trocar pets
   * nas trocas também"). O pet vai INTEIRO: o nível (XP) e as estrelas (as
   * cartas). Quem dá perde o bicho E as cartas dele — senão a próxima carta que
   * caísse devolvia o pet de graça (addPetCards religa com 5). Quem recebe fica
   * com o XP e as cartas que vieram. Só vai o bicho SOLTO: o vestido num herói
   * é solto antes, na ficha. É um de cada: quem já tem aquele bicho não recebe
   * outro, e a troca cai com o porquê. O servidor não registra pets (não há
   * cartório para eles): a execução é a local, como a dos vinténs. */
  var TETO_PETS_MESA = 6;
  function petsDefs() { return (JOGO.DATA && JOGO.DATA.pets) || {}; }
  function inteiro(v) { var n = Math.floor(Number(v)); return (isFinite(n) && n > 0) ? n : 0; }
  // o bicho como viaja na mesa, com os números presos nas réguas do jogo
  function petDaMesa(o) {
    if (!o || typeof o.petId !== 'string' || !petsDefs()[o.petId]) return null;
    var prog = P(), tab = (prog && prog.PET_XP_TABLE) || [0];
    var custo = (prog && prog.PET_UNLOCK_COST) || 5;
    return { petId: o.petId, xp: Math.min(inteiro(o.xp), tab[tab.length - 1] || 0),
             cartas: Math.min(10000, Math.max(custo, inteiro(o.cartas))) };
  }
  // {nome, nivel, estrelas} de um bicho da mesa — a mesma conta do Progress
  T.descrevePet = function (o) {
    var prog = P(), d = petsDefs()[o && o.petId] || {};
    var tab = (prog && prog.PET_XP_TABLE) || [0], custos = (prog && prog.PET_STAR_COSTS) || [];
    var custo = (prog && prog.PET_UNLOCK_COST) || 5, maxEst = (prog && prog.PET_MAX_STARS) || 3;
    var nivel = 1, estrelas = 0, i;
    for (i = 0; i < tab.length; i++) if (((o && o.xp) || 0) >= tab[i]) nivel = i + 1;
    var sobra = Math.max(0, ((o && o.cartas) || 0) - custo);
    for (i = 0; i < custos.length && i < maxEst; i++) if (sobra >= custos[i]) estrelas = i + 1;
    return { nome: d.name || (o && o.petId) || '?', nivel: nivel, estrelas: estrelas };
  };
  function petSolto(petId) {
    var prog = P(), pets = (prog && prog.state && prog.state.pets) || [];
    return pets.indexOf(petId) >= 0;
  }
  // já tenho esse bicho (solto ou vestido)? então não cabe outro
  T.jaTenhoPet = function (petId) {
    var prog = P();
    try { return !!(prog && prog.petOwned && prog.petOwned(petId)); } catch (e) { return false; }
  };
  function petRepetido(mesa) {
    for (var i = 0; i < mesa.dele.pets.length; i++) {
      if (T.jaTenhoPet(mesa.dele.pets[i].petId)) return mesa.dele.pets[i];
    }
    return null;
  }
  function motivoRepetido(o) {
    return Tx('Troca cancelada: você já tem o {nome} — é um bicho de cada.', { nome: T.descrevePet(o).nome });
  }

  // ------------------------------------------------------------- o fluxo meu
  T.convidar = function (parId) {
    // 06/10: o MEU pedido que ainda espera resposta se troca pelo novo (à mesma pessoa ou a outra) —
    // antes era "já há uma troca aberta" até recarregar a página
    if (st && st.fase === 'convidei') { manda('cancela', { motivo: 'retirou' }); st = null; }
    if (st) return false;                       // uma mesa por vez
    novaMesa('convidei', parId);
    manda('convite', {});
    avisa();
    return true;
  };

  T.responder = function (sim) {
    if (!st || st.fase !== 'convidado') return;
    if (agora() > st.expira) { T._tique(); return; }     // o prazo acabou com o cartão na tela
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
    manda('oferta', { itens: st.minha.itens, moedas: st.minha.moedas, pets: st.minha.pets });
    avisa();
  }

  /* 11/09 (a troca "bugada" no ar): sem série dita, a mesa leva a da primeira
   * cópia do saco com a mesma forma que ainda não está nela. Só com a forma, a
   * execução procurava uma cópia SEM série — no ar toda peça tem série — e a
   * troca caía no fim, calada. */
  function serieLivre(entrada) {
    var prog = P(), inv = (prog && prog.state && prog.state.inventory) || [];
    var usadas = {};
    st.minha.itens.forEach(function (o) { if (o.iid) usadas[o.iid] = true; });
    for (var i = 0; i < inv.length; i++) {
      var e = inv[i];
      if (!e || !e.iid || usadas[e.iid] || e.itemId !== entrada.itemId) continue;
      if ((e.level || 0) === (entrada.level || 0) && (e.stars || 0) === (entrada.stars || 0)) return e.iid;
    }
    return null;
  }
  T.porItem = function (entrada) {
    if (!st || st.fase !== 'aberta' || !entrada || !entrada.itemId) return false;
    if (typeof entrada.extra === 'string' && entrada.extra) return false;   // 08/10: a engastada não vai à mesa
    var iid = (typeof entrada.iid === 'string' && entrada.iid) ? entrada.iid : serieLivre(entrada);
    // a mesma peça (a mesma série) não vai à mesa duas vezes
    if (iid && st.minha.itens.some(function (o) { return o.iid === iid; })) return false;
    st.minha.itens.push({ itemId: entrada.itemId,
                          level: entrada.level || 0, stars: entrada.stars || 0, iid: iid });
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
  /* um bicho SOLTO vai à mesa com o XP e as cartas de agora */
  T.porPet = function (petId) {
    if (!st || st.fase !== 'aberta' || !petSolto(petId)) return false;
    if (st.minha.pets.some(function (o) { return o.petId === petId; })) return false;
    if (st.minha.pets.length >= TETO_PETS_MESA) return false;
    var s = P().state;
    var o = petDaMesa({ petId: petId, xp: (s.petXp || {})[petId], cartas: (s.petCards || {})[petId] });
    if (!o) return false;
    st.minha.pets.push(o);
    ofertaMudou();
    return true;
  };
  T.tiraPet = function (indice) {
    if (!st || st.fase !== 'aberta') return false;
    if (indice < 0 || indice >= st.minha.pets.length) return false;
    st.minha.pets.splice(indice, 1);
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
    var semCart = semCartorio(st);                 // 10/09: antes do confirma, que o outro lado executaria
    if (semCart) { caiSemCartorio(semCart); return; }
    var rep = petRepetido(st);                     // 12/09: um bicho de cada
    if (rep) { caiComMotivo('pet', motivoRepetido(rep)); return; }
    st.minha.confirmada = true;
    manda('confirma', {});
    talvezExecuta();
    avisa();
  };

  T.cancelar = function () {
    if (!st) return;
    manda('cancela', st.fase === 'convidei' ? { motivo: 'retirou' } : {});
    st = null;
    avisa();
  };

  /* 06/10: o prazo do pedido. Quem vê acabar avisa o outro lado, que solta na hora — o relógio de uma aba
   * em segundo plano (o celular com a tela apagada) não anda. */
  T._tique = function () {
    if (!st || (st.fase !== 'convidei' && st.fase !== 'convidado') || !(agora() > st.expira)) return;
    if (st.fase === 'convidei') {
      manda('cancela', { motivo: 'expirou' });
      acabaCom(Tx('O pedido de troca expirou.'));
    } else {
      manda('recusa', { motivo: 'expirou' });
      acabaCom(Tx('O pedido de troca de {a} expirou.', { a: st.nomePar }));
    }
    avisa();
  };
  if (typeof setInterval === 'function') {
    setInterval(function () { try { T._tique(); } catch (e) {} }, 1000);
  }

  // ------------------------------------------------------- o fluxo do outro
  /* A HUD encaminha para cá os eventos { tipo:'troca' } da Rede. */
  T.aoEvento = function (ev) {
    if (!ev || ev.tipo !== 'troca') return;

    if (ev.acao === 'convite') {
      // 06/10: quem já tinha proposto propõe DE NOVO (o `cancela` do pedido velho pode ter se perdido): o
      // pedido novo troca o que estava na tela, com o prazo cheio
      var trocou = !!st && st.fase === 'convidado' && st.par === ev.de;
      if (trocou) st = null;
      // ocupado — ou numa tela onde o pedido não apareceria (a batalha, a recompensa): recusa educada.
      // Antes o pedido que chegava na batalha ficava guardado sem tela nenhuma
      if (st || !telaDeTroca()) {
        var r = R();
        if (r) r.trocaManda(ev.de, 'recusa', { motivo: 'ocupado' });
        if (trocou) avisa();
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
      // 06/10: quem propôs fica sabendo por quê — antes a mesa só sumia
      if (st.fase === 'convidei') {
        var cr = ev.dados && ev.dados.motivo;
        acabaCom(cr === 'ocupado' ? Tx('{a} está ocupado(a) agora.', { a: st.nomePar })
               : cr === 'expirou' ? Tx('O pedido de troca expirou.')
               : Tx('{a} recusou a troca.', { a: st.nomePar }));
      }
      st = null;
    } else if (ev.acao === 'oferta' && st.fase === 'aberta') {
      st.dele.itens = (ev.dados && ev.dados.itens || []).slice(0, 24);
      st.dele.moedas = Math.max(0, Math.floor((ev.dados && ev.dados.moedas) || 0));
      // os bichos (12/09): cliente antigo não manda `pets` — vale lista vazia
      var vistos = {};
      st.dele.pets = ((ev.dados && Object.prototype.toString.call(ev.dados.pets) === '[object Array]')
        ? ev.dados.pets : []).map(petDaMesa).filter(function (o) {
          if (!o || vistos[o.petId]) return false;
          vistos[o.petId] = true;
          return true;
        }).slice(0, TETO_PETS_MESA);
      // oferta nova destrava os DOIS — ninguém troca o que não viu
      st.minha.travada = false; st.minha.confirmada = false;
      st.dele.travada = false; st.dele.confirmada = false;
    } else if (ev.acao === 'tranca' && st.fase === 'aberta') {
      st.dele.travada = !!(ev.dados && ev.dados.travado);
    } else if (ev.acao === 'confirma' && st.fase === 'aberta') {
      st.dele.confirmada = true;
      talvezExecuta();
    } else if (ev.acao === 'cancela') {
      var cod = ev.dados && ev.dados.motivo;
      if (cod && MOTIVOS_DE_LA.hasOwnProperty(cod)) {   // o lado de lá caiu no fim, e disse o porquê
        st.fase = 'cancelada';
        st.motivo = MOTIVOS_DE_LA[cod];
        avisa();
      } else if (st.fase === 'convidado') {              // 06/10: o pedido que sai da tela diz por quê
        acabaCom(cod === 'expirou' ? Tx('O pedido de troca de {a} expirou.', { a: st.nomePar })
                                   : Tx('{a} retirou o pedido de troca.', { a: st.nomePar }));
      } else if (st.fase === 'aberta') {                 // 06/10: e a mesa que o outro fechou, também
        acabaCom(Tx('{a} cancelou a troca.', { a: st.nomePar }));
      }
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

    // 0) o cartório de novo (o parceiro pode ter confirmado depois de algo mudar)
    var semCart = semCartorio(st);
    if (semCart) { caiSemCartorio(semCart); return; }

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
    // 11/09: a troca que cai no fim diz o porquê, dos DOIS lados (antes a
    // janela só fechava, e no ar parecia defeito)
    if (falta) {
      caiComMotivo('falta', Tx('Troca cancelada: uma peça que você pôs na mesa não está mais no seu saco.'));
      return;
    }
    // 1a) os bichos (12/09): o meu segue solto? o dele não é um que já tenho?
    if (st.minha.pets.some(function (o) { return !petSolto(o.petId); })) {
      caiComMotivo('falta', Tx('Troca cancelada: um bicho que você pôs na mesa não está mais solto (foi vestido ou já saiu).'));
      return;
    }
    var rep2 = petRepetido(st);
    if (rep2) { caiComMotivo('pet', motivoRepetido(rep2)); return; }

    // 1b) O SACO TEM FUNDO (25/08): o que vem tem de caber no lugar do que
    // vai. Sem vaga, a troca cai como no caso do item sumido — melhor cair
    // do que estourar o limite por uma porta lateral.
    var limite = (prog.bagLimit) ? prog.bagLimit() : Infinity;
    if (inv.length - indices.length + st.dele.itens.length > limite) {
      caiComMotivo('saco', Tx('Troca cancelada: o seu saco não tem espaço para o que vem.'));
      return;
    }

    /* A SEGURANÇA (13/09, docs/SEGURANCA.md §4.6): com a autoridade ligada quem
     * move é o SERVIDOR — as peças por série, os bichos e os vinténs saem do
     * estado de um e entram no do outro numa transação. Aqui nada se mexe na
     * mão: vai a intenção espelhada, e o estado que volta é adotado. Quem
     * registra primeiro recebe "aguardando" e busca o estado logo depois. */
    var Aut = JOGO.Autoridade, Nv = JOGO.Nuvem;
    if (Aut && Aut.ligada && Aut.ligada() && Nv && Nv.troca) {
      var parNv = null, RdA = R();
      if (RdA && RdA.pares) RdA.pares().forEach(function (p) { if (p.id === st.par) parNv = p.nuvem || null; });
      if (!parNv) { caiComMotivo('cartorio', MOTIVO_DE_LA); return; }
      var seriesDe = function (lista) { return lista.map(function (o) { return o.iid; }).filter(Boolean); };
      var dou = { iids: seriesDe(st.minha.itens), pets: st.minha.pets.map(function (p) { return p.petId; }),
                  moedas: st.minha.moedas };
      var recebo = { iids: seriesDe(st.dele.itens), pets: st.dele.pets.map(function (p) { return p.petId; }),
                     moedas: st.dele.moedas };
      var paraHistorico = { com: st.nomePar, comId: st.par,
                            dei: { itens: st.minha.itens.slice(), moedas: st.minha.moedas, pets: st.minha.pets.slice() },
                            recebi: { itens: st.dele.itens.slice(), moedas: st.dele.moedas, pets: st.dele.pets.slice() } };
      st.fase = 'feita';
      st.resultado = 'no-servidor';
      avisa();
      st = null;
      Nv.troca(parNv, dou, recebo).then(function (r) {
        var ui = JOGO.UI;
        if (r && r.ok && r.feita && (r.progress || r.db)) {
          Aut.adota(r.progress, r.db);
          try { if (DB() && DB().registrarTroca) DB().registrarTroca(paraHistorico); } catch (eH) {}
          return;
        }
        if (r && r.ok && r.aguardando) {
          // o outro lado ainda vai registrar: o estado dele e o meu mudam juntos lá
          setTimeout(function () { Aut.puxaEstado(); }, 2500);
          setTimeout(function () { Aut.puxaEstado(); }, 7000);
          try { if (DB() && DB().registrarTroca) DB().registrarTroca(paraHistorico); } catch (eH2) {}
          return;
        }
        try { if (ui && ui.toast) ui.toast(Tx('A troca não foi registrada no servidor: {a}', { a: (r && r.erro) || Tx('sem resposta') })); } catch (eT) {}
        Aut.puxaEstado();
      });
      return;
    }

    var meusItens = st.minha.itens.slice();
    var moedasVao = st.minha.moedas;
    var itensVem = st.dele.itens.slice();
    var moedasVem = st.dele.moedas;
    var meusPets = st.minha.pets.slice();
    var petsVem = st.dele.pets.slice();
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
    // 2b) os bichos: o meu sai com as cartas e o XP; o dele entra com os dele
    var sp = prog.state;
    if (!sp.petCards || typeof sp.petCards !== 'object') sp.petCards = {};
    if (!sp.petXp || typeof sp.petXp !== 'object') sp.petXp = {};
    if (Object.prototype.toString.call(sp.pets) !== '[object Array]') sp.pets = [];
    meusPets.forEach(function (o) {
      var ip = sp.pets.indexOf(o.petId);
      if (ip >= 0) sp.pets.splice(ip, 1);
      delete sp.petCards[o.petId];         // sem isto, a próxima carta devolvia o bicho
      delete sp.petXp[o.petId];
    });
    petsVem.forEach(function (o) {
      sp.petCards[o.petId] = Math.max(Math.floor(Number(sp.petCards[o.petId]) || 0), o.cartas);
      sp.petXp[o.petId] = o.xp;
      if (sp.pets.indexOf(o.petId) < 0) sp.pets.push(o.petId);
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
                              dei: { itens: meusItens, moedas: moedasVao, pets: meusPets },
                              recebi: { itens: itensVem, moedas: moedasVem, pets: petsVem } });
        } catch (e) {}
      }
    });

    st.fase = 'feita';
    st.resultado = 'trocado';
    avisa();
    st = null;
  }
})();
