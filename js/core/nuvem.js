/* nuvem.js — o save no cartório: o mesmo jogo em qualquer máquina.
 *
 * O que ela faz, quando há sessão (sessao.js):
 *   1. Ao abrir: GET /api/save. Se o servidor tem uma versão MAIS NOVA que a
 *      que esta máquina viu (ou a conta é outra), o save de lá vira o de cá e
 *      a página recarrega uma vez. Senão, o local sobe.
 *   2. Toda gravação local (Progress.save e DB) agenda uma subida: PUT
 *      /api/save com {versao, progress, db, nascimentos} — a fila do que
 *      nasceu desde a última vez (progress.js cunha; aqui esvazia).
 *   3. As respostas do cartório:
 *        200         versão nova; a fila dos nascimentos registrados esvazia
 *        409+versao  "save desatualizado": outra máquina gravou antes — o
 *                    servidor MANDA (o save de lá substitui o de cá, recarga)
 *        409/403     instância duplicada/consumida/de outra conta: o save
 *                    local está errado; fica a mensagem em `estado()` e a
 *                    subida para — a Ficha de Contas mostra
 *        0           servidor fora: tenta de novo mais tarde
 *   4. Nuvem.troca(com, dou, recebo): a intenção de troca no cartório (a
 *      posse dos iids muda quando o parceiro espelha).
 *
 * Sem sessão nada disto roda e o jogo é o local de sempre. */
