// O Torneio da Arena — o cliente de servidor/torneio.py (dono: lógica; docs/TORNEIO.md é o contrato).
var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

/* O QUE ISTO É (10/10)
 * ====================
 * O dono: "a arena é o maior item do mapa e tem que ir além de procurar desafios, deve ter torneio; todo
 * sábado terá torneio de PvP e todo domingo torneio de guilda (ou quando o adm marcar)". Quem MANDA é o
 * servidor (as inscrições, as vagas que abrem aos pares, o sorteio, a chamada de 3 minutos, o W.O., o
 * prêmio); este módulo é só o que a tela precisa para mostrar e pedir:
 *
 *   - a LISTA pública (`GET /api/torneios`, cache curto): os torneios em andamento, os próximos e os
 *     últimos encerrados — a mesma que o site lê;
 *   - o MEU (`GET /api/torneio/meu`): as minhas inscrições, a luta para a qual fui chamado, as conquistas
 *     (os títulos e os graus da moldura saem delas) e o lado da guilda (voluntários, representante).
 *     É também o "ainda estou aqui" de quem espera a chamada, então a consulta é periódica: a cada
 *     ~20 s na praça com inscrição ou torneio do dia, a cada 3 s com chamada ou luta — e rara fora disso
 *     (as conquistas mudam pouco);
 *   - os pedidos: inscrever, sair, presente ("estou aqui"), voluntariar, desvoluntariar, representante.
 *
 * A LUTA NÃO É DAQUI. Quando os dois dizem "estou aqui", o servidor cria a partida PRONTA na Arena (uma
 * linha de arena_partidas com o `did` do torneio) e o `luta.did` aparece no MEU: este módulo só chama
 * `JOGO.Arena.consulta()` — a Arena de sempre lê `fase: 'pronta'` e entrega ao Duelo pela Rede, no modo
 * 'arena' (js/core/grupo.js). Um `did` é entregue UMA vez (a revanche vem com outro `did`); fora da praça
 * ou com outro duelo aberto a entrega espera, e a tela diz para voltar.
 *
 * O RELÓGIO é o do servidor (o desvio medido a cada resposta): `To.agora()` é o "agora" de lá, e todo
 * tempo que o servidor manda (inicioMs, prazoMs, previstoMs) se compara com ele. A data e a hora que o
 * jogador lê saem do fuso do aparelho (um `Date` do instante).
 *
 * SERVIDOR FORA OU VELHO (status 0 ou 404): nada quebra — a lista fica vazia, a aba diz que o torneio
 * ainda não chegou a este servidor, e a consulta espaça.
 */
