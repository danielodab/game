var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

/* ============================================================================
 * SOTERRA — js/core/grupo.js   (11/09: a camada social da Rede)
 *
 * O pedido do dono (10/09): tocar noutro jogador leva à mensagem particular,
 * ao grupo, à guilda e ao duelo; o grupo tem no máximo 2 jogadores, quem chama
 * lidera, a liderança passa, e os dois descem juntos. Três módulos pequenos:
 *
 *   JOGO.Grupo      convite, liderança, sair, a descida junta (quem lidera
 *                   escolhe o calabouço e leva o outro para a antessala) e a
 *                   volta depois de uma queda da conexão
 *   JOGO.Duelo      o desafio pela Rede: cada um escolhe a dupla às cegas —
 *                   compromisso (SHA-256 com sal) e depois a revelação —, e a
 *                   arena sai da semente dos dois
 *   JOGO.Sussurros  a mensagem particular (o envelope `sussurro`)
 *
 * A batalha em dupla é do JOGO.Coop (coop.js). Daqui só saem as chamadas do
 * contrato: Coop.configura, Coop.parceiroSumiu/parceiroVoltou, Coop.iniciaDuelo
 * e o Game.startRun da descida. Tudo protegido: sem Coop, sem Game ou sem
 * Rede, nada quebra — os pedidos só voltam com o motivo.
 *
 * O NOME de quem está do outro lado nunca vem do envelope: é R.nomeDe(id), o
 * registro da Rede (já julgado pelo relé). Todo envelope do par depois de
 * pareado é conferido pelo `cx` que o relé carimba — quem copia o `de` de outro
 * não passa. Todo prazo é medido com `_agora()`, injetável nas provas.
 * ==========================================================================*/