(function () {
  'use strict';
  var JOGO = window.JOGO = window.JOGO || {};
  var N = JOGO.Nuvem = {};
  N.ESPERA_MS = 3000;          // a gravação local espera isto antes de subir
  N.RETENTA_MS = 30000;        // servidor fora: tenta de novo daqui a tanto
  N.NASC_POR_PUT = 200;        // a régua do servidor (NASC_POR_PUT)
  N.semRecarga = false;        // testes: aplicar o save de lá sem recarregar

  var ligada = false, timer = null, subindo = false, sujo = false;
  var versao = 0, erro = null, ultimaSubida = 0, parada = false, saveCru = null, historico = [];
  /* `puxou`: esta página já ouviu do servidor em que versão o save está.
   * Antes disso NADA sobe — subir às cegas mandava versão 0, o servidor
   * respondia 409 com o save DELE, e o jogo local (feito com a API fora do
   * ar no boot) era apagado pelo save velho. */
  var puxou = false, timerPuxa = null, enganchado = false;
  /* `encerrada` (13/09, um aparelho só): a conta entrou em outro aparelho e o
   * jogo caiu aqui (Sessao.derrubada → N.parar). Nada mais sobe nem desce até
   * a página recarregar — o save desta aba não pode cair por cima do novo. */
  var encerrada = false;
  function outroAparelho(r) { return !!r && r.status === 401 && r.motivo === 'outro-aparelho'; }

  function S() { return JOGO.Sessao || null; }
  function P() { return JOGO.Progress || null; }
  function DB() { return JOGO.DB || null; }
  function armazem() { try { return window.localStorage || null; } catch (e) { return null; } }
  function chave() {
    var C = JOGO.Contas;
    return 'soterra-nuvem-v1' + ((C && C.sufixo) ? C.sufixo() : '');
  }
  function leRegistro() {
    var s = armazem();
    try {
      var r = JSON.parse((s && s.getItem(chave())) || 'null');
      if (r && typeof r === 'object') {
        return { versao: Math.max(0, Math.floor(Number(r.versao) || 0)), conta: r.conta || null, sujo: !!r.sujo };
      }
    } catch (e) {}
    return { versao: 0, conta: null, sujo: false };
  }
  function gravaRegistro(v, conta, sujoAgora) {
    var s = armazem();
    try { if (s) s.setItem(chave(), JSON.stringify({ versao: v, conta: conta, sujo: !!sujoAgora })); } catch (e) {}
  }
  function avisa(tipo, extra) {
    var det = { tipo: tipo };
    if (extra) for (var k in extra) if (extra.hasOwnProperty(k)) det[k] = extra[k];
    historico.push(det);
    if (historico.length > 50) historico.shift();
    try { window.dispatchEvent(new CustomEvent('soterra:nuvem', { detail: det })); } catch (e) {}
  }

  function naPrincipal() {
    var Cx = JOGO.Contas;
    return !(Cx && Cx.ativa && Cx.ativa() !== 'principal');
  }

  N.estado = function () {
    var s = S();
    return { ligada: ligada, sessao: !!(s && s.ativa()), conta: s ? s.conta() : null, principal: naPrincipal(),
             versao: versao, erro: erro, parada: parada, pendente: sujo || !!timer,
             subindo: subindo, ultimaSubida: ultimaSubida };
  };
  N.historico = function () { return historico.slice(); };

  /* Os números de série que moram no DB (o save do Progress lista os seus). */
  function vivosNoDB(db) {
    var vivos = {};
    if (!db || typeof db !== 'object') return vivos;
    var i;
    var itens = (db.banco && db.banco.itens) || [];
    for (i = 0; i < itens.length; i++) if (itens[i] && typeof itens[i].iid === 'string' && itens[i].iid) vivos[itens[i].iid] = true;
    var ofertas = (db.mercado && db.mercado.ofertas) || [];
    for (i = 0; i < ofertas.length; i++) {
      var o = ofertas[i];
      if (o && o.vendedor === 'jogador' && typeof o.iid === 'string' && o.iid) vivos[o.iid] = true;
    }
    return vivos;
  }

  function montaCorpo() {
    var p = P(), db = DB();
    var foto = (db && db.exportar) ? db.exportar() : null;
    if (p && p.podaNascimentos) p.podaNascimentos(vivosNoDB(foto));
    var nasc = (p && p.nascimentos) ? p.nascimentos() : [];
    if (nasc.length > N.NASC_POR_PUT) nasc = nasc.slice(0, N.NASC_POR_PUT);
    return {
      versao: versao,
      progress: p ? p.state : null,
      db: foto,
      nascimentos: nasc.map(function (n) { return { iid: n.iid, itemId: n.itemId, origem: n.origem }; })
    };
  }

  /* A PÁGINA VAI RECARREGAR com outro save no disco (04/10): até lá o jogo segue
   * rodando com o save ANTIGO na memória, e uma gravação qualquer (um relógio da
   * HUD, a missão do dia) o punha de volta no disco. Na recarga o registro já
   * dizia "é desta conta, pendente" e o save da conta ANTERIOR subia para a nova —
   * com o mesmo código de jogador e o mesmo nome. Daqui até recarregar, nada grava. */
  function congelaDisco() {
    try { if (DB() && DB().congela) DB().congela(); } catch (e) {}
    try { if (P()) P().save = function () {}; } catch (e2) {}
  }
  function recarrega() {
    congelaDisco();
    try { if (window.__boot && window.__boot.recarregando) window.__boot.recarregando('nuvem'); } catch (eB) {}   // a marca de abertura (index.html) sai antes: é recarga de propósito
    try { location.reload(); } catch (e4) {}
  }

  /* O CÓDIGO DE JOGADOR (04/10): o servidor avisou (`trocarId`) que o save
   * guardado desta conta traz o código de OUTRA — a cópia de antes do registro.
   * O save entra aqui já com um código novo e sem o nome copiado; o resto fica. */
  function trocaNoSave(r) {
    var jog = r && r.db && r.db.jogador;
    if (!r || !r.trocarId || !jog || jog.id !== r.trocarId || !DB() || !DB().novoId) return false;
    jog.id = DB().novoId();
    jog.nome = null;
    return true;
  }

  /* O save do servidor vira o desta máquina. Gravado CRU (sem passar pelo
   * Progress.save enganchado) e a página recarrega uma vez — o jogo já leu o
   * save antigo e a HUD inteira o refletiria. `outraConta`: o que está no disco
   * é de outra conta — o que o servidor não trouxe sai, em vez de ficar. */
  function aplica(r, outraConta) {
    var C = JOGO.Contas, s = armazem();
    if (!s || !C) return false;
    if (!N.semRecarga) congelaDisco();               // antes de mexer no disco: nada do save velho volta
    var trocou = trocaNoSave(r);
    try {
      if (r.progress) s.setItem(C.chaveSave(), JSON.stringify(r.progress));
      if (r.db) s.setItem(C.chaveConta(), JSON.stringify(r.db));
      else if (outraConta) s.removeItem(C.chaveConta());
    } catch (e) { return false; }
    versao = r.versao || 0;
    gravaRegistro(versao, S().contaId(), trocou);   // código trocado: o save sobe de novo depois da recarga
    sujo = trocou;
    avisa('puxou', { versao: versao });
    if (trocou) avisa('trocou-id', null);
    if (N.semRecarga) {
      try { if (P() && P().load) P().load(); } catch (e2) {}
      try { if (DB() && DB().importar && r.db) DB().importar(r.db); } catch (e3) {}
      if (trocou) N.agendar();
      return true;
    }
    recarrega();
    return true;
  }

  /* O código de jogador que está NESTA máquina é desta conta? Pergunta ao servidor
   * (POST /api/jogador-id): livre, fica dela; de outra conta, troca aqui (DB.trocaId)
   * e a página recarrega — a praça, o grupo e a batalha já leram o código velho.
   * Vale também para o save que o servidor recusou (ele entra na praça do mesmo
   * jeito). Servidor antigo ou fora: segue como está; o PUT avisa depois.
   * Resolve true se trocou. */
  function confereId(s) {
    var db = DB();
    var id = null;
    try { id = (db && db.idDoJogador) ? db.idDoJogador() : null; } catch (e) {}
    if (!id || !db.trocaId) return Promise.resolve(false);
    return s.api('/api/jogador-id', { method: 'POST', body: { id: id } }).then(function (r) {
      if (!r || !r.ok || r.trocar !== true) return false;
      return trocaAqui(id);
    }, function () { return false; });
  }
  function trocaAqui(velho) {
    var novo = null;
    try { novo = DB().trocaId(velho); } catch (e) {}
    if (!novo) return false;
    sujo = true;
    marcaSujo();
    avisa('trocou-id', null);
    return true;
  }

  /* O save e a conta locais somem (a conta do cartório mudou nesta máquina). */
  function limpaLocal() {
    var C = JOGO.Contas, s = armazem();
    if (!s || !C) return;
    if (!N.semRecarga) congelaDisco();             // 04/10: a memória ainda tem o save da outra conta
    try { s.removeItem(C.chaveSave()); s.removeItem(C.chaveConta()); } catch (e) {}
    if (N.semRecarga) {
      try { if (P() && P().load) P().load(); } catch (e2) {}
      try { if (DB() && DB().recarregar) DB().recarregar(); } catch (e3) {}
    }
  }

  function engancha() {
    var p = P();
    if (p && p.save && !saveCru) {
      saveCru = p.save;
      p.save = function () {
        var r = saveCru.apply(this, arguments);
        N.agendar();
        return r;
      };
    }
    if (DB()) DB().aoGravar = function () { N.agendar(); };
    if (enganchado) return;                        // os ouvintes da página entram uma vez só
    enganchado = true;
    try {
      document.addEventListener('visibilitychange', function () { if (document.hidden) N.descarrega(); });
      window.addEventListener('pagehide', function () { N.descarrega(); });
    } catch (e) {}
  }

  /* A pendência vai para o registro local. Antes do 1º puxar, versão e dono
   * ficam como estavam: são o que esta máquina viu da última vez, e é com
   * eles que o próximo puxar decide (a conta pode até ser outra). */
  function marcaSujo() {
    if (puxou) { gravaRegistro(versao, S().contaId(), true); return; }
    var rg = leRegistro();
    gravaRegistro(rg.versao, rg.conta, true);
  }
  function agendaPuxar() {
    if (timerPuxa || !ligada) return;
    timerPuxa = setTimeout(function () { timerPuxa = null; N.puxar(); }, N.RETENTA_MS);
  }
  /* Fora do ar (rede) ou reiniciando (o Caddy responde 502/503 enquanto a
   * API sobe): não é recusa, é esperar e tentar de novo. */
  function foraDoAr(r) {
    if (r.status === 0) return r.erro || 'o servidor está fora (não respondeu)';
    if (r.status >= 500) return 'o servidor está fora do ar ou reiniciando (HTTP ' + r.status + ')';
    return r.erro || ('HTTP ' + r.status);
  }

  N.iniciar = function () {
    var s = S();
    if (encerrada) return Promise.resolve({ ok: false, erro: 'encerrada' });
    if (!s || !s.ativa() || !s.disponivel() || !P()) return Promise.resolve({ ok: false, erro: 'sem sessão' });
    // 13/09 (um aparelho só): com sessão, a olhada em /api/eu a cada 30 s — é
    // ela que derruba o jogo quando a conta entra em outro aparelho sem relé no meio
    if (s.vigiaOutroAparelho) { try { s.vigiaOutroAparelho(); } catch (eV) {} }
    // A Nuvem vale só na conta Principal desta máquina. As outras contas locais
    // (Criar conta nova, ?conta=2, a do Mestre local) servem para testar dois
    // jogadores num PC; a sessão do site é do navegador inteiro, e subi-las na
    // MESMA conta do servidor faria uma apagar o jogo da outra.
    if (!naPrincipal()) return Promise.resolve({ ok: false, erro: 'conta local' });
    if (!ligada) { engancha(); ligada = true; }
    parada = false;
    return confereConta(s).then(function (mudou) {
      if (mudou && !N.semRecarga) return { ok: true, recarregando: true };
      return N.puxar();
    });
  };

  /* A MARCA DE MESTRE mora no servidor (contas.gm). A sessão guardada no login
   * pode estar velha: o dono rodou `admin mestre` depois de entrar, ou alguém
   * editou o localStorage. Confere a cada abertura em /api/eu; se mudou, grava
   * e recarrega a página uma vez, para o jogo nascer com o modo certo. */
  function confereConta(s) {
    return s.api('/api/eu').then(function (r) {
      if (!r || !r.ok || !r.conta || typeof r.conta.id !== 'number') return false;
      var atual = s.conta() || {};
      var gm = r.conta.gm === true;
      if ((atual.gm === true) === gm && atual.nome === r.conta.nome && atual.id === r.conta.id) return false;
      s.guarda({ token: s.token(), conta: { id: r.conta.id, nome: r.conta.nome, gm: gm } });
      avisa('conta', { gm: gm });
      if (!N.semRecarga) try { if (window.__boot && window.__boot.recarregando) window.__boot.recarregando('nuvem'); } catch (eB) {}   // a marca de abertura sai antes
      if (!N.semRecarga) { try { location.reload(); } catch (e) {} }
      return true;
    });
  }

  N.agendar = function () {
    if (!ligada || parada) return;
    sujo = true;
    marcaSujo();
    if (timer) return;
    timer = setTimeout(function () { timer = null; N.empurrar(); }, N.ESPERA_MS);
  };

  /* A página está indo embora com gravação pendente: sobe agora, sem esperar. */
  N.descarrega = function () {
    if (!ligada || parada || !sujo || subindo) return;
    if (timer) { clearTimeout(timer); timer = null; }
    N.empurrar({ keepalive: true });
  };

  N.puxar = function () {
    var s = S();
    if (encerrada) return Promise.resolve({ ok: false, erro: 'encerrada' });
    if (!s || !s.ativa()) return Promise.resolve({ ok: false, erro: 'sem sessão' });
    return s.api('/api/save').then(function (r) {
      if (!r.ok) {
        // a conta entrou em outro aparelho: quem cuida é a Sessao (a queda, ou o
        // token novo adotado). Esquecer a sessão aqui apagaria o token NOVO
        if (outroAparelho(r) || encerrada) return r;
        if (r.status === 401 || r.status === 403) {
          s.esquece(); ligada = false;
          erro = r.erro || ('HTTP ' + r.status);
          avisa('erro', { erro: erro, status: r.status });
          return r;
        }
        // fora do ar, reiniciando ou mal configurado: tenta de novo sozinho,
        // e até conseguir nada sobe (ver `puxou`)
        erro = foraDoAr(r);
        avisa('fora', { erro: erro, status: r.status });
        agendaPuxar();
        return r;
      }
      puxou = true;
      if (timerPuxa) { clearTimeout(timerPuxa); timerPuxa = null; }
      if (!parada) erro = null;
      var reg = leRegistro();
      var cid = s.contaId();
      var mesmaConta = reg.conta === cid;
      var deLa = Math.max(0, Math.floor(Number(r.versao) || 0));
      if (r.progress && (!mesmaConta || deLa > reg.versao)) {
        aplica(r, !!reg.conta && !mesmaConta);
        return r;
      }
      // A CONTA TROCOU nesta máquina (o registro é de outra) e o servidor não
      // tem nada da nova: o que está no disco é da conta ANTERIOR e não pode
      // subir como se fosse dela (as séries têm dono) — a nova começa limpa.
      if (reg.conta && !mesmaConta && !r.progress) {
        limpaLocal();
        versao = 0;
        gravaRegistro(0, cid, true);
        avisa('limpou', { conta: cid });
        if (!N.semRecarga) { recarrega(); return r; }
        return N.empurrar();
      }
      versao = deLa;
      gravaRegistro(versao, cid, reg.sujo);
      // 04/10: o save desta máquina fica — antes de subir (e de a praça seguir com ele), o código de
      // jogador dele é conferido; se é de outra conta, troca e recarrega
      return confereId(s).then(function (trocou) {
        if (trocou && !N.semRecarga) { recarrega(); return r; }
        // o servidor não tem nada, está atrás, ou o local mudou sem subir: sobe
        if (trocou || !r.progress || !mesmaConta || reg.sujo || deLa < reg.versao) return N.empurrar();
        avisa('emdia', { versao: versao });
        return r;
      });
    });
  };

  N.empurrar = function (op) {
    op = op || {};
    var s = S();
    if (!ligada || parada || !s || !s.ativa()) return Promise.resolve({ ok: false, erro: 'sem sessão' });
    if (subindo) { sujo = true; return Promise.resolve({ ok: false, erro: 'já subindo' }); }
    if (!puxou) {                                  // sem a versão do servidor, subir seria às cegas
      sujo = true;
      marcaSujo();
      agendaPuxar();
      return Promise.resolve({ ok: false, erro: 'esperando o servidor' });
    }
    subindo = true;
    sujo = false;
    var corpo = montaCorpo();
    var enviados = corpo.nascimentos.map(function (n) { return n.iid; });
    return s.api('/api/save', { method: 'PUT', body: corpo, keepalive: !!op.keepalive }).then(function (r) {
      subindo = false;
      if (r.ok) {
        versao = Math.max(0, Math.floor(Number(r.versao) || 0));
        erro = null;
        ultimaSubida = Date.now();
        try {
          if (P() && P().limpaNascimentos) P().limpaNascimentos(enviados);
          if (saveCru) saveCru.call(P());            // grava a fila limpa SEM agendar outra subida
        } catch (e) {}
        gravaRegistro(versao, s.contaId(), sujo);
        avisa('subiu', { versao: versao, registrados: r.registrados || 0 });
        // 04/10: o save subiu com o código de jogador de outra conta (a pergunta do boot não chegou ao
        // servidor): troca agora e sobe de novo. Sem recarregar — pode haver luta aberta; a praça veste
        // o código novo na próxima abertura
        if (r.trocarId) trocaAqui(r.trocarId);
        if (sujo) N.agendar();
        return r;
      }
      if (outroAparelho(r) || encerrada) return r;             // 13/09: a Sessao já cuidou (ver o puxar)
      if (r.status === 409 && typeof r.versao === 'number') {   // outra máquina gravou antes: ela manda
        avisa('desatualizado', { versao: r.versao });
        aplica(r);
        return r;
      }
      if (r.status === 401 || r.status === 403) {
        erro = r.erro || 'a sessão não vale mais';
        if (r.status === 401) { s.esquece(); ligada = false; }
        else parada = true;                         // instância de outra conta: o save local está errado
        avisa('erro', { erro: erro, status: r.status });
        return r;
      }
      if (r.status === 0 || r.status >= 500) {      // fora, ou reiniciando (502 do Caddy): fica sujo e tenta depois
        erro = foraDoAr(r);
        sujo = true;
        gravaRegistro(versao, s.contaId(), true);
        avisa('fora', { erro: erro });
        if (!timer) timer = setTimeout(function () { timer = null; N.empurrar(); }, N.RETENTA_MS);
        return r;
      }
      // 409 de instância, 429 de nascimentos, 400: o save não sobe assim
      erro = r.erro || ('HTTP ' + r.status);
      parada = (r.status === 409);
      sujo = true;
      gravaRegistro(versao, s.contaId(), true);
      avisa('recusado', { erro: erro, status: r.status });
      return r;
    });
  };

  /* A AUTORIDADE (13/09, js/core/autoridade.js): a sala fechada e as operações
   * de economia também gravam no servidor e sobem a versão. A resposta delas
   * traz a versão nova, e a próxima subida deste save parte dela. */
  N.defineVersao = function (v) {
    var n = Math.max(0, Math.floor(Number(v) || 0));
    if (n <= versao) return;
    versao = n;
    var s = S();
    try { gravaRegistro(versao, s ? s.contaId() : null, sujo); } catch (e) {}
  };

  /* Volta a tentar depois de uma recusa (a Ficha de Contas tem o botão). */
  N.retomar = function () {
    if (encerrada) return Promise.resolve({ ok: false, erro: 'encerrada' });
    parada = false;
    erro = null;
    return N.puxar();
  };

  N.troca = function (comContaId, dou, recebo) {
    var s = S();
    if (!s || !s.ativa()) return Promise.resolve({ ok: false, erro: 'sem sessão' });
    return s.api('/api/troca', { method: 'POST', body: { com: comContaId, dou: dou || [], recebo: recebo || [] } })
      .then(function (r) { avisa('troca', { ok: !!r.ok, feita: !!r.feita, erro: r.erro || null }); return r; });
  };

  /* PARAR DE VEZ (13/09, um aparelho só): a conta entrou em outro aparelho.
   * Diferente do sair, não avisa o /api/logout (o token já morreu) e não
   * esquece a sessão local (a Sessao decide); só nada mais sobe nem desce,
   * nem a descarga do pagehide. */
  N.parar = function () {
    encerrada = true;
    if (timer) { clearTimeout(timer); timer = null; }
    if (timerPuxa) { clearTimeout(timerPuxa); timerPuxa = null; }
    ligada = false;
    parada = true;
    sujo = false;
    if (DB()) DB().aoGravar = null;
    avisa('encerrada', null);
  };
  N.encerrada = function () { return encerrada; };

  /* Sair da nuvem: a sessão some, a subida para; o local fica como está. */
  N.sair = function () {
    var s = S();
    if (timer) { clearTimeout(timer); timer = null; }
    if (timerPuxa) { clearTimeout(timerPuxa); timerPuxa = null; }
    ligada = false;
    parada = false;
    puxou = false;
    if (DB()) DB().aoGravar = null;
    return s ? s.sair() : Promise.resolve({ ok: true });
  };
})();
