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

  /* SAIR É SAIR (04/10, o dono: "saí da conta, cliquei em jogar e já logou na minha
   * outra conta... com conta deslogada coloquei para jogar e ele abriu uma sessão").
   * Não era sessão: o token morria no servidor e a chave 'soterra-sessao' sumia. O que
   * ficava era o SAVE da última conta que jogou neste navegador, nas chaves nuas da
   * conta Principal — e o jogo sem sessão abria com ele: os heróis, o nome, os itens,
   * a praça. Quem entrava na conta do Mestre só para usar o painel do site e saía
   * encontrava, no "Jogar", o jogo da OUTRA conta dele.
   *
   * A regra, decidida AQUI porque é antes de o db.js e o progress.js lerem o disco:
   * o registro da Nuvem ('soterra-nuvem-v1') diz de qual conta do servidor é o save da
   * Principal. Sem sessão, save com dono não é de quem está na frente do jogo:
   *   - em dia com o servidor (nada pendente): sai do disco — ele está inteiro lá, e
   *     volta quando a conta entrar de novo;
   *   - com gravação que não subiu (o servidor estava fora): fica guardado e ESCONDIDO,
   *     e esta janela joga na conta local 'visitante'. Quando a mesma conta entrar, a
   *     Nuvem o encontra e sobe; se entrar outra, ela o troca (js/core/nuvem.js).
   * O jogo sem conta continua existindo — começa do zero, sem nome e sem save de ninguém.
   *
   * 06/10 (o dono: somente online, "tem que exigir conta sempre!!"): isso tudo vale só EM CASA
   * (file://, localhost, as provas). NO AR o porteiro do index.html (JOGO.Porteiro) nem deixa o
   * jogo abrir sem sessão, e aqui a janela é SEMPRE a Principal — a conta do servidor: o
   * `?conta=`, a última escolhida no registro e a `visitante` não valem lá. Save de visitante
   * (ou de conta local) que já exista num navegador fica onde está, sem leitor: não sobe para
   * conta nenhuma sozinho — seria progresso que servidor nenhum conferiu. */
  var VISITANTE = 'visitante';
  // o que o navegador guarda de uma conta do servidor (as chaves nuas, as da Principal)
  var DA_CONTA = ['soterra-save-v2', 'soterra-conta-v1', 'soterra-nuvem-v1', 'soterra-vida-v1',
                  'soterra-save-v2--antes-do-teste'];
  function temSessao() {
    var s = armazem();
    try {
      var x = JSON.parse((s && s.getItem('soterra-sessao')) || 'null');
      return !!(x && typeof x.token === 'string' && x.token && x.conta && typeof x.conta === 'object');
    } catch (e) { return false; }
  }
  /* De quem é o save da Principal: {conta, sujo}, ou null se nunca subiu para conta nenhuma. */
  function donoDoDisco() {
    var s = armazem();
    try {
      var r = JSON.parse((s && s.getItem('soterra-nuvem-v1')) || 'null');
      if (r && typeof r === 'object' && r.conta !== null && r.conta !== undefined) return { conta: r.conta, sujo: !!r.sujo };
    } catch (e) {}
    return null;
  }
  /* Tira do disco o que é da conta do servidor. `ateSujo`: mesmo com gravação pendente
   * (só quando quem chama acabou de ver que ela não tem mais para onde ir). Devolve
   * true se o disco ficou sem nada dela. */
  function esqueceDaConta(ateSujo) {
    var s = armazem(), dono = donoDoDisco();
    if (!s || !dono) return true;
    if (dono.sujo && ateSujo !== true) return false;
    try { for (var i = 0; i < DA_CONTA.length; i++) s.removeItem(DA_CONTA[i]); } catch (e) { return false; }
    return true;
  }
  C.VISITANTE = VISITANTE;
  C.donoDoDisco = donoDoDisco;
  C.esqueceDaConta = esqueceDaConta;

  /* No ar? Quem sabe é o porteiro do index.html (a regra é pelo endereço). Página que não o
   * carrega (as de tests/, o Node das provas) é casa. */
  function noAr() {
    try { return !!(JOGO.Porteiro && JOGO.Porteiro.exige && JOGO.Porteiro.exige()); } catch (e) { return false; }
  }
  C.noAr = noAr;

  var reg = leReg();
  var ativa = noAr() ? 'principal' : (daUrl() || reg.ativa || 'principal');
  // a escolha vale só para ESTA janela e não vai para o registro: com sessão, a Principal volta
  if (!noAr() && !temSessao() && !esqueceDaConta() && ativa === 'principal') ativa = VISITANTE;
  // conta pedida na URL que ainda não existe nasce NA HORA — "?conta=2" na
  // segunda janela é o suficiente para criar o segundo jogador
  if (!reg.lista.some(function (c) { return c.id === ativa; })) {
    reg.lista.push({ id: ativa, rotulo: ativa === VISITANTE ? 'Visitante' : ativa, criadaEm: agora() });
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

  /* A CONTA DO MESTRE (03/09: "quero que crie uma conta local onde eu
   * seleciono e já vem o GM"): id fixo 'mestre', marcada com `mestre: true`
   * no registro. SÓ nasce pela chave do GM (o portão do gm.js chama
   * criaMestre) ou pelo botão da ficha de Contas, que só aparece com o modo
   * já ligado. Um `?conta=mestre` digitado sem a chave cria uma conta comum
   * de id 'mestre', SEM a marca — e o gm.js não liga nada por ela. */
  C.MESTRE = 'mestre';
  C.ehMestre = function (id) {
    var alvo = id || ativa, lst = leReg().lista;
    for (var i = 0; i < lst.length; i++) if (lst[i].id === alvo) return lst[i].mestre === true;
    return false;
  };
  C.criaMestre = function () {
    var r = leReg(), achou = null;
    for (var i = 0; i < r.lista.length; i++) if (r.lista[i].id === C.MESTRE) achou = r.lista[i];
    if (!achou) {
      achou = { id: C.MESTRE, rotulo: 'Mestre do Fundo', criadaEm: agora() };
      r.lista.push(achou);
    }
    achou.mestre = true;
    if (!achou.rotulo || achou.rotulo === C.MESTRE) achou.rotulo = 'Mestre do Fundo';
    gravaReg(r);
    return C.MESTRE;
  };

  /* Trocar é NAVEGAR: a conta é decidida no boot, então a troca escreve a
   * escolha no registro e recarrega a página com `?conta=` na URL — a URL é
   * a verdade DESTA janela; as outras janelas não mudam. */
  C.trocar = function (id) {
    if (noAr()) return;                 // 06/10: no ar não há conta local para onde ir
    var r = leReg();
    r.ativa = id;
    gravaReg(r);
    try { window.location.search = '?conta=' + encodeURIComponent(id); } catch (e) {}
  };
})();
