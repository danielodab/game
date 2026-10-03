// A autoridade do servidor no jogo — bilhete, lances, recibo e as operações de economia (dono: lógica).
var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

/* O QUE ISTO É (13/09, a segurança — docs/SEGURANCA.md §6)
 * ============
 * Com sessão do site, o servidor é o DONO da economia da conta: ele refaz a
 * sala e paga a recompensa, e roda cada operação (equipar, forjar, cofre…)
 * com a mesma função do jogo no estado que ele guarda. Este módulo é a ponte:
 *
 *   - O BILHETE: antes de a sala nascer, o servidor dá a semente
 *     (`prepara`/`bilheteDe`). A batalha é criada com ela.
 *   - O FECHAR: na vitória (ou derrota) vão o bilhete, os lances e o hash; volta
 *     o recibo e o estado novo, que este módulo ADOTA sem recarregar a página.
 *     Sem rede, o fechar fica guardado e tenta de novo sozinho.
 *   - AS OPERAÇÕES: a função do jogo roda na hora (a tela não espera) e a op vai
 *     numa fila para o servidor, com o hash de antes e o de depois. Hash
 *     diferente = adota o estado do servidor. As que SORTEIAM (forja, roleta)
 *     esperam o servidor: `opAgora`.
 *
 * Sem sessão (em casa, file://), `ligada()` é false e o jogo é o local de sempre. */
