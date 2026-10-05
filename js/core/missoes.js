// Missões diárias e conquistas — o motivo de voltar amanhã (dono: lógica).
var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

/* O QUE ISTO É
 * ============
 * O quadro de missões do Acampamento (item 2 da lista de MMORPG): DIÁRIAS que
 * re-sorteiam a cada dia e CONQUISTAS permanentes, pagas em vinténs — e as
 * conquistas ainda destravam TÍTULOS, que o jogador pendura junto do nome
 * acima da cabeça. É o laço de retenção clássico do gênero.
 *
 * ONDE MORA O ESTADO: no JOGO.DB (a conta), não no Progress. Missão é vida
 * ONLINE — quando o servidor chegar, é ele quem valida o "vença 3 salas";
 * guardar na conta desde já deixa a fronteira no lugar certo.
 *
 * O TRIO DO DIA É SEMEADO PELA DATA: recarregar a página não re-sorteia, e
 * todo jogador do mesmo dia vê o MESMO trio — cheiro de servidor antes do
 * servidor existir.
 *
 * QUEM AVISA O PROGRESSO: os funis de fora chamam `Missoes.registra(evento)`
 * — game.js na vitória ({tipo:'vitoria', dificuldade, desafioCumprido,
 * fundido}) e a ficha do banco no depósito ({tipo:'deposito', valor,
 * cofreTotal}). Este módulo não escuta nada sozinho: evento explícito é
 * evento testável.
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

  var M = {};
  JOGO.Missoes = M;

  // ------------------------------------------------------------- os catálogos
  /* Toda missão tem `alvo` (quanto falta) e UMA de duas formas de andar:
   * `conta(ev)` devolve o INCREMENTO que o evento vale; `atinge(ev)` devolve
   * true quando o evento já cumpre a missão inteira (limiares, como "tenha
   * 100 no cofre"). */
  var DIARIAS = {
    'd-vitorias': { texto: Tx('Vença 3 salas'), alvo: 3, premio: 30,
      conta: function (ev) { return ev.tipo === 'vitoria' ? 1 : 0; } },
    'd-dificil': { texto: Tx('Vença 1 sala no difícil'), alvo: 1, premio: 40,
      conta: function (ev) { return (ev.tipo === 'vitoria' && ev.dificuldade === 'dificil') ? 1 : 0; } },
    'd-desafios': { texto: Tx('Cumpra 2 desafios de sala'), alvo: 2, premio: 35,
      conta: function (ev) { return (ev.tipo === 'vitoria' && ev.desafioCumprido) ? 1 : 0; } },
    'd-fundido': { texto: Tx('Vença 1 sala com uma fusão em campo'), alvo: 1, premio: 35,
      conta: function (ev) { return (ev.tipo === 'vitoria' && ev.fundido) ? 1 : 0; } },
    'd-cofre': { texto: Tx('Guarde 40 vinténs no cofre'), alvo: 40, premio: 25,
      conta: function (ev) { return ev.tipo === 'deposito' ? (ev.valor || 0) : 0; } }
  };

  /* 11/09: as conquistas PAGAM (vinténs) e não dão mais TÍTULO. A decisão é
   * do dono: "os títulos da plaquinha podem existir, mas não por cumprir
   * missão". Título agora é posição no ranking ou dez quedas do mesmo chefe
   * no difícil, sozinho — a régua toda mora em js/core/titulos.js. */
  var CONQUISTAS = {
    'c-fusao': { texto: Tx('Vença uma sala fundido'), alvo: 1, premio: 30,
      conta: function (ev) { return (ev.tipo === 'vitoria' && ev.fundido) ? 1 : 0; } },
    'c-dificil5': { texto: Tx('Vença 5 salas no difícil'), alvo: 5, premio: 60,
      conta: function (ev) { return (ev.tipo === 'vitoria' && ev.dificuldade === 'dificil') ? 1 : 0; } },
    'c-desafios10': { texto: Tx('Cumpra 10 desafios de sala'), alvo: 10, premio: 60,
      conta: function (ev) { return (ev.tipo === 'vitoria' && ev.desafioCumprido) ? 1 : 0; } },
    'c-cofre100': { texto: Tx('Tenha 100 vinténs no cofre de uma vez'), alvo: 1, premio: 50,
      atinge: function (ev) { return ev.tipo === 'deposito' && (ev.cofreTotal || 0) >= 100; } }
  };

  M.DIARIAS = DIARIAS;
  M.CONQUISTAS = CONQUISTAS;
  M.POR_DIA = 3;

  // ------------------------------------------------------------- utilidades
  /* O DIA DE BRASÍLIA (13/09, a segurança): o servidor confere a missão e
   * paga o prêmio, e ele não sabe o fuso do jogador — então o dia é o de
   * Brasília (UTC−3 fixo, sem horário de verão desde 2019) para os dois lados.
   * Antes era o dia LOCAL do aparelho: às 22 h de Brasília o servidor (em UTC)
   * já estaria no dia seguinte, com outra lista. */
  function hoje() {
    var d = new Date(Date.now() - 3 * 3600 * 1000);
    var m = d.getUTCMonth() + 1, dia = d.getUTCDate();
    return d.getUTCFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (dia < 10 ? '0' : '') + dia;
  }
  M.hoje = hoje;
  /* O sorteio do dia: mulberry32 semeado pela DATA — determinístico e
   * verificável. A mesma família de rng do motor, cópia local de propósito:
   * este módulo não pode depender do Engine para abrir o quadro no hub. */
  function hashStr(s2) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < s2.length; i++) {
      h ^= s2.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  function sorteiaTrio(dia) {
    var seed = hashStr('missoes:' + dia);
    function rnd() {
      seed = (seed + 0x6D2B79F5) >>> 0;
      var t = seed;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    var ids = Object.keys(DIARIAS);
    for (var i = ids.length - 1; i > 0; i--) {
      var j = Math.floor(rnd() * (i + 1));
      var tmp = ids[i]; ids[i] = ids[j]; ids[j] = tmp;
    }
    return ids.slice(0, M.POR_DIA).map(function (id) {
      return { id: id, prog: 0, pago: false };
    });
  }

  function DB() { return JOGO.DB || null; }

  // ------------------------------------------------------------- carregar
  /* Devolve o quadro inteiro, re-sorteando as diárias se o dia virou.
   * `dataForcada` existe para o TESTE virar o dia sem esperar a meia-noite. */
  M.carregar = function (dataForcada) {
    var db = DB();
    if (!db) return Promise.resolve(null);
    return Promise.all([db.missoes(), db.conquistas()]).then(function (r) {
      var ms = r[0], cq = r[1] || {};
      var dia = dataForcada || hoje();
      if (!ms || ms.dia !== dia) {
        ms = { dia: dia, lista: sorteiaTrio(dia) };
        return db.salvarMissoes(ms).then(function () {
          return { dia: dia, lista: ms.lista, conquistas: cq };
        });
      }
      return { dia: ms.dia, lista: ms.lista, conquistas: cq };
    });
  };

  // ------------------------------------------------------------- registrar
  /* Um evento entra, os contadores andam, o DB guarda. Fire-and-forget para
   * os chamadores — mas devolve a Promise para o teste esperar. */
  M.registra = function (evento, dataForcada) {
    var db = DB();
    if (!db || !evento) return Promise.resolve(null);
    return M.carregar(dataForcada).then(function (quadro) {
      if (!quadro) return null;
      var mudou = false;

      quadro.lista.forEach(function (mi) {
        var def = DIARIAS[mi.id];
        if (!def || mi.prog >= def.alvo) return;
        var soma = def.atinge ? (def.atinge(evento) ? def.alvo : 0)
                              : (def.conta ? def.conta(evento) : 0);
        if (soma > 0) {
          mi.prog = Math.min(def.alvo, mi.prog + soma);
          mudou = true;
        }
      });

      Object.keys(CONQUISTAS).forEach(function (id) {
        var def = CONQUISTAS[id];
        var st = quadro.conquistas[id] || (quadro.conquistas[id] = { prog: 0, pago: false });
        if (st.prog >= def.alvo) return;
        var soma = def.atinge ? (def.atinge(evento) ? def.alvo : 0)
                              : (def.conta ? def.conta(evento) : 0);
        if (soma > 0) {
          st.prog = Math.min(def.alvo, st.prog + soma);
          mudou = true;
        }
      });

      if (!mudou) return quadro;
      return Promise.all([
        db.salvarMissoes({ dia: quadro.dia, lista: quadro.lista }),
        db.salvarConquistas(quadro.conquistas)
      ]).then(function () { return quadro; });
    });
  };

  // ------------------------------------------------------------- reivindicar
  /* O prêmio só sai UMA vez, e só de missão terminada. O pagamento passa por
   * DB.ganharMoedas — o mesmo funil dos vinténs de batalha. */
  M.reivindicar = function (id, dataForcada) {
    var db = DB();
    if (!db) return Promise.resolve({ ok: false, erro: Tx('sem conta') });
    return M.carregar(dataForcada).then(function (quadro) {
      var def = DIARIAS[id] || CONQUISTAS[id];
      if (!def) return { ok: false, erro: Tx('missão desconhecida') };
      var st = null, ehDiaria = !!DIARIAS[id];
      if (ehDiaria) {
        for (var i = 0; i < quadro.lista.length; i++) {
          if (quadro.lista[i].id === id) st = quadro.lista[i];
        }
        if (!st) return { ok: false, erro: Tx('não é uma missão de hoje') };
      } else {
        st = quadro.conquistas[id] || { prog: 0, pago: false };
      }
      if (st.prog < def.alvo) return { ok: false, erro: Tx('ainda não terminou') };
      if (st.pago) return { ok: false, erro: Tx('já recebido') };
      st.pago = true;
      if (!ehDiaria) quadro.conquistas[id] = st;
      var salvar = ehDiaria
        ? db.salvarMissoes({ dia: quadro.dia, lista: quadro.lista })
        : db.salvarConquistas(quadro.conquistas);
      return salvar.then(function () {
        return db.ganharMoedas(def.premio);
      }).then(function (r) {
        return { ok: true, premio: def.premio, moedas: r.moedas, titulo: def.titulo || null };
      });
    });
  };

  /* 11/09: `M.titulos` saiu junto com os títulos de conquista. Quem responde
   * "que títulos esta conta pode pendurar" é JOGO.Titulos.ganhos(). */
})();
