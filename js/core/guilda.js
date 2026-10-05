// A Guilda — clã com cofre, bônus e banco de empréstimos (dono: lógica).
var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

/* O QUE ISTO É (pedido do usuário, 25/08)
 * ========================================
 * "cada guild poderia ter um local só para eles.. competição de guild..
 *  isso dá xp pra guild e ranking também e moeda da guild, moeda única que
 *  vai para um cofre e somente o líder usa e pode comprar bônus para
 *  membros, de drops, xp etc... lá vai ter um banco compartilhado de guild
 *  para empréstimos de item"
 *
 * LOCAL-PRIMEIRO, como tudo: o registro vive em UMA chave de localStorage
 * SEM sufixo de conta ('soterra-guilda-v1') — é o "servidor de mentira" da
 * máquina, compartilhado entre as contas dela (o mesmo modelo do Banco de
 * Contas: duas janelas = dois jogadores = dois membros de verdade). Quando
 * o servidor chegar, o miolo troca e o registro vira resposta dele — a API
 * já é assíncrona por isso.
 *
 * O QUE FICA PARA O SERVIDOR (dito, não escondido): a COMPETIÇÃO de guild
 * entre máquinas (2 jogadores, 2 personagens cada — o duelo às cegas da
 * Rede) e a CASA 3D própria (vem com a fase do lobby). Hoje o duelo de
 * treino alimenta a guilda em versão reduzida, e a Sede na praça abre a
 * ficha.
 *
 * REGRAS:
 *   moeda da guilda  só nasce de competição (treino paga pouco); vai ao
 *                    COFRE — e só o LÍDER gasta, comprando bônus de 24h
 *                    para TODOS os membros (+15% de saque ou de XP).
 *   banco da guilda  membros depositam itens; QUALQUER membro pega
 *                    emprestado (um empréstimo ativo por conta); devolve
 *                    quem pegou; o DONO retira de vez se não está emprestado.
 *                    04/10: quem pegou e fica mais de EMPRESTIMO_AUSENCIA_DIAS
 *                    sem entrar perde o empréstimo — a peça volta sozinha.
 *   liderança        quem cria lidera; se sair, passa ao membro mais
 *                    antigo; o último a sair dissolve a guilda.
 * Quem move o ITEM de verdade (saco ↔ banco da guilda) é a HUD, como no
 * banco do Acampamento — aqui mora só o registro.
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

  var G = {};
  JOGO.Guilda = G;

  var CHAVE = 'soterra-guilda-v1';
  G.XP_TREINO = 6;
  G.MOEDA_TREINO = 1;
  G.CUSTO_BONUS = 25;
  G.BONUS_MS = 24 * 3600 * 1000;
  G.BONUS_FATOR = 1.15;
  /* fundar custa INSÍGNIAS DE FUNDAÇÃO (30/08): a moeda que só chefe
   * derruba (DATA.insignias, funil em game.js, saldo no Progress). O
   * número oficial mora em DATA.insignias.porGuilda; este é o reserva
   * para páginas que carregam a guilda sem o DATA. */
  G.CUSTO_CRIAR = 10;

  /* relógio injetável (teste de expiração de bônus) */
  G._agora = null;
  function agora() { return typeof G._agora === 'function' ? G._agora() : Date.now(); }

  /* A CONTA DA JANELA, espelhada aqui pela HUD (o DB é assíncrono e o
   * game.js precisa de bonusAtivo SÍNCRONO no meio da recompensa). */
  var conta = null;
  G.contaAtiva = function (id, nome) {
    if (id) conta = { id: id, nome: nome || '?' };
    // 04/10: a conta entrou — confere os empréstimos vencidos e marca a presença (jogo local)
    if (id) { try { if (!G.noServidor()) presencaLocal(); } catch (e) {} }
    return conta;
  };

  /* ============================================ A PEÇA EMPRESTADA QUE VOLTA SOZINHA (04/10)
   * Pedido do dono: "caso o usuário exclua a conta ou fique mais de 3 dias sem
   * entrar, a peça volta automaticamente para o cofre da guilda". No servidor
   * quem confere é o servidor/guilda.py (EMPRESTIMO_AUSENCIA_DIAS, o espelho
   * deste número) e o jogo só recebe o recado. Aqui, no jogo LOCAL, a régua é a
   * data desta máquina: `visto[conta]` guarda a última vez que cada conta entrou
   * e a conferência roda quando alguém entra ou abre a guilda. Conta local não
   * se exclui, então só existe a regra dos dias. */
  G.EMPRESTIMO_AUSENCIA_DIAS = 3;
  G.EMPRESTIMO_AUSENCIA_MS = G.EMPRESTIMO_AUSENCIA_DIAS * 24 * 3600 * 1000;
  var PRESENCA_MS = 3600 * 1000;          // a presença regrava no máximo de hora em hora
  var CHAVE_RECADOS = 'soterra-guilda-recados-v1';

  /* Dentro de uma leitura `d`: devolve true se mudou algo (quem chama grava). */
  function recolheAusentes(d) {
    if (!conta) return false;
    var t = agora(), mudou = false;
    if (!d.visto) d.visto = {};
    Object.keys(d.guildas).forEach(function (gid) {
      var banco = (d.guildas[gid] && d.guildas[gid].banco) || [];
      for (var i = 0; i < banco.length; i++) {
        var e = banco[i], quem = e && e.emprestadoPara;
        if (!quem) continue;
        // empréstimo de antes desta regra não tem data: o prazo dele começa agora
        if (typeof d.visto[quem] !== 'number') { d.visto[quem] = t; mudou = true; continue; }
        if (t - d.visto[quem] <= G.EMPRESTIMO_AUSENCIA_MS) continue;
        if (!d.recados) d.recados = {};
        (d.recados[quem] = d.recados[quem] || []).push({
          itemId: e.itemId, level: e.level || 0, stars: e.stars || 0,
          motivo: 'ausencia', dias: G.EMPRESTIMO_AUSENCIA_DIAS });
        e.emprestadoPara = null;
        delete e.tomadorNome;
        mudou = true;
      }
    });
    // só DEPOIS de julgar: quem volta fora do prazo perde o empréstimo antes de contar como presente
    if (!(t - d.visto[conta.id] < PRESENCA_MS)) { d.visto[conta.id] = t; mudou = true; }
    return mudou;
  }
  function presencaLocal() {
    var d = le();
    var mudou = recolheAusentes(d);
    var meus = (d.recados && d.recados[conta.id]) || [];
    if (meus.length) { delete d.recados[conta.id]; mudou = true; }
    if (mudou) grava(d);
    // o saco local é desta página: a cópia sai dele aqui mesmo (o recado já saiu do disco, não repete)
    if (meus.length) trataRecados(meus, true);
    else mostraRecados();
  }

  /* A cópia emprestada sai do saco (ou do herói que a veste). Com a série, por
   * ela; sem (o jogo local e o servidor sem juiz não a conhecem), pela peça
   * IGUAL — o mesmo critério da devolução pelo gesto na HUD. */
  function tiraCopia(av) {
    var P = JOGO.Progress, st = P && P.state;
    if (!st || !av) return false;
    function igual(id, v) {
      if (av.iid) return !!(v && v.iid === av.iid);
      return id === av.itemId && ((v && v.level) || 0) === (av.level || 0) && ((v && v.stars) || 0) === (av.stars || 0);
    }
    var inv = st.inventory || [], achou = false;
    for (var i = 0; i < inv.length && !achou; i++) {
      if (inv[i] && igual(inv[i].itemId, inv[i])) { inv.splice(i, 1); achou = true; }
    }
    var hs = st.heroes || {};
    Object.keys(hs).forEach(function (hid) {
      var h = hs[hid] || {};
      Object.keys(h.items || {}).forEach(function (slot) {
        var v = h.itemVar && h.itemVar[slot];
        if (achou || !h.items[slot] || !igual(h.items[slot], v)) return;
        h.items[slot] = null;
        if (h.itemVar) h.itemVar[slot] = null;
        achou = true;
      });
    });
    if (achou) { try { P.save(); } catch (e) {} }
    return achou;
  }
  G.textoRecado = function (av) {
    var def = (JOGO.DATA && JOGO.DATA.items && JOGO.DATA.items[av.itemId]) || null;
    var nome = (def && def.name) || 'emprestada';
    if (av.motivo === 'dono-excluiu') {
      return Tx('A peça {nome} saiu do seu saco: quem a emprestou excluiu a conta.', { nome: nome });
    }
    // 04/10: a guilda desfeita pela equipe — quem pegou emprestado perde a cópia, o dono recebe a peça
    if (av.motivo === 'guilda-desfeita') {
      return Tx('A peça {nome} saiu do seu saco: a guilda que a emprestou foi desfeita pela equipe.', { nome: nome });
    }
    if (av.motivo === 'devolvida-cofre') {
      return Tx('A guilda foi desfeita pela equipe: a sua peça {nome} voltou do banco dela para o cofre do Acampamento (o saco estava cheio).', { nome: nome });
    }
    if (av.motivo === 'devolvida-saco' || av.motivo === 'devolvida') {
      return Tx('A guilda foi desfeita pela equipe: a sua peça {nome} voltou do banco dela para o seu saco.', { nome: nome });
    }
    return Tx('A peça {nome} voltou para o banco da guilda: você ficou mais de {a} dias sem entrar.', { nome: nome, a: av.dias || G.EMPRESTIMO_AUSENCIA_DIAS });
  };
  /* O recado pode chegar antes de a HUD existir (a conta é reconhecida cedo):
   * fica na fila e sai no próximo pedido à guilda. */
  var recadosNaFila = [];
  function mostraRecados() {
    if (!recadosNaFila.length || !(JOGO.UI && typeof JOGO.UI.toast === 'function')) return;
    var fila = recadosNaFila;
    recadosNaFila = [];
    for (var i = 0; i < fila.length; i++) { try { JOGO.UI.toast(fila[i], 'info'); } catch (e) {} }
  }
  function trataRecados(lista, tira) {
    for (var i = 0; i < lista.length; i++) {
      // o recado 'devolvida' é o contrário: a peça ENTROU (é do dono) — nunca se tira nada por ele
      if (tira && !/^devolvida/.test(String(lista[i].motivo || ''))) tiraCopia(lista[i]);
      recadosNaFila.push(G.textoRecado(lista[i]));
    }
    mostraRecados();
  }
  G._recadosNaFila = function () { return recadosNaFila.slice(); };   // provas

  function armazem() {
    try {
      if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
    } catch (e) {}
    return null;
  }
  /* SEM cache: cada chamada relê o disco — outra janela (outro membro da
   * máquina) pode ter escrito. Corrida de escrita é last-write-wins e está
   * ACEITA até o servidor virar a autoridade. */
  function le() {
    var s = armazem();
    try {
      var d = JSON.parse((s && s.getItem(CHAVE)) || '');
      if (d && d.guildas && d.porConta) return d;
    } catch (e) {}
    return { guildas: {}, porConta: {} };
  }
  function grava(d) {
    var s = armazem();
    try { if (s) s.setItem(CHAVE, JSON.stringify(d)); } catch (e) {}
  }
  function responde(v) { return Promise.resolve(v); }
  function novoId() {
    return 'g' + agora().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  /* a escada: subir custa cada vez mais — limiar(n) = 60·n·(n+1)/2 */
  G.nivelDe = function (xp) {
    xp = (typeof xp === 'number' && isFinite(xp)) ? xp : 0;
    var n = 1;
    while (xp >= 60 * n * (n + 1) / 2) n++;
    return n;
  };

  function minhaG(d) {
    if (!conta) return null;
    var gid = d.porConta[conta.id];
    return gid ? d.guildas[gid] || null : null;
  }
  function foto(g) {
    if (!g) return null;
    return JSON.parse(JSON.stringify(g));
  }

  /* OS CARGOS (30/08): líder, oficial e membro. O líder continua sendo
   * `liderId` (a verdade única de sempre); `cargo` no registro do membro só
   * guarda 'oficial' — quem não tem nada é membro raso. As permissões:
   *   gastar o COFRE (bônus): líder e oficiais;
   *   promover/rebaixar: só o líder;
   *   doar XP e usar o banco: todo mundo. */
  function cargoDe(g, id) {
    if (!g) return null;
    if (g.liderId === id) return 'lider';
    for (var i = 0; i < g.membros.length; i++) {
      if (g.membros[i].id === id) return g.membros[i].cargo === 'oficial' ? 'oficial' : 'membro';
    }
    return null;
  }
  function podeGastarCofre(g, id) {
    var c = cargoDe(g, id);
    return c === 'lider' || c === 'oficial';
  }

  // ------------------------------------------------------------ vida da guilda
  /* O PREÇO DA FUNDAÇÃO cobra do Progress (as insígnias dos chefes). A
   * cobrança vem DEPOIS de toda validação — fundação recusada não pode
   * comer moeda — e só quando o Progress está de pé: as páginas de teste
   * que carregam guilda.js sozinha continuam fundando de graça, que é o
   * ambiente delas; no jogo o Progress sempre existe. */
  function precoCriar() {
    var cfg = (typeof JOGO !== 'undefined' && JOGO.DATA && JOGO.DATA.insignias) || null;
    var n = cfg && typeof cfg.porGuilda === 'number' ? Math.floor(cfg.porGuilda) : G.CUSTO_CRIAR;
    return n > 0 ? n : G.CUSTO_CRIAR;
  }
  function cofreInsignias() {
    var P = (typeof JOGO !== 'undefined') ? JOGO.Progress : null;
    return (P && typeof P.insigniasVer === 'function' &&
            typeof P.gastaInsignias === 'function') ? P : null;
  }
  /* A LEI DOS NOMES (js/core/nomes.js, pedido do dono: "ninguem conseguir
   * colocar o nome com GM Gm Admin Administrador etc.."). Guilda nenhuma se
   * passa pela equipe do jogo — e a recusa vem ANTES de qualquer cobrança.
   * O módulo pode não estar na página: guilda.js roda sozinha nas bancadas de
   * teste, e ali nada muda. O Mestre do Fundo passa: o título é dele. */
  function ehMestre() {
    try {
      return !!(JOGO.GM && typeof JOGO.GM.ativo === 'function' && JOGO.GM.ativo());
    } catch (e) { return false; }
  }
  function nomeDeEquipe(nome) {
    var Nm = (typeof JOGO !== 'undefined') ? JOGO.Nomes : null;
    if (!Nm || typeof Nm.reservado !== 'function') return null;
    if (ehMestre()) return null;
    if (!Nm.reservado(nome)) return null;
    return Nm.MOTIVO_RESERVADO || Tx('esse nome é reservado à equipe do jogo');
  }

  G.criar = function (nome, emblema) {
    if (!conta) return responde({ ok: false, erro: Tx('sem conta') });
    nome = String(nome || '').trim().slice(0, 24);
    if (!nome) return responde({ ok: false, erro: Tx('diga um nome') });
    var recusa = nomeDeEquipe(nome);
    if (recusa) return responde({ ok: false, erro: recusa });
    var d = le();
    if (d.porConta[conta.id]) return responde({ ok: false, erro: Tx('você já tem guilda') });
    var P = cofreInsignias();
    if (P) {
      var preco = precoCriar();
      if (P.insigniasVer() < preco) {
        return responde({ ok: false, erro: Tx('faltam insígnias: {a}/{preco} — só chefe derruba', { a: P.insigniasVer(), preco: preco }) });
      }
      if (!P.gastaInsignias(preco)) {
        return responde({ ok: false, erro: Tx('as insígnias escaparam da mão') });
      }
    }
    var g = { id: novoId(), nome: nome, emblema: String(emblema || '⚑').slice(0, 64),
              liderId: conta.id, membros: [{ id: conta.id, nome: conta.nome }],
              xp: 0, moedas: 0, bonus: {}, banco: [], treinos: 0, criadaEm: agora(),
              porta: 'aberta', dizimo: 0, pedidos: [] };
    if (ehMestre()) g.equipe = true;             // 04/10: a guilda da equipe não sai em lista
    d.guildas[g.id] = g;
    d.porConta[conta.id] = g.id;
    grava(d);
    return responde({ ok: true, guilda: foto(g) });
  };

  /* A GUILDA DA EQUIPE (04/10, dono: "guild staff não deve aparecer nem na lista de guild..
   * só o adm possui"). No servidor é a que um Mestre lidera (guilda.py, _g_da_equipe). Em
   * casa não há contas.gm: a guilda leva a marca `equipe` quando o Mestre a funda — e as
   * que ele já liderava ganham a marca na primeira vez que ele abre a ficha. Marcada, ela
   * some da lista de quem não é o Mestre e ninguém entra nela por conta própria. O
   * Mestre aqui é o mesmo da lei dos nomes (ehMestre, acima): o modo Mestre ativo. */
  function escondida(g) { return !!(g && g.equipe === true && !ehMestre()); }

  G.minha = function () {
    if (conta) presencaLocal();          // 04/10: os empréstimos vencidos voltam antes da foto
    var d = le();
    var g = minhaG(d);
    if (!g) return responde(null);
    if (conta && g.liderId === conta.id && !g.equipe && ehMestre()) { g.equipe = true; grava(d); }
    var f = foto(g);
    f.nivel = G.nivelDe(g.xp);
    f.souLider = !!(conta && g.liderId === conta.id);
    f.meuCargo = conta ? cargoDe(g, conta.id) : null;
    // cada membro sai com o cargo RESOLVIDO (o líder pelo liderId); 13/09: e o XP
    // que doou e o dízimo dele, como a ficha do servidor
    for (var mi = 0; mi < f.membros.length; mi++) {
      var mid = f.membros[mi].id;
      f.membros[mi].cargo = cargoDe(g, mid);
      f.membros[mi].xpDoado = (g.contrib && g.contrib[mid]) || 0;
      f.membros[mi].dizimo = dizimoDe(g, mid);
      f.membros[mi].dizimoProprio = !!(g.dizimoMembros && typeof g.dizimoMembros[mid] === 'number');
    }
    f.mural = g.mural || null;
    delete f.contrib;
    delete f.dizimoMembros;
    return responde(f);
  };

  // ------------------------------------------------------------------ cargos
  G.promover = function (idAlvo) {
    if (!conta) return responde({ ok: false });
    var d = le();
    var g = minhaG(d);
    if (!g) return responde({ ok: false, erro: Tx('sem guilda') });
    if (g.liderId !== conta.id) return responde({ ok: false, erro: Tx('só o líder promove') });
    if (idAlvo === conta.id) return responde({ ok: false, erro: Tx('você já lidera') });
    for (var i = 0; i < g.membros.length; i++) {
      if (g.membros[i].id !== idAlvo) continue;
      if (g.membros[i].cargo === 'oficial') return responde({ ok: false, erro: Tx('já é oficial') });
      g.membros[i].cargo = 'oficial';
      grava(d);
      return responde({ ok: true, cargo: 'oficial' });
    }
    return responde({ ok: false, erro: Tx('não é membro') });
  };
  G.rebaixar = function (idAlvo) {
    if (!conta) return responde({ ok: false });
    var d = le();
    var g = minhaG(d);
    if (!g) return responde({ ok: false, erro: Tx('sem guilda') });
    if (g.liderId !== conta.id) return responde({ ok: false, erro: Tx('só o líder rebaixa') });
    for (var i = 0; i < g.membros.length; i++) {
      if (g.membros[i].id !== idAlvo) continue;
      if (g.membros[i].cargo !== 'oficial') return responde({ ok: false, erro: Tx('já é membro raso') });
      delete g.membros[i].cargo;
      grava(d);
      return responde({ ok: true, cargo: 'membro' });
    }
    return responde({ ok: false, erro: Tx('não é membro') });
  };

  /* A PORTA E OS PEDIDOS (30/08): "os usuários na sede podem ver as guildas
   * existentes e pedir para participar OU caso a guild seja aberta ele já
   * entra". A guilda nasce ABERTA; o líder fecha para 'convite' e a fila de
   * pedidos passa a existir — líder e oficiais aceitam ou recusam. */
  function portaDe(g) { return g.porta === 'convite' ? 'convite' : 'aberta'; }
  function pedidosDe(g) {
    if (!Array.isArray(g.pedidos)) g.pedidos = [];
    return g.pedidos;
  }
  G.definirPorta = function (modo) {
    if (modo !== 'aberta' && modo !== 'convite') return responde({ ok: false, erro: 'modo desconhecido' });
    if (!conta) return responde({ ok: false });
    var d = le();
    var g = minhaG(d);
    if (!g) return responde({ ok: false, erro: Tx('sem guilda') });
    if (g.liderId !== conta.id) return responde({ ok: false, erro: Tx('só o líder mexe na porta') });
    g.porta = modo;
    grava(d);
    return responde({ ok: true, porta: modo });
  };
  G.pedirEntrada = function (gid) {
    if (!conta) return responde({ ok: false, erro: Tx('sem conta') });
    var d = le();
    if (d.porConta[conta.id]) return responde({ ok: false, erro: Tx('você já tem guilda') });
    var g = d.guildas[gid];
    if (!g || escondida(g)) return responde({ ok: false, erro: Tx('essa guilda não existe mais') });
    if (portaDe(g) === 'aberta') {
      // porta aberta não tem fila: pedir É entrar
      g.membros.push({ id: conta.id, nome: conta.nome });
      d.porConta[conta.id] = gid;
      grava(d);
      return responde({ ok: true, entrou: true, guilda: foto(g) });
    }
    var fila = pedidosDe(g);
    for (var i = 0; i < fila.length; i++) {
      if (fila[i].id === conta.id) return responde({ ok: false, erro: Tx('seu pedido já está na fila') });
    }
    fila.push({ id: conta.id, nome: conta.nome, em: agora() });
    grava(d);
    return responde({ ok: true, entrou: false, pedidoFeito: true });
  };
  G.aceitarPedido = function (idAlvo) {
    if (!conta) return responde({ ok: false });
    var d = le();
    var g = minhaG(d);
    if (!g) return responde({ ok: false, erro: Tx('sem guilda') });
    if (!podeGastarCofre(g, conta.id)) {
      return responde({ ok: false, erro: Tx('só líder e oficiais aceitam pedidos') });
    }
    var fila = pedidosDe(g);
    for (var i = 0; i < fila.length; i++) {
      if (fila[i].id !== idAlvo) continue;
      var p = fila.splice(i, 1)[0];
      if (d.porConta[p.id]) {                 // já achou outra casa nesse meio-tempo
        grava(d);
        return responde({ ok: false, erro: Tx('essa conta já entrou noutra guilda') });
      }
      g.membros.push({ id: p.id, nome: p.nome });
      d.porConta[p.id] = g.id;
      grava(d);
      return responde({ ok: true, membro: { id: p.id, nome: p.nome } });
    }
    return responde({ ok: false, erro: Tx('pedido não está mais na fila') });
  };
  G.recusarPedido = function (idAlvo) {
    if (!conta) return responde({ ok: false });
    var d = le();
    var g = minhaG(d);
    if (!g) return responde({ ok: false, erro: Tx('sem guilda') });
    if (!podeGastarCofre(g, conta.id)) {
      return responde({ ok: false, erro: Tx('só líder e oficiais recusam pedidos') });
    }
    var fila = pedidosDe(g);
    for (var i = 0; i < fila.length; i++) {
      if (fila[i].id === idAlvo) { fila.splice(i, 1); grava(d); return responde({ ok: true }); }
    }
    return responde({ ok: false, erro: Tx('pedido não está mais na fila') });
  };

  /* O DÍZIMO (30/08): "o líder define a % de doação de xp de cada um" — a
   * taxa vale para todo membro, o desconto acontece no funil de XP do
   * game.js (que consulta `dizimoAtual` SÍNCRONO, como o bonusAtivo). */
  G.DIZIMO_MAX = 25;
  /* 13/09, dono: "o líder define quantos % cada um vai doar". Sem `idAlvo`, o
   * dízimo PADRÃO (quem não tem um próprio; `op.todos` passa a valer para
   * todos); com `idAlvo`, o daquele membro — `pct` null o devolve ao padrão.
   * O mesmo contrato do POST /api/guilda/dizimo. */
  G.definirDizimo = function (pct, idAlvo, op) {
    if (!conta) return responde({ ok: false });
    var voltaAoPadrao = idAlvo != null && pct === null;
    if (!voltaAoPadrao) {
      pct = Math.floor(pct);
      if (!isFinite(pct) || pct < 0 || pct > G.DIZIMO_MAX) {
        return responde({ ok: false, erro: Tx('o dízimo vai de 0 a {DIZIMO_MAX}%', { DIZIMO_MAX: G.DIZIMO_MAX }) });
      }
    }
    var d = le();
    var g = minhaG(d);
    if (!g) return responde({ ok: false, erro: Tx('sem guilda') });
    if (g.liderId !== conta.id) return responde({ ok: false, erro: Tx('só o líder define o dízimo') });
    if (!g.dizimoMembros || typeof g.dizimoMembros !== 'object') g.dizimoMembros = {};
    if (idAlvo == null) {
      g.dizimo = pct;
      if (op && op.todos === true) g.dizimoMembros = {};
    } else {
      if (!cargoDe(g, idAlvo)) return responde({ ok: false, erro: Tx('não é membro') });
      if (voltaAoPadrao) delete g.dizimoMembros[idAlvo];
      else g.dizimoMembros[idAlvo] = pct;
    }
    grava(d);
    return responde({ ok: true, dizimo: pct, conta: idAlvo == null ? null : idAlvo });
  };
  function dizimoDe(g, id) {
    var dm = g && g.dizimoMembros;
    return (dm && typeof dm[id] === 'number') ? dm[id] : Math.floor((g && g.dizimo) || 0);
  }
  G.dizimoAtual = function () {
    var d = le();
    var g = minhaG(d);
    var p = g ? Math.floor(dizimoDe(g, conta.id)) : 0;
    return (isFinite(p) && p > 0) ? Math.min(p, G.DIZIMO_MAX) : 0;
  };

  /* A MENSAGEM DA GUILDA (13/09): boas-vindas e orientações que todo membro lê
   * na ficha. Líder e oficiais escrevem; texto vazio apaga. */
  G.MURAL_MAX = 500;
  function limpaMural(texto) {
    return String(texto == null ? '' : texto).replace(/\r\n?/g, '\n')
      .replace(/[\x00-\x09\x0b-\x1f\x7f]/g, '').trim().slice(0, G.MURAL_MAX).trim();
  }
  G.definirMural = function (texto) {
    if (!conta) return responde({ ok: false });
    var d = le();
    var g = minhaG(d);
    if (!g) return responde({ ok: false, erro: Tx('sem guilda') });
    if (!podeGastarCofre(g, conta.id)) {
      return responde({ ok: false, erro: Tx('só líder e oficiais escrevem a mensagem da guilda') });
    }
    texto = limpaMural(texto);
    if (texto) g.mural = { texto: texto, autorNome: conta.nome, em: agora() };
    else delete g.mural;
    grava(d);
    return responde({ ok: true });
  };

  /* O XP DO DÍZIMO. Nasceu como a oferenda (30/08: vinténs da conta viravam XP da
   * guilda, 2 por 1). 04/10, dono: "dinheiro não dará mais XP para guild; somente %
   * de XP doada de batalha OU guerra de guild" — a HUD perdeu o botão e esta porta
   * ficou só para o dízimo, que o game.js entrega no fim de cada sala. */
  G.doarXp = function (n) {
    if (!conta) return responde({ ok: false });
    n = Math.floor(n);
    if (!isFinite(n) || n <= 0) return responde({ ok: false, erro: Tx('quantia inválida') });
    var d = le();
    var g = minhaG(d);
    if (!g) return responde({ ok: false, erro: Tx('sem guilda') });
    g.xp += n;
    if (!g.contrib || typeof g.contrib !== 'object') g.contrib = {};
    g.contrib[conta.id] = (g.contrib[conta.id] || 0) + n;      // 13/09: a ordem da grade de membros
    grava(d);
    return responde({ ok: true, xp: g.xp, nivel: G.nivelDe(g.xp) });
  };

  G.lista = function () {
    var d = le();
    var fora = [];
    for (var gid in d.guildas) {
      if (!d.guildas.hasOwnProperty(gid)) continue;
      var g = d.guildas[gid];
      if (escondida(g)) continue;                 // 04/10: a guilda da equipe só o Mestre vê
      fora.push({ id: g.id, nome: g.nome, emblema: g.emblema, xp: g.xp,
                  nivel: G.nivelDe(g.xp), membros: g.membros.length,
                  porta: portaDe(g) });
    }
    fora.sort(function (a, b) { return b.xp - a.xp; });
    return responde(fora);
  };

  G.entrar = function (gid, op) {
    if (!conta) return responde({ ok: false, erro: Tx('sem conta') });
    var d = le();
    if (d.porConta[conta.id]) return responde({ ok: false, erro: Tx('você já tem guilda') });
    var g = d.guildas[gid];
    // 04/10: na guilda da equipe só se entra pelo convite do Mestre
    if (!g || (escondida(g) && !(op && op.convite === true))) return responde({ ok: false, erro: Tx('essa guilda não existe mais') });
    // porta fechada (30/08): entrar direto só em guilda ABERTA — na de
    // convite o caminho é a fila (pedirEntrada) ou o convite da praça. 11/09:
    // o convite da praça ({ convite: true }) entra — antes ele batia nesta
    // porta e o "aceitar" não levava a lugar nenhum
    if (portaDe(g) === 'convite' && !(op && op.convite === true)) {
      return responde({ ok: false, erro: Tx('a guilda é por convite — peça para entrar') });
    }
    g.membros.push({ id: conta.id, nome: conta.nome });
    d.porConta[conta.id] = gid;
    grava(d);
    return responde({ ok: true, guilda: foto(g) });
  };

  G.sair = function () {
    if (!conta) return responde({ ok: false });
    var d = le();
    var g = minhaG(d);
    if (!g) return responde({ ok: false, erro: Tx('sem guilda') });
    // empréstimo ativo prende: devolve antes de bater a porta
    for (var b = 0; b < g.banco.length; b++) {
      if (g.banco[b].emprestadoPara === conta.id) {
        return responde({ ok: false, erro: Tx('devolva o item emprestado antes de sair') });
      }
    }
    g.membros = g.membros.filter(function (m) { return m.id !== conta.id; });
    delete d.porConta[conta.id];
    if (!g.membros.length) {
      delete d.guildas[g.id];                       // o último apaga a luz
    } else if (g.liderId === conta.id) {
      g.liderId = g.membros[0].id;                  // o mais antigo herda
    }
    grava(d);
    return responde({ ok: true });
  };

  // -------------------------------------------------- competição (v1: treino)
  /* O duelo de TREINO paga pouco de propósito (é contra si mesmo); a
   * competição de verdade — 2 jogadores, 2 personagens cada, pela Rede —
   * chega com o servidor e pagará por vitória. */
  G.registraTreino = function () {
    var d = le();
    var g = minhaG(d);
    if (!g) return responde({ ok: false });
    g.xp += G.XP_TREINO;
    g.moedas += G.MOEDA_TREINO;
    g.treinos++;
    grava(d);
    return responde({ ok: true, xp: g.xp, moedas: g.moedas });
  };

  // ------------------------------------------------------- o cofre e os bônus
  G.compraBonus = function (tipo) {
    if (tipo !== 'drop' && tipo !== 'xp') return responde({ ok: false, erro: Tx('bônus desconhecido') });
    if (!conta) return responde({ ok: false });
    var d = le();
    var g = minhaG(d);
    if (!g) return responde({ ok: false, erro: Tx('sem guilda') });
    // cargos (30/08): oficiais também administram o cofre
    if (!podeGastarCofre(g, conta.id)) {
      return responde({ ok: false, erro: Tx('só líder e oficiais gastam o cofre') });
    }
    if (g.moedas < G.CUSTO_BONUS) return responde({ ok: false, erro: 'cofre insuficiente' });
    g.moedas -= G.CUSTO_BONUS;
    var base = Math.max(agora(), g.bonus[tipo] || 0);   // comprar de novo ESTENDE
    g.bonus[tipo] = base + G.BONUS_MS;
    grava(d);
    return responde({ ok: true, ate: g.bonus[tipo], moedas: g.moedas });
  };

  /* SÍNCRONO de propósito: o game.js consulta no meio da conta da recompensa. */
  G.bonusAtivo = function (tipo) {
    var d = le();
    var g = minhaG(d);
    return !!(g && g.bonus && g.bonus[tipo] && g.bonus[tipo] > agora());
  };

  // -------------------------------------------- o banco de empréstimos
  G.bancoDepositar = function (item) {
    if (!conta || !item || !item.itemId) return responde({ ok: false });
    var d = le();
    var g = minhaG(d);
    if (!g) return responde({ ok: false, erro: Tx('sem guilda') });
    g.banco.push({ itemId: item.itemId, level: item.level || 0, stars: item.stars || 0,
                   dono: conta.id, donoNome: conta.nome, emprestadoPara: null });
    grava(d);
    return responde({ ok: true, total: g.banco.length });
  };
  G.bancoLista = function () {
    if (conta) presencaLocal();          // 04/10: abrir o banco confere os empréstimos vencidos
    var d = le();
    var g = minhaG(d);
    return responde(g ? foto(g).banco : []);
  };
  /* Pegar: o DONO retira de vez (se livre); os outros pegam EMPRESTADO —
   * um empréstimo ativo por conta, para o banco não virar saque. */
  G.bancoPegar = function (idx) {
    if (!conta) return responde({ ok: false });
    var d = le();
    var g = minhaG(d);
    if (!g || !g.banco[idx]) return responde({ ok: false, erro: Tx('essa peça já saiu') });
    var e = g.banco[idx];
    if (e.emprestadoPara) return responde({ ok: false, erro: Tx('já está emprestada') });
    if (e.dono === conta.id) {
      g.banco.splice(idx, 1);                       // retirada definitiva
      grava(d);
      return responde({ ok: true, item: e, definitivo: true });
    }
    for (var b = 0; b < g.banco.length; b++) {
      if (g.banco[b].emprestadoPara === conta.id) {
        return responde({ ok: false, erro: Tx('devolva o empréstimo atual primeiro') });
      }
    }
    e.emprestadoPara = conta.id;
    e.tomadorNome = conta.nome;
    if (!d.visto) d.visto = {};
    d.visto[conta.id] = agora();          // 04/10: quem pega está aqui — o prazo da ausência parte de agora
    grava(d);
    return responde({ ok: true, item: e, definitivo: false });
  };
  G.bancoDevolver = function (idx) {
    if (!conta) return responde({ ok: false });
    var d = le();
    var g = minhaG(d);
    if (!g || !g.banco[idx]) return responde({ ok: false, erro: 'essa vaga sumiu' });
    var e = g.banco[idx];
    if (e.emprestadoPara !== conta.id) return responde({ ok: false, erro: Tx('não foi você que pegou') });
    e.emprestadoPara = null;
    delete e.tomadorNome;
    grava(d);
    return responde({ ok: true });
  };

  /* ================================================================ A GUILDA NO SERVIDOR (11/09)
   * Pedido do dono ("Guilda no servidor"): com sessão (a conta do site), o
   * registro mora no cartório (servidor/guilda.py, /api/guilda/*) — o convite
   * entre duas máquinas passa a funcionar, e cofre, banco e bônus são de
   * todos. Sem sessão (em casa, nas bancadas) segue o registro local acima.
   * A HUD não muda de conversa: as mesmas funções, as mesmas respostas (os
   * ids de membro viram os das CONTAS; a ficha traz `eu`). O que o game.js
   * lê SÍNCRONO (bonusAtivo, dizimoAtual) vem da última ficha do servidor,
   * renovada em segundo plano quando passa de FICHA_MS. */
  G._servidor = null;                  // provas: true/false força; null = pela sessão
  G.noServidor = function () {
    if (typeof G._servidor === 'boolean') return G._servidor;
    try { var S = JOGO.Sessao; return !!(S && S.ativa && S.ativa() && S.api); } catch (e) { return false; }
  };
  var FICHA_MS = 5 * 60 * 1000;
  var ficha = null, fichaEm = 0, fichaPedida = false;
  function guardaFicha(f) { ficha = f || null; fichaEm = Date.now(); }
  function pede(rota, corpo) {
    var op = corpo === undefined ? {} : { method: 'POST', body: corpo };
    return JOGO.Sessao.api(rota, op).then(function (r) {
      r = (r && typeof r === 'object') ? r : { ok: false };
      if (r.ok && Object.prototype.hasOwnProperty.call(r, 'guilda')) guardaFicha(r.guilda);
      if (r.ok && r.avisos && r.avisos.length) { try { recebeAvisos(r.avisos); } catch (eA) {} }
      else mostraRecados();
      if (r.ok && r.devolucoes && r.devolucoes.length) { try { recebeDevolucoes(r.devolucoes); } catch (eD) {} }
      if (!r.ok && !r.erro) r.erro = r.status === 0 ? Tx('o servidor está fora (não respondeu)') : Tx('não deu');
      return r;
    });
  }
  /* 04/10: os recados do servidor (a peça emprestada voltou ao banco sem você). Com a
   * autoridade o servidor já tirou a cópia do estado: o jogo só adota o estado de lá. Sem
   * ela o saco mora aqui, e é esta página que tira a cópia — UMA vez por recado: os já
   * tratados ficam anotados no disco, porque a confirmação pode se perder no caminho e o
   * recado repetido tiraria outra peça igual. */
  function recadosVistos() {
    var s = armazem();
    try { var v = JSON.parse((s && s.getItem(CHAVE_RECADOS)) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; }
  }
  function recebeAvisos(lista) {
    var vistos = recadosVistos(), novos = [], ate = 0;
    for (var i = 0; i < lista.length; i++) {
      var av = lista[i];
      if (!av || typeof av.id !== 'number') continue;
      ate = Math.max(ate, av.id);
      if (vistos.indexOf(av.id) < 0) { novos.push(av); vistos.push(av.id); }
    }
    if (novos.length) {
      var s = armazem();
      try { if (s) s.setItem(CHAVE_RECADOS, JSON.stringify(vistos.slice(-50))); } catch (e) {}
      var A = JOGO.Autoridade;
      var ligada = !!(A && A.ligada && A.ligada());
      trataRecados(novos, !ligada);
      if (ligada && A.sincroniza) { try { A.sincroniza(); } catch (e2) {} }
    }
    if (ate) JOGO.Sessao.api('/api/guilda/avisos/visto', { method: 'POST', body: { ate: ate } });
  }
  /* A GUILDA DESFEITA PELA EQUIPE (04/10): as peças que esta conta tinha no banco voltam para
   * ela. Com a autoridade o servidor já as pôs no estado (chega só o recado 'devolvida' acima) e
   * esta lista vem vazia. SEM ela o saco mora aqui: é esta página que põe cada peça de volta —
   * no saco, ou no cofre do Acampamento se o saco está cheio — com a MESMA série, e confirma.
   * Uma vez por devolução: as já tratadas ficam anotadas no disco, como os recados, porque a
   * confirmação pode se perder e a lista repetida poria outra peça igual. */
  var CHAVE_DEVOLUCOES = 'soterra-guilda-devolucoes-v1';
  function recebeDevolucoes(lista) {
    var A = JOGO.Autoridade;
    if (A && A.ligada && A.ligada()) return;        // o servidor entrega pelo juiz; aqui não se mexe no saco
    var P = JOGO.Progress, st = P && P.state;
    if (!st || !Array.isArray(st.inventory)) return;
    var s = armazem(), vistos = [];
    try { vistos = JSON.parse((s && s.getItem(CHAVE_DEVOLUCOES)) || '[]'); if (!Array.isArray(vistos)) vistos = []; } catch (e) { vistos = []; }
    var ate = 0, pus = 0;
    for (var i = 0; i < lista.length; i++) {
      var dv = lista[i];
      if (!dv || typeof dv.id !== 'number' || typeof dv.itemId !== 'string') continue;
      ate = Math.max(ate, dv.id);
      if (vistos.indexOf(dv.id) >= 0) continue;
      var peca = { itemId: dv.itemId, level: dv.level || 0, stars: dv.stars || 0 };
      if (dv.iid) peca.iid = dv.iid;
      var noCofre = !(typeof P.bagFree === 'function' ? P.bagFree(1) : true) &&
                    !!(JOGO.DB && typeof JOGO.DB.depositarItem === 'function');
      if (noCofre) JOGO.DB.depositarItem(peca);
      else st.inventory.push(peca);
      vistos.push(dv.id);
      pus++;
      recadosNaFila.push(G.textoRecado({ itemId: dv.itemId, motivo: noCofre ? 'devolvida-cofre' : 'devolvida-saco' }));
    }
    if (pus) {
      try { P.save(); } catch (e2) {}
      try { if (s) s.setItem(CHAVE_DEVOLUCOES, JSON.stringify(vistos.slice(-200))); } catch (e3) {}
      mostraRecados();
    }
    if (ate) JOGO.Sessao.api('/api/guilda/devolucoes/visto', { method: 'POST', body: { ate: ate } });
  }
  function renova() {
    if (fichaPedida) return;
    fichaPedida = true;
    pede('/api/guilda/minha').then(function () { fichaPedida = false; }, function () { fichaPedida = false; });
  }
  G._ficha = function () { return ficha; };               // provas
  var local = {};
  ['criar', 'minha', 'promover', 'rebaixar', 'definirPorta', 'pedirEntrada', 'aceitarPedido', 'recusarPedido',
   'definirDizimo', 'dizimoAtual', 'definirMural', 'doarXp', 'lista', 'entrar', 'sair', 'registraTreino', 'compraBonus',
   'bonusAtivo', 'bancoDepositar', 'bancoLista', 'bancoPegar', 'bancoDevolver'].forEach(function (k) { local[k] = G[k]; });
  G._local = local;
  function peloServidor(nome, fn) {
    G[nome] = function () {
      return G.noServidor() ? fn.apply(null, arguments) : local[nome].apply(G, arguments);
    };
  }

  // 13/09: a guilda de antes do servidor que ESTA conta pode trazer (do /minha)
  var antigaSrv = null;
  /* 04/10 (dono: "a da minha conta teste sumiu"): a ficha que NÃO veio (o servidor fora, a
   * sessão vencida) não é "sem guilda". Sem a ficha guardada, a leitura falha devolvia null e a
   * tela oferecia fundar uma guilda a quem já tem uma. `falhaDaFicha()` diz à HUD que a última
   * leitura não respondeu — ela mostra o erro e o "tentar de novo" em vez da tela de fundar. */
  var minhaFalha = null;
  G.falhaDaFicha = function () { return G.noServidor() ? minhaFalha : null; };
  peloServidor('minha', function () {
    return pede('/api/guilda/minha').then(function (r) {
      if (r.ok) antigaSrv = r.guilda ? null : (r.antiga || null);
      minhaFalha = r.ok ? null : (r.erro || Tx('não deu'));
      return r.ok ? (r.guilda || null) : ficha;
    });
  });
  peloServidor('lista', function () {
    return pede('/api/guilda/lista').then(function (r) { return r.ok ? (r.guildas || []) : []; });
  });
  peloServidor('criar', function (nome, emblema) {
    nome = String(nome || '').trim().slice(0, 24);
    if (!nome) return responde({ ok: false, erro: Tx('diga um nome') });
    var recusa = nomeDeEquipe(nome);
    if (recusa) return responde({ ok: false, erro: recusa });
    var P = cofreInsignias(), preco = precoCriar();
    if (P && P.insigniasVer() < preco) {
      return responde({ ok: false, erro: Tx('faltam insígnias: {a}/{preco} — só chefe derruba', { a: P.insigniasVer(), preco: preco }) });
    }
    return pede('/api/guilda/criar', { nome: nome, emblema: String(emblema || '⚑').slice(0, 64) }).then(function (r) {
      if (r.ok && P) P.gastaInsignias(preco);       // a cobrança vem DEPOIS do sim: fundação recusada não come insígnia
      return r;
    });
  });
  peloServidor('entrar', function (gid) { return pede('/api/guilda/entrar', { gid: gid }); });
  peloServidor('pedirEntrada', function (gid) { return pede('/api/guilda/pedir', { gid: gid }); });
  peloServidor('aceitarPedido', function (id) { return pede('/api/guilda/pedido', { conta: id, aceitar: true }); });
  peloServidor('recusarPedido', function (id) { return pede('/api/guilda/pedido', { conta: id, aceitar: false }); });
  peloServidor('promover', function (id) { return pede('/api/guilda/cargo', { conta: id, cargo: 'oficial' }); });
  peloServidor('rebaixar', function (id) { return pede('/api/guilda/cargo', { conta: id, cargo: 'membro' }); });
  peloServidor('definirPorta', function (modo) { return pede('/api/guilda/porta', { modo: modo }); });
  peloServidor('definirDizimo', function (pct, idAlvo, op) {
    var corpo = { pct: (idAlvo != null && pct === null) ? null : Math.floor(Number(pct)) };
    if (idAlvo != null) corpo.conta = idAlvo;
    if (op && op.todos === true) corpo.todos = true;
    return pede('/api/guilda/dizimo', corpo);
  });
  peloServidor('definirMural', function (texto) {
    return pede('/api/guilda/mural', { texto: String(texto == null ? '' : texto).slice(0, G.MURAL_MAX * 2) });
  });
  peloServidor('doarXp', function (n) {
    n = Math.floor(n);
    if (!isFinite(n) || n <= 0) return responde({ ok: false, erro: Tx('quantia inválida') });
    // 04/10: a origem vai dita — o servidor recusa a doação que não é o dízimo (a oferenda em vinténs acabou)
    return pede('/api/guilda/doar', { xp: n, origem: 'dizimo' }).then(function (r) { if (r.ok && ficha) ficha.xp = r.xp; return r; });
  });
  peloServidor('registraTreino', function () { return pede('/api/guilda/treino', {}); });
  peloServidor('compraBonus', function (tipo) { return pede('/api/guilda/bonus', { tipo: tipo }); });
  peloServidor('sair', function () {
    return pede('/api/guilda/sair', {}).then(function (r) { if (r.ok) guardaFicha(null); return r; });
  });
  peloServidor('bancoLista', function () {
    var vem = ficha ? responde(ficha) : G.minha();
    return vem.then(function (f) { return JSON.parse(JSON.stringify((f && f.banco) || [])); });
  });
  peloServidor('bancoDepositar', function (item) {
    if (!item || !item.itemId) return responde({ ok: false });
    return pede('/api/guilda/banco/depositar', { item: { itemId: item.itemId, level: item.level || 0,
      stars: item.stars || 0, iid: (typeof item.iid === 'string' && item.iid) ? item.iid : null } });
  });
  // a HUD fala por POSIÇÃO na lista que ela desenhou (a da última ficha); o servidor, pelo id da vaga
  function vagaDe(idx) { var b = (ficha && ficha.banco) || []; return b[idx] || null; }
  peloServidor('bancoPegar', function (idx) {
    var v = vagaDe(idx);
    return v ? pede('/api/guilda/banco/pegar', { id: v.id }) : responde({ ok: false, erro: Tx('essa peça já saiu') });
  });
  peloServidor('bancoDevolver', function (idx) {
    var v = vagaDe(idx);
    return v ? pede('/api/guilda/banco/devolver', { id: v.id }) : responde({ ok: false, erro: 'essa vaga sumiu' });
  });
  /* SÍNCRONOS (o game.js, no meio da recompensa): da última ficha */
  peloServidor('bonusAtivo', function (tipo) {
    if (Date.now() - fichaEm > FICHA_MS) renova();
    return !!(ficha && ficha.bonus && ficha.bonus[tipo] && ficha.bonus[tipo] > agora());
  });
  peloServidor('dizimoAtual', function () {
    if (Date.now() - fichaEm > FICHA_MS) renova();
    // 13/09: o dízimo do MEU membro (o próprio, se o líder deu um), senão o padrão
    var p = 0;
    if (ficha) {
      var eu = (ficha.membros || []).filter(function (m) { return m && m.id === ficha.eu; })[0];
      p = Math.floor((eu && typeof eu.dizimo === 'number') ? eu.dizimo : (ficha.dizimo || 0));
    }
    return (isFinite(p) && p > 0) ? Math.min(p, G.DIZIMO_MAX) : 0;
  });

  /* O CONVITE DA PRAÇA (11/09): líder e oficiais convidam a CONTA de quem está
   * na praça (o `nuvem` da presença, que o relé conferiu). Sem servidor, o
   * convite é o de sempre (e o `entrar` com { convite: true } passa a porta). */
  G.convidar = function (contaAlvo) {
    if (!G.noServidor()) return responde({ ok: true, local: true });
    if (typeof contaAlvo !== 'number' || !(contaAlvo > 0)) {
      return responde({ ok: false, erro: Tx('essa pessoa precisa entrar na conta para receber convite de guilda') });
    }
    return pede('/api/guilda/convidar', { conta: contaAlvo });
  };

  /* A GUILDA DE ANTES (11/09): quem fundou uma guilda no navegador, antes do
   * servidor, leva o nome e o emblema para lá sem pagar as insígnias de novo
   * (o XP, o cofre e o banco ficam na máquina; os membros entram por convite).
   * Só o líder, só uma vez. */
  G.guildaLocalLiderada = function () {
    if (!G.noServidor() || !conta) return null;
    // 13/09: a foto do servidor vale em qualquer navegador (a de baixo, só no
    // navegador onde a guilda foi fundada — e só para o líder)
    if (antigaSrv) return { nome: antigaSrv.nome, emblema: antigaSrv.emblema, existe: !!antigaSrv.existe, servidor: true };
    var g = minhaG(le());
    if (!g || g.liderId !== conta.id || g.migrada) return null;
    return { nome: g.nome, emblema: g.emblema };
  };
  G.migrarLocal = function () {
    var a = G.guildaLocalLiderada();
    if (!a) return responde({ ok: false, erro: Tx('nada para trazer') });
    if (a.servidor) {
      return pede('/api/guilda/trazer', {}).then(function (r) { if (r.ok) antigaSrv = null; return r; });
    }
    return pede('/api/guilda/criar', { nome: a.nome, emblema: a.emblema }).then(function (r) {
      if (r.ok) { var d = le(), g = minhaG(d); if (g) { g.migrada = true; grava(d); } }
      return r;
    });
  };
})();