(function () {
  'use strict';

  var A = {};
  JOGO.Autoridade = A;

  A.FILA_MS = 300;             // as ops acumulam isto antes de subir juntas
  A.RETENTA_MS = 4000;         // fechar/op sem rede tentam de novo depois disto
  A.OPS_POR_PEDIDO = 40;       // a régua do servidor
  A._fetch = null;             // provas: (rota, op) → Promise<resposta>

  var bilhetes = {};           // chave da sala → { estado: 'pedindo'|'pronto'|'falhou', bilhete, semente, carry, espera: [] }
  var fila = [], timerFila = null, subindo = false;
  var hashAntesDaFila = null;  // o hash do estado quando a 1ª op da fila foi aplicada
  var profundidade = 0;        // op dentro de op (vestirTraje chama equipar): só a de fora vai
  var adotando = false;
  var opsFeitas = 0;           // quantas ops esta página já pôs na fila (03/10: A.sincroniza vê se nasceu alguma no meio)
  /* 03/10 (revisão): a fila que SOBROU de uma adoção com `manterFila` foi feita no estado de antes da adoção — a
   * leva dela volta sempre com o estado (o hashDepois daqui não bate com o do servidor), e a adoção comum apagaria
   * a fila nascida enquanto ELA viajava: a op do jogador sumia sem subir. Esta marca diz que a próxima leva é dessa
   * fila, e a resposta dela também guarda o que nasceu no meio. */
  var filaSobreAdocao = false;
  var fechamentos = [];        // fechar pendentes (sem rede): tentam de novo
  var ultimo = { versao: null, hash: null, erro: null };
  /* `parado` (13/09, um aparelho só): a conta entrou em outro aparelho e o jogo
   * caiu aqui (Sessao.derrubada → A.parar). As filas morrem e nada mais sobe. */
  var parado = false;
  function outroAparelho(r) { return !!r && r.status === 401 && r.motivo === 'outro-aparelho'; }
  A.parar = function () {
    parado = true;
    fila = [];
    hashAntesDaFila = null;
    if (timerFila) { clearTimeout(timerFila); timerFila = null; }
    bilhetes = {};
  };

  function S() { return JOGO.Sessao || null; }
  function N() { return JOGO.Nuvem || null; }
  function P() { return JOGO.Progress || null; }
  function DB() { return JOGO.DB || null; }
  function Ec() { return JOGO.Economia || null; }
  function aviso(txt, tipo) { try { if (JOGO.UI && JOGO.UI.toast) JOGO.UI.toast(txt, tipo); } catch (e) {} }

  /* ------------------------------------------------------------ ligada? */
  A.ligada = function () {
    if (parado) return false;
    var s = S(), n = N();
    if (!s || !s.ativa || !s.ativa()) return false;
    if (!n || !n.estado) return false;
    var e = n.estado();
    return !!(e.ligada && e.principal);
  };

  function api(rota, corpo, extra) {
    var vivo = !!(extra && extra.keepalive);
    if (typeof A._fetch === 'function') return A._fetch(rota, { method: 'POST', body: corpo, keepalive: vivo });
    var s = S();
    if (!s || !s.api) return Promise.resolve({ ok: false, status: 0, erro: 'sem sessão' });
    var op = { method: 'POST', body: corpo };
    // 15/09: o pedido que tem de sair mesmo com a página indo embora (a desistência declarada). O navegador limita o
    // corpo do keepalive a 64 KB: acima disso vai o pedido comum, e a fila de retentativa segue valendo
    if (vivo) { try { if (JSON.stringify(corpo).length < 60000) op.keepalive = true; } catch (e) {} }
    return s.api(rota, op);
  }
  function foraDoAr(r) { return !r || r.status === 0 || r.status >= 500; }

  A.hashLocal = function () {
    var p = P(), db = DB(), e = Ec();
    if (!p || !db || !e) return null;
    return e.hash(p.state, db.exportar());
  };
  A.estado = function () {
    return { ligada: A.ligada(), fila: fila.length, subindo: subindo, versao: ultimo.versao, hash: ultimo.hash,
             erro: ultimo.erro, fechamentos: fechamentos.length };
  };

  /* ------------------------------------------------------------ adotar */
  /* O estado do servidor vira o desta página, sem recarregar: o Progress relê
   * (saneia e refaz os feitiços), e o DB fica com a economia do servidor e o
   * cosmético daqui (nome, avatar, placar…). A HUD repinta. */
  /* `manterFila` (03/10): o servidor subiu a op por cima de uma entrega do Mestre (resposta com `rebase`) — as
   * ops que o jogador fez ENQUANTO ela viajava continuam valendo e sobem na próxima leva, sobre o hash novo. */
  A.adota = function (progress, db, manterFila) {
    var p = P(), d = DB(), e = Ec(), C = JOGO.Contas;
    if (!p || !d || !e) return false;
    adotando = true;
    try {
      var chave = (C && C.chaveSave) ? C.chaveSave() : (p.SAVE_KEY || 'soterra-save-v2');
      if (progress && typeof progress === 'object') {
        try { window.localStorage.setItem(chave, JSON.stringify(progress)); } catch (e1) {}
        p.load();
      }
      if (db && typeof db === 'object' && d.importar) d.importar(e.junta(db, d.exportar()));
      if (manterFila === true && fila.length) {
        hashAntesDaFila = ultimo.hash;
        filaSobreAdocao = true;
      } else {
        fila = [];                                     // o que estava na fila já não vale sobre o estado novo
        hashAntesDaFila = null;
        filaSobreAdocao = false;
      }
    } finally {
      adotando = false;
    }
    try { if (JOGO.UI && JOGO.UI.repaint) JOGO.UI.repaint(); } catch (e2) {}
    return true;
  };
  function anotaResposta(r) {
    if (!r) return;
    if (typeof r.versao === 'number') {
      ultimo.versao = r.versao;
      var n = N();
      if (n && n.defineVersao) n.defineVersao(r.versao);
    }
    if (typeof r.hash === 'string') ultimo.hash = r.hash;
  }

  /* A resposta de uma rota que mudou o estado FORA do /api/op (13/09: o mercadinho entre
   * contas, js/core/mercado.js): anota versão e hash e adota o estado que veio junto. */
  A.adotaResposta = function (r) {
    if (!r || typeof r !== 'object') return false;
    anotaResposta(r);
    if (r.progress || r.db) { A.adota(r.progress, r.db); return true; }
    return false;
  };

  /* ------------------------------------------------------------ o bilhete */
  function chaveSala(p) {
    return [p.dungeonId, p.roomIndex, p.dificuldade || 'normal', (p.herois || []).join('+')].join('|');
  }
  /* pede o bilhete em segundo plano; `quandoPronto` roda quando ele chegar */
  /* 19/09 (a 2ª rodada de conserto): a VERSÃO DAS REGRAS desta página vai em TODA abertura (a sala, o grupo, o
   * duelo; a confirmação da guerra em grupo.js) — o servidor recusa na abertura (409 regras-velhas, e o `erro`
   * já diz "recarregue a página") a página que ficou aberta através de um deploy que mudou uma regra, em vez
   * de deixá-la jogar e cair como fraude no fim; sem o campo o servidor entende a página de ANTES do número
   * (docs/SEGURANCA.md §4.1) */
  function versaoRegras() { return (JOGO.Engine && typeof JOGO.Engine.VERSAO_REGRAS === 'number') ? JOGO.Engine.VERSAO_REGRAS : undefined; }
  function comVersao(corpo) {
    var c = {}, v = versaoRegras();
    for (var k in corpo) if (Object.prototype.hasOwnProperty.call(corpo, k)) c[k] = corpo[k];
    if (v !== undefined) c.versaoRegras = v;
    return c;
  }
  A.versaoRegras = versaoRegras;

  A.prepara = function (pedido, quandoPronto) {
    if (!A.ligada() || !pedido) return;
    var k = chaveSala(pedido);
    var b = bilhetes[k];
    if (b && b.estado === 'pronto') { if (quandoPronto) quandoPronto(b); return; }
    if (b && b.estado === 'pedindo') { if (quandoPronto) b.espera.push(quandoPronto); return; }
    b = bilhetes[k] = { estado: 'pedindo', espera: quandoPronto ? [quandoPronto] : [] };
    // 15/09: a luta que ficou aberta (a aba fechada no meio) fecha ANTES de o bilhete novo abrir
    A.fechaPendente().then(function () {
      return api('/api/sala/abrir', { dungeonId: pedido.dungeonId, roomIndex: pedido.roomIndex,
                                      dificuldade: pedido.dificuldade || 'normal', herois: pedido.herois,
                                      versaoRegras: versaoRegras() });   // 19/09: a versão das regras desta página
    })
      .then(function (r) {
        A.notaLargada(r);                               // 15/09: o servidor largou uma luta de antes
        if (r && r.ok && typeof r.bilhete === 'string' && typeof r.semente === 'number') {
          A.abreLuta('sala', r.bilhete);                // 15/09: o registro da luta aberta, desde o bilhete
          b.estado = 'pronto';
          b.bilhete = r.bilhete;
          b.semente = r.semente;
          b.carry = r.carry || null;
          var fns = b.espera; b.espera = [];
          fns.forEach(function (fn) { try { fn(b); } catch (e) {} });
          return;
        }
        b.estado = 'falhou';
        b.espera = [];
        delete bilhetes[k];
        if (parado || outroAparelho(r)) return;         // 13/09: o jogo caiu aqui; a capa já diz por quê
        // 14/09: o herói está a 0 no relógio do servidor — a vida daqui se acerta com a de lá
        if (r && r.motivo === 'vida-zero') {
          aviso(A.textoVidaZero(r));
          try { if (JOGO.Vida && JOGO.Vida.sincroniza) JOGO.Vida.sincroniza(); } catch (eV) {}
          return;
        }
        aviso(foraDoAr(r) ? 'O servidor não respondeu para abrir a sala — tente de novo em instantes.'
                          : ((r && r.erro) || 'O servidor não abriu a sala.'));
      });
  };
  /* o bilhete pronto desta sala (e o consome: cada bilhete abre UMA batalha) */
  A.tomaBilhete = function (pedido) {
    var k = chaveSala(pedido);
    var b = bilhetes[k];
    if (!b || b.estado !== 'pronto') return null;
    delete bilhetes[k];
    return { bilhete: b.bilhete, semente: b.semente, carry: b.carry };
  };
  A.esqueceBilhetes = function () { bilhetes = {}; };

  /* ------------------------------------------------------------ a luta aberta (15/09) */
  /* AS FALHAS CONHECIDAS (15/09, o dono: "arrume as falhas conhecidas"). Fechar a aba no meio de uma derrota fugia
   * da vida zerada: o servidor nunca recebia o fechar e a vida do herói ficava a de antes da luta. Agora a luta com
   * bilhete (sala solo, Poço) ou gid (sala em grupo) mora num registro no localStorage DA CONTA
   * ('soterra-luta-aberta-v1' + o sufixo), com os lances a cada lance. Ao abrir o jogo e ANTES de pedir qualquer luta
   * nova (bilhete, sala em grupo, duelo, Arena, guerra) a luta pendente fecha no servidor com os lances guardados: a
   * sala para no meio e o servidor grava a vida do ponto em que o replay parou (na sala em grupo, só a parte desta
   * conta: `largou`). O fechar que resolve apaga o registro. Quem não fecha — outro aparelho, a memória limpa, o
   * cliente mexido — o servidor LARGA na abertura seguinte: os heróis daquela luta a 0 (servidor/salas.py) e a
   * resposta traz `largada`, que vira o aviso da HUD.
   * O pagehide NÃO fecha: o sendBeacon não leva o cabeçalho Authorization da sessão, e o fetch keepalive levaria, mas
   * o pagehide também dispara na ida ao cache de voltar/avançar — fechar ali estragaria a luta que volta. */
  A.LUTA_CHAVE = 'soterra-luta-aberta-v1';
  A.TEXTO_LARGADA = 'Você saiu da última luta sem terminar: os heróis dela voltam do zero';
  function chaveLuta() {
    var C = JOGO.Contas;
    return A.LUTA_CHAVE + ((C && C.sufixo) ? C.sufixo() : '');
  }
  function armario() { try { return window.localStorage || null; } catch (e) { return null; } }
  // 19/09: a guerra de guilda pronta também é luta aberta; 03/10 (revisão): e a tentativa do Eco — sem registro, a
  // tentativa que ainda estava sendo conferida morria no próximo "Enfrentar o Eco" (o abrir vence a aberta) e a
  // da aba fechada antes da resposta nunca fechava: o dano sumia e a vez do dia ficava gasta
  var TIPOS_LUTA = { sala: true, grupo: true, guerra: true, eco: true };
  A.lutaAberta = function () {
    var ls = armario();
    if (!ls) return null;
    try {
      var v = JSON.parse(ls.getItem(chaveLuta()) || 'null');
      return (v && TIPOS_LUTA[v.tipo] === true && typeof v.ref === 'string') ? v : null;
    } catch (e) { return null; }
  };
  function gravaLuta(v) {
    var ls = armario();
    if (!ls) return;
    try { if (v) ls.setItem(chaveLuta(), JSON.stringify(v)); else ls.removeItem(chaveLuta()); } catch (e) {}
  }
  /* a luta nasceu: 'sala' com o bilhete, 'grupo' e 'guerra' com o gid, 'eco' com a tentativa */
  A.abreLuta = function (tipo, ref) {
    if (TIPOS_LUTA[tipo] !== true || typeof ref !== 'string' || !ref || !A.ligada()) return;
    var v = A.lutaAberta();
    if (v && v.ref === ref) return;
    gravaLuta({ tipo: tipo, ref: ref, lances: [], fim: false });
  };
  /* os lances de agora (a lista inteira: o registro é o que o servidor refaz); `fim` = a luta acabou e o fechar de
   * sempre já saiu (na sala em grupo o registro que sobrar fecha como fim, e não como `largou`); 19/09: `corpo` = o
   * corpo inteiro do fechar (a guerra: com o hash do fim, `fotografada`, `wo`) — quem reabre o jogo reenvia esse */
  A.anotaLuta = function (ref, lances, fim, corpo) {
    var v = A.lutaAberta();
    if (!v || v.ref !== ref) return;
    v.lances = Object.prototype.toString.call(lances) === '[object Array]' ? lances.slice() : [];
    if (fim) v.fim = true;
    if (corpo && typeof corpo === 'object') v.corpo = corpo;
    gravaLuta(v);
  };
  A.esqueceLuta = function (ref) {
    var v = A.lutaAberta();
    if (v && (!ref || v.ref === ref)) gravaLuta(null);
  };
  var fechandoLuta = {};       // ref → a promessa do fechar em curso (o de sempre ou o do registro)
  /* Fecha a luta pendente e resolve quando o servidor respondeu de vez (sem rede, tenta de novo como todo fechar).
   * Resolve null sem luta pendente. Um fechar da MESMA luta que já está a caminho é esperado, não repetido. */
  A.fechaPendente = function () {
    if (!A.ligada()) return Promise.resolve(null);
    var v = A.lutaAberta();
    if (!v) return Promise.resolve(null);
    if (fechandoLuta[v.ref]) return fechandoLuta[v.ref].then(function () { return A.lutaAberta() ? A.fechaPendente() : null; });
    var p;
    if (v.tipo === 'sala') p = A.fecha(v.ref, v.lances || [], null);
    else if (v.tipo === 'guerra') {
      // 19/09: a guerra pendente — quem SAIU declara a saída; quem fechou e a página foi embora reenvia o corpo
      // guardado; quem só sumiu fecha sem fim (o servidor põe em espera até o registro com fim de outro dos quatro)
      p = v.saiu ? A.saiDaGuerra(v.ref)
        : A.fechaGuerra((v.corpo && v.corpo.gid === v.ref) ? v.corpo
                        : { gid: v.ref, lances: v.lances || [], hashFinal: null, fotografada: false });
    } else if (v.tipo === 'eco') {
      // 03/10: a tentativa do Eco pendente fecha com os lances guardados; o hash do fim só se ela acabou de fato
      p = A.fechaEco({ tentativa: v.ref, lances: v.lances || [],
                       hashFinal: (v.fim && v.corpo && typeof v.corpo.hashFinal === 'number') ? v.corpo.hashFinal : null });
    } else p = A.fechaGrupo({ gid: v.ref, lances: v.lances || [], hashFinal: null, fotografada: false, largou: !v.fim });
    return p.then(function (r) {
      A.esqueceLuta(v.ref);
      try { if (JOGO.Vida && JOGO.Vida.sincroniza) JOGO.Vida.sincroniza(); } catch (eV) {}
      return r;
    });
  };
  /* a resposta de uma abertura diz que o servidor largou uma luta de antes: o aviso curto e a vida de lá */
  A.notaLargada = function (r) {
    var l = r && r.largada;
    if (!l || Object.prototype.toString.call(l.herois) !== '[object Array]' || !l.herois.length) return false;
    aviso(A.TEXTO_LARGADA + '.', 'aviso');
    try { if (JOGO.Vida && JOGO.Vida.sincroniza) JOGO.Vida.sincroniza(); } catch (eV) {}
    return true;
  };

  /* ------------------------------------------------------------ o fechar */
  /* Resolve SEMPRE: {ok, fase, recompensa} ou {ok:false, erro, recusada}. Sem
   * rede, tenta de novo sozinho até o servidor responder (a tela diz). */
  A.fecha = function (bilhete, lances, hashFinal) {
    return fechaEm('/api/sala/fechar', { bilhete: bilhete, lances: lances, hashFinal: hashFinal });
  };
  /* O ECO PRIMORDIAL (02/10, servidor/supremo.py): a tentativa abre com a semente do servidor (as ops na fila
   * sobem antes: o juiz monta o grupo do estado de lá) e fecha com os lances — o juiz refaz e o placar é o dele.
   * Resolve sempre: {ok, tentativa, semente, restantes} / {ok, dano, pontos, eu…} ou {ok:false, erro, motivo}.
   * A tentativa não mexe na vida única, mas é luta aberta (03/10, revisão): o registro em soterra-luta-aberta
   * guarda os lances, e a abertura seguinte espera a pendente fechar (a de antes, ainda sendo conferida, não
   * pode vencer como 'outra-aberta'). */
  A.abreEco = function (corpo) {
    return A.fechaPendente().then(null, function () { return null; }).then(function () { return descarregaFila(); })
      .then(function () { return api('/api/supremo/abrir', comVersao(corpo)); }).then(function (r) {
      if (parado || outroAparelho(r)) return { ok: false, erro: 'sua conta entrou em outro aparelho', motivo: 'outro-aparelho' };
      if (foraDoAr(r)) return { ok: false, foraDoAr: true, erro: 'o servidor não respondeu', motivo: 'servidor' };
      if (!r.ok) {
        return { ok: false, erro: r.erro || 'o servidor não abriu a tentativa', motivo: r.motivo || null,
                 liberaEm: r.liberaEm };
      }
      if (typeof r.tentativa === 'string') A.abreLuta('eco', r.tentativa);
      return r;
    }, function () { return { ok: false, foraDoAr: true, erro: 'o servidor não respondeu', motivo: 'servidor' }; });
  };
  A.fechaEco = function (corpo) { return fechaEm('/api/supremo/fechar', corpo); };
  /* A SALA EM GRUPO (coop.js): o líder pede a semente ao servidor antes da ata (15/09: depois de fechar a luta pendente) */
  A.abreGrupo = function (corpo) {
    return A.fechaPendente().then(function () { return api('/api/grupo/abrir', comVersao(corpo)); })
      .then(function (r) { A.notaLargada(r); return r; });
  };
  /* e cada membro fecha com o registro do motor dele (os lances dos dois e as marcas) */
  A.fechaGrupo = function (corpo) { return fechaEm('/api/grupo/fechar', corpo); };
  /* O DUELO RANQUEADO: o servidor refaz a arena e muda a Brasa dos dois. 15/09: `extra.keepalive` (a desistência, que
   * sai mesmo com a página indo embora); e a resposta 'aguardando' (o lado que recebeu a desistência espera a
   * declaração do desistente; o W.O. espera a prova de queda do relé) pergunta de novo sozinha, depois de `esperaMs`,
   * até a resposta de vez — a promessa resolve com ela. */
  A.ESPERA_DUELO_VEZES = 40;
  A._espera = function (ms, fn) { return setTimeout(fn, ms); };     // provas: o relógio
  A.fechaDuelo = function (corpo, extra) {
    return fechaEm('/api/duelo/fechar', corpo, extra).then(function (r) { return esperaDuelo(corpo, r, 0); });
  };
  function esperaDuelo(corpo, r, n) {
    if (!r || !r.ok || r.fase !== 'aguardando' || parado || n >= A.ESPERA_DUELO_VEZES) return r;
    var ms = Math.max(1000, Math.min(30000, (typeof r.esperaMs === 'number' && isFinite(r.esperaMs) ? r.esperaMs : 5000) + 500));
    return new Promise(function (volta) { A._espera(ms, volta); })
      .then(function () { return fechaEm('/api/duelo/fechar', corpo); })
      .then(function (r2) { return esperaDuelo(corpo, r2, n + 1); });
  }
  /* A GUERRA DE GUILDA (19/09, o dono: "dê uma revisada na guerra de guild"). O fechar da guerra passa por aqui — a
   * fila de retentativa (servidor fora por instantes já deixava os quatro sem XP e sem vida), `extra.keepalive` e a
   * resposta 'aguardando' (o fechamento sem fim, o fotografado, o recusado pelo juiz e o W.O. ainda sem a prova de
   * queda) perguntada de novo a cada ESPERA_GUERRA_MS até a resposta de vez — `aoAguardar` avisa cada volta (a tela
   * diz "esperando o registro de outro jogador"). O 422 do juiz também não é final (o limpo de outro vence): a
   * resposta recusada leva `fase` para a espera continuar. */
  A.ESPERA_GUERRA_MS = 5000;
  A.ESPERA_GUERRA_VEZES = 60;
  A.fechaGuerra = function (corpo, extra, aoAguardar) {
    return fechaEm('/api/guerra/fechar', corpo, extra).then(function (r) { return esperaGuerra(corpo, r, 0, aoAguardar); });
  };
  function esperaGuerra(corpo, r, n, aoAguardar) {
    if (!r || r.fase !== 'aguardando' || parado || n >= A.ESPERA_GUERRA_VEZES) return r;
    if (typeof aoAguardar === 'function') { try { aoAguardar(r); } catch (e) {} }
    return new Promise(function (volta) { A._espera(A.ESPERA_GUERRA_MS, volta); })
      .then(function () { return fechaEm('/api/guerra/fechar', corpo); })
      .then(function (r2) { return esperaGuerra(corpo, r2, n + 1, aoAguardar); });
  }
  /* quem SAI da guerra pronta declara (POST /api/guerra/sair {gid}, keepalive): os heróis dele a 0 na hora, e é a
   * prova que o juiz exige para a marca `morte` dele nos registros dos outros três. A luta aberta guarda `saiu` até o
   * servidor responder de vez (a página que for embora antes declara ao abrir o jogo) */
  A.saiDaGuerra = function (gid) {
    if (typeof gid !== 'string' || !gid) return Promise.resolve(null);
    var v = A.lutaAberta();
    if (v && v.ref === gid) { v.saiu = true; gravaLuta(v); }
    return fechaEm('/api/guerra/sair', { gid: gid }, { keepalive: true });
  };

  /* A POÇÃO NA SALA DE ESPERA (13/09, o dono: "a poção seria para curar a vida e não precisar
   * esperar para ir para a próxima sala"). O servidor tira a poção do estado dele e soma a cura
   * no registro da vida do herói, numa transação; a página adota o estado que volta (a
   * contagem das poções) — também no 409 de quem estava com o estado velho. As ops na fila
   * sobem antes. Resolve a resposta ({ok, cura, hp, hpMax}) ou {ok:false, erro, motivo}.
   * corpo solo {bilhete, heroId, pocaoId}; em grupo {gid, heroId, pocaoId}. */
  A.bebeNaSala = function (corpo) { return bebeEm('/api/sala/pocao', corpo); };
  A.bebeNoGrupo = function (corpo) { return bebeEm('/api/grupo/pocao', corpo); };
  /* A VIDA ÚNICA (14/09, o dono: "a vida vai recuperando aos poucos até encher ou o jogador usa
   * pote; isso vale para quando terminar calabouço (na praça), depois de um pvp e assim por
   * diante"). A poção agora se bebe FORA DA BATALHA em qualquer lugar: corpo {heroId, pocaoId};
   * resolve {ok, cura, hp, hpMax} ou {ok:false, motivo: 'cheio'|'acabou'|'sem-pocao'|'heroi'…}.
   * As duas rotas de cima seguem aceitas pelo servidor, mas o jogo novo só usa esta. */
  A.bebeVida = function (corpo) { return bebeEm('/api/vida/pocao', corpo); };
  /* a vida de cada herói não cheio, no relógio do servidor (GET /api/vida; JOGO.Vida adota) */
  A.puxaVida = function () {
    if (!A.ligada()) return Promise.resolve(null);
    var pedido;
    if (typeof A._fetch === 'function') pedido = A._fetch('/api/vida', { method: 'GET' });
    else {
      var s = S();
      if (!s || !s.api) return Promise.resolve(null);
      pedido = s.api('/api/vida');
    }
    return Promise.resolve(pedido).then(function (r) {
      if (parado || outroAparelho(r) || foraDoAr(r) || !r || !r.ok) return null;
      return r;
    }, function () { return null; });
  };
  /* O DUELO EM REDE ABRE NO SERVIDOR (14/09): antes do compromisso, o servidor guarda com que
   * vida cada herói meu entra (é com ela que ele refaz o duelo no fechar). corpo {did, herois};
   * resolve {ok, carry: {heroId: PV}|null} ou {ok:false, motivo: 'vida-zero', heroi, esperaS}. */
  A.abreDuelo = function (corpo) {
    return descarregaFila().then(function () { return A.fechaPendente(); }).then(function () {
      return api('/api/duelo/abrir', comVersao(corpo));
    }).then(function (r) {
      A.notaLargada(r);                                 // 15/09: o servidor largou uma luta de antes
      if (parado || outroAparelho(r)) return { ok: false, erro: 'sua conta entrou em outro aparelho', motivo: 'outro-aparelho' };
      if (foraDoAr(r)) return { ok: false, foraDoAr: true, erro: 'o servidor não respondeu', motivo: 'servidor' };
      if (!r.ok) {
        return { ok: false, erro: r.erro || 'o servidor não abriu o duelo', motivo: r.motivo || null,
                 heroi: r.heroi || null, esperaS: r.esperaS };
      }
      return { ok: true, carry: (r.carry && typeof r.carry === 'object') ? r.carry : null };
    }, function () { return { ok: false, foraDoAr: true, erro: 'o servidor não respondeu', motivo: 'servidor' }; });
  };
  /* o texto de um 409 'vida-zero' (sala, grupo ou duelo): quem espera e quanto */
  A.textoVidaZero = function (r) {
    var hid = (r && r.heroi) || '', classe = String(hid).split('#')[0], nome = hid || 'um herói';
    try {
      var h = P() && P().hero ? P().hero(hid) : null;
      if (h && h.classId) classe = h.classId;
      var d = JOGO.DATA && JOGO.DATA.classes && JOGO.DATA.classes[classe];
      if (d && d.name) nome = d.name;
    } catch (e) {}
    var s = Math.max(1, Math.ceil(Number(r && r.esperaS) || 0));
    return nome + ' está sem vida: espere ' + s + ' s (a vida volta sozinha) ou beba uma poção.';
  };
  function bebeEm(rota, corpo) {
    return descarregaFila().then(function () { return api(rota, corpo); }).then(function (r) {
      if (parado || outroAparelho(r)) return { ok: false, erro: 'sua conta entrou em outro aparelho', motivo: 'outro-aparelho' };
      if (foraDoAr(r)) return { ok: false, foraDoAr: true, erro: 'o servidor não respondeu', motivo: 'servidor' };
      A.adotaResposta(r);
      if (!r.ok) return { ok: false, erro: r.erro || 'o servidor recusou a poção', motivo: r.motivo || null };
      return r;
    });
  }

  /* 15/09: o fechar da sala e da sala em grupo é também o da luta aberta — enquanto ele está a caminho, a luta
   * pendente espera por ele (fechandoLuta), e a resposta de vez apaga o registro */
  function fechaEm(rota, corpo, extra) {
    var ref = (rota === '/api/sala/fechar' && corpo && corpo.bilhete) ||
              (rota === '/api/supremo/fechar' && corpo && corpo.tentativa) ||
              ((rota === '/api/grupo/fechar' || rota === '/api/guerra/fechar' || rota === '/api/guerra/sair') && corpo && corpo.gid) || null;
    var p = fechaEmBruto(rota, corpo, extra).then(function (r) {
      if (ref) {
        if (fechandoLuta[ref] === p) delete fechandoLuta[ref];
        A.esqueceLuta(ref);
      }
      return r;
    });
    if (ref) fechandoLuta[ref] = p;
    return p;
  }
  function fechaEmBruto(rota, corpo, extra) {
    return new Promise(function (resolve) {
      var pend = { corpo: corpo, resolve: resolve };
      fechamentos.push(pend);
      function tenta(avisou) {
        // as ops na fila sobem ANTES: o servidor paga a sala sobre o estado com elas
        descarregaFila().then(function () {
          return api(rota, corpo, avisou ? null : extra);   // o keepalive só na primeira: a página ainda estava ali
        }).then(function (r) {
          if (parado || outroAparelho(r)) {
            // 13/09: a conta entrou em outro aparelho — sem tentar de novo (nem sem rede)
            var i = fechamentos.indexOf(pend);
            if (i >= 0) fechamentos.splice(i, 1);
            resolve({ ok: false, recusada: true, derrubada: true, erro: 'sua conta entrou em outro aparelho',
                      motivo: 'outro-aparelho' });
            return;
          }
          if (foraDoAr(r)) {
            if (!avisou) aviso('Conferindo a ' + (rota.indexOf('/guerra/') >= 0 ? 'guerra' : (rota.indexOf('/supremo/') >= 0 ? 'tentativa do Eco' : 'sala')) + ' com o servidor… (sem resposta, tentando de novo)');
            setTimeout(function () { tenta(true); }, A.RETENTA_MS);
            return;
          }
          fechamentos.splice(fechamentos.indexOf(pend), 1);
          if (r && r.ok) {
            anotaResposta(r);
            if (r.progress || r.db) A.adota(r.progress, r.db);
            resolve(r);
            return;
          }
          ultimo.erro = (r && r.erro) || 'recusada';
          // 19/09: a `fase` e o `esperaAte` viajam na recusa também — o 422 do juiz na guerra vai para a espera
          resolve({ ok: false, recusada: true, erro: (r && r.erro) || 'o servidor recusou a sala',
                    motivo: r && r.motivo, fase: (r && r.fase) || null, esperaAte: r && r.esperaAte });
        });
      }
      tenta(false);
    });
  }

  /* ------------------------------------------------------------ as operações */
  /* A op já rodou aqui (a função do jogo); entra na fila para o servidor. */
  A.op = function (nome, args) {
    if (!A.ligada() || adotando || profundidade > 0) return;
    opsFeitas++;
    if (!fila.length) hashAntesDaFila = ultimo.hash;
    fila.push({ nome: nome, args: args || {} });
    if (fila.length >= A.OPS_POR_PEDIDO) { descarregaFila(); return; }
    if (!timerFila) timerFila = setTimeout(function () { timerFila = null; descarregaFila(); }, A.FILA_MS);
  };
  /* roda uma função do jogo como UMA op: a de dentro não vai de novo */
  A.embrulha = function (nome, fn, argsDe) {
    return function () {
      if (profundidade > 0 || adotando || !A.ligada()) return fn.apply(this, arguments);
      profundidade++;
      var r;
      try { r = fn.apply(this, arguments); }
      finally { profundidade--; }
      var args = null;
      try { args = argsDe.apply(null, arguments); } catch (e) { args = null; }
      if (args) A.op(nome, args);
      return r;
    };
  };

  var descarregando = null;
  function descarregaFila() {
    if (timerFila) { clearTimeout(timerFila); timerFila = null; }
    if (descarregando) return descarregando.then(function () { return fila.length ? descarregaFila() : null; });
    if (!fila.length || !A.ligada()) return Promise.resolve(null);
    var lote = fila.splice(0, A.OPS_POR_PEDIDO);
    var sobreAdocao = filaSobreAdocao;
    filaSobreAdocao = false;
    var corpo = { hashAntes: hashAntesDaFila, ops: lote, hashDepois: A.hashLocal() };
    hashAntesDaFila = fila.length ? corpo.hashDepois : null;
    subindo = true;
    descarregando = api('/api/op', corpo).then(function (r) {
      subindo = false;
      descarregando = null;
      if (parado || outroAparelho(r)) return r;        // 13/09: o jogo caiu aqui; o lote não volta para a fila
      if (foraDoAr(r)) {
        // sem rede: o lote volta para a frente da fila e tenta depois
        fila = lote.concat(fila);
        hashAntesDaFila = corpo.hashAntes;
        filaSobreAdocao = sobreAdocao;
        if (!timerFila) timerFila = setTimeout(function () { timerFila = null; descarregaFila(); }, A.RETENTA_MS);
        return r;
      }
      anotaResposta(r);
      if (r && r.ok && (r.rebase || (sobreAdocao && (r.progress || r.db)))) {
        // 03/10: o Mestre tinha posto algo nesta conta e o servidor subiu a leva por cima (salas.py): o estado
        // que volta tem as duas coisas, e o que o jogador fez enquanto isto viajava continua na fila — e a
        // leva seguinte, a dessa fila (filaSobreAdocao), também guarda a fila que nasceu enquanto ela viajava
        A.adota(r.progress, r.db, true);
        if (fila.length && !timerFila) timerFila = setTimeout(function () { timerFila = null; descarregaFila(); }, A.FILA_MS);
      } else if (r && (r.status === 409 || r.progress || r.db)) {
        // o servidor tinha outro estado (outra aba, ou a tela divergiu): ele manda
        A.adota(r.progress, r.db);
      } else if (r && !r.ok) {
        ultimo.erro = r.erro || 'op recusada';
        aviso('O servidor recusou uma ação: ' + (r.erro || 'op recusada'));
        // o estado local já tem a op que o servidor não aceitou: busca o dele
        return A.puxaEstado();
      }
      return r;
    });
    return descarregando;
  }
  A.descarrega = descarregaFila;

  /* A op que SORTEIA no servidor (forja com risco, roleta): sobe a fila, manda
   * esta sozinha e devolve o resultado dela, com o estado já adotado. */
  A.opAgora = function (nome, args) {
    return descarregaFila().then(function () {
      var corpo = { hashAntes: ultimo.hash, ops: [{ nome: nome, args: args || {} }], hashDepois: null };
      return api('/api/op', corpo);
    }).then(function (r) {
      if (foraDoAr(r)) return { ok: false, foraDoAr: true, erro: 'o servidor não respondeu' };
      anotaResposta(r);
      if (r && (r.progress || r.db)) A.adota(r.progress, r.db);
      // o `motivo` da recusa vai junto (a quebra distingue 'emprestada' sem ler o texto)
      if (!r || !r.ok) return { ok: false, erro: (r && r.erro) || 'o servidor recusou', motivo: (r && r.motivo) || null };
      return { ok: true, resultado: (r.resultados || [])[0] };
    });
  };

  /* O ESTADO QUE MUDOU POR FORA (03/10, o painel único do Mestre): uma entrega do Mestre nesta conta. O
   * jogo adota o estado novo SEM apagar o que o jogador fez: primeiro a fila sobe (o servidor a põe por cima
   * da entrega, `rebase`), depois o estado inteiro é lido — e só é adotado se nenhuma op nova nasceu
   * enquanto a leitura viajava; se nasceu, tenta de novo (a leva dela traz o estado de volta). */
  function pedeSave() {
    if (typeof A._fetch === 'function') return Promise.resolve(A._fetch('/api/save', { method: 'GET' }));
    var s = S();
    if (!s || !s.api) return Promise.resolve(null);
    return s.api('/api/save');
  }
  A.sincroniza = function (tentativas) {
    if (!A.ligada()) return Promise.resolve(null);
    tentativas = (typeof tentativas === 'number') ? tentativas : 3;
    return descarregaFila().then(function () {
      var marca = opsFeitas;
      return pedeSave().then(function (r) {
        if (parado || !r || !r.ok || !(r.progress || r.db)) return r || null;
        if (marca !== opsFeitas || fila.length || descarregando) {
          return tentativas > 0 ? A.sincroniza(tentativas - 1) : descarregaFila();
        }
        anotaResposta(r);
        A.adota(r.progress, r.db);
        if (typeof r.hash !== 'string') ultimo.hash = A.hashLocal();
        return r;
      });
    });
  };
  /* A resposta de uma entrega ao PRÓPRIO Mestre (POST /api/mestre/dar): `marca` = A.marca() de quando o
   * pedido saiu. Sem op nova no meio, adota como sempre; com op nova, a resposta já é velha — sincroniza. */
  A.marca = function () { return opsFeitas; };
  A.adotaDeFora = function (r, marca) {
    if (!r || typeof r !== 'object') return false;
    if (A.ligada() && (marca !== opsFeitas || fila.length || descarregando)) {
      A.sincroniza();
      return false;
    }
    return A.adotaResposta(r);
  };

  /* O estado inteiro do servidor (GET /api/save), adotado. */
  A.puxaEstado = function () {
    var s = S();
    if (!s || !s.api) return Promise.resolve(null);
    return s.api('/api/save').then(function (r) {
      if (r && r.ok && (r.progress || r.db)) {
        anotaResposta(r);
        A.adota(r.progress, r.db);
        // o estado agora É o do servidor: o hash conhecido parte daqui
        if (typeof r.hash !== 'string') ultimo.hash = A.hashLocal();
      }
      return r;
    });
  };

  /* NA ABERTURA (13/09): quando a Nuvem fala com o servidor pela primeira vez
   * nesta página, a economia daqui é trocada pela do servidor. Um save mexido
   * no localStorage não sobe (o servidor ignora) e não fica na tela esperando
   * a próxima op para ser desfeito. */
  var puxouNaAbertura = false;
  function ouveNuvem(det) {
    if (puxouNaAbertura || !det || (det.tipo !== 'emdia' && det.tipo !== 'subiu')) return;
    if (!A.ligada()) return;
    puxouNaAbertura = true;
    A.puxaEstado();
    // 15/09: a luta que ficou aberta da última vez (a aba fechada no meio) fecha já, com os lances guardados
    try { A.fechaPendente(); } catch (eL) {}
    // 14/09: e a vida dos heróis, que o servidor guarda (a praça já está na tela)
    try { if (JOGO.Vida && JOGO.Vida.sincroniza) JOGO.Vida.sincroniza(); } catch (eV) {}
  }
  try { window.addEventListener('soterra:nuvem', function (ev) { ouveNuvem(ev && ev.detail); }); } catch (e) {}
  try {
    var hN = (N() && N().historico) ? N().historico() : [];
    for (var iN = 0; iN < hN.length; iN++) ouveNuvem(hN[iN]);
  } catch (e) {}

  /* ------------------------------------------------------------ os embrulhos */
  /* As funções do jogo que mudam a economia sem sorteio: rodam aqui na hora e
   * vão para a fila. Instalado uma vez; sem sessão cada embrulho só repassa. */
  var instalado = false;
  A.instala = function () {
    if (instalado) return;
    var p = P(), db = DB(), M = JOGO.Missoes, G = JOGO.GM;
    if (!p || !db) return;
    instalado = true;
    function em(obj, fnNome, opNome, argsDe) {
      if (!obj || typeof obj[fnNome] !== 'function') return;
      obj[fnNome] = A.embrulha(opNome, obj[fnNome], argsDe);
    }
    em(p, 'equip', 'equipar', function (heroId, itemId, invIndex) {
      return { heroId: heroId, itemId: itemId, invIndex: (typeof invIndex === 'number') ? invIndex : null };
    });
    em(p, 'unequip', 'desequipar', function (heroId, slot) { return { heroId: heroId, slot: slot }; });
    em(p, 'equipPet', 'equiparPet', function (heroId, petId) { return { heroId: heroId, petId: petId }; });
    em(p, 'unequipPet', 'soltarPet', function (heroId) { return { heroId: heroId }; });
    em(p, 'saveTraje', 'salvarTraje', function (heroId, n) { return { heroId: heroId, n: n }; });
    em(p, 'wearTraje', 'vestirTraje', function (heroId, n) { return { heroId: heroId, n: n }; });
    em(p, 'fuseItem', 'fundirPeca', function (invIndex) { return { invIndex: invIndex }; });
    em(p, 'chooseElement', 'escolherElemento', function (heroId, el) { return { heroId: heroId, elemento: el }; });
    em(p, 'liberaElemento', 'liberarElemento', function (heroId, el) { return { heroId: heroId, elemento: el }; });
    em(p, 'trocaElemento', 'trocarElemento', function (heroId, el) { return { heroId: heroId, elemento: el }; });
    em(p, 'reescreveElemento', 'reescreverElemento', function (heroId, velho, novo) {
      return { heroId: heroId, velho: velho, novo: novo };
    });
    em(p, 'escolheSeloElemento', 'escolherSeloElemento', function (el) { return { elemento: el }; });
    em(p, 'lePergaminhoXp', 'lerPergaminhoXp', function () { return {}; });
    em(p, 'devolvidasPorNivel', 'devolvidasPorNivel', function (limpar) { return limpar ? {} : null; });
    em(db, 'depositarMoedas', 'depositarMoedas', function (n) { return { n: Math.floor(Number(n) || 0) }; });
    em(db, 'sacarMoedas', 'sacarMoedas', function (n) { return { n: Math.floor(Number(n) || 0) }; });
    em(db, 'definirTitulo', 'definirTitulo', function (t) { return { titulo: t || null }; });
    em(M, 'reivindicar', 'reivindicarMissao', function (id) { return { id: id }; });
    // 13/09: a banca do mercador — a compra roda aqui na hora e a MESMA sobe como op
    em(JOGO.Mercado, 'comprarPocao', 'comprarPocao', function (id, qtd) {
      var q = Math.floor(Number(qtd));
      return (typeof id === 'string' && q >= 1 && q <= 1000) ? { id: id, qtd: q } : null;
    });
    if (G) {
      em(G, 'aparelha', 'gmAparelha', function () { return {}; });
      em(G, 'pegaItem', 'gmPegaItem', function (itemId) { return { itemId: itemId }; });
      em(G, 'pegaSet', 'gmPegaSet', function (setId) { return { setId: setId }; });
      em(G, 'pegaPet', 'gmPegaPet', function (petId, topo) { return { petId: petId, topo: !!topo }; });
      em(G, 'pegaPedras', 'gmPegaPedras', function (sid, n) { return { stoneId: sid, n: n }; });
      em(G, 'pegaSelos', 'gmPegaSelos', function (el, n) { return { elemento: el, n: n }; });
      em(G, 'pegaInsignias', 'gmPegaInsignias', function (n) { return { n: n }; });
      em(G, 'pegaCartas', 'gmPegaCartas', function (cid, n) { return { classId: cid, n: n }; });
      em(G, 'pegaPergaminho', 'gmPegaPergaminho', function (tipo, n) { return { tipo: tipo, n: n }; });
      em(G, 'pegaBonusXp', 'gmPegaBonusXp', function (dias) { return { dias: dias }; });
      // 02/10: as ferramentas do painel do Mestre (gm.js; o painel de teste, js/ui/debug.js)
      em(G, 'liberaClasse', 'gmLiberaClasse', function (cid) { return { classId: cid }; });
      em(G, 'poeNivel', 'gmNivel', function (hid, n) { return { heroId: hid, nivel: Math.max(1, Math.min(999, Math.floor(Number(n)) || 1)) }; });
      em(G, 'poeElemento', 'gmElemento', function (hid, el) { return { heroId: hid, elemento: el }; });
    }
  };
  // os módulos do jogo já carregaram (index.html põe este arquivo depois deles)
  try { A.instala(); } catch (e) {}

  // a página indo embora: a fila sobe na hora
  try {
    window.addEventListener('pagehide', function () { descarregaFila(); });
  } catch (e) {}
})();
