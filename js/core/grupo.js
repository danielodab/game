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
 *   JOGO.Arena      (14/09) a fila da Arena ranqueada — o cliente de servidor/arena.py
 *
 * 14/09: o duelo tem três MODOS (desafio amistoso na praça, a Arena da fila e o Campo de PvP, onde tocar
 * é atacar) — ver Duelo.MAPA_DESAFIO e os acessórios de "a Arena e o Campo de PvP".
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
  /* 14/09, AS TRÊS FORMAS DE DUELO (o dono: "tem duas formas de desafio: um normal, ou um pvp, ou a
   * inscrição na arena e espera um adversário"; "o duelo deve ocorrer no mapa da praça. Mapas aleatórios é
   * para pvp de inscrição na arena ou pvp comum no mapa pvp"). O `modo` viaja no desafio/ataque, na ata, no
   * Coop e no fechar do servidor:
   *   desafio  tocar no jogador na praça: amistoso, no mapa FIXO da praça (js/core/data/arenas.js)
   *   arena    a fila da Arena (JOGO.Arena, abaixo): os dois já casados pelo servidor, mapa sorteado
   *   campo    o Campo de PvP: tocar é atacar, o atacado entra sozinho, cada um com a dupla do Campo */
  Duelo.MAPA_DESAFIO = 'praca';
  Duelo.ATAQUE_MS = 15000;         // o ataque no Campo espera a resposta automática do outro lado
  Duelo.PARIDADE_CAMPO = 10;       // o dono: no Campo, até 10 níveis entre os heróis mais fortes
  Duelo.ARENA_REENVIO_MS = 3000;   // o lado A da Arena repete o chamado até o B responder
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
  // 13/09 (dono): o INIMIGO (JOGO.Amigos) não manda mensagem particular — o relé já
  // não entrega; isto larga o que um relé antigo deixasse passar
  function inimigo(id) {
    return !!safe(function () { return JOGO.Amigos && JOGO.Amigos.inimigoPorHeroi(id); }, false);
  }
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

  /* ---------------------------------------------------------- OS MEUS HEROIS
   * DOIS, NAO UM (12/09, pedido do dono: "quando forem para um calabouco podem
   * ir com os dois personagens selecionados... no caso 4 personagens no
   * maximo"). Ate aqui o grupo levava UM heroi de cada lado; agora leva os
   * selecionados de cada um, e a sala nasce com ate quatro.
   *
   * O FIO CONTINUA SENDO UM SO: as vozes do grupo passaram a carregar
   * `herois` (a lista), e o `heroi` de sempre segue indo como o PRINCIPAL --
   * e o que o convite mostra e o que a placa do parceiro na praca desenha.
   * Ninguem precisa de rede de compatibilidade: o convite ja reprova quem
   * esta em outra versao do jogo ("recarreguem a pagina"), e a versao muda a
   * cada deploy porque sai do hash dos arquivos servidos. */
  var meusHerois = [], meuNome = null;
  var MAX_HEROIS = 2;
  function principal() { return meusHerois.length ? meusHerois[0] : null; }
  function heroiResumo(hid) {
    if (!hid) return null;
    var h = safe(function () { return JOGO.Progress.hero(hid); }, null);
    if (!h) return { classId: hid, element: 'neutro', level: 1 };
    return { classId: h.classId || hid, element: h.element || 'neutro', level: h.level || 1 };
  }
  function heroisResumo(ids) {
    var out = [];
    (ids || []).forEach(function (hid) {
      var r = hid ? heroiResumo(hid) : null;
      if (r && out.length < MAX_HEROIS) out.push(r);
    });
    return out;
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
  /* a lista que chega do outro lado: ate dois, cada um limpo pela regua de
   * sempre; um objeto solto (o `heroi` do fio) tambem serve */
  function limpaHerois(v, umSo) {
    var bruta = (Object.prototype.toString.call(v) === '[object Array]') ? v : [];
    var out = [];
    for (var i = 0; i < bruta.length && out.length < MAX_HEROIS; i++) {
      var h = limpaHeroi(bruta[i]);
      if (h) out.push(h);
    }
    if (!out.length) { var u = limpaHeroi(umSo); if (u) out.push(u); }
    return out;
  }
  function ehMestre(hid) {
    if (!hid) return false;
    if (hid === 'gm') return true;
    return safe(function () { return JOGO.Progress.hero(hid).classId === 'gm'; }, false);
  }
  function temHeroi(hid) { return !!(hid && safe(function () { return JOGO.Progress.hero(hid); }, null)); }
  function temHerois() {
    if (!meusHerois.length) return false;
    for (var i = 0; i < meusHerois.length; i++) if (!temHeroi(meusHerois[i])) return false;
    return true;
  }
  /* o Mestre entra em grupo mas e ele quem chama: basta UM dos meus ser ele */
  function algumMestre() {
    for (var i = 0; i < meusHerois.length; i++) if (ehMestre(meusHerois[i])) return true;
    return false;
  }
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
      if (!temHerois()) return 'sem-heroi';
      if (algumMestre()) return 'so-mestre-chama';   // 11/09: o Mestre entra em grupo, mas é ele quem chama
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
    if (!temHerois()) return 'sem-heroi';
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
    'desistiu': '{n} desistiu do duelo.',
    // 14/09: o Campo de PvP e a Arena
    'fora-do-campo': '{n} não está mais no Campo de PvP.',
    'alvo-fora': '{n} não está no Campo de PvP.',
    'alvo-luta': '{n} já está numa luta.',
    'vida-zero-alvo': '{n} está sem vida agora — espere recuperar.',
    'paridade': 'A diferença de nível entre vocês passa de 10: no Campo não dá.'
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
    'n': 'Escolha um ou dois heróis.',
    // 14/09 (o dono): "pede para ele selecionar os dois que ele quer ir para a batalha"
    'dois': 'Escolha os dois heróis que vão lutar.',
    'fora-do-campo': 'Isso é só dentro do Campo de PvP.',
    'paridade': 'A diferença de nível passa de 10: no Campo não dá.',
    'arena': 'A Arena não aceitou agora.',
    // 14/09: a vida única — herói a 0 PV não entra em duelo até recuperar (ou beber uma poção)
    'vida-zero': 'Esse herói está sem vida: espere ele recuperar ou beba uma poção.',
    'servidor': 'O servidor não respondeu — tente de novo em instantes.'
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
           par: null,               // { id, cx, nome, heroi, herois[], on, sumidoDesde, saiu }
           pendente: null,          // { tipo:'convite', id, gid, chave, cx, heroi, herois[], expira, meu }
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
    return { id: st.par.id, cx: st.par.cx, nome: st.par.nome, heroi: st.par.heroi,
             herois: (st.par.herois || []).slice() };
  };
  Grupo.estado = function () {
    var e = eu();
    var membros = [];
    if (Grupo.emGrupo()) {
      var meus = heroisResumo(meusHerois);
      var mim = { id: e, cx: meuCx(), nome: meuNome || 'Você', heroi: meus[0] || null, herois: meus,
                  on: true, sumidoDesde: null, eu: true };
      var ele = { id: st.par.id, cx: st.par.cx, nome: st.par.nome,
                  heroi: st.par.heroi, herois: (st.par.herois || []).slice(),
                  on: st.par.on, sumidoDesde: st.par.sumidoDesde, saiu: !!st.par.saiu, eu: false };
      if (st.lider === e) membros.push(mim, ele); else membros.push(ele, mim);
    }
    var p = st.pendente;
    return {
      gid: st.gid, v: st.v, lider: Grupo.emGrupo() ? st.lider : null, eu: e, fase: st.fase,
      membros: membros,
      pendente: p ? { tipo: 'convite', id: p.id, gid: p.gid, expira: p.expira, meu: !!p.meu,
                      nome: nomeDe(p.id), heroi: p.heroi || null,
                      herois: (p.herois || []).slice() } : null,
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
               parceiro: { id: st.par.id, cx: st.par.cx, heroi: st.par.heroi,
                           herois: (st.par.herois || []).slice(), nome: st.par.nome } };
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
      membros: [{ id: eu(), cx: meuCx(), heroi: heroiResumo(principal()),
                  herois: heroisResumo(meusHerois) },
                { id: st.par.id, cx: st.par.cx, heroi: st.par.heroi,
                  herois: (st.par.herois || []).slice() }]
    }, semCx ? null : st.par.cx);
  }
  // envelope do par já pareado: o id e o cx carimbado batem
  function doPar(ev) {
    return !!(st.par && ev.de === st.par.id && (st.par.cx == null || ev.cx === st.par.cx));
  }

  /* desfaz o grupo. Se o PAR saiu no meio da batalha, a sala continua (os
   * heróis dele CAEM, no Coop — 12/09) e o grupo só se desfaz quando ela acabar. */
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
    // 12/09: a descida em grupo leva os MEUS selecionados (ate dois)
    var ok = safe(function () { return G().startRun(meusHerois.slice(), dg, { grupo: true }); }, false);
    if (!ok) {
      descidaG = null;
      aviso('Não deu para começar a descida.');
      if (Grupo.emGrupo()) manda('grupo', st.par.id, 'subir', { gid: st.gid, motivo: 'falhou' }, st.par.cx);
    }
    muda();
    return ok;
  }

  // ---- a superfície
  Grupo.defineHerois = function (ids) {
    var lista = [];
    (Object.prototype.toString.call(ids) === '[object Array]' ? ids : [ids]).forEach(function (h) {
      if (typeof h === 'string' && h && lista.indexOf(h) < 0 && lista.length < MAX_HEROIS) lista.push(h);
    });
    var antes = JSON.stringify(heroisResumo(meusHerois));
    meusHerois = lista;
    lerMeuNome();
    var depois = JSON.stringify(heroisResumo(meusHerois));
    if (antes === depois || !Grupo.emGrupo()) return;
    manda('grupo', st.par.id, 'heroi',
          { gid: st.gid, heroi: heroiResumo(principal()), herois: heroisResumo(meusHerois) }, st.par.cx);
    muda();
  };
  // o de sempre, com um so: quem chama com um id continua funcionando
  Grupo.defineHeroi = function (heroId) { return Grupo.defineHerois(heroId ? [heroId] : []); };
  Grupo.meuHeroi = function () { return principal(); };
  Grupo.meusHerois = function () { return meusHerois.slice(); };

  Grupo.convidar = function (id) {
    if (!id || id === eu()) return { ok: false, motivo: 'ocupado' };
    if (st.fase === 'formado') return { ok: false, motivo: 'em-grupo' };
    if (st.fase !== 'livre' || dst.fase !== 'livre') return { ok: false, motivo: 'ocupado' };
    if (trocaAberta()) return { ok: false, motivo: 'troca' };
    if (tela() !== 'hub' || minhaSala()) return { ok: false, motivo: 'em-batalha' };
    if (!temHerois()) return { ok: false, motivo: 'sem-heroi' };
    // 11/09 (pedido do dono): o Mestre chama para o grupo; chamar o Mestre
    // conferido nem sai daqui — só ele pede grupo
    if (mestreConferido(id) && !algumMestre()) return { ok: false, motivo: 'so-mestre-chama' };
    var gid = eu() + '-' + aleat(4), chave = aleat(8);
    if (!manda('grupo', id, 'convite', { gid: gid, chave: chave, heroi: heroiResumo(principal()),
                                          herois: heroisResumo(meusHerois), versao: versao() })) {
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
    if (!manda('grupo', p.id, 'resposta', { gid: p.gid, ok: true, heroi: heroiResumo(principal()),
                                            herois: heroisResumo(meusHerois), kb: kb }, p.cx)) {
      muda();
      return { ok: false, motivo: ultimaRecusa };
    }
    st.fase = 'formado';
    st.gid = p.gid; st.chave = p.chave + ':' + kb; st.v = 0; st.lider = p.id;
    st.par = { id: p.id, cx: p.cx || null, nome: nomeDe(p.id), heroi: p.heroi,
               herois: (p.herois || []).slice(), on: true, sumidoDesde: null };
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
      // 11/09: convite com o herói do Mestre só do Mestre que o relé conferiu —
      // 12/09: conferido na LISTA inteira, não só no principal
      var hsC = limpaHerois(d.herois, d.heroi);
      var temGm = hsC.some(function (h) { return h.classId === 'gm'; }) ||
                  !!(d.heroi && String(d.heroi.classId || '') === 'gm');
      if (!mot && temGm && !mestreConferido(de)) mot = 'mestre-falso';
      if (mot) {
        manda('grupo', de, 'resposta', { gid: String(d.gid).slice(0, 48), ok: false, motivo: mot }, ev.cx);
        return;
      }
      st.fase = 'convidado';
      st.pendente = { tipo: 'convite', id: de, gid: String(d.gid).slice(0, 48), chave: String(d.chave).slice(0, 24),
                      cx: ev.cx || null, heroi: hsC[0] || null, herois: hsC,
                      expira: agora() + Grupo.PRAZO_MS, meu: false };
      if (Grupo.aoConvite) {
        try {
          Grupo.aoConvite({ id: de, nome: nomeDe(de), heroi: st.pendente.heroi,
                            herois: st.pendente.herois.slice(),
                            expira: st.pendente.expira, gid: st.pendente.gid });
        } catch (e) {}
      }
      muda();
    } else if (a === 'guerra') {
      // 15/09: quem lidera inscreveu o grupo na guerra de guilda — consulto já (a vez de pôr a minha dupla)
      if (doPar(ev)) Guerra.consulta();
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
      var hsR = limpaHerois(d.herois, d.heroi);
      st.par = { id: de, cx: ev.cx || null, nome: nomeDe(de), heroi: hsR[0] || null, herois: hsR,
                 on: true, sumidoDesde: null };
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
        if (m && m.id === de) {
          var hh = limpaHerois(m.herois, m.heroi);
          if (hh.length) { st.par.herois = hh; st.par.heroi = hh[0]; }
        }
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
      var h2 = limpaHerois(d.herois, d.heroi);
      if (h2.length) { st.par.herois = h2; st.par.heroi = h2[0]; }
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
      /* QUEM CAIU NAO PERDE A DESCIDA (12/09, pedido do dono: "caso ele cair
       * do jogo/internet deve continuar na luta se ela nao tiver acabado, ou
       * nascer na proxima sala caso tenha acabado"). Antes o grupo se desfazia
       * assim que a SALA acabava com ele fora ("nao voltou — a descida
       * acabou"), e a descida morria na tela de recompensa. Agora, em qualquer
       * ponto da descida (batalha, antessala, recompensa), quem ficou apenas
       * LIDERA: a sala seguinte nasce com os herois de quem caiu, o turno
       * deles passa, e ele reassume os corpos quando a conexao voltar. Na
       * praca, onde nao ha nada em curso, a queda desfaz o grupo como sempre. */
      var naDescida = descidaAtual() !== 'praca' || !!descidaG;
      if (naDescida) {
        // D21: quem ficou lidera (a autoridade da batalha é do Coop)
        if (st.lider !== eu()) { st.lider = eu(); st.v++; muda(); }
      } else {
        desfaz(nome + ' saiu — o grupo se desfez.');
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
    tiqueArena();                                             // 14/09: a fila da Arena
    tiqueGuerraFila();                                        // 15/09: a fila da guerra de guilda
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
            revelei: false, ata: null, inicio: 0, viuBatalha: false, fimDele: null,
            abrindo: false,    // 14/09: o duelo_abrir no servidor (a vida de cada herói) ainda não respondeu
            modo: null,        // 14/09: 'desafio' | 'arena' | 'campo'
            arena: null,       // 14/09: a partida da fila { conta, nome, herois, reenvio } (antes do aceite)
            dupla: null,       // 14/09: a dupla do Campo — a escolha às cegas sai sozinha com ela
            kb: null };        // 14/09: a minha metade da chave no aceite automático (a resposta perdida se repete)
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
      eleEscolheu: !!(dst.dele && dst.dele.h), n: dst.minha ? dst.minha.n : 0, abrindo: !!dst.abrindo,
      modo: dst.modo, heroisArena: (dst.arena && dst.arena.herois) ? dst.arena.herois.slice() : null,
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
    // 14/09: o desafio é sempre o AMISTOSO da praça (o modo vai junto; a versão já barra quem não o conhece)
    if (!manda('duelo', id, 'desafio', { did: did, versao: versao(), chave: chave, modo: 'desafio' })) {
      return { ok: false, motivo: ultimaRecusa };
    }
    dst.fase = 'desafiei'; dst.did = did; dst.eu = 'A'; dst.chave = chave; dst.modo = 'desafio';
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

  // ------------------------------------------------ 14/09: a Arena e o Campo de PvP
  function parDe(id) {
    var achado = null;
    safe(function () { R().pares().forEach(function (p) { if (!achado && p && p.id === id) achado = p; }); return true; }, false);
    return achado;
  }
  function parPorConta(conta) {
    if (typeof conta !== 'number') return null;
    var achado = null;
    safe(function () { R().pares().forEach(function (p) { if (!achado && p && p.nuvem === conta) achado = p; }); return true; }, false);
    return achado;
  }
  function naCampo() {
    return !!safe(function () { return JOGO.Hub && typeof JOGO.Hub.naCampo === 'function' && JOGO.Hub.naCampo(); }, false);
  }
  /* A DUPLA DO CAMPO (14/09, o dono: "pede para ele selecionar os dois que ele quer ir para a batalha"): a HUD
   * pede os dois na entrada do Campo e guarda aqui; sem ela, os escolhidos da praça */
  var duplaCampo = [];
  function limpaIds(ids) {
    var out = [];
    (Object.prototype.toString.call(ids) === '[object Array]' ? ids : []).forEach(function (h) {
      if (typeof h === 'string' && h && out.indexOf(h) < 0 && out.length < MAX_HEROIS && temHeroi(h) && !ehMestre(h)) out.push(h);
    });
    return out;
  }
  function duplaDoCampo() { return limpaIds(duplaCampo.length ? duplaCampo : meusHerois); }
  Duelo.defineDuplaCampo = function (ids) { duplaCampo = limpaIds(ids); return duplaCampo.slice(); };
  Duelo.duplaCampo = function () { return duplaDoCampo(); };
  function forteDe(ids) {
    var m = 1;
    (ids || []).forEach(function (h) { var lv = safe(function () { return JOGO.Progress.hero(h).level; }, 1) || 1; if (lv > m) m = lv; });
    return m;
  }
  Duelo.forteDe = forteDe;
  /* o nível do mais forte de quem está do outro lado: o `forte` do resumo da presença (a HUD põe) */
  function forteDoPar(p) {
    var f = p && p.resumo ? p.resumo.forte : null;
    return (typeof f === 'number' && f >= 1 && f <= 99) ? Math.floor(f) : null;
  }
  function zeradoNa(ids) {
    return safe(function () { return (JOGO.Vida && JOGO.Vida.zerado) ? JOGO.Vida.zerado(ids) : null; }, null);
  }
  function motivoCampo(de, d) {
    if (!naCampo()) return 'fora-do-campo';
    var m = motivoOcupado(false);
    if (m) return m;
    var dupla = duplaDoCampo();
    if (!dupla.length) return 'sem-heroi';
    if (zeradoNa(dupla)) return 'vida-zero-alvo';
    var dele = forteDoPar(parDe(de));
    if (dele === null) { var nf = Math.floor(Number(d && d.forte)); if (nf >= 1 && nf <= 99) dele = nf; }
    if (dele !== null && Math.abs(forteDe(dupla) - dele) > Duelo.PARIDADE_CAMPO) return 'paridade';
    return null;
  }
  /* o que decide o atacante antes de sair o ataque: (a) o outro no Campo e fora de luta, (b) a paridade
   * pelo nível que viaja na presença (o servidor confere de novo), (c) a MINHA vida — a do alvo o cliente
   * dele confere e recusa com o motivo */
  Duelo.podeAtacar = function (id) {
    if (!id || id === eu()) return { ok: false, motivo: 'ocupado' };
    if (!naCampo()) return { ok: false, motivo: 'fora-do-campo' };
    if (dst.fase !== 'livre' || st.fase === 'convidei' || st.fase === 'convidado') return { ok: false, motivo: 'ocupado' };
    if (trocaAberta()) return { ok: false, motivo: 'troca' };
    if (tela() !== 'hub' || minhaSala() || descidaG) return { ok: false, motivo: 'em-batalha' };
    var p = parDe(id);
    if (!p || p.sala || (p.zona || 'praca') !== 'campo') return { ok: false, motivo: 'alvo-fora', nome: p ? p.nome : null };
    if (p.luta === true) return { ok: false, motivo: 'alvo-luta', nome: p.nome };
    var dupla = duplaDoCampo();
    if (!dupla.length) return { ok: false, motivo: 'sem-heroi' };
    if (dupla.length < 2 && heroisDeDuelo().length >= 2) return { ok: false, motivo: 'dois' };
    var z = zeradoNa(dupla);
    if (z) return { ok: false, motivo: 'vida-zero', esperaS: z.esperaS };
    var meu = forteDe(dupla), dele = forteDoPar(p);
    if (dele !== null && Math.abs(meu - dele) > Duelo.PARIDADE_CAMPO) return { ok: false, motivo: 'paridade', meu: meu, dele: dele };
    return { ok: true, dupla: dupla, forte: meu, nome: p.nome };
  };
  Duelo.atacar = function (id) {
    var pode = Duelo.podeAtacar(id);
    if (!pode.ok) return pode;
    var did = eu() + '-' + aleat(6), chave = aleat(8);
    if (!manda('duelo', id, 'ataque', { did: did, versao: versao(), chave: chave, modo: 'campo', forte: pode.forte })) {
      return { ok: false, motivo: ultimaRecusa };
    }
    dst.fase = 'desafiei'; dst.modo = 'campo'; dst.did = did; dst.eu = 'A'; dst.chave = chave; dst.dupla = pode.dupla;
    dst.op = { id: id, cx: null, nome: nomeDe(id) };
    dst.prazo = agoraD() + Duelo.ATAQUE_MS;
    mudaD();
    return { ok: true };
  };
  /* a escolha às cegas SOZINHA (o Campo): se não sai, a luta cai e o outro lado sabe o porquê */
  function autoEscolhe() {
    if (dst.fase !== 'escolhendo' || !dst.dupla) return;
    var r = Duelo.escolher(dst.dupla.slice());
    if (!r || !r.ok) {
      aviso(Grupo.textoMotivo(r ? r.motivo : 'ocupado', null));
      cancelaCalado(r && r.motivo === 'vida-zero' ? 'vida-zero-alvo' : 'desistiu');
    }
  }
  function cancelaCalado(motivoOutro) {
    if (dst.op) manda('duelo', dst.op.id, 'cancela', { did: dst.did, motivo: motivoOutro || 'desistiu' }, dst.op.cx);
    zeraDuelo();
    mudaD();
  }
  function mesmaDupla(dupla, ids) {
    var a = (dupla || []).map(function (p) { return String((p && (p.heroId || p.classId)) || ''); }).sort();
    var b = (ids || []).map(String).sort();
    return JSON.stringify(a) === JSON.stringify(b);
  }
  /* A PARTIDA DO QUADRO DA ARENA (14/09): o JOGO.Arena entrega a partida pronta do servidor. Os dois já
   * confirmaram e as DUPLAS SÃO PÚBLICAS (as do quadro): o lado A (o inscrito) chama o B pela Rede (achado
   * pela CONTA), o B aceita sozinho, e a escolha sai sozinha com essas duplas — o compromisso e a revelação
   * seguem por baixo, e a revelação que não bate com o quadro é trapaça. */
  function mandaArena(t) {
    var a = dst.arena;
    a.reenvio = (t || agoraD()) + Duelo.ARENA_REENVIO_MS;
    if (!dst.op || !dst.op.id) {
      var p = parPorConta(a.conta);
      if (!p) return false;                                    // ainda não apareceu na Rede: o tique tenta de novo
      dst.op = { id: p.id, cx: null, nome: nomeDe(p.id, a.nome) };
    }
    return manda('duelo', dst.op.id, 'arena', { did: dst.did, versao: versao(), chave: dst.chave, modo: 'arena' });
  }
  var arenaPendente = null, arenaBatalhou = {};
  Duelo.iniciaArena = function (p) {
    p = p || {};
    if (!p.did || (p.lado !== 'A' && p.lado !== 'B') || typeof p.conta !== 'number') return { ok: false, motivo: 'versao' };
    if (dst.fase !== 'livre') return { ok: false, motivo: 'ocupado' };
    if (trocaAberta()) return { ok: false, motivo: 'troca' };
    if (tela() !== 'hub' || minhaSala() || descidaG) return { ok: false, motivo: 'em-batalha' };
    dst.modo = 'arena'; dst.did = String(p.did).slice(0, 64); dst.eu = p.lado;
    dst.arena = { conta: p.conta, nome: String(p.nome || '').slice(0, 24),
                  herois: limpaIds(p.herois), reenvio: 0,
                  heroisDele: (Object.prototype.toString.call(p.heroisDele) === '[object Array]' ? p.heroisDele : [])
                    .slice(0, MAX_HEROIS).map(function (h) { return String(h).slice(0, 64); }) };
    if (!dst.arena.herois.length) { zeraDuelo(); return { ok: false, motivo: 'sem-heroi' }; }
    dst.dupla = dst.arena.herois.slice();
    dst.prazo = agoraD() + Duelo.PRAZO_MS;
    if (p.lado === 'A') {
      dst.fase = 'desafiei';
      dst.chave = aleat(8);
      mandaArena(agoraD());
    } else {
      dst.fase = 'desafiado';
      var pend = arenaPendente;
      arenaPendente = null;
      if (pend && pend.did === dst.did && agoraD() - pend.t < Duelo.PRAZO_MS) { aoDuelo(pend.ev); return { ok: true }; }
    }
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
  /* A VIDA ÚNICA NO DUELO (14/09, o dono: "se o jogador estiver com a vida na metade e começar
   * uma batalha sendo pvp… a vida vai começar onde estava"). Herói a 0 não entra
   * ('vida-zero'). Cada payload leva `vida` (o PV de agora, inteiro ≥ 1; sem ele = cheio)
   * DENTRO da dupla que vai para o compromisso: o outro lado confere no hash e os dois motores
   * nascem com o mesmo PV. Com a sessão do site, o servidor guarda essa vida ANTES do
   * compromisso (POST /api/duelo/abrir) e devolve o carry — é com ele que o duelo é refeito
   * no fechar; então escolher espera a resposta ({ok, esperando}) e o compromisso sai depois. */
  Duelo.escolher = function (heroIds) {
    if (dst.fase !== 'escolhendo') return { ok: false, motivo: 'ocupado' };
    if (dst.abrindo) return { ok: true, esperando: true };
    var ids = [];
    (heroIds || []).forEach(function (h) { if (h && ids.indexOf(h) < 0) ids.push(h); });
    if (ids.length < 1 || ids.length > 2) return { ok: false, motivo: 'n' };
    var pls = [];
    for (var i = 0; i < ids.length; i++) {
      var pl = payloadDe(ids[i]);
      if (!pl) return { ok: false, motivo: ehMestre(ids[i]) ? 'mestre' : 'sem-heroi' };
      pls.push(pl);
    }
    var Vd = JOGO.Vida;
    var z = safe(function () { return (Vd && Vd.zerado) ? Vd.zerado(ids) : null; }, null);
    if (z) return { ok: false, motivo: 'vida-zero', heroi: z.heroId, esperaS: z.esperaS };
    var A = JOGO.Autoridade;
    if (A && A.abreDuelo && safe(function () { return A.ligada(); }, false)) {
      var eraDst = dst, did = dst.did;
      dst.abrindo = true;
      A.abreDuelo({ did: did, herois: ids.slice() }).then(function (r) {
        if (dst !== eraDst) return;                          // o duelo acabou (ou outro começou) no meio
        dst.abrindo = false;
        if (dst.fase !== 'escolhendo' || dst.did !== did) { mudaD(); return; }
        if (!r || !r.ok) {
          if (r && r.motivo === 'vida-zero') {
            aviso(A.textoVidaZero ? A.textoVidaZero(r) : Grupo.textoMotivo('vida-zero', null));
            safe(function () { return Vd.sincroniza(); }, null);
          } else aviso('O servidor não abriu o duelo: ' + ((r && r.erro) || 'sem resposta') + '.');
          // 14/09: no Campo e na Arena não há ficha de escolha para tentar de novo — a luta cai na hora
          if (dst.modo === 'campo' || dst.modo === 'arena') { cancelaCalado(r && r.motivo === 'vida-zero' ? 'vida-zero-alvo' : 'desistiu'); return; }
          mudaD();
          return;
        }
        var res = comprometeDupla(ids, pls, r.carry);
        if (!res.ok) aviso(Grupo.textoMotivo(res.motivo, null));
        mudaD();
      }, function () {
        if (dst !== eraDst) return;
        dst.abrindo = false;
        aviso(Grupo.textoMotivo('servidor', null));
        if (dst.modo === 'campo' || dst.modo === 'arena') { cancelaCalado('desistiu'); return; }
        mudaD();
      });
      mudaD();
      return { ok: true, esperando: true };
    }
    return comprometeDupla(ids, pls, safe(function () { return (Vd && Vd.carry) ? Vd.carry(ids) : null; }, null));
  };
  function comprometeDupla(ids, pls, carry) {
    pls.forEach(function (pl) {
      var pv = (carry && typeof carry === 'object') ? carry[pl.heroId] : undefined;
      if (typeof pv === 'number' && isFinite(pv) && pv >= 1) pl.vida = Math.min(100000, Math.floor(pv));
      else delete pl.vida;
    });
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
      // 14/09: a vida com que entra — inteiro de 1 a 100000, ou ausente (cheio); torta é trapaça
      if (p.vida !== undefined && (typeof p.vida !== 'number' || p.vida !== Math.floor(p.vida) || p.vida < 1 || p.vida > 100000)) {
        return 'trapaca';
      }
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
  /* 14/09: os mapas de luta que não são calabouço (a praça) moram em DATA.arenas */
  function acharMapaDeLuta(id) {
    var a = safe(function () { return D().arena ? D().arena(id) : null; }, null);
    if (a) return a;
    var lista = D().arenas || [];
    for (var i = 0; i < lista.length; i++) if (lista[i] && lista[i].id === id) return lista[i];
    return null;
  }
  function nomeArena(ar) {
    var m = ar ? acharMapaDeLuta(ar.dungeonId) : null;
    if (m) return m.name || 'A Praça';                 // a praça tem um mapa só: sem "sala 1"
    var d = ar ? acharDungeon(ar.dungeonId) : null;
    return ((d && d.name) || (ar && ar.dungeonId) || 'Arena') + ' — sala ' + ((ar && ar.roomIndex || 0) + 1);
  }
  /* O MAPA DE CADA MODO (14/09): o desafio amistoso é SEMPRE a praça, sala 0; a arena e o campo sorteiam
   * pela semente dos dois entre os calabouços abertos (o Coop, ou o gêmeo daqui) */
  function mapaDoDesafio() {
    var m = acharMapaDeLuta(Duelo.MAPA_DESAFIO);
    return (m && m.rooms && m.rooms.length) ? { dungeonId: m.id, roomIndex: 0 } : null;
  }
  function arenaDoModo(modo, s) {
    if (modo === 'desafio') return mapaDoDesafio();
    var c = C();
    var ar = (c && typeof c.sorteiaArena === 'function') ? safe(function () { return c.sorteiaArena(s); }, null) : null;
    return ar || sorteiaArenaLocal(s);
  }
  Duelo._mapaDoModo = arenaDoModo;       // provas
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
  Duelo._validaDupla = validaDupla;       // provas (14/09: o `vida` da dupla)

  function confereFim() {
    if (!dst.revelei || !dst.dele || !dst.dele.dupla || dst.fase === 'batalha') return;
    var salA = dst.eu === 'A' ? dst.minha.sal : dst.dele.sal;
    var salB = dst.eu === 'A' ? dst.dele.sal : dst.minha.sal;
    var s = Duelo._semente(dst.did, salA, salB);
    var c = C();
    var arena = arenaDoModo(dst.modo, s);      // 14/09: a praça no desafio; o sorteio na arena e no campo
    if (!arena) { cancelaD('versao', true); return; }
    if (dst.modo === 'arena') arenaBatalhou[dst.did] = true;
    var minha = JSON.parse(dst.minha.str);
    var ata = { did: dst.did, semente: s, modo: dst.modo, dungeonId: arena.dungeonId, roomIndex: arena.roomIndex,
                duplaA: dst.eu === 'A' ? minha : dst.dele.dupla,
                duplaB: dst.eu === 'A' ? dst.dele.dupla : minha,
                eu: dst.eu, oponente: { id: dst.op.id, cx: dst.op.cx, nome: dst.op.nome } };
    dst.ata = ata;
    dst.fase = 'batalha';
    dst.prazo = 0;
    dst.inicio = agoraD();
    dst.viuBatalha = false;
    aviso(dst.modo === 'desafio' ? 'Desafio amistoso na Praça — a coroa não muda.'
                                 : 'Arena sorteada: ' + nomeArena(ata) + '.', 'good');
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
      if (d.modo !== undefined && d.modo !== 'desafio') return;     // 14/09: pelo desafio só vem o amistoso
      var mot = mutado(de) ? 'ocupado' : (String(d.versao || '') !== versao() ? 'versao' : motivoOcupado(false));
      if (mot) {
        manda('duelo', de, 'resposta', { did: String(d.did).slice(0, 48), ok: false, motivo: mot }, ev.cx);
        return;
      }
      dst.fase = 'desafiado'; dst.did = String(d.did).slice(0, 48); dst.eu = 'B'; dst.modo = 'desafio';
      dst.chave = String(d.chave || '').slice(0, 24);
      dst.op = { id: de, cx: ev.cx || null, nome: nomeDe(de) };
      dst.prazo = agoraD() + Duelo.PRAZO_MS;
      if (Duelo.aoDesafio) {
        try { Duelo.aoDesafio({ id: de, nome: dst.op.nome, expira: dst.prazo, did: dst.did }); } catch (e) {}
      }
      mudaD();
    } else if (a === 'arena') {
      /* 14/09, A PARTIDA DA FILA: o lado A chama; o B aceita SOZINHO se a partida pronta que o servidor
       * deu a ele tem esse did e o outro lado é a conta dela (o `nuvem` da presença, carimbado pelo relé) */
      var didA = String(d.did || '').slice(0, 64);
      if (!didA) return;
      if (String(d.versao || '') !== versao()) { manda('duelo', de, 'resposta', { did: didA, ok: false, motivo: 'versao' }, ev.cx); return; }
      if (dst.modo === 'arena' && dst.did === didA && dst.arena && dst.eu === 'B') {
        var pA = parDe(de);
        if (!pA || pA.nuvem !== dst.arena.conta) return;
        if (dst.fase === 'desafiado') {
          if (emBatalhaOuDescida() || trocaAberta()) {
            manda('duelo', de, 'resposta', { did: didA, ok: false, motivo: trocaAberta() ? 'troca' : 'em-batalha' }, ev.cx);
            zeraDuelo(); mudaD();
            return;
          }
          dst.op = { id: de, cx: ev.cx || null, nome: nomeDe(de, dst.arena.nome) };
          dst.kb = aleat(8);
          dst.chave = String(d.chave || '').slice(0, 24) + ':' + dst.kb;
          if (!manda('duelo', de, 'resposta', { did: didA, ok: true, kb: dst.kb, modo: 'arena' }, ev.cx)) { dst.op = null; return; }
          dst.fase = 'escolhendo';
          dst.prazo = agoraD() + Duelo.ESCOLHA_MS;
          vigia(de, dst.op.cx);
          aviso(dst.op.nome + ' chegou à Arena — a luta começa!', 'good');
          mudaD();
          autoEscolhe();                                        // as duplas são as do quadro: sem escolha
        } else if ((dst.fase === 'escolhendo' || dst.fase === 'comprometido' || dst.fase === 'revelado') &&
                   dst.op && dst.op.id === de && dst.kb) {
          manda('duelo', de, 'resposta', { did: didA, ok: true, kb: dst.kb, modo: 'arena' }, ev.cx);   // a resposta se perdeu
        }
        return;
      }
      // a minha fila ainda não soube da partida pronta: guarda o chamado e pergunta ao servidor
      arenaPendente = { did: didA, ev: ev, t: agoraD() };
      safe(function () { return Arena.consulta(); }, null);
    } else if (a === 'ataque') {
      /* 14/09, O CAMPO DE PVP (o dono: "lá ao clicar em cima o jogador pode atacar sem aviso prévio"):
       * o atacado NÃO confirma — confere que está no Campo, livre, de pé e na paridade, e entra com a
       * dupla do Campo. O compromisso e a revelação continuam por baixo (o hash é a prova) */
      var didC = String(d.did || '').slice(0, 48);
      if (!didC || dst.did === didC) return;
      var motC = String(d.versao || '') !== versao() ? 'versao' : motivoCampo(de, d);
      if (motC) { manda('duelo', de, 'resposta', { did: didC, ok: false, motivo: motC, modo: 'campo' }, ev.cx); return; }
      var duplaC = duplaDoCampo();
      dst.fase = 'escolhendo'; dst.modo = 'campo'; dst.did = didC; dst.eu = 'B'; dst.dupla = duplaC;
      dst.op = { id: de, cx: ev.cx || null, nome: nomeDe(de) };
      dst.kb = aleat(8);
      dst.chave = String(d.chave || '').slice(0, 24) + ':' + dst.kb;
      dst.prazo = agoraD() + Duelo.ESCOLHA_MS;
      if (!manda('duelo', de, 'resposta', { did: didC, ok: true, kb: dst.kb, modo: 'campo' }, ev.cx)) { zeraDuelo(); mudaD(); return; }
      vigia(de, dst.op.cx);
      aviso(dst.op.nome + ' te atacou no Campo de PvP — a luta começa!', 'bad');
      mudaD();
      autoEscolhe();
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
      if (dst.modo === 'campo' || dst.modo === 'arena') {
        aviso(dst.modo === 'campo' ? 'Você atacou ' + dst.op.nome + ' — a luta começa!'
                                   : dst.op.nome + ' chegou à Arena — a luta começa!', 'good');
        mudaD();
        autoEscolhe();                                          // 14/09: a dupla do Campo ou a do quadro, sem ficha
        return;
      }
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
      // 14/09: na Arena a dupla revelada é a que o quadro mostrou (o servidor confere de novo no fechar)
      if (!mot3 && dst.modo === 'arena' && dst.arena && dst.arena.heroisDele.length && !mesmaDupla(dupla, dst.arena.heroisDele)) {
        mot3 = 'trapaca';
      }
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
          : (m4 !== 'desistiu' && SOBRE_OUTRO.hasOwnProperty(m4)) ? Grupo.textoMotivo(m4, nome)   // 14/09: vida, paridade…
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
      // 14/09: o lado A da Arena repete o chamado (e acha o outro na Rede pela conta) até a resposta
      if (f === 'desafiei' && dst.modo === 'arena' && dst.arena && t <= dst.prazo && t >= dst.arena.reenvio) mandaArena(t);
      if (t > dst.prazo) {
        var n = dst.op ? dst.op.nome : '';
        var meu = f === 'desafiei', modoT = dst.modo;
        if (!meu && dst.op) manda('duelo', dst.op.id, 'resposta', { did: dst.did, ok: false, motivo: 'expirou' }, dst.op.cx);
        zeraDuelo();
        aviso(modoT === 'arena' ? 'O adversário da Arena não apareceu — a partida caiu.'
            : modoT === 'campo' ? 'O ataque não teve resposta.'
            : (meu ? 'O desafio expirou.' : 'O desafio de ' + n + ' expirou.'));
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
  Duelo._reset = function () { zeraDuelo(); ultimoOp = null; duplaCampo = []; arenaPendente = null; arenaBatalhou = {}; };
  Duelo._st = function () { return dst; };

  // ==========================================================================
  // O QUADRO DA ARENA (14/09) — o cliente de servidor/arena.py
  // ==========================================================================
  /* O pedido do dono: "na inscrição de pvp onde ele se inscreve na arena para esperar que alguém aceite o
   * desafio... esse ele pré-seleciona as duas classes já e quem vai desafiar consegue ver.. essa inscrição dá
   * ranking na coroa também". Quem se inscreve deixa a dupla PÚBLICA no quadro; quem desafia escolhe um
   * inscrito (a paridade de 5 níveis e a vida conferidas pelo servidor) e mostra a dele; os dois confirmam em
   * 30 s. Daqui sai o pedido, a consulta do estado a cada CONSULTA_MS SÓ enquanto inscrito ou casado, e a
   * entrega da partida pronta ao Duelo (Duelo.iniciaArena: sem escolha às cegas — as duplas do quadro). Quem
   * entra em batalha, sala ou grupo sai. Sem o jogo servido, sem a conta do site ou sem o relé novo, fica
   * desligada e Arena.disponivel() diz o porquê. */
  var Arena = {};
  JOGO.Arena = Arena;
  Arena.CONSULTA_MS = 2500;
  Arena.PARIDADE = 5;
  Arena._agora = function () { return Date.now(); };
  var ast = null;
  function zeraArena() {
    ast = { fase: 'livre', dados: null, ultima: 0, pedindo: false, offset: 0, entregue: null, entregueEm: 0, erro: null };
  }
  zeraArena();
  function mudaA() { if (Arena.aoMudar) { try { Arena.aoMudar(Arena.estado()); } catch (e) {} } }

  Arena.disponivel = function () {
    var proto = safe(function () { return window.location.protocol; }, '');
    if (proto === 'file:') {
      return { ok: false, motivo: 'arquivo', texto: 'A Arena ranqueada precisa do jogo aberto pelo site — do arquivo ele não fala com o servidor.' };
    }
    var s = JOGO.Sessao;
    if (!s || typeof s.api !== 'function' || !safe(function () { return s.ativa(); }, false)) {
      return { ok: false, motivo: 'sem-sessao', texto: 'A Arena ranqueada precisa da sua conta do site: entre para jogar.' };
    }
    var A = JOGO.Autoridade;
    if (A && typeof A.ligada === 'function' && !safe(function () { return A.ligada(); }, false)) {
      return { ok: false, motivo: 'servidor', texto: 'O servidor da Arena não está ligado agora.' };
    }
    if (!safe(function () { return R().privado(); }, false)) {
      return { ok: false, motivo: 'rede', texto: 'A Arena precisa do servidor da Rede (o duelo sai por ele).' };
    }
    return { ok: true };
  };
  Arena.inscrita = function () {
    return ast.fase === 'inscrito' || ast.fase === 'casada' || (ast.fase === 'pronta' && !ast.entregue);
  };
  function copiaLista(v) { return Array.isArray(v) ? JSON.parse(JSON.stringify(v)) : null; }
  Arena.estado = function () {
    var d = ast.dados || {}, disp = Arena.disponivel();
    var e = { fase: ast.fase, pedindo: !!ast.pedindo, erro: ast.erro, desligada: disp.ok ? null : disp.texto,
              herois: copiaLista(d.herois), classes: copiaLista(d.classes), nivel: d.nivel || null };
    if (ast.fase === 'inscrito') e.desdeMs = d.desdeMs - ast.offset;
    if (ast.fase === 'casada') { e.prazoMs = d.prazoMs - ast.offset; e.confirmei = !!d.confirmei; e.eleConfirmou = !!d.eleConfirmou; }
    if (ast.fase === 'casada' || ast.fase === 'pronta') {
      var ad = d.adversario || {};
      e.lado = d.lado;
      e.papel = d.papel;
      e.adversario = { conta: ad.conta, nome: String(ad.nome || '?'), nivel: ad.nivel, brasa: ad.brasa,
                       herois: copiaLista(ad.herois) || [], classes: copiaLista(ad.classes) || [] };
    }
    if (ast.fase === 'pronta') e.did = d.did;
    return e;
  };
  function pedeArena(rota, metodo, corpo) {
    var s = JOGO.Sessao;
    if (!s || typeof s.api !== 'function') return Promise.resolve({ ok: false, status: 0, erro: 'sem sessão' });
    var op = { method: metodo };
    if (corpo !== undefined) op.body = corpo;
    try {
      return Promise.resolve(s.api(rota, op)).then(function (r) { return r || { ok: false, status: 0 }; },
                                                   function () { return { ok: false, status: 0, erro: 'o servidor não respondeu' }; });
    } catch (e) { return Promise.resolve({ ok: false, status: 0, erro: 'o servidor não respondeu' }); }
  }
  function adota(r, era) {
    if (era && ast !== era) return;                     // saiu no meio: a resposta velha não reinscreve
    if (!r || !r.ok || typeof r.fase !== 'string') return;
    var antes = ast.fase;
    ast.offset = (typeof r.agoraMs === 'number') ? r.agoraMs - Arena._agora() : 0;
    ast.dados = r;
    ast.erro = null;
    ast.fase = r.fase;
    if (r.fase === 'casada' && antes !== 'casada' && Arena.aoCasou) { try { Arena.aoCasou(Arena.estado()); } catch (e) {} }
    if (r.fase === 'pronta' && ast.entregue !== r.did) {
      ast.entregue = r.did;
      ast.entregueEm = Arena._agora();
      var ad = r.adversario || {};
      var res = Duelo.iniciaArena({ did: r.did, lado: r.lado, conta: ad.conta, nome: ad.nome,
                                    herois: r.herois, heroisDele: ad.herois });
      if (!res || !res.ok) {
        aviso('A partida da Arena caiu: ' + Grupo.textoMotivo(res ? res.motivo : 'ocupado', null).toLowerCase());
        Arena.sair();
        return;
      }
    }
    mudaA();
  }
  function falhaArena(r) {
    return { ok: false, motivo: (r && r.motivo) || (r && r.status === 0 ? 'servidor' : 'arena'),
             erro: (r && r.erro) || null, esperaS: r ? r.esperaS : undefined };
  }
  /* a dupla de quem se inscreve ou desafia: os DOIS, em ordem (um só se a conta só tem um), de pé, e quem
   * pede fora de luta, de sala, de grupo e de outro duelo */
  function motivoDaDupla(lista) {
    if (!lista.length) return 'n';
    for (var i = 0; i < lista.length; i++) {
      if (ehMestre(lista[i])) return 'mestre';
      if (!temHeroi(lista[i])) return 'sem-heroi';
    }
    if (lista.length < 2 && heroisDeDuelo().length >= 2) return 'dois';
    if (Grupo.emGrupo()) return 'em-grupo';
    if (emBatalhaOuDescida() || minhaSala() || descidaG) return 'em-batalha';
    if (dst.fase !== 'livre') return 'ocupado';
    return null;
  }
  function listaDe(ids) {
    var lista = [];
    (Object.prototype.toString.call(ids) === '[object Array]' ? ids : []).forEach(function (h) {
      if (typeof h === 'string' && h && lista.indexOf(h) < 0 && lista.length < MAX_HEROIS) lista.push(h);
    });
    return lista;
  }
  function pedeComDupla(rota, corpo, lista) {
    var disp = Arena.disponivel();
    if (!disp.ok) return Promise.resolve({ ok: false, motivo: disp.motivo, erro: disp.texto });
    var mot = motivoDaDupla(lista);
    if (mot) return Promise.resolve({ ok: false, motivo: mot });
    var z = zeradoNa(lista);
    if (z) return Promise.resolve({ ok: false, motivo: 'vida-zero', esperaS: z.esperaS });
    var era = ast;
    ast.pedindo = true;
    mudaA();
    return pedeArena(rota, 'POST', corpo).then(function (r) {
      if (ast !== era) return { ok: false, motivo: 'ocupado' };
      ast.pedindo = false;
      ast.ultima = Arena._agora();
      if (r.ok) { adota(r, era); return { ok: true }; }
      ast.erro = r.erro || null;
      mudaA();
      return falhaArena(r);
    });
  }
  Arena.inscrever = function (ids) {
    var lista = listaDe(ids);
    return pedeComDupla('/api/arena/inscrever', { herois: lista }, lista);
  };
  Arena.desafiar = function (conta, ids) {
    var lista = listaDe(ids);
    if (typeof conta !== 'number') return Promise.resolve({ ok: false, motivo: 'sem-inscricao' });
    if (ast.fase !== 'livre') return Promise.resolve({ ok: false, motivo: ast.fase === 'inscrito' ? 'inscrito' : 'ocupado' });
    return pedeComDupla('/api/arena/desafiar', { alvo: conta, herois: lista }, lista);
  };
  /* O QUADRO (a lista pública dos inscritos): só a leitura — a HUD pede enquanto o painel está aberto */
  Arena.quadro = function () {
    var disp = Arena.disponivel();
    if (!disp.ok) return Promise.resolve({ ok: false, motivo: disp.motivo, erro: disp.texto, inscritos: [] });
    return pedeArena('/api/arena/quadro', 'GET').then(function (r) {
      if (!r || !r.ok) return { ok: false, erro: (r && r.erro) || 'o servidor não respondeu', inscritos: [] };
      var off = (typeof r.agoraMs === 'number') ? r.agoraMs - Arena._agora() : 0;
      var lista = (Array.isArray(r.inscritos) ? r.inscritos : []).map(function (x) {
        return { conta: x.conta, nome: String(x.nome || '?'), nivel: x.nivel, brasa: x.brasa, eu: !!x.eu,
                 classes: Array.isArray(x.classes) ? x.classes : [], desdeMs: x.desdeMs - off };
      });
      return { ok: true, paridade: r.paridade || Arena.PARIDADE, inscritos: lista };
    });
  };
  function pedeSimples(rota) {
    var era = ast;
    ast.pedindo = true;
    mudaA();
    return pedeArena(rota, 'POST', {}).then(function (r) {
      if (ast !== era) return { ok: false, motivo: 'ocupado' };
      ast.pedindo = false;
      if (r.ok) { adota(r, era); return { ok: true }; }
      mudaA();
      if (r.motivo === 'sem-partida') Arena.consulta();
      return falhaArena(r);
    });
  }
  Arena.confirmar = function () {
    if (ast.fase !== 'casada') return Promise.resolve({ ok: false, motivo: 'sem-partida' });
    return pedeSimples('/api/arena/confirmar');
  };
  Arena.recusar = function () {
    if (ast.fase !== 'casada') return Promise.resolve({ ok: false, motivo: 'sem-partida' });
    return pedeSimples('/api/arena/recusar');
  };
  Arena.sair = function () {
    var era = ast.fase;
    zeraArena();
    mudaA();
    if (era === 'livre') return Promise.resolve({ ok: true });
    return pedeArena('/api/arena/sair', 'POST', {}).then(function (r) { return { ok: !!(r && r.ok) }; });
  };
  Arena.consulta = function () {
    var era = ast;
    ast.ultima = Arena._agora();
    return pedeArena('/api/arena/estado', 'GET').then(function (r) {
      if (r && r.ok) adota(r, era);
      return r;
    });
  };
  function tiqueArena() {
    var t = Arena._agora();
    if (ast.fase === 'pronta' && ast.entregue) {
      // a partida foi entregue ao Duelo: acabou (ou caiu antes da arena) — aqui volta a livre
      if (dst.fase === 'livre' && t - ast.entregueEm > 3000) {
        if (!arenaBatalhou[ast.entregue]) pedeArena('/api/arena/sair', 'POST', {});
        zeraArena();
        mudaA();
      }
      return;
    }
    if (!Arena.inscrita()) return;
    if (emBatalhaOuDescida() || minhaSala() || descidaG || Grupo.emGrupo()) {
      aviso('Você saiu da Arena.');
      Arena.sair();
      return;
    }
    if (t - ast.ultima >= Arena.CONSULTA_MS) Arena.consulta();
  }
  Arena._tique = tiqueArena;
  Arena._reset = function () { zeraArena(); };
  Arena._st = function () { return ast; };

  // ==========================================================================
  // A GUERRA DE GUILDA 2×2 NA SEDE (15/09)
  // ==========================================================================
  /* O dono: "a guerra de guild que é 2x2 de cada guild é na sede de guild, isso dá pontos de experiência para
   * guild"; e "quando for pras arenas, pvp, guerra de guild etc.. pede para ele selecionar os dois que ele quer ir
   * para a batalha". A FILA mora no servidor (servidor/guerra.py): quem LIDERA o grupo de 2 (os dois da mesma
   * guilda) inscreve a dupla dele com o parceiro; o parceiro põe a dele (juntar) e a inscrição vale; o servidor
   * casa com a dupla de jogadores de OUTRA guilda e os QUATRO confirmam em 30 s. A partida pronta traz a ATA (os
   * oito heróis, a semente, a vida) e vai ao Coop.iniciaGuerra; o fim volta por Guerra.fechar. A consulta do estado
   * corre a cada CONSULTA_MS com a inscrição viva, e a cada CONSULTA_GRUPO_MS com o grupo formado na praça (é assim
   * que o parceiro fica sabendo; quem lidera ainda avisa pelo trilho do grupo, a acao 'guerra'). Sem o jogo servido,
   * sem a conta do site ou sem o relé novo, fica desligada e Guerra.disponivel() diz o porquê. */
  var Guerra = {};
  JOGO.Guerra = Guerra;
  Guerra.CONSULTA_MS = 2500;
  Guerra.CONSULTA_GRUPO_MS = 8000;
  Guerra.XP = 40;                    // espelha GUERRA_XP (servidor/guerra.py): só para a tela explicar
  Guerra.PARIDADE = 10;              // espelha GUERRA_PARIDADE
  Guerra.FECHA_REPETE_MS = 20000;    // o fechamento fotografado pergunta de novo (o registro limpo de outro chega)
  Guerra._agora = function () { return Date.now(); };
  var gst = null, ultimaGuerra = null;
  function zeraGuerra() {
    gst = { fase: 'livre', dados: null, ultima: 0, pedindo: false, offset: 0, entregue: null, entregueEm: 0, erro: null };
  }
  zeraGuerra();
  function mudaG() { if (Guerra.aoMudar) { try { Guerra.aoMudar(Guerra.estado()); } catch (e) {} } }
  function copiaG(v) { return v == null ? null : JSON.parse(JSON.stringify(v)); }

  Guerra.disponivel = function () {
    var proto = safe(function () { return window.location.protocol; }, '');
    if (proto === 'file:') {
      return { ok: false, motivo: 'arquivo', texto: 'A guerra de guilda precisa do jogo aberto pelo site — do arquivo ele não fala com o servidor.' };
    }
    var s = JOGO.Sessao;
    if (!s || typeof s.api !== 'function' || !safe(function () { return s.ativa(); }, false)) {
      return { ok: false, motivo: 'sem-sessao', texto: 'A guerra de guilda precisa da sua conta do site: entre para jogar.' };
    }
    var A = JOGO.Autoridade;
    if (A && typeof A.ligada === 'function' && !safe(function () { return A.ligada(); }, false)) {
      return { ok: false, motivo: 'servidor', texto: 'O servidor da guerra de guilda não está ligado agora.' };
    }
    if (!safe(function () { return R().privado(); }, false)) {
      return { ok: false, motivo: 'rede', texto: 'A guerra de guilda precisa do servidor da Rede (a batalha dos quatro sai por ele).' };
    }
    return { ok: true };
  };
  Guerra.estado = function () {
    var d = gst.dados || {}, disp = Guerra.disponivel();
    var e = { fase: gst.fase, pedindo: !!gst.pedindo, erro: gst.erro, desligada: disp.ok ? null : disp.texto,
              herois: copiaLista(d.herois), nivel: d.nivel || null, resultado: copiaG(ultimaGuerra) };
    if (d.parceiro) e.parceiro = { conta: d.parceiro.conta, nome: String(d.parceiro.nome || '?') };
    if (d.lider) e.lider = { conta: d.lider.conta, nome: String(d.lider.nome || '?') };
    if (typeof d.desdeMs === 'number') e.desdeMs = d.desdeMs - gst.offset;
    if (typeof d.prazoMs === 'number') e.prazoMs = d.prazoMs - gst.offset;
    if (gst.fase === 'casada' || gst.fase === 'pronta') {
      e.lado = d.lado;
      e.guildas = copiaG(d.guildas);
      e.aliados = copiaLista(d.aliados) || [];
      e.adversarios = copiaLista(d.adversarios) || [];     // só a guilda e os nomes: as duplas ficam ocultas
      e.confirmei = !!d.confirmei;
    }
    if (gst.fase === 'pronta') { e.gid = d.gid; e.ataPronta = !!d.ata; e.entregue = gst.entregue === d.gid; }
    return e;
  };
  /* a conta do servidor do meu parceiro de grupo: o `nuvem` que o relé conferiu na presença */
  function contaDoPar() {
    if (!Grupo.emGrupo()) return null;
    var id = st.par.id, achou = null;
    safe(function () {
      R().pares().forEach(function (p) { if (p && p.id === id && typeof p.nuvem === 'number') achou = p.nuvem; });
      return true;
    }, null);
    return achou;
  }
  function motivoDaGuerra(lista, lider) {
    if (!lista.length) return 'n';
    for (var i = 0; i < lista.length; i++) {
      if (ehMestre(lista[i])) return 'mestre';
      if (!temHeroi(lista[i])) return 'sem-heroi';
    }
    if (lista.length < 2 && heroisDeDuelo().length >= 2) return 'dois';
    if (!Grupo.emGrupo()) return 'sem-grupo';
    if (lider && !Grupo.souLider()) return 'nao-lider';
    if (emBatalhaOuDescida() || minhaSala() || descidaG) return 'em-batalha';
    if (dst.fase !== 'livre') return 'ocupado';
    if (Arena.inscrita()) return 'arena';
    return null;
  }
  function adotaGuerra(r, era) {
    if (era && gst !== era) return;                     // saiu no meio: a resposta velha não reinscreve
    if (!r || !r.ok || typeof r.fase !== 'string') return;
    var antes = gst.fase;
    gst.offset = (typeof r.agoraMs === 'number') ? r.agoraMs - Guerra._agora() : 0;
    gst.dados = r;
    gst.erro = null;
    gst.fase = r.fase;
    if (r.fase === 'convite' && antes !== 'convite' && Guerra.aoConvite) { try { Guerra.aoConvite(Guerra.estado()); } catch (e) {} }
    if (r.fase === 'casada' && antes !== 'casada' && Guerra.aoCasou) { try { Guerra.aoCasou(Guerra.estado()); } catch (e2) {} }
    // a partida pronta COM a ata: vai ao Coop (só da praça — de outra tela, a consulta seguinte tenta de novo)
    if (r.fase === 'pronta' && r.ata && gst.entregue !== r.gid && tela() === 'hub' && !minhaSala()) {
      gst.entregue = r.gid;
      gst.entregueEm = Guerra._agora();
      var c = C();
      var ok = !!(c && typeof c.iniciaGuerra === 'function' && safe(function () {
        return c.iniciaGuerra({ gid: r.gid, ata: r.ata, jogadores: r.jogadores, guildas: r.guildas, eu: eu() });
      }, false));
      if (!ok) aviso('A guerra de guilda não abriu aqui — a ata não bateu com este jogo (recarregue a página).');
    }
    mudaG();
  }
  function pedeGuerraComDupla(rota, corpo, lista, lider) {
    var disp = Guerra.disponivel();
    if (!disp.ok) return Promise.resolve({ ok: false, motivo: disp.motivo, erro: disp.texto });
    var mot = motivoDaGuerra(lista, lider);
    if (mot) return Promise.resolve({ ok: false, motivo: mot });
    var z = zeradoNa(lista);
    if (z) return Promise.resolve({ ok: false, motivo: 'vida-zero', esperaS: z.esperaS });
    var era = gst;
    gst.pedindo = true;
    mudaG();
    return pedeArena(rota, 'POST', corpo).then(function (r) {
      if (gst !== era) return { ok: false, motivo: 'ocupado' };
      gst.pedindo = false;
      gst.ultima = Guerra._agora();
      if (r.ok) { adotaGuerra(r, era); return { ok: true, fase: r.fase }; }
      gst.erro = r.erro || null;
      mudaG();
      return falhaArena(r);
    });
  }
  /* quem LIDERA o grupo: a dupla dele e o parceiro (a conta que o relé conferiu) */
  Guerra.inscrever = function (ids) {
    var lista = listaDe(ids);
    if (!Grupo.emGrupo()) return Promise.resolve({ ok: false, motivo: 'sem-grupo' });
    var conta = contaDoPar();
    if (typeof conta !== 'number') return Promise.resolve({ ok: false, motivo: 'sem-conta-par' });
    return pedeGuerraComDupla('/api/guerra/inscrever', { parceiro: conta, herois: lista, dono: eu() }, lista, true)
      .then(function (r) {
        if (r.ok && Grupo.emGrupo()) manda('grupo', st.par.id, 'guerra', { gid: st.gid }, st.par.cx);
        return r;
      });
  };
  /* o parceiro: a dupla dele — a inscrição passa a valer */
  Guerra.juntar = function (ids) {
    var lista = listaDe(ids);
    return pedeGuerraComDupla('/api/guerra/juntar', { herois: lista, dono: eu() }, lista, false);
  };
  function pedeGuerraSimples(rota) {
    var era = gst;
    gst.pedindo = true;
    mudaG();
    return pedeArena(rota, 'POST', {}).then(function (r) {
      if (gst !== era) return { ok: false, motivo: 'ocupado' };
      gst.pedindo = false;
      if (r.ok) { adotaGuerra(r, era); return { ok: true }; }
      mudaG();
      if (r.motivo === 'sem-partida') Guerra.consulta();
      return falhaArena(r);
    });
  }
  Guerra.confirmar = function () {
    if (gst.fase !== 'casada') return Promise.resolve({ ok: false, motivo: 'sem-partida' });
    return pedeGuerraSimples('/api/guerra/confirmar');
  };
  Guerra.recusar = function () {
    if (gst.fase !== 'casada') return Promise.resolve({ ok: false, motivo: 'sem-partida' });
    return pedeGuerraSimples('/api/guerra/recusar');
  };
  Guerra.sair = function () {
    var era = gst.fase;
    zeraGuerra();
    mudaG();
    if (era === 'livre') return Promise.resolve({ ok: true });
    return pedeArena('/api/guerra/sair', 'POST', {}).then(function (r) { return { ok: !!(r && r.ok) }; });
  };
  Guerra.consulta = function () {
    var era = gst;
    gst.ultima = Guerra._agora();
    return pedeArena('/api/guerra/estado', 'GET').then(function (r) {
      if (r && r.ok) adotaGuerra(r, era);
      return r;
    });
  };
  /* o fim da guerra (o Coop chama): o servidor refaz e diz se a guilda ganhou o XP. Fotografado espera o registro
   * limpo de outro dos quatro: pergunta de novo algumas vezes */
  Guerra.fechar = function (corpo, vez) {
    vez = vez || 0;
    return pedeArena('/api/guerra/fechar', 'POST', corpo).then(function (r) {
      if (r && r.ok && r.fase === 'aguardando' && vez < 7 && typeof setTimeout === 'function') {
        setTimeout(function () { Guerra.fechar(corpo, vez + 1); }, Guerra.FECHA_REPETE_MS);
      }
      ultimaGuerra = (r && r.ok) ? r : { ok: false, gid: corpo && corpo.gid, motivo: (r && r.motivo) || null,
                                         erro: (r && r.erro) || 'o servidor não respondeu' };
      safe(function () { JOGO.Vida.sincroniza(); return true; }, null);
      if (Guerra.aoFechou) { try { Guerra.aoFechou(copiaG(ultimaGuerra)); } catch (e) {} }
      mudaG();
      return copiaG(ultimaGuerra);
    });
  };
  Guerra.resultado = function () { return copiaG(ultimaGuerra); };
  function tiqueGuerraFila() {
    var t = Guerra._agora();
    if (gst.fase === 'pronta' && gst.entregue) {
      // a partida foi entregue ao Coop: acabou (ou caiu antes do salão) — aqui volta a livre
      var ses = safe(function () { return C().sessao(); }, null);
      if ((!ses || ses.tipo !== 'guerra' || ses.bid !== gst.entregue) && t - gst.entregueEm > 3000) { zeraGuerra(); mudaG(); }
      return;
    }
    if (gst.pedindo) return;
    if (gst.fase === 'livre') {
      if (Grupo.emGrupo() && tela() === 'hub' && t - gst.ultima >= Guerra.CONSULTA_GRUPO_MS && Guerra.disponivel().ok) Guerra.consulta();
      return;
    }
    if (gst.fase !== 'pronta' && (emBatalhaOuDescida() || minhaSala() || descidaG || !Grupo.emGrupo())) {
      aviso('Você saiu da fila da guerra de guilda.');
      Guerra.sair();
      return;
    }
    if (t - gst.ultima >= Guerra.CONSULTA_MS) Guerra.consulta();
  }
  Guerra._tique = tiqueGuerraFila;
  Guerra._reset = function () { zeraGuerra(); ultimaGuerra = null; };
  Guerra._st = function () { return gst; };

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
    if (mutado(ev.de) || inimigo(ev.de)) return;       // silenciado ou inimigo: nem linha, nem aviso
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