(function () {
  'use strict';

  var Grupo = {}, Duelo = {}, Sussurros = {};
  JOGO.Grupo = Grupo;
  JOGO.Duelo = Duelo;
  JOGO.Sussurros = Sussurros;

  Grupo.PRAZO_MS = 30000;          // o convite vale 30 s (D17)
  Grupo.DESCER_MS = 5000;          // quem lidera espera 5 s pelo "desci"
  Grupo.GRACA_MS = 15000;          // carência de quem caiu (o Coop.GRACA_MS vence, se existir)
  Duelo.PRAZO_MS = 30000;          // o desafio vale 30 s; a revelação também
  Duelo.ESCOLHA_MS = 90000;        // o tempo de escolher a dupla
  Duelo.INICIO_MS = 60000;         // da revelação até a arena abrir (a carga dos modelos cabe)
  Sussurros.TEXTO_MAX = 240;
  Sussurros.LISTA_MAX = 30;

  Grupo._agora = function () { return Date.now(); };
  Duelo._agora = function () { return Date.now(); };
  function agora() { return Grupo._agora(); }
  function agoraD() { return Duelo._agora(); }

  // ------------------------------------------------------------ acessadores
  function R() { return JOGO.Rede || null; }
  function G() { return JOGO.Game || null; }
  function C() { return JOGO.Coop || null; }
  function D() { return JOGO.DATA || {}; }
  function safe(fn, def) { try { var v = fn(); return v === undefined ? def : v; } catch (e) { return def; } }
  function eu() { return safe(function () { return R().meuId(); }, null); }
  function meuCx() { return safe(function () { return R().meuCx(); }, null); }
  /* A TELA de verdade: o Acampamento ('hub') só existe na HUD — o Game.screen
   * fica no que estava antes (menu, heroSelect, defeat…). Sem HUD na página
   * (cliente de prova sem tela), fora da batalha e da antessala é a praça. */
  var PRACA_SEM_UI = ['menu', 'heroSelect', 'dungeonSelect', 'hub', 'dungeonComplete', 'defeat', 'duelFim'];
  function tela() {
    var u = safe(function () { return JOGO.UI.telaAtual(); }, null);
    if (u) return u;
    var g = safe(function () { return G().screen; }, null) || 'menu';
    return PRACA_SEM_UI.indexOf(g) >= 0 ? 'hub' : g;
  }
  function minhaSala() { return safe(function () { return R().minhaSala(); }, null); }

  var ALFA = '0123456789abcdefghijklmnopqrstuvwxyz';
  function aleat(n, alfa) {
    alfa = alfa || ALFA;
    var s = '';
    for (var i = 0; i < n; i++) s += alfa.charAt(Math.floor(Math.random() * alfa.length));
    return s;
  }
  function hex(n) { return aleat(n, '0123456789abcdef'); }

  /* o nome de quem está do outro lado: o registro da Rede (julgado pelo relé);
   * sem R.nomeDe (Rede antiga), a lista de pares; nunca o envelope */
  function nomeDe(id, sug) {
    if (!id) return sug || 'Aventureiro';
    var r = R();
    if (r && typeof r.nomeDe === 'function') {
      var n = safe(function () { return r.nomeDe(id, sug); }, null);
      if (n) return String(n);
    }
    var achado = null;
    safe(function () {
      r.pares().forEach(function (p) { if (p && p.id === id && p.nome) achado = p.nome; });
      return true;
    }, false);
    return achado || sug || 'Aventureiro';
  }

  /* A VERSÃO dos dois lados tem de bater: o carimbo do build mais a assinatura
   * dos dados (Coop.assinatura, seção 3.3 do plano). */
  function versao() {
    var w = (typeof window !== 'undefined') ? window : globalThis;
    var v = safe(function () { return w.SOTERRA_VERSAO.versao; }, '') || '';
    var a = safe(function () { return C().assinatura(); }, '') || '';
    return String(v) + ':' + String(a);
  }
  Grupo.versao = versao;

  // -------------------------------------------------------------- a Rede
  var ultimaRecusa = null;
  function manda(tipo, para, acao, dados, cx) {
    var r = R();
    if (!r || typeof r.dirige !== 'function') { ultimaRecusa = 'rele-antigo'; return false; }
    var ok = false;
    try { ok = !!r.dirige(tipo, para, acao, dados || {}, cx ? { cx: cx } : {}); } catch (e) { ok = false; }
    if (!ok) ultimaRecusa = safe(function () { return r.ultimaRecusa(); }, null) || 'sem-conexao';
    return ok;
  }
  function vigia(id, cx) { safe(function () { R().vigia(id, cx); return true; }, false); }
  function solta(id, cx) { safe(function () { R().solta(id, cx); return true; }, false); }

  /* A CHAVE (11/09, revisão). O id de quem não tem conta conferida pode ser
   * usado por outra conexão, e o que vai ao id SEM cx (o convite, a `volta`)
   * chega a ela também. Então: a chave do grupo (e do duelo) é feita de DUAS
   * metades — a de quem chama vai no convite; a de quem aceita, na resposta,
   * dirigida à conexão de quem chamou —, e ela nunca mais viaja em aberto: a
   * `volta` e o `sair` de um cx novo levam a PROVA sha256(chave|cx), presa ao
   * cx que o relé carimba. Quem ouve a prova de outro não a usa no seu cx. */
  function provaDe(chave, cx) { return sha256(String(chave || '') + '|' + String(cx || '')); }
  /* o "sair expirou" automático (a resposta a um grupo que já não existe) sai
   * uma vez por minuto por (quem, gid): senão qualquer um fazia a vítima
   * mandar mensagem até o relé a desligar */
  var respondi = {};
  function umaVez(de, id) {
    var k = de + '|' + id, t = agora();
    for (var q in respondi) if (respondi.hasOwnProperty(q) && t - respondi[q] > 60000) delete respondi[q];
    if (respondi[k] && t - respondi[k] < 60000) return false;
    respondi[k] = t;
    return true;
  }
  /* pelo relé novo a queda que vale é o `caiu` do vigia (com o cx): o `saiu`
   * (o tchau de OUTRA aba da mesma conta, a varredura numa aba estrangulada)
   * não tira o par vigiado */
  function viaRele() { return !!safe(function () { return R().transporte() === 'ws'; }, false); }

  // os silenciados no chat (DB.mutados): convite e sussurro deles morrem calados
  var mutados = {};
  function carregaMutados() {
    var DB = JOGO.DB;
    if (!DB || typeof DB.mutados !== 'function') return;
    try {
      DB.mutados().then(function (l) {
        var novo = {};
        (l || []).forEach(function (m) { if (m && m.id) novo[m.id] = true; });
        mutados = novo;
      }, function () {});
    } catch (e) {}
  }
  function mutado(id) { return !!mutados[id]; }
  /* a HUD avisa quando silencia ou devolve a voz (o DB grava; aqui é o espelho) */
  Grupo.mutado = function (id, sim) {
    if (!id) return false;
    if (sim === undefined) return mutado(id);
    if (sim) mutados[id] = true; else delete mutados[id];
    // 11/09 (achado 21): o silêncio por id não segura quem abre conexão nova
    // (e id novo) a cada envio — o relé novo cala o ENDEREÇO dele para mim
    safe(function () { return R().cala(id, !sim); }, false);
    return !!sim;
  };

  // ------------------------------------------------------------ o meu herói
  var meuHeroiId = null, meuNome = null;
  function heroiResumo(hid) {
    if (!hid) return null;
    var h = safe(function () { return JOGO.Progress.hero(hid); }, null);
    if (!h) return { classId: hid, element: 'neutro', level: 1 };
    return { classId: h.classId || hid, element: h.element || 'neutro', level: h.level || 1 };
  }
  function limpaHeroi(h) {
    if (!h || typeof h !== 'object') return null;
    var cid = String(h.classId || '').slice(0, 40);
    if (!/^[a-z0-9_:+\-]+$/i.test(cid)) return null;
    var el = String(h.element || 'neutro');
    if (!/^(neutro|fogo|agua|terra|ar)$/.test(el)) el = 'neutro';
    var lv = Math.max(1, Math.min(99, Math.floor(Number(h.level) || 1)));
    return { classId: cid, element: el, level: lv };
  }
  function ehMestre(hid) {
    if (!hid) return false;
    if (hid === 'gm') return true;
    return safe(function () { return JOGO.Progress.hero(hid).classId === 'gm'; }, false);
  }
  function temHeroi(hid) { return !!(hid && safe(function () { return JOGO.Progress.hero(hid); }, null)); }
  /* 11/09 (pedido do dono): o Mestre ENTRA em grupo com o Cavaleiro Negro, mas
   * só ele chama. "É o Mestre" = o mestre:true da presença, que a Rede só põe
   * quando confia no relé — nunca o que veio escrito no convite. */
  function mestreConferido(id) {
    return safe(function () {
      var r = R();
      return !!(id && r && r.pares && r.pares().some(function (p) { return p && p.id === id && p.mestre === true; }));
    }, false);
  }
  function lerMeuNome() {
    var DB = JOGO.DB;
    if (!DB || typeof DB.jogador !== 'function') return;
    try { DB.jogador().then(function (j) { if (j && j.nome) meuNome = j.nome; }, function () {}); } catch (e) {}
  }

  // ------------------------------------------------------- quem está ocupado
  function trocaAberta() {
    var e = safe(function () { return JOGO.Troca.estado(); }, null);
    return !!(e && (e.fase === 'convidei' || e.fase === 'convidado' || e.fase === 'aberta'));
  }
  function emBatalhaOuDescida() {
    var t = tela();
    return t === 'battle' || t === 'antessala' || t === 'roomClear' || t === 'elementChoice';
  }
  /* "ocupado" de quem RECEBE um convite ou desafio (seção 5.2.2) */
  function motivoOcupado(paraGrupo) {
    if (paraGrupo && st.fase === 'formado') return 'em-grupo';
    if (emBatalhaOuDescida()) return 'em-batalha';
    if (st.fase === 'convidei' || st.fase === 'convidado') return 'ocupado';
    if (dst.fase !== 'livre') return 'ocupado';
    if (trocaAberta()) return 'troca';
    if (tela() !== 'hub' || minhaSala()) return 'ocupado';
    if (paraGrupo) {
      if (!temHeroi(meuHeroiId)) return 'sem-heroi';
      if (ehMestre(meuHeroiId)) return 'so-mestre-chama';   // 11/09: o Mestre entra em grupo, mas é ele quem chama
    } else if (!heroisDeDuelo().length) return 'sem-heroi';
    return null;
  }
  /* "posso seguir" quem lidera para a antessala (seção 2.6) */
  function motivoPodeSeguir() {
    var t = tela();
    if (t === 'battle' || t === 'antessala' || t === 'roomClear') return 'em-batalha';
    if (['hub', 'menu', 'defeat', 'dungeonComplete', 'duelFim'].indexOf(t) < 0) return 'ocupado';
    if (trocaAberta()) return 'troca';
    if (dst.fase !== 'livre') return 'ocupado';
    if (!temHeroi(meuHeroiId)) return 'sem-heroi';
    return null;                     // 11/09: o Mestre no grupo segue (e desce) como qualquer um
  }
  Grupo.podeSeguir = function () {
    var m = motivoPodeSeguir();
    return { ok: !m, motivo: m };
  };
  function acharDungeon(id) {
    var ds = D().dungeons || [];
    var lista = Array.isArray(ds) ? ds : Object.keys(ds).map(function (k) { return ds[k]; });
    for (var i = 0; i < lista.length; i++) if (lista[i] && lista[i].id === id) return lista[i];
    return null;
  }
  /* 11/09 (revisão): a dificuldade que vem do outro lado — um id conhecido (sem a
   * tabela na página, só a forma) */
  function difValida(x) {
    var s = String(x == null ? '' : x).slice(0, 16);
    if (!/^[a-z_]+$/.test(s)) return null;
    var tab = safe(function () { return D().dificuldades; }, null);
    return (!tab || tab[s]) ? s : null;
  }
  function validaDescida(dg) {
    if (!dg) return 'portal';
    if (dg === 'poco') return 'poco';
    if (safe(function () { return D().portalFechado(dg); }, false)) return 'portal';
    var d = acharDungeon(dg);
    if (!d || !d.rooms || !d.rooms.length) return 'portal';
    return null;
  }

  // ------------------------------------------------------------ os textos
  /* Os motivos padronizados (seção 2.6) em pt-BR. `nome` = quem está do outro
   * lado (null: é sobre mim). "Quem lidera" é a forma única da HUD (4.11). */
  var SOBRE_OUTRO = {
    'ocupado': '{n} está ocupado(a) agora.',
    'em-batalha': '{n} está ocupado(a) agora.',
    'em-grupo': '{n} já está num grupo.',
    'troca': '{n} está numa troca.',
    'versao': 'Vocês estão em versões diferentes do jogo — recarreguem a página.',
    'mestre': 'O Mestre do Fundo não entra em duelo.',
    'so-mestre-chama': 'O Mestre do Fundo é quem chama para o grupo.',
    'mestre-falso': 'Esse Mestre do Fundo não foi conferido pelo servidor.',
    'sem-heroi': '{n} não tem herói escolhido.',
    'portal': 'Esse calabouço não abre agora.',
    'poco': 'O Poço é só para quem desce sozinho — por enquanto.',
    'expirou': 'O convite expirou.',
    'recusou': '{n} recusou.',
    'rele-antigo': 'Grupo e duelo precisam do servidor novo da Rede.',
    'sem-conexao': 'Sem conexão com a Rede agora.',
    'sumido': '{n} não está mais conectado(a).',
    'trapaca': 'O duelo foi cancelado: a dupla revelada não bate com a escolhida.',
    'desistiu': '{n} desistiu do duelo.'
  };
  var SOBRE_MIM = {
    'ocupado': 'Termine o que está fazendo antes.',
    'em-batalha': 'Não dá no meio da descida.',
    'em-grupo': 'Você já está num grupo.',
    'troca': 'Feche a troca aberta antes.',
    'sem-heroi': 'Escolha um herói primeiro.',
    'mestre': 'O Mestre do Fundo não entra em duelo.',
    'so-mestre-chama': 'O Mestre do Fundo é quem chama para o grupo.',
    'mestre-falso': 'Esse Mestre do Fundo não foi conferido pelo servidor.',
    'nao-lider': 'Só quem lidera escolhe o calabouço.',
    'sem-grupo': 'Você não está num grupo.',
    'privado': 'Mensagem particular precisa do servidor da Rede.',
    'vazio': 'Escreva alguma coisa.',
    'n': 'Escolha um ou dois heróis.'
  };
  Grupo.textoMotivo = function (motivo, nome) {
    var m = String(motivo || 'ocupado');
    var t = nome ? (SOBRE_OUTRO[m] || SOBRE_MIM[m]) : (SOBRE_MIM[m] || SOBRE_OUTRO[m]);
    if (!t) t = nome ? '{n} não pôde agora.' : 'Não deu agora.';
    return t.replace('{n}', nome || 'O outro lado');
  };

  function aviso(texto, kind) {
    if (!texto) return;
    if (Grupo.aoAviso) { try { Grupo.aoAviso(texto, kind); } catch (e) {} }
  }

  // ==========================================================================
  // O GRUPO
  // ==========================================================================
  var st = null;
  var descidaG = null;              // { dungeonId }: a descida em curso é de grupo
  var ultimoPar = null;             // { id, nome }: quem estava no grupo que se desfez
  function zera() {
    st = { fase: 'livre', gid: null, chave: null, v: 0, lider: null,
           par: null,               // { id, cx, nome, heroi, on, sumidoDesde, saiu }
           pendente: null,          // { tipo:'convite', id, gid, chave, cx, heroi, expira, meu }
           descer: null,            // { dungeonId, expira } — quem lidera esperando o "desci"
           aguardaEstado: false,    // mandei 'volta': o próximo estado do par vale
           voltaProva: null,        // a prova da minha última 'volta' (o "sair expirou" de quem já não me conhece a devolve)
           dissolver: null,         // o par saiu no meio da batalha: desfaz quando a sala acabar
           descidaAcabou: false,
           descidaDif: null };      // 11/09 (revisão): a dificuldade de quem lidera (quem segue a vê)
  }
  zera();

  function graca() {
    var g = safe(function () { return C().GRACA_MS; }, null);
    return (typeof g === 'number' && g > 0) ? g : Grupo.GRACA_MS;
  }
  function descidaAtual() {
    var t = tela();
    if (t === 'battle' && !safe(function () { return G().state.pvp; }, false)) return 'batalha';
    if (t === 'antessala' || t === 'roomClear' || t === 'elementChoice' ||
        (t === 'battle' && descidaG)) return 'descida';
    return 'praca';
  }
  function podePassar() {
    var t = tela();
    return t !== 'battle' && t !== 'roomClear' && t !== 'dungeonComplete' && t !== 'elementChoice';
  }

  Grupo.emGrupo = function () { return st.fase === 'formado' && !!st.par; };
  Grupo.souLider = function () { return Grupo.emGrupo() && st.lider === eu(); };
  Grupo.lider = function () { return Grupo.emGrupo() ? st.lider : null; };
  Grupo.parceiro = function () {
    if (!Grupo.emGrupo()) return null;
    return { id: st.par.id, cx: st.par.cx, nome: st.par.nome, heroi: st.par.heroi };
  };
  Grupo.estado = function () {
    var e = eu();
    var membros = [];
    if (Grupo.emGrupo()) {
      var mim = { id: e, cx: meuCx(), nome: meuNome || 'Você', heroi: heroiResumo(meuHeroiId),
                  on: true, sumidoDesde: null, eu: true };
      var ele = { id: st.par.id, cx: st.par.cx, nome: st.par.nome, heroi: st.par.heroi,
                  on: st.par.on, sumidoDesde: st.par.sumidoDesde, saiu: !!st.par.saiu, eu: false };
      if (st.lider === e) membros.push(mim, ele); else membros.push(ele, mim);
    }
    var p = st.pendente;
    return {
      gid: st.gid, v: st.v, lider: Grupo.emGrupo() ? st.lider : null, eu: e, fase: st.fase,
      membros: membros,
      pendente: p ? { tipo: 'convite', id: p.id, gid: p.gid, expira: p.expira, meu: !!p.meu,
                      nome: nomeDe(p.id), heroi: p.heroi || null } : null,
      descida: descidaAtual(),
      descendo: st.descer ? { dungeonId: st.descer.dungeonId, expira: st.descer.expira } : null,
      descidaGrupo: descidaG ? descidaG.dungeonId : null,
      descidaAcabou: !!st.descidaAcabou || !!(descidaG && !Grupo.emGrupo()),
      descidaDif: st.descidaDif || null,     // 11/09 (revisão): a de quem lidera, para quem segue
      graca: graca(),
      ultimoParceiro: ultimoPar ? { id: ultimoPar.id, nome: ultimoPar.nome } : null
    };
  };

  // ---- a mudança se espalha: o Coop, a placa na praça e a HUD
  var assinaturaCoop = '';
  var marcado = { id: null, papel: null };
  function configuraCoop() {
    var c = C();
    if (!c || typeof c.configura !== 'function') return;
    var info = null;
    if (Grupo.emGrupo()) {
      info = { gid: st.gid, lider: st.lider, eu: eu(),
               parceiro: { id: st.par.id, cx: st.par.cx, heroi: st.par.heroi, nome: st.par.nome } };
    }
    var sig = info ? JSON.stringify(info) : 'null';
    if (sig === assinaturaCoop) return;
    assinaturaCoop = sig;
    try { c.configura(info); } catch (e) {}
  }
  function marcaHub() {
    var H = JOGO.Hub;
    if (!H || typeof H.marcaGrupo !== 'function') return;
    var id = Grupo.emGrupo() ? st.par.id : null;
    var papel = id ? (st.lider === id ? 'lider' : 'membro') : null;
    if (marcado.id && marcado.id !== id) { try { H.marcaGrupo(marcado.id, null); } catch (e) {} }
    if (id && (marcado.id !== id || marcado.papel !== papel)) { try { H.marcaGrupo(id, papel); } catch (e) {} }
    marcado = { id: id, papel: papel };
  }
  function muda() {
    configuraCoop();
    marcaHub();
    if (Grupo.aoMudar) { try { Grupo.aoMudar(Grupo.estado()); } catch (e) {} }
  }

  function mandaEstado(semCx) {
    if (!Grupo.emGrupo() || st.lider !== eu()) return false;
    st.v++;
    return manda('grupo', st.par.id, 'estado', {
      gid: st.gid, v: st.v, lider: st.lider, fase: descidaAtual(),
      dif: safe(function () { return G().dificuldade; }, null) || 'normal',   // 11/09 (revisão): quem segue vê a dificuldade
      membros: [{ id: eu(), cx: meuCx(), heroi: heroiResumo(meuHeroiId) },
                { id: st.par.id, cx: st.par.cx, heroi: st.par.heroi }]
    }, semCx ? null : st.par.cx);
  }
  // envelope do par já pareado: o id e o cx carimbado batem
  function doPar(ev) {
    return !!(st.par && ev.de === st.par.id && (st.par.cx == null || ev.cx === st.par.cx));
  }

  /* desfaz o grupo. Se o PAR saiu no meio da batalha, a sala continua (o herói
   * dele segue com a IA, no Coop) e o grupo só se desfaz quando ela acabar. */
  function desfaz(texto, kind, porMim) {
    if (st.fase !== 'formado') return;
    if (!porMim && tela() === 'battle') {
      if (st.par) {
        st.par.on = false;
        st.par.saiu = true;
        if (!st.par.sumidoDesde) st.par.sumidoDesde = agora();
      }
      st.dissolver = texto || 'saiu';
      st.descidaAcabou = true;
      if (texto) aviso(texto, kind);
      muda();
      return;
    }
    var par = st.par;
    if (par) { solta(par.id, par.cx); ultimoPar = { id: par.id, nome: par.nome }; }
    var naAntessala = tela() === 'antessala' && !!descidaG;
    zera();
    if (texto) aviso(texto, kind);
    muda();
    if (naAntessala) sobe('grupo-desfeito');
  }
  function sobe(motivo) {
    descidaG = null;
    if (Grupo.aoSubiu) { try { Grupo.aoSubiu(motivo || 'saiu'); } catch (e) {} }
  }
  function comecaDescida(dg) {
    descidaG = { dungeonId: dg };
    st.descidaAcabou = false;
    var ok = safe(function () { return G().startRun([meuHeroiId], dg, { grupo: true }); }, false);
    if (!ok) {
      descidaG = null;
      aviso('Não deu para começar a descida.');
      if (Grupo.emGrupo()) manda('grupo', st.par.id, 'subir', { gid: st.gid, motivo: 'falhou' }, st.par.cx);
    }
    muda();
    return ok;
  }

  // ---- a superfície
  Grupo.defineHeroi = function (heroId) {
    var antes = JSON.stringify(heroiResumo(meuHeroiId));
    meuHeroiId = heroId || null;
    lerMeuNome();
    var depois = JSON.stringify(heroiResumo(meuHeroiId));
    if (antes === depois || !Grupo.emGrupo()) return;
    manda('grupo', st.par.id, 'heroi', { gid: st.gid, heroi: heroiResumo(meuHeroiId) }, st.par.cx);
    muda();
  };
  Grupo.meuHeroi = function () { return meuHeroiId; };

  Grupo.convidar = function (id) {
    if (!id || id === eu()) return { ok: false, motivo: 'ocupado' };
    if (st.fase === 'formado') return { ok: false, motivo: 'em-grupo' };
    if (st.fase !== 'livre' || dst.fase !== 'livre') return { ok: false, motivo: 'ocupado' };
    if (trocaAberta()) return { ok: false, motivo: 'troca' };
    if (tela() !== 'hub' || minhaSala()) return { ok: false, motivo: 'em-batalha' };
    if (!temHeroi(meuHeroiId)) return { ok: false, motivo: 'sem-heroi' };
    // 11/09 (pedido do dono): o Mestre chama para o grupo; chamar o Mestre
    // conferido nem sai daqui — só ele pede grupo
    if (mestreConferido(id) && !ehMestre(meuHeroiId)) return { ok: false, motivo: 'so-mestre-chama' };
    var gid = eu() + '-' + aleat(4), chave = aleat(8);
    if (!manda('grupo', id, 'convite', { gid: gid, chave: chave, heroi: heroiResumo(meuHeroiId),
                                          versao: versao() })) {
      return { ok: false, motivo: ultimaRecusa };
    }
    st.fase = 'convidei';
    st.pendente = { tipo: 'convite', id: id, gid: gid, chave: chave, cx: null, heroi: null,
                    expira: agora() + Grupo.PRAZO_MS, meu: true };
    muda();
    return { ok: true };
  };

  Grupo.responder = function (sim) {
    var p = st.pendente;
    if (st.fase !== 'convidado' || !p || p.meu) return { ok: false, motivo: 'expirou' };
    st.pendente = null;
    st.fase = 'livre';
    if (agora() > p.expira) { muda(); return { ok: false, motivo: 'expirou' }; }
    if (!sim) {
      manda('grupo', p.id, 'resposta', { gid: p.gid, ok: false, motivo: 'recusou' }, p.cx);
      muda();
      return { ok: true };
    }
    var mot = motivoOcupado(true);
    if (mot) {
      manda('grupo', p.id, 'resposta', { gid: p.gid, ok: false, motivo: mot }, p.cx);
      muda();
      return { ok: false, motivo: mot };
    }
    var kb = aleat(8);                      // a minha metade da chave: só à conexão de quem chamou
    if (!manda('grupo', p.id, 'resposta', { gid: p.gid, ok: true, heroi: heroiResumo(meuHeroiId), kb: kb }, p.cx)) {
      muda();
      return { ok: false, motivo: ultimaRecusa };
    }
    st.fase = 'formado';
    st.gid = p.gid; st.chave = p.chave + ':' + kb; st.v = 0; st.lider = p.id;
    st.par = { id: p.id, cx: p.cx || null, nome: nomeDe(p.id), heroi: p.heroi, on: true, sumidoDesde: null };
    st.descidaAcabou = false;
    vigia(p.id, st.par.cx);
    muda();
    return { ok: true };
  };

  Grupo.passarLideranca = function () {
    if (!Grupo.emGrupo()) return { ok: false, motivo: 'sem-grupo' };
    if (!Grupo.souLider()) return { ok: false, motivo: 'nao-lider' };
    if (!podePassar()) return { ok: false, motivo: 'em-batalha' };
    if (!st.par.on) return { ok: false, motivo: 'sumido' };
    st.v++;
    if (!manda('grupo', st.par.id, 'lider', { gid: st.gid, novo: st.par.id, v: st.v }, st.par.cx)) {
      st.v--;
      return { ok: false, motivo: ultimaRecusa };
    }
    st.lider = st.par.id;
    st.descer = null;
    muda();
    return { ok: true };
  };

  Grupo.sair = function (motivo) {
    var p = st.pendente;
    if (p && st.fase !== 'formado') {
      // o convite em aberto se retira
      if (p.meu) manda('grupo', p.id, 'sair', { gid: p.gid, motivo: 'retirou' });
      else manda('grupo', p.id, 'resposta', { gid: p.gid, ok: false, motivo: 'recusou' }, p.cx);
      st.pendente = null;
      st.fase = 'livre';
      muda();
      return;
    }
    if (!Grupo.emGrupo()) return;
    manda('grupo', st.par.id, 'sair', { gid: st.gid, prova: provaDe(st.chave, meuCx()), motivo: motivo || 'saiu' }, st.par.cx);
    desfaz(null, null, true);
  };

  Grupo.descer = function (dungeonId) {
    if (!Grupo.emGrupo()) return { ok: false, motivo: 'sem-grupo' };
    if (!Grupo.souLider()) return { ok: false, motivo: 'nao-lider' };
    var mot = validaDescida(dungeonId) || motivoPodeSeguir();
    if (mot) return { ok: false, motivo: mot };
    if (!st.par.on) return { ok: false, motivo: 'sumido' };
    if (st.descer) return { ok: false, motivo: 'ocupado' };
    var dif = safe(function () { return G().dificuldade; }, null) || 'normal';
    if (!manda('grupo', st.par.id, 'descer', { gid: st.gid, dungeonId: dungeonId, dificuldade: dif }, st.par.cx)) {
      return { ok: false, motivo: ultimaRecusa };
    }
    st.descer = { dungeonId: dungeonId, expira: agora() + Grupo.DESCER_MS };
    muda();
    return { ok: true };
  };

  /* 11/09 (revisão): quem lidera mudou a dificuldade no seletor — quem segue fica
   * sabendo pelo estado (a HUD chama; sem liderar, nada sai) */
  Grupo.avisaDificuldade = function () {
    if (!Grupo.souLider()) return false;
    return mandaEstado();
  };

  Grupo.subir = function (motivo) {
    if (Grupo.emGrupo() && st.par.on) {
      manda('grupo', st.par.id, 'subir', { gid: st.gid, motivo: motivo || 'saiu' }, st.par.cx);
    }
    st.descidaAcabou = false;
    st.descer = null;
    sobe(motivo || 'saiu');
    muda();
  };

  // ---- o que chega
  /* o par falou pela conexão que eu conheço: não sumiu. Um `saiu` de outra
   * aba dele, ou um `ausente` que se cruzou com a volta, não o tira mais */
  function revive(ev) {
    if (!ev || !Grupo.emGrupo() || st.par.on || st.par.saiu || ev.de !== st.par.id || !st.par.cx || ev.cx !== st.par.cx) return;
    st.par.on = true;
    st.par.sumidoDesde = null;
    safe(function () { C().parceiroVoltou(st.par.id, st.par.cx); return true; }, false);
    if (tela() !== 'battle') aviso(st.par.nome + ' voltou.', 'good');
    muda();
  }
  function aoGrupo(ev) {
    if (!ev || !ev.de || ev.de === eu()) return;
    var d = ev.dados || {};
    var de = ev.de, a = ev.acao;
    revive(ev);
    if (a === 'convite') {
      if (!d.gid || !d.chave) return;
      if (st.pendente && st.pendente.gid === d.gid) return;          // reenvio
      if (st.fase === 'formado' && st.gid === d.gid) return;
      var mot = mutado(de) ? 'ocupado' : (String(d.versao || '') !== versao() ? 'versao' : motivoOcupado(true));
      // 11/09: convite com o herói do Mestre só do Mestre que o relé conferiu
      if (!mot && d.heroi && String(d.heroi.classId || '') === 'gm' && !mestreConferido(de)) mot = 'mestre-falso';
      if (mot) {
        manda('grupo', de, 'resposta', { gid: String(d.gid).slice(0, 48), ok: false, motivo: mot }, ev.cx);
        return;
      }
      st.fase = 'convidado';
      st.pendente = { tipo: 'convite', id: de, gid: String(d.gid).slice(0, 48), chave: String(d.chave).slice(0, 24),
                      cx: ev.cx || null, heroi: limpaHeroi(d.heroi), expira: agora() + Grupo.PRAZO_MS, meu: false };
      if (Grupo.aoConvite) {
        try {
          Grupo.aoConvite({ id: de, nome: nomeDe(de), heroi: st.pendente.heroi,
                            expira: st.pendente.expira, gid: st.pendente.gid });
        } catch (e) {}
      }
      muda();
    } else if (a === 'resposta') {
      var p = st.pendente;
      if (!p || !p.meu || p.id !== de || p.gid !== d.gid) {
        // o sim a um convite que já não existe desfaz o grupo fantasma do outro
        // lado — dirigido à conexão dele, e uma vez por minuto
        if (d.ok === true && d.gid && !(st.fase === 'formado' && st.gid === d.gid) && umaVez(de, d.gid)) {
          manda('grupo', de, 'sair', { gid: d.gid, motivo: 'expirou' }, ev.cx);
        }
        return;
      }
      st.pendente = null;
      st.fase = 'livre';
      if (agora() > p.expira) {
        if (d.ok === true && umaVez(de, d.gid)) manda('grupo', de, 'sair', { gid: d.gid, motivo: 'expirou' }, ev.cx);
        aviso('O convite expirou.');
        muda();
        return;
      }
      if (d.ok !== true) {
        aviso(!d.motivo || d.motivo === 'recusou' ? nomeDe(de) + ' recusou o convite.'
                                                  : Grupo.textoMotivo(d.motivo, nomeDe(de)));
        muda();
        return;
      }
      st.fase = 'formado';
      // a chave: a minha metade (a do convite) e a dele (a da resposta, que só a minha conexão ouviu)
      st.gid = p.gid; st.chave = p.chave + ':' + String(d.kb || '').slice(0, 24); st.v = 0; st.lider = eu();
      st.par = { id: de, cx: ev.cx || null, nome: nomeDe(de), heroi: limpaHeroi(d.heroi), on: true, sumidoDesde: null };
      st.descidaAcabou = false;
      vigia(de, st.par.cx);
      mandaEstado();
      aviso(st.par.nome + ' entrou no grupo!', 'good');
      muda();
    } else if (a === 'estado') {
      if (!Grupo.emGrupo() || d.gid !== st.gid || !doPar(ev)) return;
      var v = Math.floor(Number(d.v) || 0);
      if (v <= st.v) return;
      if (de !== st.lider && !st.aguardaEstado) return;      // estado de quem não lidera: ignorado
      if (d.lider !== de && d.lider !== eu()) return;
      st.v = v;
      st.aguardaEstado = false;
      st.lider = (d.lider === eu()) ? eu() : de;
      // 11/09 (revisão): a dificuldade que quem lidera escolheu (quem segue a vê no portal e na porta)
      if (st.lider === de && d.dif) st.descidaDif = difValida(d.dif) || st.descidaDif;
      (Array.isArray(d.membros) ? d.membros : []).forEach(function (m) {
        if (m && m.id === de) { var hh = limpaHeroi(m.heroi); if (hh) st.par.heroi = hh; }
      });
      muda();
    } else if (a === 'lider') {
      if (!Grupo.emGrupo() || d.gid !== st.gid || !doPar(ev) || de !== st.lider) return;
      if (d.novo !== eu() || !podePassar()) return;
      st.lider = eu();
      st.v = Math.max(st.v, Math.floor(Number(d.v) || 0));
      mandaEstado();
      aviso('Agora você lidera o grupo.', 'good');
      muda();
    } else if (a === 'heroi') {
      if (!Grupo.emGrupo() || d.gid !== st.gid || !doPar(ev)) return;
      var h2 = limpaHeroi(d.heroi);
      if (h2) st.par.heroi = h2;
      if (Grupo.souLider()) mandaEstado();
      muda();
    } else if (a === 'sair') {
      // vale do par pela conexão dele; de um cx novo, só com a PROVA da chave
      // presa a esse cx (ou a prova da minha última `volta`, devolvida por quem
      // já não me conhecia). O "expirou" não passa mais sem conferir: um
      // impostor com o id do par desfazia o grupo com ele
      var provaOk = !!(d.prova && Grupo.emGrupo() &&
                       (d.prova === provaDe(st.chave, ev.cx) || (st.voltaProva && d.prova === st.voltaProva)));
      if (Grupo.emGrupo() && d.gid === st.gid && de === st.par.id && (doPar(ev) || provaOk)) {
        var nome = st.par.nome;
        desfaz(d.motivo === 'expirou' ? null : nome + ' saiu do grupo.');
      } else if (st.pendente && !st.pendente.meu && st.pendente.gid === d.gid && st.pendente.id === de &&
                 (!st.pendente.cx || ev.cx === st.pendente.cx)) {   // achado 18: só pela conexão que convidou
        st.pendente = null;
        st.fase = 'livre';
        muda();
      }
    } else if (a === 'descer') {
      if (!Grupo.emGrupo() || d.gid !== st.gid || !doPar(ev) || de !== st.lider) return;
      var dg = String(d.dungeonId || '');
      var mot2 = validaDescida(dg) || motivoPodeSeguir();
      if (mot2) {
        manda('grupo', de, 'desci', { gid: st.gid, dungeonId: dg, ok: false, motivo: mot2 }, st.par.cx);
        aviso(st.par.nome + ' chamou para descer, mas ' + Grupo.textoMotivo(mot2, null).charAt(0).toLowerCase() +
              Grupo.textoMotivo(mot2, null).slice(1));
        return;
      }
      // 11/09 (revisão): quem segue é AVISADO (a descida fecha a ficha aberta sem uma
      // linha) e fica sabendo a dificuldade — a que vale é a da ata, a de quem lidera
      st.descidaDif = difValida(d.dificuldade) || st.descidaDif || 'normal';
      var dd = acharDungeon(dg);
      var cfgDif = safe(function () { return D().dificuldades[st.descidaDif]; }, null);
      aviso(st.par.nome + ' escolheu ' + ((dd && (dd.name || dd.nome)) || 'o calabouço') +
            (cfgDif && cfgDif.nome ? ' (' + cfgDif.nome + ')' : '') + ' — descendo juntos.', 'good');
      manda('grupo', de, 'desci', { gid: st.gid, dungeonId: dg, ok: true }, st.par.cx);
      comecaDescida(dg);
    } else if (a === 'desci') {
      if (!Grupo.emGrupo() || d.gid !== st.gid || !doPar(ev)) return;
      if (!st.descer || d.dungeonId !== st.descer.dungeonId) {
        // o sim chegou depois do prazo: o outro já desceu sozinho — volta
        if (d.ok === true) manda('grupo', de, 'subir', { gid: st.gid, motivo: 'expirou' }, st.par.cx);
        return;
      }
      var alvo = st.descer.dungeonId;
      st.descer = null;
      if (d.ok !== true) {
        aviso(Grupo.textoMotivo(d.motivo || 'ocupado', st.par.nome));
        muda();
        return;
      }
      comecaDescida(alvo);
      mandaEstado();
    } else if (a === 'subir') {
      if (!Grupo.emGrupo() || d.gid !== st.gid || !doPar(ev)) return;
      st.descer = null;
      var tx = d.motivo === 'expirou' ? 'Quem lidera não esperou: a descida foi cancelada.'
             : (st.par.nome + ' saiu da descida — vocês voltaram ao Acampamento.');
      if (tela() === 'battle') {
        st.descidaAcabou = true;
        aviso(st.par.nome + ' saiu da descida — ela acaba no fim desta sala.');
        muda();
      } else if (descidaAtual() !== 'praca' || descidaG) {
        aviso(tx);
        st.descidaAcabou = false;
        sobe(d.motivo || 'parceiro');
        muda();
      }
    } else if (a === 'volta') {
      if (!Grupo.emGrupo() || d.gid !== st.gid || de !== st.par.id) {
        // grupo que já não existe aqui: o outro lado se desfaz também (a prova
        // dele volta junto, e a resposta sai uma vez por minuto)
        if (d.gid && d.prova && umaVez(de, d.gid)) {
          manda('grupo', de, 'sair', { gid: d.gid, motivo: 'expirou', prova: String(d.prova).slice(0, 64) }, ev.cx);
        }
        return;
      }
      // a prova da chave presa ao cx NOVO (o carimbado pelo relé): quem ouviu
      // a volta de outro não tem prova para o próprio cx
      if (!d.prova || d.prova !== provaDe(st.chave, ev.cx)) return;
      var voltou = !st.par.on;
      st.par.cx = ev.cx || st.par.cx;
      st.par.on = true;
      st.par.sumidoDesde = null;
      st.par.saiu = false;
      vigia(de, st.par.cx);
      safe(function () { C().parceiroVoltou(de, st.par.cx); return true; }, false);
      if (Grupo.souLider()) mandaEstado();
      if (voltou) aviso(st.par.nome + ' voltou.', 'good');
      muda();
    }
  }

  /* o par (ou quem convidou) sumiu: a voz `caiu` do relé, o `saiu` da Rede ou
   * o `ausente` de um envelope que não achou ninguém. No grupo começa a
   * carência; o Coop decide a batalha. */
  function sinalSumiu(id, cx, fonte) {
    if (!id) return;
    var t0 = agora();
    var soPendente = fonte === 'saiu' && viaRele();       // pelo relé, o par e o oponente caem pelo `caiu`
    var p = st.pendente;
    if (p && p.id === id && !(cx && p.cx && cx !== p.cx)) {
      st.pendente = null;
      if (st.fase !== 'formado') st.fase = 'livre';
      aviso(p.meu ? nomeDe(id) + ' não está mais conectado(a) — o convite caiu.'
                  : 'O convite de ' + nomeDe(id) + ' caiu: a conexão fechou.');
      muda();
    }
    if (Grupo.emGrupo() && st.par.id === id && !(soPendente && st.par.cx) &&
        !(cx && st.par.cx && cx !== st.par.cx) && st.par.on) {
      st.par.on = false;
      st.par.sumidoDesde = t0;
      safe(function () { C().parceiroSumiu(id, t0); return true; }, false);
      // na batalha quem avisa é o Coop (a mesma frase): aqui só fora dela
      if (tela() !== 'battle') aviso(st.par.nome + ' caiu — esperando voltar (' + Math.round(graca() / 1000) + ' s)…');
      muda();
    }
    sinalSumiuDuelo(id, cx, t0, soPendente);
  }
  function aoAusente(ev) {
    if (!ev || !ev.para) return;
    var tipo = ev.tipoMsg;
    if (tipo === 'sussurro') { falhouSussurro(ev.para); return; }
    if (tipo === 'grupo' || tipo === 'vigia' || tipo === 'batalha') sinalSumiu(ev.para, ev.paraCx || null, 'ausente');
    else if (tipo === 'duelo') sinalSumiuDuelo(ev.para, ev.paraCx || null, agora());
  }
  /* a MINHA conexão voltou com cx novo: o par precisa saber (a chave prova) */
  function aoReligou() {
    if (Grupo.emGrupo()) {
      st.aguardaEstado = true;
      vigia(st.par.id, st.par.cx);
      st.voltaProva = provaDe(st.chave, meuCx());
      manda('grupo', st.par.id, 'volta', { gid: st.gid, prova: st.voltaProva });
      if (Grupo.souLider()) mandaEstado(true);
    }
    if (dst.fase !== 'livre' && dst.op) {
      vigia(dst.op.id, dst.op.cx);
      manda('duelo', dst.op.id, 'volta', { did: dst.did, prova: provaDe(dst.chave, meuCx()) });
    }
  }

  Grupo._tique = function () {
    liga();
    var t = agora();
    var p = st.pendente;
    if (p && t > p.expira) {
      st.pendente = null;
      if (st.fase !== 'formado') st.fase = 'livre';
      aviso(p.meu ? 'O convite expirou.' : 'O convite de ' + nomeDe(p.id) + ' expirou.');
      muda();
    }
    if (st.descer && t > st.descer.expira) {
      st.descer = null;
      aviso((st.par ? st.par.nome : 'O outro lado') + ' não respondeu.');
      muda();
    }
    if (Grupo.emGrupo() && !st.par.on && st.par.sumidoDesde && !st.dissolver &&
        t - st.par.sumidoDesde >= graca()) {
      var nome = st.par.nome;
      if (tela() === 'battle') {
        // D21: quem ficou lidera (a autoridade da batalha é do Coop)
        if (st.lider !== eu()) { st.lider = eu(); st.v++; muda(); }
      } else {
        var naDescida = descidaAtual() !== 'praca' || !!descidaG;
        desfaz(naDescida ? nome + ' não voltou — a descida acabou.' : nome + ' saiu — o grupo se desfez.');
      }
    }
    if (st.dissolver && tela() !== 'battle') {
      st.dissolver = null;
      desfaz(null, null, true);
    }
    if (descidaG) {
      var tl = tela();
      if (tl === 'hub' || tl === 'menu' || tl === 'heroSelect') { descidaG = null; muda(); }
    }
    tiqueDuelo(agoraD());
  };

  Grupo._reset = function () {
    zera();
    respondi = {};
    descidaG = null;
    ultimoPar = null;
    assinaturaCoop = '';
    marcado = { id: null, papel: null };
  };
  Grupo._chaveAtual = function () { return st.chave; };
  Grupo._st = function () { return st; };

  // ==========================================================================
  // O DUELO PELA REDE
  // ==========================================================================
  var dst = null;
  var ultimoOp = null;
  function zeraDuelo() {
    if (dst && dst.op) ultimoOp = { id: dst.op.id, nome: dst.op.nome };
    dst = { fase: 'livre', did: null, eu: null, op: null, chave: null, prazo: 0,
            minha: null,     // { str, sal, h, n, ids }
            dele: null,      // { h, n, str, sal, dupla }
            revelei: false, ata: null, inicio: 0, viuBatalha: false, fimDele: null };
  }
  zeraDuelo();
  ultimoOp = null;

  function mudaD() {
    if (Duelo.aoMudar) { try { Duelo.aoMudar(Duelo.estado()); } catch (e) {} }
  }
  function doOp(ev, d) {
    return !!(dst.op && ev.de === dst.op.id && d && d.did === dst.did &&
              (dst.op.cx == null || ev.cx === dst.op.cx));
  }
  /* os meus heróis que podem duelar: todos, menos o Mestre do Fundo */
  function heroisDeDuelo() {
    var ids = safe(function () { return JOGO.Progress.heroIds(); }, []) || [];
    return ids.filter(function (hid) { return temHeroi(hid) && !ehMestre(hid); });
  }
  Duelo.herois = heroisDeDuelo;

  Duelo.estado = function () {
    return {
      did: dst.did, fase: dst.fase, eu: dst.eu, prazo: dst.prazo,
      oponente: dst.op ? { id: dst.op.id, cx: dst.op.cx, nome: dst.op.nome } : null,
      escolhi: !!dst.minha, minhaDupla: dst.minha ? dst.minha.ids.slice() : null,
      eleEscolheu: !!(dst.dele && dst.dele.h), n: dst.minha ? dst.minha.n : 0,
      arena: dst.ata ? { dungeonId: dst.ata.dungeonId, roomIndex: dst.ata.roomIndex,
                         nome: nomeArena(dst.ata) } : null
    };
  };
  Duelo.ultimo = function () { return ultimoOp ? { id: ultimoOp.id, nome: ultimoOp.nome } : null; };
  Duelo.fimDele = function () { return dst.fimDele; };

  Duelo.desafiar = function (id) {
    if (!id || id === eu()) return { ok: false, motivo: 'ocupado' };
    if (dst.fase !== 'livre' || st.fase === 'convidei' || st.fase === 'convidado') return { ok: false, motivo: 'ocupado' };
    if (trocaAberta()) return { ok: false, motivo: 'troca' };
    if (tela() !== 'hub' || minhaSala() || descidaG) return { ok: false, motivo: 'em-batalha' };
    if (!heroisDeDuelo().length) return { ok: false, motivo: 'sem-heroi' };
    var did = eu() + '-' + aleat(6), chave = aleat(8);
    if (!manda('duelo', id, 'desafio', { did: did, versao: versao(), chave: chave })) {
      return { ok: false, motivo: ultimaRecusa };
    }
    dst.fase = 'desafiei'; dst.did = did; dst.eu = 'A'; dst.chave = chave;
    dst.op = { id: id, cx: null, nome: nomeDe(id) };
    dst.prazo = agoraD() + Duelo.PRAZO_MS;
    mudaD();
    return { ok: true };
  };

  Duelo.responder = function (sim) {
    if (dst.fase !== 'desafiado') return { ok: false, motivo: 'expirou' };
    var op = dst.op, did = dst.did;
    if (agoraD() > dst.prazo) { zeraDuelo(); mudaD(); return { ok: false, motivo: 'expirou' }; }
    if (!sim) {
      manda('duelo', op.id, 'resposta', { did: did, ok: false, motivo: 'recusou' }, op.cx);
      zeraDuelo(); mudaD();
      return { ok: true };
    }
    dst.fase = 'livre';                     // o "ocupado" não pode contar o próprio desafio
    var mot = motivoOcupado(false);
    if (mot) {
      manda('duelo', op.id, 'resposta', { did: did, ok: false, motivo: mot }, op.cx);
      zeraDuelo(); mudaD();
      return { ok: false, motivo: mot };
    }
    var kb = aleat(8);                      // a minha metade da chave do duelo: só à conexão de quem desafiou
    if (!manda('duelo', op.id, 'resposta', { did: did, ok: true, kb: kb }, op.cx)) {
      zeraDuelo(); mudaD();
      return { ok: false, motivo: ultimaRecusa };
    }
    dst.chave = String(dst.chave || '') + ':' + kb;
    dst.fase = 'escolhendo';
    dst.prazo = agoraD() + Duelo.ESCOLHA_MS;
    vigia(op.id, op.cx);
    mudaD();
    return { ok: true };
  };

  /* O payload de cada herói escolhido (o do Coop, com o `dono`); a dupla viaja
   * como STRING — quem recebe calcula o hash sobre a string recebida e só então
   * faz o JSON.parse, então a ordem das chaves nunca muda o hash. */
  function payloadDe(hid) {
    if (!temHeroi(hid) || ehMestre(hid)) return null;
    var c = C();
    if (c && typeof c.payloadMeu === 'function') return safe(function () { return c.payloadMeu(hid); }, null) || null;
    var pl = safe(function () { return JOGO.Progress.battleParty([hid])[0]; }, null);
    if (!pl || typeof pl !== 'object') return null;
    pl = JSON.parse(JSON.stringify(pl));
    pl.dono = eu();
    return pl;
  }
  Duelo.escolher = function (heroIds) {
    if (dst.fase !== 'escolhendo') return { ok: false, motivo: 'ocupado' };
    var ids = [];
    (heroIds || []).forEach(function (h) { if (h && ids.indexOf(h) < 0) ids.push(h); });
    if (ids.length < 1 || ids.length > 2) return { ok: false, motivo: 'n' };
    var pls = [];
    for (var i = 0; i < ids.length; i++) {
      var pl = payloadDe(ids[i]);
      if (!pl) return { ok: false, motivo: ehMestre(ids[i]) ? 'mestre' : 'sem-heroi' };
      pls.push(pl);
    }
    var str = JSON.stringify(pls);
    var sal = hex(32);
    var h = sha256(str + '|' + sal);
    if (!manda('duelo', dst.op.id, 'compromisso', { did: dst.did, h: h, n: ids.length }, dst.op.cx)) {
      return { ok: false, motivo: ultimaRecusa };
    }
    dst.minha = { str: str, sal: sal, h: h, n: ids.length, ids: ids };
    dst.fase = 'comprometido';
    if (dst.dele && dst.dele.h) revela();
    mudaD();
    return { ok: true };
  };

  /* cancela antes da luta. Na fase 'batalha' só enquanto a arena ainda não
   * abriu (o Coop chama quando o "dentro" dos dois não vem); depois de aberta,
   * sair é desistir (Coop.desistir), que conta como derrota. */
  Duelo.cancelar = function (motivo) {
    if (dst.fase === 'livre' || (dst.fase === 'batalha' && dst.viuBatalha)) return false;
    if (dst.op) manda('duelo', dst.op.id, 'cancela', { did: dst.did, motivo: motivo || 'desistiu' }, dst.op.cx);
    zeraDuelo();
    mudaD();
    return true;
  };
  function cancelaD(motivo, avisaOutro) {
    var nome = dst.op ? dst.op.nome : null;
    if (avisaOutro && dst.op) manda('duelo', dst.op.id, 'cancela', { did: dst.did, motivo: motivo }, dst.op.cx);
    zeraDuelo();
    aviso(motivo === 'expirou' ? 'O duelo foi cancelado: o tempo de escolher a dupla acabou.'
                               : Grupo.textoMotivo(motivo, nome));
    mudaD();
  }

  function revela() {
    if (dst.revelei || !dst.minha) return;
    dst.revelei = true;
    manda('duelo', dst.op.id, 'revela', { did: dst.did, dupla: dst.minha.str, sal: dst.minha.sal }, dst.op.cx);
    dst.fase = 'revelado';
    dst.prazo = agoraD() + Duelo.PRAZO_MS;
    confereFim();
  }
  function nivelTeto() {
    var t = safe(function () { return D().leveling.maxLevel; }, null);
    return (typeof t === 'number' && t > 0) ? t : 30;
  }
  /* a dupla revelada: lista de 1 ou 2 payloads, nenhum do Mestre, nível no
   * teto, classe e feitiços que o MEU jogo conhece (senão é versão diferente) */
  function validaDupla(dupla, n) {
    if (!Array.isArray(dupla) || dupla.length !== n || (n !== 1 && n !== 2)) return 'trapaca';
    var teto = nivelTeto();
    var classes = D().classes || {};
    for (var i = 0; i < dupla.length; i++) {
      var p = dupla[i];
      if (!p || typeof p !== 'object') return 'trapaca';
      if (p.classId === 'gm' || p.heroId === 'gm') return 'trapaca';
      // o nível é um inteiro de verdade, no teto: o '99' em texto passava
      if (typeof p.level !== 'number' || p.level !== Math.floor(p.level) || p.level < 1 || p.level > teto) return 'trapaca';
      if (p.classId && !classes[p.classId]) return 'versao';
      var sp = Array.isArray(p.spells) ? p.spells : [];
      for (var k = 0; k < sp.length; k++) {
        var sid = (sp[k] && typeof sp[k] === 'object') ? sp[k].id : sp[k];
        if (/^gm-/.test(String(sid))) return 'trapaca';
        var E = JOGO.Engine;
        if (E && typeof E.spell === 'function' && !safe(function () { return E.spell(sid); }, null)) return 'versao';
      }
    }
    return null;
  }
  function nomeArena(ar) {
    var d = ar ? acharDungeon(ar.dungeonId) : null;
    return ((d && d.name) || (ar && ar.dungeonId) || 'Arena') + ' — sala ' + ((ar && ar.roomIndex || 0) + 1);
  }
  /* O mesmo sorteio do Coop (seção 3.11), para quando ele não estiver na
   * página: os calabouços abertos, em ordem alfabética. */
  function sorteiaArenaLocal(s) {
    var ds = D().dungeons || [];
    var lista = Array.isArray(ds) ? ds : Object.keys(ds).map(function (k) { return ds[k]; });
    var abertos = lista.filter(function (d) {
      return d && d.id && d.id !== 'poco' && d.rooms && d.rooms.length &&
             !safe(function () { return D().portalFechado(d.id); }, false);
    }).map(function (d) { return d.id; }).sort();
    if (!abertos.length) return null;
    var dg = abertos[s % abertos.length];
    var def = acharDungeon(dg);
    return { dungeonId: dg, roomIndex: (s >>> 8) % def.rooms.length };
  }
  Duelo._arena = sorteiaArenaLocal;

  function confereFim() {
    if (!dst.revelei || !dst.dele || !dst.dele.dupla || dst.fase === 'batalha') return;
    var salA = dst.eu === 'A' ? dst.minha.sal : dst.dele.sal;
    var salB = dst.eu === 'A' ? dst.dele.sal : dst.minha.sal;
    var s = Duelo._semente(dst.did, salA, salB);
    var c = C();
    var arena = (c && typeof c.sorteiaArena === 'function') ? safe(function () { return c.sorteiaArena(s); }, null) : null;
    if (!arena) arena = sorteiaArenaLocal(s);
    if (!arena) { cancelaD('versao', true); return; }
    var minha = JSON.parse(dst.minha.str);
    var ata = { did: dst.did, semente: s, dungeonId: arena.dungeonId, roomIndex: arena.roomIndex,
                duplaA: dst.eu === 'A' ? minha : dst.dele.dupla,
                duplaB: dst.eu === 'A' ? dst.dele.dupla : minha,
                eu: dst.eu, oponente: { id: dst.op.id, cx: dst.op.cx, nome: dst.op.nome } };
    dst.ata = ata;
    dst.fase = 'batalha';
    dst.prazo = 0;
    dst.inicio = agoraD();
    dst.viuBatalha = false;
    aviso('Arena sorteada: ' + nomeArena(ata) + '.', 'good');
    var ok = !!(c && typeof c.iniciaDuelo === 'function') && safe(function () { return c.iniciaDuelo(ata); }, false);
    if (!ok) { cancelaD('rele-antigo', true); return; }
    mudaD();
  }

  function aoDuelo(ev) {
    if (!ev || !ev.de || ev.de === eu()) return;
    var d = ev.dados || {};
    var de = ev.de, a = ev.acao;
    if (a === 'desafio') {
      if (!d.did || dst.did === d.did) return;
      var mot = mutado(de) ? 'ocupado' : (String(d.versao || '') !== versao() ? 'versao' : motivoOcupado(false));
      if (mot) {
        manda('duelo', de, 'resposta', { did: String(d.did).slice(0, 48), ok: false, motivo: mot }, ev.cx);
        return;
      }
      dst.fase = 'desafiado'; dst.did = String(d.did).slice(0, 48); dst.eu = 'B';
      dst.chave = String(d.chave || '').slice(0, 24);
      dst.op = { id: de, cx: ev.cx || null, nome: nomeDe(de) };
      dst.prazo = agoraD() + Duelo.PRAZO_MS;
      if (Duelo.aoDesafio) {
        try { Duelo.aoDesafio({ id: de, nome: dst.op.nome, expira: dst.prazo, did: dst.did }); } catch (e) {}
      }
      mudaD();
    } else if (a === 'resposta') {
      if (dst.fase !== 'desafiei' || d.did !== dst.did || !dst.op || de !== dst.op.id) return;
      if (d.ok !== true) {
        var n = dst.op.nome;
        zeraDuelo();
        aviso(d.motivo === 'recusou' || !d.motivo ? n + ' recusou o duelo.' : Grupo.textoMotivo(d.motivo, n));
        mudaD();
        return;
      }
      dst.op.cx = ev.cx || null;
      dst.chave = String(dst.chave || '') + ':' + String(d.kb || '').slice(0, 24);
      dst.fase = 'escolhendo';
      dst.prazo = agoraD() + Duelo.ESCOLHA_MS;
      vigia(de, dst.op.cx);
      aviso(dst.op.nome + ' aceitou o duelo! Escolha a sua dupla.', 'good');
      mudaD();
    } else if (a === 'compromisso') {
      if (!doOp(ev, d) || (dst.fase !== 'escolhendo' && dst.fase !== 'comprometido')) return;
      if (dst.dele && dst.dele.h) return;                        // um compromisso só
      var h = String(d.h || ''), nn = Math.floor(Number(d.n) || 0);
      if (!/^[0-9a-f]{64}$/.test(h) || (nn !== 1 && nn !== 2)) { cancelaD('trapaca', true); return; }
      dst.dele = { h: h, n: nn };
      if (dst.minha) revela();
      mudaD();
    } else if (a === 'revela') {
      if (!doOp(ev, d)) return;
      // antes dos DOIS compromissos a revelação não vale nada
      if (!dst.minha || !dst.dele || !dst.dele.h || dst.dele.str) return;
      var str = (typeof d.dupla === 'string') ? d.dupla : null;
      var sal = String(d.sal || '');
      if (!str || str.length > 60000 || !/^[0-9a-f]{32}$/.test(sal) || sha256(str + '|' + sal) !== dst.dele.h) {
        cancelaD('trapaca', true);
        return;
      }
      var dupla = null;
      try { dupla = JSON.parse(str); } catch (e) { dupla = null; }
      var mot3 = validaDupla(dupla, dst.dele.n);
      if (mot3) { cancelaD(mot3, true); return; }
      dst.dele.str = str; dst.dele.sal = sal; dst.dele.dupla = dupla;
      confereFim();
      mudaD();
    } else if (a === 'cancela') {
      if (!dst.op || de !== dst.op.id || d.did !== dst.did || (dst.fase === 'batalha' && dst.viuBatalha)) return;
      if (dst.op.cx && ev.cx !== dst.op.cx) return;          // achado 18: só pela conexão do oponente (a `volta` troca o cx)
      var nome = dst.op.nome, m4 = String(d.motivo || 'desistiu');
      zeraDuelo();
      aviso(m4 === 'expirou' ? 'O duelo foi cancelado: o tempo de escolher a dupla acabou.'
          : m4 === 'trapaca' ? 'O duelo foi cancelado pelo outro lado: as duplas não bateram.'
          : m4 === 'versao' ? Grupo.textoMotivo('versao', nome)
          : m4 === 'retirou' ? 'O desafio de ' + nome + ' foi retirado.'
          : nome + ' desistiu do duelo.');
      mudaD();
    } else if (a === 'fim') {
      if (!dst.op || de !== dst.op.id || d.did !== (dst.ata ? dst.ata.did : dst.did)) return;
      if (dst.op.cx && ev.cx !== dst.op.cx) return;          // achado 18: idem
      dst.fimDele = { venc: d.venc, h: d.h };
    } else if (a === 'volta') {
      if (!dst.op || de !== dst.op.id || d.did !== dst.did || !d.prova || d.prova !== provaDe(dst.chave, ev.cx)) return;
      dst.op.cx = ev.cx || dst.op.cx;
      vigia(de, dst.op.cx);
      if (dst.fase === 'batalha') safe(function () { C().parceiroVoltou(de, dst.op.cx); return true; }, false);
      mudaD();
    }
  }
  function sinalSumiuDuelo(id, cx, t0, soPendente) {
    if (dst.fase === 'livre' || !dst.op || dst.op.id !== id) return;
    if (cx && dst.op.cx && cx !== dst.op.cx) return;
    if (soPendente && dst.op.cx) return;                  // pelo relé, o oponente vigiado cai pelo `caiu`
    if (dst.fase === 'batalha') {
      safe(function () { C().parceiroSumiu(id, t0 || agoraD()); return true; }, false);
      return;
    }
    var n = dst.op.nome;
    zeraDuelo();
    aviso(n + ' saiu — o duelo foi cancelado.');
    mudaD();
  }
  function tiqueDuelo(t) {
    var f = dst.fase;
    if (f === 'desafiei' || f === 'desafiado') {
      if (t > dst.prazo) {
        var n = dst.op ? dst.op.nome : '';
        var meu = f === 'desafiei';
        if (!meu && dst.op) manda('duelo', dst.op.id, 'resposta', { did: dst.did, ok: false, motivo: 'expirou' }, dst.op.cx);
        zeraDuelo();
        aviso(meu ? 'O desafio expirou.' : 'O desafio de ' + n + ' expirou.');
        mudaD();
      }
    } else if (f === 'escolhendo' || f === 'comprometido' || f === 'revelado') {
      if (t > dst.prazo) cancelaD('expirou', true);
    } else if (f === 'batalha') {
      var tl = tela();
      if (tl === 'battle') dst.viuBatalha = true;
      else if (dst.viuBatalha || t - dst.inicio > Duelo.INICIO_MS) { zeraDuelo(); mudaD(); }
    }
  }

  /* SHA-256 em JS puro e síncrono (o crypto.subtle é assíncrono e falta fora
   * de contexto seguro). Entrada em UTF-8, saída em hex minúsculo. */
  var K256 = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];
  function utf8(s) {
    s = String(s == null ? '' : s);
    try { return unescape(encodeURIComponent(s)); } catch (e) { return s; }
  }
  function sha256(msg) {
    var s = utf8(msg);
    var l = s.length, i;
    var nW = (((l + 8) >> 6) + 1) * 16;
    var w = new Array(nW);
    for (i = 0; i < nW; i++) w[i] = 0;
    for (i = 0; i < l; i++) w[i >> 2] |= (s.charCodeAt(i) & 0xff) << (24 - (i % 4) * 8);
    w[l >> 2] |= 0x80 << (24 - (l % 4) * 8);
    var bits = l * 8;
    w[nW - 1] = bits >>> 0;
    w[nW - 2] = Math.floor(bits / 0x100000000) >>> 0;
    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var W = new Array(64);
    for (var j = 0; j < nW; j += 16) {
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (var t = 0; t < 64; t++) {
        if (t < 16) W[t] = w[j + t] | 0;
        else {
          var x = W[t - 15], y = W[t - 2];
          var s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
          var s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
          W[t] = (W[t - 16] + s0 + W[t - 7] + s1) | 0;
        }
        var S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        var ch = (e & f) ^ (~e & g);
        var t1 = (h + S1 + ch + K256[t] + W[t]) | 0;
        var S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        var mj = (a & b) ^ (a & c) ^ (b & c);
        var t2 = (S0 + mj) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    var out = '';
    for (i = 0; i < 8; i++) out += ('00000000' + (H[i] >>> 0).toString(16)).slice(-8);
    return out;
  }
  /* a semente do duelo: FNV-1a de 32 bits sobre did|salA|salB — os sais estão
   * presos nos compromissos, então ninguém escolhe a arena sozinho */
  function fnv(s) {
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }
  Duelo._sha256 = sha256;
  Duelo._semente = function (did, salA, salB) { return fnv(String(did) + '|' + String(salA) + '|' + String(salB)); };
  Duelo._reset = function () { zeraDuelo(); ultimoOp = null; };
  Duelo._st = function () { return dst; };

  // ==========================================================================
  // A MENSAGEM PARTICULAR
  // ==========================================================================
  var linhas = [];
  /* 11/09 (achado 21): a CONVERSA fica. A lista guarda LISTA_MAX linhas, e uma
   * enxurrada de ids novos (uma conexão nova a cada envio) empurrava para fora
   * a mensagem de verdade. Agora sai primeiro a linha mais velha de quem NÃO
   * conversa comigo; a conversa (as minhas linhas, quem eu já respondi, o par
   * do grupo e o oponente do duelo) só sai quando só sobra ela. */
  var conversas = {}, nConversas = 0;
  function lembraConversa(id) {
    if (!id || conversas[id]) return;
    if (nConversas >= 200) { conversas = {}; nConversas = 0; }
    conversas[id] = true;
    nConversas++;
  }
  function daConversa(l) {
    if (!l) return false;
    if (l.meu || conversas[l.de]) return true;
    if (st && st.par && l.de === st.par.id) return true;
    return !!(dst && dst.op && l.de === dst.op.id);
  }
  function poeLinha(l) {
    linhas.push(l);
    while (linhas.length > Sussurros.LISTA_MAX) {
      var k = 0;
      for (var i = 0; i < linhas.length; i++) if (!daConversa(linhas[i])) { k = i; break; }
      linhas.splice(k, 1);
    }
    if (Sussurros.aoChegar) { try { Sussurros.aoChegar(l); } catch (e) {} }
  }
  Sussurros.lista = function () { return linhas.map(function (l) { var c = {}; for (var k in l) if (l.hasOwnProperty(k)) c[k] = l[k]; return c; }); };
  Sussurros.pode = function () { return !!safe(function () { return R().privado(); }, false); };
  Sussurros.manda = function (id, texto) {
    var r = R();
    texto = String(texto == null ? '' : texto).trim().slice(0, Sussurros.TEXTO_MAX);
    if (!id || id === eu()) return { ok: false, motivo: 'sem-para' };
    if (!texto) return { ok: false, motivo: 'vazio' };
    if (!r || typeof r.privado !== 'function' || typeof r.sussurrar !== 'function' || !safe(function () { return r.privado(); }, false)) {
      return { ok: false, motivo: 'privado' };
    }
    // ao par e ao oponente, dirigido à CONEXÃO dele: outra conexão com o mesmo id não ouve
    var cxPara = (Grupo.emGrupo() && st.par.id === id && st.par.cx) ? st.par.cx
               : ((dst.op && dst.op.id === id && dst.op.cx) ? dst.op.cx : null);
    var ok = false;
    try { ok = !!r.sussurrar(id, texto, cxPara ? { cx: cxPara } : {}); } catch (e) { ok = false; }
    if (!ok) return { ok: false, motivo: safe(function () { return r.ultimaRecusa(); }, null) || 'privado' };
    lembraConversa(id);
    poeLinha({ de: eu(), para: id, nome: nomeDe(id), texto: texto, t: agora(), meu: true, falhou: false });
    return { ok: true };
  };
  function aoSussurro(ev) {
    if (!ev || !ev.de || ev.de === eu()) return;
    if (mutado(ev.de)) return;                         // silenciado: nem linha, nem aviso
    var texto = String(ev.texto || '').slice(0, Sussurros.TEXTO_MAX);
    var r = R();
    if (r && typeof r.filtra === 'function') texto = safe(function () { return r.filtra(texto); }, texto);
    if (!texto.trim()) return;
    poeLinha({ de: ev.de, para: eu(), nome: String(ev.nome || nomeDe(ev.de)).slice(0, 24), texto: texto,
               t: agora(), meu: false, falhou: false, mestre: ev.mestre === true });
  }
  function falhouSussurro(para) {
    for (var i = linhas.length - 1; i >= 0; i--) {
      if (linhas[i].meu && linhas[i].para === para && !linhas[i].falhou) { linhas[i].falhou = true; break; }
    }
    var nome = nomeDe(para);
    poeLinha({ de: eu(), para: para, nome: nome, sistema: true, meu: true, falhou: true, t: agora(),
               texto: nome + ' não está mais conectado(a) — a mensagem não foi entregue.' });
  }
  Sussurros._reset = function () { linhas = []; conversas = {}; nConversas = 0; };

  // ==========================================================================
  // A LIGA COM A REDE (R.ouvir, vários ouvintes; sobrevivem a sair/entrar)
  // ==========================================================================
  var ligadoEm = null, desligas = [];
  function liga() {
    var r = R();
    if (!r || typeof r.ouvir !== 'function') return false;
    if (r === ligadoEm) return true;
    desligas.forEach(function (f) { try { f(); } catch (e) {} });
    desligas = [];
    ligadoEm = r;
    function ouve(tipo, fn) {
      var dl = null;
      try {
        dl = r.ouvir(tipo, function (ev) {
          try { fn(ev || {}); } catch (e) { if (typeof console !== 'undefined') console.warn('grupo.js:', tipo, e); }
        });
      } catch (e) {}
      if (typeof dl === 'function') desligas.push(dl);
    }
    ouve('grupo', aoGrupo);
    ouve('duelo', aoDuelo);
    ouve('sussurro', aoSussurro);
    ouve('caiu', function (ev) { sinalSumiu(ev.id, ev.cx || null, 'caiu'); });
    ouve('saiu', function (ev) { sinalSumiu(ev.id, ev.cx || null, 'saiu'); });
    ouve('batalha', revive);                     // na batalha o par só fala por lá: também prova que voltou
    ouve('ausente', aoAusente);
    ouve('religou', aoReligou);
    ouve('cx', function () { carregaMutados(); });
    return true;
  }
  Grupo._liga = function () { ligadoEm = null; return liga(); };
  // ganchos de prova: um evento da Rede entregue direto
  Grupo._ev = function (ev) {
    if (!ev) return;
    if (ev.tipo === 'grupo') aoGrupo(ev);
    else if (ev.tipo === 'duelo') aoDuelo(ev);
    else if (ev.tipo === 'sussurro') aoSussurro(ev);
    else if (ev.tipo === 'caiu') sinalSumiu(ev.id, ev.cx || null, 'caiu');
    else if (ev.tipo === 'saiu') sinalSumiu(ev.id, ev.cx || null, 'saiu');
    else if (ev.tipo === 'batalha') revive(ev);
    else if (ev.tipo === 'ausente') aoAusente(ev);
    else if (ev.tipo === 'religou') aoReligou(ev);
  };

  liga();
  carregaMutados();
  lerMeuNome();
  if (typeof setInterval === 'function') {
    setInterval(function () { try { Grupo._tique(); } catch (e) {} }, 1000);
  }
})();
