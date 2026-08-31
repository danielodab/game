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
  G.criar = function (nome, emblema) {
    if (!conta) return responde({ ok: false, erro: 'sem conta' });
    nome = String(nome || '').trim().slice(0, 24);
    if (!nome) return responde({ ok: false, erro: 'diga um nome' });
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
    var g = { id: novoId(), nome: nome, emblema: String(emblema || '⚑').slice(0, 4),
              liderId: conta.id, membros: [{ id: conta.id, nome: conta.nome }],
              xp: 0, moedas: 0, bonus: {}, banco: [], treinos: 0, criadaEm: agora() };
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
    return responde(f);
  };

  G.lista = function () {
    var d = le();
    var fora = [];
    for (var gid in d.guildas) {
      if (!d.guildas.hasOwnProperty(gid)) continue;
      var g = d.guildas[gid];
      fora.push({ id: g.id, nome: g.nome, emblema: g.emblema, xp: g.xp,
                  nivel: G.nivelDe(g.xp), membros: g.membros.length });
    }
    fora.sort(function (a, b) { return b.xp - a.xp; });
    return responde(fora);
  };

  G.entrar = function (gid) {
    if (!conta) return responde({ ok: false, erro: 'sem conta' });
    var d = le();
    if (d.porConta[conta.id]) return responde({ ok: false, erro: 'você já tem guilda' });
    var g = d.guildas[gid];
    if (!g) return responde({ ok: false, erro: 'essa guilda não existe mais' });
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
    if (g.liderId !== conta.id) return responde({ ok: false, erro: 'só o líder gasta o cofre' });
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
})();
