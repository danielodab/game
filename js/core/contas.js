// O Banco de Contas — várias contas na mesma máquina (dono: lógica).
var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

/* O QUE ISTO É
 * ============
 * O começo do banco de contas (pedido do usuário, 25/08: "já devemos começar
 * a criar um banco para contas.. ids para cada novo objeto"): um REGISTRO de
 * contas no localStorage e o SUFIXO de chave que separa, por conta, o cofre
 * (db.js) e o save solo (progress.js).
 *
 * A CONTA DA JANELA é decidida AQUI, antes de db/progress carregarem:
 *   1. `?conta=<id>` na URL — prende ESTA janela àquela conta. É assim que
 *      duas janelas do mesmo navegador viram DOIS JOGADORES na mesma máquina:
 *      a Rede (BroadcastChannel) cruza janelas da mesma origem, e com contas
 *      diferentes cada uma tem seu id — fantasma, chat, troca e arena de
 *      verdade, sem servidor.
 *   2. senão, a última escolhida no registro (`ativa`);
 *   3. senão, 'principal'.
 *
 * A conta 'principal' usa as CHAVES NUAS de sempre ('soterra-conta-v1',
 * 'soterra-save-v2') — o save que já existe na máquina continua sendo a
 * conta principal sem migração nenhuma. As outras ganham ':<id>' no fim.
 *
 * QUANDO O SERVIDOR CHEGAR: este registro vira a tela de login; o sufixo de
 * chave vira o cache local da conta logada. A fronteira é a mesma do db.js.
 */
(function () {
  'use strict';

  var C = {};
  JOGO.Contas = C;

  var REG = 'soterra-contas-v1';

  function agora() { return Date.now(); }
  function armazem() {
    try {
      if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
    } catch (e) {}
    return null;
  }

  function leReg() {
    var s = armazem();
    try {
      var d = JSON.parse((s && s.getItem(REG)) || '');
      if (d && Array.isArray(d.lista) && d.lista.length) return d;
    } catch (e) {}
    return { ativa: 'principal',
             lista: [{ id: 'principal', rotulo: 'Principal', criadaEm: agora() }] };
  }
  function gravaReg(r) {
    var s = armazem();
    try { if (s) s.setItem(REG, JSON.stringify(r)); } catch (e) {}
  }

  /* O id vindo da URL é curto e sem espaços — vira sufixo de chave de
   * localStorage, não pode carregar lixo. */
  function daUrl() {
    try {
      var m = /[?&]conta=([A-Za-z0-9_-]{1,24})/.exec(String(window.location.search || ''));
      return m ? m[1] : null;
    } catch (e) { return null; }
  }

  var reg = leReg();
  var ativa = daUrl() || reg.ativa || 'principal';
  // conta pedida na URL que ainda não existe nasce NA HORA — "?conta=2" na
  // segunda janela é o suficiente para criar o segundo jogador
  if (!reg.lista.some(function (c) { return c.id === ativa; })) {
    reg.lista.push({ id: ativa, rotulo: ativa, criadaEm: agora() });
    gravaReg(reg);
  }

  C.ativa = function () { return ativa; };
  C.rotulo = function () {
    var lst = leReg().lista;
    for (var i = 0; i < lst.length; i++) if (lst[i].id === ativa) return lst[i].rotulo || ativa;
    return ativa;
  };
  C.lista = function () { return leReg().lista.slice(); };
  C.sufixo = function () { return ativa === 'principal' ? '' : ':' + ativa; };
  C.chaveConta = function () { return 'soterra-conta-v1' + C.sufixo(); };
  C.chaveSave = function () { return 'soterra-save-v2' + C.sufixo(); };

  C.cria = function (rotulo) {
    var r = leReg();
    var id = 'c' + agora().toString(36) + Math.random().toString(36).slice(2, 6);
    r.lista.push({ id: id, rotulo: rotulo || ('Conta ' + (r.lista.length + 1)),
                   criadaEm: agora() });
    gravaReg(r);
    return id;
  };

  /* Trocar é NAVEGAR: a conta é decidida no boot, então a troca escreve a
   * escolha no registro e recarrega a página com `?conta=` na URL — a URL é
   * a verdade DESTA janela; as outras janelas não mudam. */
  C.trocar = function (id) {
    var r = leReg();
    r.ativa = id;
    gravaReg(r);
    try { window.location.search = '?conta=' + encodeURIComponent(id); } catch (e) {}
  };
})();