(function () {
  'use strict';
  /* O TEXTO NO IDIOMA DO JOGADOR (docs/IDIOMAS.md): a chave é o próprio português. Sem o JOGO.I18n
   * (as provas em Node não o carregam) volta o português, com as {variáveis}. */
  function Tx(s, v) {
    var I = (typeof JOGO !== 'undefined' && JOGO) ? JOGO.I18n : null;
    if (I && I.t) return I.t(s, v);
    if (!v) return s;
    return String(s).replace(/\{([A-Za-z_]\w*)\}/g, function (m, k) {
      return Object.prototype.hasOwnProperty.call(v, k) ? String(v[k]) : m;
    });
  }

  var To = {};
  JOGO.Torneio = To;

  To.LISTA_MS = 60 * 1000;           // o cache da lista pública
  To.LISTA_VIVO_MS = 15 * 1000;      // com torneio sorteado ou em andamento a chave anda: a lista é relida mais vezes
  To.MEU_RAPIDO_MS = 3 * 1000;       // com chamada ou luta
  To.MEU_LENTO_MS = 20 * 1000;       // na praça com inscrição ou torneio do dia
  To.MEU_OCIOSO_MS = 5 * 60 * 1000;  // na praça sem nada disso (as conquistas mudam pouco)
  To.FALHA_MS = 60 * 1000;           // o servidor não respondeu (ou é de antes do torneio): espera
  To.ENTREGA_MS = 2500;              // entre duas tentativas de entregar a mesma luta à Arena
  To.DIA_MS = 24 * 3600 * 1000;
  To.CHAMADA_MS = 3 * 60 * 1000;     // os 3 minutos do "estou aqui" (só para a barra; quem conta é o servidor)
  To.FECHA_ANTES_MS = 10 * 60 * 1000;
  To.RODADA_MIN = 20;                // a previsão pública: início + rodada × 20 min
  To.VAGAS = [2, 4, 8, 16];
  To.TETO = 16;
  /* O PRÊMIO DO CAMPEÃO pelo tamanho da chave SORTEADA (a tabela do contrato). O servidor manda o do
   * tamanho de agora em `T.premio`; esta cópia existe para a tela mostrar o do torneio CHEIO (16) ao lado. */
  To.PREMIOS = {
    16: { barras: 20, vintens: 5000, gemas: 2, conquista: true, moldura: true, xpGuilda: 600 },
    8:  { barras: 10, vintens: 2500, gemas: 1, conquista: true, moldura: true, xpGuilda: 300 },
    4:  { barras: 5, vintens: 1250, gemas: 0, conquista: true, moldura: false, xpGuilda: 150 },
    2:  { barras: 2, vintens: 600, gemas: 0, conquista: false, moldura: false, xpGuilda: 60 }
  };
  To.XP_GUILDA_FATOR = 2;            // a guilda campeã: XP em dobro
  To.XP_GUILDA_DIAS = 7;
  To.CHAVE_VISTOS = 'soterra-torneio-vistos-v1';

  /* relógio injetável (as provas andam no tempo sem esperar) */
  To._agora = null;
  function relogio() { return typeof To._agora === 'function' ? To._agora() : Date.now(); }

  function isArr(v) { return Object.prototype.toString.call(v) === '[object Array]'; }
  function num(v, def) { return (typeof v === 'number' && isFinite(v)) ? v : def; }
  function inteiro(v, def) { return (typeof v === 'number' && isFinite(v)) ? Math.floor(v) : def; }
  function safe(fn, def) { try { var v = fn(); return v === undefined ? def : v; } catch (e) { return def; } }
  function copia(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }

  // ------------------------------------------------------------ o estado
  var st = null;
  function zera() {
    st = { lista: [], listaEm: 0, listaOk: false, listaErro: null, listaPedindo: false, semRota: false,
           meu: null, meuEm: 0, meuOk: false, meuPedindo: false, meuFalhaEm: 0,
           desvio: 0, entregues: {}, entregaEm: 0, bloqueio: null,
           lutaSig: '', didVisto: null, estados: {}, sig: '' };
  }
  zera();

  function avisaMudou() {
    var s = assina();
    if (s === st.sig) return;
    st.sig = s;
    if (To.aoMudar) { try { To.aoMudar(To.estado()); } catch (e) {} }
  }
  function assina() {
    return JSON.stringify([st.lista, st.meu, st.bloqueio, st.listaOk, st.meuOk, st.semRota, st.listaErro]);
  }

  // ------------------------------------------------------------ com quem se fala
  function sessao() { return JOGO.Sessao || null; }
  To.disponivel = function () {
    var proto = safe(function () { return window.location.protocol; }, '');
    if (proto === 'file:') {
      return { ok: false, motivo: 'arquivo', texto: Tx('O Torneio precisa do jogo aberto pelo site — do arquivo ele não fala com o servidor.') };
    }
    var s = sessao();
    if (!s || typeof s.api !== 'function' || !safe(function () { return s.ativa(); }, false)) {
      return { ok: false, motivo: 'sem-sessao', texto: Tx('O Torneio precisa da sua conta do site: entre para jogar.') };
    }
    return { ok: true };
  };
  function pede(rota, metodo, corpo, semToken) {
    var s = sessao();
    if (!s || typeof s.api !== 'function') return Promise.resolve({ ok: false, status: 0, erro: Tx('sem sessão') });
    var op = { method: metodo };
    if (corpo !== undefined) op.body = corpo;
    if (semToken) op.semToken = true;
    try {
      return Promise.resolve(s.api(rota, op)).then(function (r) { return r || { ok: false, status: 0 }; },
        function () { return { ok: false, status: 0, erro: Tx('o servidor não respondeu') }; });
    } catch (e) { return Promise.resolve({ ok: false, status: 0, erro: Tx('o servidor não respondeu') }); }
  }
  function acertaRelogio(r) {
    if (r && typeof r.agoraMs === 'number' && isFinite(r.agoraMs)) st.desvio = r.agoraMs - relogio();
  }
  /* o "agora" do SERVIDOR: todo tempo que ele manda se compara com este */
  To.agora = function () { return relogio() + st.desvio; };

  // ------------------------------------------------------------ o torneio como a tela o lê
  function limpaP(p) {
    if (!p || typeof p !== 'object') return null;
    var g = (p.guilda && typeof p.guilda === 'object') ? { id: p.guilda.id, nome: String(p.guilda.nome || ''), emblema: p.guilda.emblema || '' } : null;
    return { conta: p.conta, nome: String(p.nome || '?'), guilda: g };
  }
  function limpaClasses(v) {
    return (isArr(v) ? v : []).slice(0, 2).map(function (c) {
      return { classId: String((c && c.classId) || ''), nivel: inteiro(c && c.nivel, 1) };
    });
  }
  function limpaTorneio(t) {
    if (!t || typeof t !== 'object' || t.id == null) return null;
    var tipo = t.tipo === 'guilda' ? 'guilda' : 'pvp';
    var vagas = To.VAGAS.indexOf(t.vagas) >= 0 ? t.vagas : 2;
    var chave = null;
    if (t.chave && typeof t.chave === 'object' && isArr(t.chave.rodadas)) {
      chave = { tamanho: To.VAGAS.indexOf(t.chave.tamanho) >= 0 ? t.chave.tamanho : 2,
                rodada: Math.max(0, inteiro(t.chave.rodada, 0)),
                rodadas: t.chave.rodadas.map(function (rd, ri) {
                  return (isArr(rd) ? rd : []).map(function (l, li) {
                    l = l || {};
                    return { pos: inteiro(l.pos, li), rodada: ri, a: limpaP(l.a), b: limpaP(l.b),
                             estado: ['aguarda', 'chamada', 'luta', 'decidida'].indexOf(l.estado) >= 0 ? l.estado : 'aguarda',
                             vencedor: (l.vencedor === 'a' || l.vencedor === 'b') ? l.vencedor : null,
                             como: ['luta', 'wo', 'bye', 'sorteio', 'desistencia'].indexOf(l.como) >= 0 ? l.como : null,
                             previstoMs: num(l.previstoMs, null) };
                  });
                }) };
    }
    var pr = (t.premio && typeof t.premio === 'object') ? t.premio : {};
    return {
      id: t.id, tipo: tipo, faixa: (tipo === 'pvp' && typeof t.faixa === 'string') ? t.faixa : null,
      nivelMin: inteiro(t.nivelMin, 20), nivelMax: inteiro(t.nivelMax, 30),
      titulo: String(t.titulo || ''), origem: t.origem === 'mestre' ? 'mestre' : 'semanal',
      inicioMs: num(t.inicioMs, 0), inscricaoAteMs: num(t.inscricaoAteMs, num(t.inicioMs, 0) - To.FECHA_ANTES_MS),
      estado: ['inscricoes', 'sorteado', 'andamento', 'encerrado', 'cancelado'].indexOf(t.estado) >= 0 ? t.estado : 'inscricoes',
      vagas: vagas,
      inscritos: (isArr(t.inscritos) ? t.inscritos : []).map(function (x) {
        x = x || {};
        var p = limpaP(x) || { conta: null, nome: '?', guilda: null };
        p.nivel = inteiro(x.nivel, null);
        p.classes = limpaClasses(x.classes);
        return p;
      }),
      chave: chave,
      campeao: limpaP(t.campeao),
      premio: { barras: Math.max(0, inteiro(pr.barras, 0)), vintens: Math.max(0, inteiro(pr.vintens, 0)),
                gemas: Math.max(0, inteiro(pr.gemas, 0)), conquista: pr.conquista === true, moldura: pr.moldura === true,
                xpGuilda: Math.max(0, inteiro(pr.xpGuilda, 0)) }
    };
  }
  var ORDEM_ESTADO = { andamento: 0, sorteado: 1, inscricoes: 2, encerrado: 3, cancelado: 4 };
  function ordena(lista) {
    return lista.sort(function (a, b) {
      var ea = ORDEM_ESTADO[a.estado], eb = ORDEM_ESTADO[b.estado];
      if (ea !== eb) return ea - eb;
      // os que vêm: o mais próximo primeiro; os que passaram: o mais recente primeiro
      var d = ea >= 3 ? b.inicioMs - a.inicioMs : a.inicioMs - b.inicioMs;
      if (d) return d;
      // as duas chaves do mesmo sábado: a faixa de baixo primeiro
      var fa = a.faixa || '~', fb = b.faixa || '~';
      return fa < fb ? -1 : (fa > fb ? 1 : (a.id < b.id ? -1 : (a.id > b.id ? 1 : 0)));
    });
  }

  // ------------------------------------------------------------ a lista pública
  function minhaConta() { return safe(function () { return sessao().contaId(); }, null); }
  function armazem() {
    try { return (typeof window !== 'undefined' && window.localStorage) ? window.localStorage : null; }
    catch (e) { return null; }
  }
  function chaveVistos() {
    var Cn = JOGO.Contas;
    return To.CHAVE_VISTOS + ((Cn && Cn.sufixo) ? safe(function () { return Cn.sufixo(); }, '') : '');
  }
  function leVistos() {
    var s = armazem();
    try { var v = JSON.parse((s && s.getItem(chaveVistos())) || '[]'); return isArr(v) ? v.map(String) : []; }
    catch (e) { return []; }
  }
  function gravaVisto(id) {
    var s = armazem();
    if (!s) return;
    try {
      var v = leVistos();
      if (v.indexOf(String(id)) < 0) v.push(String(id));
      s.setItem(chaveVistos(), JSON.stringify(v.slice(-24)));
    } catch (e) {}
  }
  /* O FIM de um torneio chega à tela UMA vez: para quem estava inscrito (o campeão vê o prêmio, os outros o
   * aviso) mesmo que a página tenha sido recarregada no meio — o "já vi" mora no armário da conta —, e para
   * quem só assistia, quando a virada para `encerrado` acontece com o jogo aberto. */
  function confereFins(antes) {
    var eu = minhaConta(), vistos = null;
    st.lista.forEach(function (t) {
      var era = antes[t.id];
      if (t.estado !== 'encerrado' || !t.campeao) return;
      var participei = eu != null && (t.inscritos.some(function (x) { return x.conta === eu; }) || t.campeao.conta === eu);
      var aoVivo = !!era && era !== 'encerrado' && era !== 'cancelado';
      if (!participei && !aoVivo) return;
      if (vistos === null) vistos = leVistos();
      if (vistos.indexOf(String(t.id)) >= 0) return;
      gravaVisto(t.id);
      if (To.aoCampeao) { try { To.aoCampeao(copia(t), { eu: eu != null && t.campeao.conta === eu, participei: participei }); } catch (e) {} }
    });
  }
  function adotaLista(r) {
    acertaRelogio(r);
    var antes = st.estados;
    st.lista = ordena((isArr(r.torneios) ? r.torneios : []).map(limpaTorneio).filter(Boolean));
    st.estados = {};
    st.lista.forEach(function (t) { st.estados[t.id] = t.estado; });
    st.listaOk = true;
    st.listaErro = null;
    st.semRota = false;
    confereFins(antes);
  }
  /* a lista pública, do cache (ou do servidor, se o cache venceu ou `forca`) */
  To.busca = function (forca) {
    var t = relogio();
    if (st.listaPedindo) return st.listaPedindo;
    if (!forca && st.listaOk && t - st.listaEm < To.LISTA_MS) return Promise.resolve({ ok: true, torneios: To.torneios() });
    var era = st;
    st.listaEm = t;
    st.listaPedindo = pede('/api/torneios', 'GET', undefined, true).then(function (r) {
      if (st !== era) return { ok: false, torneios: [] };
      st.listaPedindo = false;
      if (r && r.ok) adotaLista(r);
      else {
        st.semRota = !!(r && r.status === 404);
        st.listaErro = st.semRota ? Tx('O Torneio da Arena ainda não chegou a este servidor.')
                                  : ((r && r.erro) || Tx('o servidor não respondeu'));
      }
      avisaMudou();
      return { ok: !!(r && r.ok), erro: st.listaErro, torneios: To.torneios() };
    });
    return st.listaPedindo;
  };
  To.torneios = function () { return copia(st.lista); };
  To.torneio = function (id) {
    for (var i = 0; i < st.lista.length; i++) if (String(st.lista[i].id) === String(id)) return copia(st.lista[i]);
    return null;
  };
  function trocaNaLista(t) {
    var novo = limpaTorneio(t);
    if (!novo) return;
    var achou = false;
    st.lista = st.lista.map(function (x) { if (String(x.id) === String(novo.id)) { achou = true; return novo; } return x; });
    if (!achou) st.lista.push(novo);
    ordena(st.lista);
    st.estados[novo.id] = novo.estado;
  }
  /* os que a aba mostra: o de PvP de cada faixa e o de guilda que estão em andamento ou vêm primeiro */
  To.proximos = function () {
    var vistos = {}, fora = [];
    st.lista.forEach(function (t) {
      if (t.estado === 'encerrado' || t.estado === 'cancelado') return;
      var k = t.tipo + '|' + (t.faixa || '');
      if (vistos[k]) return;
      vistos[k] = true;
      fora.push(copia(t));
    });
    return fora;
  };
  To.encerrados = function () {
    return copia(st.lista.filter(function (t) { return t.estado === 'encerrado'; }));
  };
  /* há torneio hoje? (em andamento, sorteado, ou com início nas próximas 24 h) */
  To.torneioDoDia = function () {
    var agora = To.agora();
    for (var i = 0; i < st.lista.length; i++) {
      var t = st.lista[i];
      if (t.estado === 'andamento' || t.estado === 'sorteado') return copia(t);
      if (t.estado === 'inscricoes' && t.inicioMs - agora < To.DIA_MS && t.inicioMs - agora > -To.DIA_MS) return copia(t);
    }
    return null;
  };

  // ------------------------------------------------------------ o MEU
  function limpaLuta(l) {
    if (!l || typeof l !== 'object' || l.torneio == null) return null;
    var ad = l.adversario || {};
    return { torneio: l.torneio, rodada: Math.max(0, inteiro(l.rodada, 0)), pos: Math.max(0, inteiro(l.pos, 0)),
             lado: l.lado === 'B' ? 'B' : 'A',
             adversario: { conta: ad.conta, nome: String(ad.nome || '?'), nivel: inteiro(ad.nivel, null), classes: limpaClasses(ad.classes) },
             prazoMs: num(l.prazoMs, 0), presente: l.presente === true, elePresente: l.elePresente === true,
             revanche: l.revanche === true,       // o duelo fechou sem vencedor: o servidor abriu UMA revanche (outro did)
             did: (typeof l.did === 'string' && l.did) ? l.did : null };
  }
  function limpaGuilda(g) {
    if (!g || typeof g !== 'object' || g.torneio == null) return null;
    return { torneio: g.torneio,
             voluntarios: (isArr(g.voluntarios) ? g.voluntarios : []).map(function (v) {
               v = v || {};
               return { conta: v.conta, nome: String(v.nome || '?'), nivel: inteiro(v.nivel, null),
                        classes: limpaClasses(v.classes), desdeMs: num(v.desdeMs, 0) };
             }),
             representante: (g.representante == null) ? null : g.representante,
             souVoluntario: g.souVoluntario === true, possoEscolher: g.possoEscolher === true };
  }
  function limpaMeu(r) {
    var cq = (r && r.conquistas) || {};
    return {
      inscricoes: (isArr(r.inscricoes) ? r.inscricoes : []).map(function (i) {
        i = i || {};
        return { torneio: i.torneio, herois: (isArr(i.herois) ? i.herois : []).slice(0, 2).map(String),
                 classes: limpaClasses(i.classes), nivel: inteiro(i.nivel, null) };
      }).filter(function (i) { return i.torneio != null; }),
      luta: limpaLuta(r.luta),
      conquistas: { pvp: Math.max(0, inteiro(cq.pvp, 0)), guilda: Math.max(0, inteiro(cq.guilda, 0)) },
      moldura: r.moldura === true, vigente: r.vigente === true,
      guilda: limpaGuilda(r.guilda)
    };
  }
  var MEU_VAZIO = { inscricoes: [], luta: null, conquistas: { pvp: 0, guilda: 0 }, moldura: false, vigente: false, guilda: null };
  function adotaMeu(r) {
    acertaRelogio(r);
    st.meu = limpaMeu(r);
    st.meuOk = true;
    st.meuFalhaEm = 0;
    var l = st.meu.luta;
    var sig = l ? [l.torneio, l.rodada, l.pos, l.adversario.conta].join('|') : '';
    if (sig && sig !== st.lutaSig && To.aoChamada) { try { To.aoChamada(To.luta()); } catch (e) {} }
    st.lutaSig = sig;
    if (l && l.did && l.did !== st.didVisto) {
      st.didVisto = l.did;
      if (To.aoPronta) { try { To.aoPronta(To.luta()); } catch (e2) {} }
    }
    if (!l) { st.bloqueio = null; st.didVisto = null; }
    entrega();
  }
  To.consulta = function () {
    if (st.meuPedindo) return st.meuPedindo;
    var disp = To.disponivel();
    if (!disp.ok) return Promise.resolve({ ok: false, motivo: disp.motivo, erro: disp.texto });
    var era = st;
    st.meuEm = relogio();
    st.meuPedindo = pede('/api/torneio/meu', 'GET').then(function (r) {
      if (st !== era) return { ok: false };
      st.meuPedindo = false;
      if (r && r.ok) adotaMeu(r);
      else st.meuFalhaEm = relogio();
      avisaMudou();
      return r;
    });
    return st.meuPedindo;
  };
  To.meu = function () { return copia(st.meu || MEU_VAZIO); };
  To.lido = function () { return st.meuOk; };
  To.inscricao = function (id) {
    var m = st.meu || MEU_VAZIO;
    for (var i = 0; i < m.inscricoes.length; i++) if (String(m.inscricoes[i].torneio) === String(id)) return copia(m.inscricoes[i]);
    return null;
  };
  /* a luta para a qual fui chamado, com o que a tela precisa a mais: se já foi entregue à Arena e o que a segura */
  To.luta = function () {
    var l = st.meu && st.meu.luta;
    if (!l) return null;
    var c = copia(l);
    c.entregue = !!(l.did && st.entregues[l.did]);
    c.bloqueio = st.bloqueio;
    return c;
  };
  /* a última luta do torneio entregue ao Duelo ({did, torneio}) — a tela do fim do duelo pergunta */
  var ultimaEntrega = null;
  To.lutaEntregue = function (did) {
    if (!ultimaEntrega) return null;
    if (did != null && String(did) !== String(ultimaEntrega.did)) return null;
    return copia(ultimaEntrega);
  };
  To.ehDoTorneio = function (did) { return !!(did && st.entregues[did]); };

  // ------------------------------------------------------------ a entrega da luta à Arena
  /* A TELA de verdade (a mesma leitura do grupo.js): o Acampamento ('hub') só existe na HUD — o Game.screen
   * fica em 'menu' ou 'heroSelect' enquanto o jogador anda pela praça */
  function telaDoJogo() {
    var u = safe(function () { return JOGO.UI.telaAtual(); }, null);
    if (u) return u;
    var g = safe(function () { return JOGO.Game.screen; }, null) || 'menu';
    return (g === 'menu' || g === 'heroSelect' || g === 'hub') ? 'hub' : g;
  }
  /* o que impede a luta de abrir AGORA (null = pode): a Arena só entrega ao Duelo na praça, com o duelo livre */
  function bloqueioDaEntrega() {
    if (!JOGO.Arena || typeof JOGO.Arena.consulta !== 'function') return 'sem-arena';
    if (telaDoJogo() !== 'hub') return 'fora-da-praca';
    var fase = safe(function () { return JOGO.Duelo.estado().fase; }, 'livre');
    if (fase && fase !== 'livre') return 'ocupado';
    return null;
  }
  function entrega() {
    var l = st.meu && st.meu.luta;
    if (!l || !l.did || st.entregues[l.did]) { if (!l || !l.did) st.bloqueio = null; return false; }
    // a Arena pode já ter pegado esta partida sozinha (quem estava inscrito no quadro consulta por conta própria)
    var ja = safe(function () { return JOGO.Arena._st().entregue; }, null);
    if (ja && ja === l.did) { marcaEntregue(l); return true; }
    var b = bloqueioDaEntrega();
    st.bloqueio = b;
    if (b) return false;
    var t = relogio();
    if (t - st.entregaEm < To.ENTREGA_MS) return false;
    st.entregaEm = t;
    var era = st, did = l.did;
    Promise.resolve(safe(function () { return JOGO.Arena.consulta(); }, null)).then(function () {
      if (st !== era) return;
      var a = safe(function () { return JOGO.Arena.estado(); }, null);
      var cur = st.meu && st.meu.luta;
      if (a && a.fase === 'pronta' && a.did === did && cur && cur.did === did) { marcaEntregue(cur); avisaMudou(); }
    }, function () {});
    return true;
  }
  function marcaEntregue(l) {
    st.entregues[l.did] = true;
    st.bloqueio = null;
    ultimaEntrega = { did: l.did, torneio: l.torneio, rodada: l.rodada, t: relogio() };
  }

  // ------------------------------------------------------------ os pedidos
  function falha(r) {
    r = r || {};
    return { ok: false, motivo: r.motivo || (r.status === 0 ? 'servidor' : (r.status === 404 ? 'sem-rota' : 'torneio')),
             erro: r.erro || null, nivel: r.nivel, nivelMin: r.nivelMin, nivelMax: r.nivelMax, status: r.status };
  }
  function limpaHerois(ids) {
    var lista = [];
    (isArr(ids) ? ids : []).forEach(function (h) {
      if (typeof h === 'string' && h && lista.indexOf(h) < 0 && lista.length < 2) lista.push(h);
    });
    return lista;
  }
  function pedeTorneio(rota, corpo, depois) {
    var disp = To.disponivel();
    if (!disp.ok) return Promise.resolve({ ok: false, motivo: disp.motivo, erro: disp.texto });
    var era = st;
    return pede(rota, 'POST', corpo).then(function (r) {
      if (st !== era) return { ok: false, motivo: 'ocupado' };
      if (!r || !r.ok) return falha(r);
      acertaRelogio(r);
      if (r.torneio) trocaNaLista(r.torneio);
      if (depois) depois(r);
      var feito = { ok: true, torneio: r.torneio ? To.torneio(r.torneio.id) : null };
      /* voluntariar, desvoluntariar e representante respondem o corpo do MEU (com o bloco `guilda` DAQUELE
       * torneio, docs/TORNEIO.md §4.3): adota-se direto, sem outra ida ao servidor */
      if (r.conquistas && typeof r.conquistas === 'object' && r.inscricoes) {
        st.meuEm = relogio();
        adotaMeu(r);
        avisaMudou();
        return feito;
      }
      avisaMudou();
      // inscrever e sair devolvem só o torneio: o MEU é relido (a inscrição nova, a saída)
      return To.consulta().then(function () { return feito; });
    });
  }
  /* inscreve (ou troca) a dupla: 1 ou 2 heróis, em ordem */
  To.inscrever = function (id, herois) {
    var lista = limpaHerois(herois);
    if (!lista.length) return Promise.resolve({ ok: false, motivo: 'n' });
    return pedeTorneio('/api/torneio/inscrever', { torneio: id, herois: lista });
  };
  To.sair = function (id) { return pedeTorneio('/api/torneio/sair', { torneio: id }); };
  /* "estou aqui": a resposta é o MEU inteiro */
  To.presente = function (id) {
    var disp = To.disponivel();
    if (!disp.ok) return Promise.resolve({ ok: false, motivo: disp.motivo, erro: disp.texto });
    var era = st;
    return pede('/api/torneio/presente', 'POST', { torneio: id }).then(function (r) {
      if (st !== era) return { ok: false, motivo: 'ocupado' };
      if (!r || !r.ok) return falha(r);
      st.meuEm = relogio();
      adotaMeu(r);
      avisaMudou();
      return { ok: true };
    });
  };
  To.voluntariar = function (id, herois) {
    var lista = limpaHerois(herois);
    if (!lista.length) return Promise.resolve({ ok: false, motivo: 'n' });
    return pedeTorneio('/api/torneio/voluntariar', { torneio: id, herois: lista });
  };
  To.desvoluntariar = function (id) { return pedeTorneio('/api/torneio/desvoluntariar', { torneio: id }); };
  /* o líder ou um oficial escolhe o representante entre os voluntários (`conta: null` desfaz) */
  To.representante = function (id, conta) {
    return pedeTorneio('/api/torneio/representante', { torneio: id, conta: (conta == null ? null : conta) });
  };

  // ------------------------------------------------------------ as contas que a tela faz
  /* o torneio aceita este nível? (o do herói MAIS FORTE da dupla) */
  To.cabeNaFaixa = function (t, nivel) {
    return !!t && typeof nivel === 'number' && nivel >= t.nivelMin && nivel <= t.nivelMax;
  };
  To.premioDe = function (tamanho) { return copia(To.PREMIOS[tamanho] || To.PREMIOS[2]); };
  /* o tamanho que a chave teria se o sorteio fosse agora: a menor potência de 2 que cabe os inscritos (mín. 2) */
  To.tamanhoCom = function (n) {
    var t = 2;
    while (t < n && t < To.TETO) t *= 2;
    return t;
  };
  /* o grau da moldura "Campeão da Arena" pelas conquistas: 1–2 → I, 3–4 → II, 5+ → III (0 = sem) */
  To.grau = function (n) {
    n = inteiro(n, 0);
    return n >= 5 ? 3 : (n >= 3 ? 2 : (n >= 1 ? 1 : 0));
  };
  /* o que a MINHA plaquinha carrega: {n, vigente} (o dos outros chega carimbado pelo Relé) */
  To.arenaDoPerfil = function () {
    var m = st.meu || MEU_VAZIO;
    return { n: m.conquistas.pvp, vigente: m.vigente === true, moldura: m.moldura === true };
  };
  /* a linha da chave em que uma conta está na rodada em curso (ou a última em que esteve) */
  To.linhaDe = function (t, conta) {
    if (!t || !t.chave || conta == null) return null;
    var achada = null;
    t.chave.rodadas.forEach(function (rd, ri) {
      rd.forEach(function (l) {
        if ((l.a && l.a.conta === conta) || (l.b && l.b.conta === conta)) achada = { rodada: ri, pos: l.pos, lado: (l.a && l.a.conta === conta) ? 'a' : 'b' };
      });
    });
    return achada;
  };
  /* o nome de cada rodada pelo que falta: Final, Semifinal, Quartas, Oitavas */
  To.nomeDaRodada = function (tamanho, rodada) {
    var lutas = tamanho / Math.pow(2, rodada + 1);
    if (lutas <= 1) return Tx('Final');
    if (lutas === 2) return Tx('Semifinal');
    if (lutas === 4) return Tx('Quartas');
    return Tx('Oitavas');
  };

  /* OS MOTIVOS DE RECUSA do contrato, em frase clara (e os de quem nem chegou a pedir) */
  To.textoRecusa = function (r) {
    if (!r) return Tx('O Torneio não respondeu.');
    var m = r.motivo;
    if (m === 'fechado') return Tx('As inscrições deste torneio já fecharam (elas fecham 10 minutos antes do início).');
    if (m === 'cheio') return Tx('O torneio está cheio: os 16 lugares já têm dono.');
    if (m === 'nivel') {
      return (typeof r.nivel === 'number' && typeof r.nivelMin === 'number' && typeof r.nivelMax === 'number')
        ? Tx('O herói mais forte da dupla está no nível {nivel}: esta chave é do nível {min} ao {max}.', { nivel: r.nivel, min: r.nivelMin, max: r.nivelMax })
        : Tx('O nível do herói mais forte da dupla está fora da faixa desta chave.');
    }
    if (m === 'outra-chave') return Tx('A sua conta já está em outra chave deste dia: uma conta, uma chave. Saia de lá para trocar.');
    if (m === 'mestre') return Tx('A conta do Mestre não entra no Torneio.');
    if (m === 'tipo') return Tx('Este torneio é de guilda: a inscrição é pelos voluntários da guilda, não pelo quadro.');
    if (m === 'dois') return Tx('A sua conta tem dois heróis que podem lutar: inscreva a dupla, os dois.');
    // os de guilda e os de quem pede sem estar inscrito (nomes que o cliente assume; fora deles vale a frase do servidor)
    if (m === 'sem-guilda') return Tx('Você precisa estar numa guilda para o torneio de guilda.');
    if (m === 'cargo') return Tx('Só o líder ou um oficial escolhe o representante da guilda.');
    if (m === 'sem-voluntario') return Tx('Esse membro não está entre os voluntários.');
    if (m === 'equipe') return Tx('A guilda da equipe não entra no Torneio.');
    if (m === 'sem-inscricao') return Tx('Você não está inscrito neste torneio.');
    if (m === 'sem-luta') return Tx('Não há luta sua sendo chamada agora.');
    if (m === 'n') return Tx('Escolha a dupla: um ou dois heróis.');
    if (m === 'sem-heroi') return Tx('Esse herói não está na sua conta do servidor.');
    if (m === 'sem-rota') return Tx('O Torneio da Arena ainda não chegou a este servidor.');
    if (m === 'servidor') return Tx('O servidor não respondeu — tente de novo em instantes.');
    if (r.erro) return r.erro;
    return Tx('Não deu agora.');
  };

  // ------------------------------------------------------------ o estado inteiro (a HUD desenha disto)
  To.estado = function () {
    var disp = To.disponivel();
    return { desligado: disp.ok ? null : disp.texto, lido: st.listaOk, lidoMeu: st.meuOk, semRota: st.semRota,
             erro: st.listaErro, agoraMs: To.agora(), torneios: To.torneios(), meu: To.meu(), luta: To.luta() };
  };

  // ------------------------------------------------------------ o tique (1 s)
  /* de quanto em quanto o MEU é relido agora (0 = não é) */
  To.ritmo = function () {
    var tela = telaDoJogo();
    var m = st.meu;
    if (m && m.luta) return tela === 'battle' ? To.MEU_LENTO_MS : To.MEU_RAPIDO_MS;
    if (tela !== 'hub') return 0;
    if (!st.meuOk) return 1;                                   // a primeira leitura, ao chegar à praça
    if (m && (m.inscricoes.length || (m.guilda && (m.guilda.souVoluntario || m.guilda.representante === minhaConta())))) return To.MEU_LENTO_MS;
    if (To.torneioDoDia()) return To.MEU_LENTO_MS;
    return To.MEU_OCIOSO_MS;
  };
  function tique() {
    if (!To.disponivel().ok) return false;
    var t = relogio();
    var fez = false;
    // a lista: só na praça (ou com luta), e mais vezes quando há chave andando
    var vivo = st.lista.some(function (x) { return x.estado === 'andamento' || x.estado === 'sorteado'; });
    var passoLista = st.semRota ? To.FALHA_MS * 5 : (vivo ? To.LISTA_VIVO_MS : To.LISTA_MS);
    if ((telaDoJogo() === 'hub' || (st.meu && st.meu.luta)) && !st.listaPedindo && t - st.listaEm >= passoLista) {
      To.busca(true);
      fez = true;
    }
    if (st.semRota) return fez;                                // servidor de antes do torneio: o MEU também não existe
    var passo = To.ritmo();
    if (passo && st.meuFalhaEm && t - st.meuFalhaEm < To.FALHA_MS && passo < To.FALHA_MS && !(st.meu && st.meu.luta)) passo = To.FALHA_MS;
    if (passo && !st.meuPedindo && t - st.meuEm >= passo) { To.consulta(); fez = true; }
    else if (st.meu && st.meu.luta && st.meu.luta.did && !st.entregues[st.meu.luta.did]) {
      // a luta está pronta e ainda não abriu (estava fora da praça, o duelo de antes fechou agora): tenta de novo
      var antes = st.bloqueio;
      entrega();
      if (antes !== st.bloqueio) avisaMudou();
    }
    return fez;
  }
  To._tique = tique;
  To._reset = function () { zera(); ultimaEntrega = null; };
  To._st = function () { return st; };
  /* aplica respostas como se tivessem vindo do servidor (as provas e as fotos) */
  To._injeta = function (lista, meu) {
    if (lista) { adotaLista(lista); st.listaEm = relogio(); }
    if (meu) { adotaMeu(meu); st.meuEm = relogio(); }
    avisaMudou();
  };

  if (typeof window !== 'undefined' && typeof setInterval === 'function') {
    setInterval(function () { try { tique(); } catch (e) {} }, 1000);
  }
})();
