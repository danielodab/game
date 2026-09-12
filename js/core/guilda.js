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
 *   liderança        quem cria lidera; se sair, passa ao membro mais
 *                    antigo; o último a sair dissolve a guilda.
 * Quem move o ITEM de verdade (saco ↔ banco da guilda) é a HUD, como no
 * banco do Acampamento — aqui mora só o registro.
 */
(function () {
  'use strict';

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
    return conta;
  };

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
    return Nm.MOTIVO_RESERVADO || 'esse nome é reservado à equipe do jogo';
  }

  G.criar = function (nome, emblema) {
    if (!conta) return responde({ ok: false, erro: 'sem conta' });
    nome = String(nome || '').trim().slice(0, 24);
    if (!nome) return responde({ ok: false, erro: 'diga um nome' });
    var recusa = nomeDeEquipe(nome);
    if (recusa) return responde({ ok: false, erro: recusa });
    var d = le();
    if (d.porConta[conta.id]) return responde({ ok: false, erro: 'você já tem guilda' });
    var P = cofreInsignias();
    if (P) {
      var preco = precoCriar();
      if (P.insigniasVer() < preco) {
        return responde({ ok: false, erro: 'faltam insígnias: ' +
                          P.insigniasVer() + '/' + preco + ' — só chefe derruba' });
      }
      if (!P.gastaInsignias(preco)) {
        return responde({ ok: false, erro: 'as insígnias escaparam da mão' });
      }
    }
    var g = { id: novoId(), nome: nome, emblema: String(emblema || '⚑').slice(0, 64),
              liderId: conta.id, membros: [{ id: conta.id, nome: conta.nome }],
              xp: 0, moedas: 0, bonus: {}, banco: [], treinos: 0, criadaEm: agora(),
              porta: 'aberta', dizimo: 0, pedidos: [] };
    d.guildas[g.id] = g;
    d.porConta[conta.id] = g.id;
    grava(d);
    return responde({ ok: true, guilda: foto(g) });
  };

  G.minha = function () {
    var d = le();
    var g = minhaG(d);
    if (!g) return responde(null);
    var f = foto(g);
    f.nivel = G.nivelDe(g.xp);
    f.souLider = !!(conta && g.liderId === conta.id);
    f.meuCargo = conta ? cargoDe(g, conta.id) : null;
    // cada membro sai com o cargo RESOLVIDO (o líder pelo liderId)
    for (var mi = 0; mi < f.membros.length; mi++) {
      f.membros[mi].cargo = cargoDe(g, f.membros[mi].id);
    }
    return responde(f);
  };

  // ------------------------------------------------------------------ cargos
  G.promover = function (idAlvo) {
    if (!conta) return responde({ ok: false });
    var d = le();
    var g = minhaG(d);
    if (!g) return responde({ ok: false, erro: 'sem guilda' });
    if (g.liderId !== conta.id) return responde({ ok: false, erro: 'só o líder promove' });
    if (idAlvo === conta.id) return responde({ ok: false, erro: 'você já lidera' });
    for (var i = 0; i < g.membros.length; i++) {
      if (g.membros[i].id !== idAlvo) continue;
      if (g.membros[i].cargo === 'oficial') return responde({ ok: false, erro: 'já é oficial' });
      g.membros[i].cargo = 'oficial';
      grava(d);
      return responde({ ok: true, cargo: 'oficial' });
    }
    return responde({ ok: false, erro: 'não é membro' });
  };
  G.rebaixar = function (idAlvo) {
    if (!conta) return responde({ ok: false });
    var d = le();
    var g = minhaG(d);
    if (!g) return responde({ ok: false, erro: 'sem guilda' });
    if (g.liderId !== conta.id) return responde({ ok: false, erro: 'só o líder rebaixa' });
    for (var i = 0; i < g.membros.length; i++) {
      if (g.membros[i].id !== idAlvo) continue;
      if (g.membros[i].cargo !== 'oficial') return responde({ ok: false, erro: 'já é membro raso' });
      delete g.membros[i].cargo;
      grava(d);
      return responde({ ok: true, cargo: 'membro' });
    }
    return responde({ ok: false, erro: 'não é membro' });
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
    if (!g) return responde({ ok: false, erro: 'sem guilda' });
    if (g.liderId !== conta.id) return responde({ ok: false, erro: 'só o líder mexe na porta' });
    g.porta = modo;
    grava(d);
    return responde({ ok: true, porta: modo });
  };
  G.pedirEntrada = function (gid) {
    if (!conta) return responde({ ok: false, erro: 'sem conta' });
    var d = le();
    if (d.porConta[conta.id]) return responde({ ok: false, erro: 'você já tem guilda' });
    var g = d.guildas[gid];
    if (!g) return responde({ ok: false, erro: 'essa guilda não existe mais' });
    if (portaDe(g) === 'aberta') {
      // porta aberta não tem fila: pedir É entrar
      g.membros.push({ id: conta.id, nome: conta.nome });
      d.porConta[conta.id] = gid;
      grava(d);
      return responde({ ok: true, entrou: true, guilda: foto(g) });
    }
    var fila = pedidosDe(g);
    for (var i = 0; i < fila.length; i++) {
      if (fila[i].id === conta.id) return responde({ ok: false, erro: 'seu pedido já está na fila' });
    }
    fila.push({ id: conta.id, nome: conta.nome, em: agora() });
    grava(d);
    return responde({ ok: true, entrou: false, pedidoFeito: true });
  };
  G.aceitarPedido = function (idAlvo) {
    if (!conta) return responde({ ok: false });
    var d = le();
    var g = minhaG(d);
    if (!g) return responde({ ok: false, erro: 'sem guilda' });
    if (!podeGastarCofre(g, conta.id)) {
      return responde({ ok: false, erro: 'só líder e oficiais aceitam pedidos' });
    }
    var fila = pedidosDe(g);
    for (var i = 0; i < fila.length; i++) {
      if (fila[i].id !== idAlvo) continue;
      var p = fila.splice(i, 1)[0];
      if (d.porConta[p.id]) {                 // já achou outra casa nesse meio-tempo
        grava(d);
        return responde({ ok: false, erro: 'essa conta já entrou noutra guilda' });
      }
      g.membros.push({ id: p.id, nome: p.nome });
      d.porConta[p.id] = g.id;
      grava(d);
      return responde({ ok: true, membro: { id: p.id, nome: p.nome } });
    }
    return responde({ ok: false, erro: 'pedido não está mais na fila' });
  };
  G.recusarPedido = function (idAlvo) {
    if (!conta) return responde({ ok: false });
    var d = le();
    var g = minhaG(d);
    if (!g) return responde({ ok: false, erro: 'sem guilda' });
    if (!podeGastarCofre(g, conta.id)) {
      return responde({ ok: false, erro: 'só líder e oficiais recusam pedidos' });
    }
    var fila = pedidosDe(g);
    for (var i = 0; i < fila.length; i++) {
      if (fila[i].id === idAlvo) { fila.splice(i, 1); grava(d); return responde({ ok: true }); }
    }
    return responde({ ok: false, erro: 'pedido não está mais na fila' });
  };

  /* O DÍZIMO (30/08): "o líder define a % de doação de xp de cada um" — a
   * taxa vale para todo membro, o desconto acontece no funil de XP do
   * game.js (que consulta `dizimoAtual` SÍNCRONO, como o bonusAtivo). */
  G.DIZIMO_MAX = 25;
  G.definirDizimo = function (pct) {
    if (!conta) return responde({ ok: false });
    pct = Math.floor(pct);
    if (!isFinite(pct) || pct < 0 || pct > G.DIZIMO_MAX) {
      return responde({ ok: false, erro: 'o dízimo vai de 0 a ' + G.DIZIMO_MAX + '%' });
    }
    var d = le();
    var g = minhaG(d);
    if (!g) return responde({ ok: false, erro: 'sem guilda' });
    if (g.liderId !== conta.id) return responde({ ok: false, erro: 'só o líder define o dízimo' });
    g.dizimo = pct;
    grava(d);
    return responde({ ok: true, dizimo: pct });
  };
  G.dizimoAtual = function () {
    var d = le();
    var g = minhaG(d);
    var p = g ? Math.floor(g.dizimo || 0) : 0;
    return (isFinite(p) && p > 0) ? Math.min(p, G.DIZIMO_MAX) : 0;
  };

  /* A OFERENDA (30/08): "a guild upa conforme os usuários doam xp" — o core
   * recebe XP já convertida (a HUD cobra os vinténs da conta ANTES; a taxa
   * de conversão é dela). Qualquer membro doa. */
  G.doarXp = function (n) {
    if (!conta) return responde({ ok: false });
    n = Math.floor(n);
    if (!isFinite(n) || n <= 0) return responde({ ok: false, erro: 'quantia inválida' });
    var d = le();
    var g = minhaG(d);
    if (!g) return responde({ ok: false, erro: 'sem guilda' });
    g.xp += n;
    grava(d);
    return responde({ ok: true, xp: g.xp, nivel: G.nivelDe(g.xp) });
  };

  G.lista = function () {
    var d = le();
    var fora = [];
    for (var gid in d.guildas) {
      if (!d.guildas.hasOwnProperty(gid)) continue;
      var g = d.guildas[gid];
      fora.push({ id: g.id, nome: g.nome, emblema: g.emblema, xp: g.xp,
                  nivel: G.nivelDe(g.xp), membros: g.membros.length,
                  porta: portaDe(g) });
    }
    fora.sort(function (a, b) { return b.xp - a.xp; });
    return responde(fora);
  };

  G.entrar = function (gid, op) {
    if (!conta) return responde({ ok: false, erro: 'sem conta' });
    var d = le();
    if (d.porConta[conta.id]) return responde({ ok: false, erro: 'você já tem guilda' });
    var g = d.guildas[gid];
    if (!g) return responde({ ok: false, erro: 'essa guilda não existe mais' });
    // porta fechada (30/08): entrar direto só em guilda ABERTA — na de
    // convite o caminho é a fila (pedirEntrada) ou o convite da praça. 11/09:
    // o convite da praça ({ convite: true }) entra — antes ele batia nesta
    // porta e o "aceitar" não levava a lugar nenhum
    if (portaDe(g) === 'convite' && !(op && op.convite === true)) {
      return responde({ ok: false, erro: 'a guilda é por convite — peça para entrar' });
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
    if (!g) return responde({ ok: false, erro: 'sem guilda' });
    // empréstimo ativo prende: devolve antes de bater a porta
    for (var b = 0; b < g.banco.length; b++) {
      if (g.banco[b].emprestadoPara === conta.id) {
        return responde({ ok: false, erro: 'devolva o item emprestado antes de sair' });
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
    if (tipo !== 'drop' && tipo !== 'xp') return responde({ ok: false, erro: 'bônus desconhecido' });
    if (!conta) return responde({ ok: false });
    var d = le();
    var g = minhaG(d);
    if (!g) return responde({ ok: false, erro: 'sem guilda' });
    // cargos (30/08): oficiais também administram o cofre
    if (!podeGastarCofre(g, conta.id)) {
      return responde({ ok: false, erro: 'só líder e oficiais gastam o cofre' });
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
    if (!g) return responde({ ok: false, erro: 'sem guilda' });
    g.banco.push({ itemId: item.itemId, level: item.level || 0, stars: item.stars || 0,
                   dono: conta.id, donoNome: conta.nome, emprestadoPara: null });
    grava(d);
    return responde({ ok: true, total: g.banco.length });
  };
  G.bancoLista = function () {
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
    if (!g || !g.banco[idx]) return responde({ ok: false, erro: 'essa peça já saiu' });
    var e = g.banco[idx];
    if (e.emprestadoPara) return responde({ ok: false, erro: 'já está emprestada' });
    if (e.dono === conta.id) {
      g.banco.splice(idx, 1);                       // retirada definitiva
      grava(d);
      return responde({ ok: true, item: e, definitivo: true });
    }
    for (var b = 0; b < g.banco.length; b++) {
      if (g.banco[b].emprestadoPara === conta.id) {
        return responde({ ok: false, erro: 'devolva o empréstimo atual primeiro' });
      }
    }
    e.emprestadoPara = conta.id;
    e.tomadorNome = conta.nome;
    grava(d);
    return responde({ ok: true, item: e, definitivo: false });
  };
  G.bancoDevolver = function (idx) {
    if (!conta) return responde({ ok: false });
    var d = le();
    var g = minhaG(d);
    if (!g || !g.banco[idx]) return responde({ ok: false, erro: 'essa vaga sumiu' });
    var e = g.banco[idx];
    if (e.emprestadoPara !== conta.id) return responde({ ok: false, erro: 'não foi você que pegou' });
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
      if (!r.ok && !r.erro) r.erro = r.status === 0 ? 'o servidor está fora (não respondeu)' : 'não deu';
      return r;
    });
  }
  function renova() {
    if (fichaPedida) return;
    fichaPedida = true;
    pede('/api/guilda/minha').then(function () { fichaPedida = false; }, function () { fichaPedida = false; });
  }
  G._ficha = function () { return ficha; };               // provas
  var local = {};
  ['criar', 'minha', 'promover', 'rebaixar', 'definirPorta', 'pedirEntrada', 'aceitarPedido', 'recusarPedido',
   'definirDizimo', 'dizimoAtual', 'doarXp', 'lista', 'entrar', 'sair', 'registraTreino', 'compraBonus',
   'bonusAtivo', 'bancoDepositar', 'bancoLista', 'bancoPegar', 'bancoDevolver'].forEach(function (k) { local[k] = G[k]; });
  G._local = local;
  function peloServidor(nome, fn) {
    G[nome] = function () {
      return G.noServidor() ? fn.apply(null, arguments) : local[nome].apply(G, arguments);
    };
  }

  peloServidor('minha', function () {
    return pede('/api/guilda/minha').then(function (r) { return r.ok ? (r.guilda || null) : ficha; });
  });
  peloServidor('lista', function () {
    return pede('/api/guilda/lista').then(function (r) { return r.ok ? (r.guildas || []) : []; });
  });
  peloServidor('criar', function (nome, emblema) {
    nome = String(nome || '').trim().slice(0, 24);
    if (!nome) return responde({ ok: false, erro: 'diga um nome' });
    var recusa = nomeDeEquipe(nome);
    if (recusa) return responde({ ok: false, erro: recusa });
    var P = cofreInsignias(), preco = precoCriar();
    if (P && P.insigniasVer() < preco) {
      return responde({ ok: false, erro: 'faltam insígnias: ' + P.insigniasVer() + '/' + preco + ' — só chefe derruba' });
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
  peloServidor('definirDizimo', function (pct) { return pede('/api/guilda/dizimo', { pct: Math.floor(Number(pct)) }); });
  peloServidor('doarXp', function (n) {
    n = Math.floor(n);
    if (!isFinite(n) || n <= 0) return responde({ ok: false, erro: 'quantia inválida' });
    return pede('/api/guilda/doar', { xp: n }).then(function (r) { if (r.ok && ficha) ficha.xp = r.xp; return r; });
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
    return v ? pede('/api/guilda/banco/pegar', { id: v.id }) : responde({ ok: false, erro: 'essa peça já saiu' });
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
    var p = ficha ? Math.floor(ficha.dizimo || 0) : 0;
    return (isFinite(p) && p > 0) ? Math.min(p, G.DIZIMO_MAX) : 0;
  });

  /* O CONVITE DA PRAÇA (11/09): líder e oficiais convidam a CONTA de quem está
   * na praça (o `nuvem` da presença, que o relé conferiu). Sem servidor, o
   * convite é o de sempre (e o `entrar` com { convite: true } passa a porta). */
  G.convidar = function (contaAlvo) {
    if (!G.noServidor()) return responde({ ok: true, local: true });
    if (typeof contaAlvo !== 'number' || !(contaAlvo > 0)) {
      return responde({ ok: false, erro: 'essa pessoa precisa entrar na conta para receber convite de guilda' });
    }
    return pede('/api/guilda/convidar', { conta: contaAlvo });
  };

  /* A GUILDA DE ANTES (11/09): quem fundou uma guilda no navegador, antes do
   * servidor, leva o nome e o emblema para lá sem pagar as insígnias de novo
   * (o XP, o cofre e o banco ficam na máquina; os membros entram por convite).
   * Só o líder, só uma vez. */
  G.guildaLocalLiderada = function () {
    if (!G.noServidor() || !conta) return null;
    var g = minhaG(le());
    if (!g || g.liderId !== conta.id || g.migrada) return null;
    return { nome: g.nome, emblema: g.emblema };
  };
  G.migrarLocal = function () {
    var a = G.guildaLocalLiderada();
    if (!a) return responde({ ok: false, erro: 'nada para trazer' });
    return pede('/api/guilda/criar', { nome: a.nome, emblema: a.emblema }).then(function (r) {
      if (r.ok) { var d = le(), g = minhaG(d); if (g) { g.migrada = true; grava(d); } }
      return r;
    });
  };
})();
