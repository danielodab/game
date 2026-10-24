/* conta.js — a página da conta do site (site/conta.html). Fase C.
 *
 * SEM SESSÃO: Criar conta e Entrar, como antes, e o "esqueci a senha", que só
 * liga quando GET /api/saude diz `correio: true` (sem o envio de e-mail no
 * servidor, fica o aviso de antes). O esqueci tem dois passos: o e-mail; e o
 * código com a senha nova duas vezes. O passo 2 aparece SEMPRE depois do 1,
 * exista a conta ou não: o servidor responde a mesma frase para as duas, e a
 * página não pode contar mais do que ele.
 *
 * COM SESSÃO ("Minha conta", GET /api/conta): os dados, trocar a senha, trocar
 * o e-mail em dois passos (o código vai ao e-mail ATUAL), as sessões abertas e
 * a atividade. Um 401 quer dizer token morto (contrato da Fase C, 1.1): a
 * página esquece a sessão e mostra as abas. É o conserto do "você já está
 * dentro" que aparecia com token vencido.
 *
 * O RETRATO NO RANKING (10/09): GET /api/avatar sai junto com a conta e traz
 * as opções que o SERVIDOR aceita (os retratos das classes que a conta tem no
 * último save, mais as iniciais, e as fusões de qualquer dupla delas), a
 * escolha guardada e o que o ranking mostra agora. Um clique grava (POST
 * /api/avatar {avatar}, `null` = automático, o melhor herói), sem janelinha;
 * a recusa do servidor aparece como veio. A conta do Mestre só veste o
 * Cavaleiro Negro. O nome das classes vem de ../js/core/data/classes.js.
 *
 * O NOME DA CONTA NOVA passa pela lei dos nomes do jogo (../js/core/nomes.js,
 * que este arquivo carrega sob demanda): nome reservado à equipe (GM, Admin,
 * Administrador…) não sai da página. Sem a lei, o pedido sai como antes e o
 * servidor decide. O Entrar não passa por ela: conta antiga segue entrando.
 *
 * O ACEITE (02/10): criar conta exige marcar "Li e aceito os Termos de Uso e a
 * Política de Privacidade"; o pedido leva `aceiteTermos` = SITE.VERSAO_TERMOS e o
 * servidor grava a versão e o dia (servidor/privacidade.py). O bloco "Privacidade e
 * dados" da Minha conta (o aceite que falta, baixar os dados, excluir a conta) mora em
 * conta_privacidade.js, que só olha quando a Minha conta aparece.
 *
 * Rotas de hash: #criar, #entrar, #esqueci, #conta. Só o estado da tela vai no
 * endereço; e-mail, código e senha vão só no corpo do POST (SITE.api). Tudo que
 * vem do servidor passa pelo SITE.esc, ou entra por textContent. */
(function () {
  'use strict';
  /* O TEXTO NO IDIOMA DO VISITANTE (docs/IDIOMAS.md, etapa 3): a chave é o próprio português. Sem o
   * JOGO.I18n (página de prova que não carrega o js/core/i18n.js) volta o português, com as {variáveis}. */
  function Tx(s, v) {
    var I = window.JOGO && window.JOGO.I18n;
    if (I && I.t) return I.t(s, v);
    if (!v) return s;
    return String(s).replace(/\{([A-Za-z_]\w*)\}/g, function (m, k) {
      return Object.prototype.hasOwnProperty.call(v, k) ? String(v[k]) : m;
    });
  }
  var E = SITE.esc;
  function $(id) { return document.getElementById(id); }
  function proprio(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }

  var dados = null;       // a última resposta boa de GET /api/conta
  var correio = null;     // o servidor manda e-mail? (/api/saude; null = ainda não se sabe)
  var querEsqueci = /^#esqueci/.test(location.hash || '');
  var troca = null;       // a troca de e-mail aberta: {para, enviadoPara, expiraEm, reenviarEm}
  var emOutro = false;    // o jogador pediu para voltar ao passo 1 com uma troca aberta
  var relogio = 0;        // o intervalo que conta o "reenviar em …"
  var eqEmail = '';       // o e-mail do passo 1 do esqueci
  var tela = '';
  var avatar = null;      // a última resposta boa de GET /api/avatar
  var avatarErro = '';
  var avOcupado = false;  // uma troca de retrato a caminho

  /* ---- avisos e validação miúda ---- */
  function aviso(id, texto, tipo) {
    var el = $(id);
    if (!el) return;
    el.className = 'aviso' + (texto ? ' ' + (tipo || 'erro') : '');
    el.textContent = texto || '';
  }
  function marca(input, ruim) { input.classList.toggle('invalido', !!ruim); }
  function nomeValido(n) {
    return n === n.trim() && n.length >= 3 && n.length <= 20 && /^[\p{L}\p{N} _-]+$/u.test(n);
  }
  function emailParece(e) { return /^[^@\s]+@[^@\s]+$/.test(e); }
  function codigoDe(input) { return String(input.value || '').replace(/\s+/g, ''); }
  function seisDigitos(c) { return /^\d{6}$/.test(c); }
  function dd(n) { return (n < 10 ? '0' : '') + n; }
  function data(ts) {
    var d = new Date(Number(ts) * 1000);
    return isNaN(d.getTime()) ? '' : dd(d.getDate()) + '/' + dd(d.getMonth() + 1) + '/' + d.getFullYear();
  }
  function limpa(ids) { ids.forEach(function (id) { $(id).value = ''; $(id).classList.remove('invalido'); }); }

  /* ---- a lei dos nomes do jogo (../js/core/nomes.js), sob demanda ----
   * PEDIDO DO DONO: ninguém cria conta com nome da equipe (GM, Admin,
   * Administrador…). A lei é UMA só, a do jogo: este arquivo põe o <script>
   * dela quando o formulário de criar conta é usado (quem só entra não baixa
   * nada), SEM marca na URL — o Caddy revalida o que vem sem marca, e um ?v=
   * do instante ganharia "guarde por um ano". Com a lei, o nome recusado não
   * sai da página e o motivo dela aparece no aviso do cadastro, onde o erro
   * do servidor apareceria. Sem a lei (o arquivo não veio, quebrou ou passou
   * do prazo), o pedido sai como antes: quem manda é o servidor. */
  var LEI_NOMES = '../js/core/nomes.js';
  var PRAZO_LEI = 2500;       // ms que o envio espera pela lei que ainda está descendo
  var cargaLei = null;        // a promessa da carga: resolve quando o <script> termina, bem ou mal
  function lei() {
    var N = window.JOGO && window.JOGO.Nomes;
    return N && typeof N.valida === 'function' ? N : null;
  }
  function carregaLei() {
    if (!cargaLei) {
      cargaLei = new Promise(function (fim) {
        if (lei()) { fim(); return; }
        var s = document.createElement('script');
        s.onload = s.onerror = function () { fim(); };
        s.src = LEI_NOMES;
        (document.head || document.documentElement).appendChild(s);
      });
    }
    return cargaLei;
  }
  /* a lei, se ela chegar dentro do prazo; null deixa a decisão com o servidor */
  function esperaLei() {
    if (lei()) return Promise.resolve(lei());
    return Promise.race([carregaLei(), new Promise(function (r) { setTimeout(r, PRAZO_LEI); })]).then(lei);
  }
  /* {ok, motivo} do nome da conta nova: pela lei quando ela veio; sem ela (ou
   * se ela quebrar), a conferência miúda de sempre, espelho do servidor */
  function confereNome(nome, N) {
    if (N) {
      try {
        var v = N.valida(nome, 3, 20);
        if (v && typeof v.ok === 'boolean') {
          return { ok: v.ok, motivo: v.ok ? '' : String(v.motivo || Tx('esse nome não pode ser usado')) };
        }
      } catch (e) { /* a lei quebrou: fica a conferência de sempre, e o servidor decide */ }
    }
    return nomeValido(nome) ? { ok: true, motivo: '' }
      : { ok: false, motivo: Tx('Nome: 3 a 20 caracteres (letras, números, espaço, apóstrofo, _ ou -), sem espaço nas pontas.') };
  }

  /* ---- as telas e o endereço ---- */
  var TELAS_FORA = ['criar', 'entrar', 'esqueci'];
  function hashTela() {
    var m = /^#([a-z]+)/.exec(location.hash || '');
    return m ? m[1] : '';
  }
  function gravaHash(qual) {
    if (!history.replaceState || hashTela() === qual) return;
    // o endereço inteiro, e não só '#x': com um <base> na página, o '#x'
    // sozinho apontaria para outro arquivo e o replaceState recusaria
    try { history.replaceState(null, '', location.href.split('#')[0] + '#' + qual); } catch (e) { /* fica sem mexer no endereço */ }
  }
  function mostra(qual) {
    if (qual === 'esqueci' && correio !== true) qual = 'entrar';
    tela = qual;
    var fora = TELAS_FORA.indexOf(qual) >= 0;
    $('conta-carregando').hidden = qual !== 'carregando';
    $('caixa-fora').hidden = !fora;
    $('minha-conta').hidden = qual !== 'conta';
    if (fora) {
      TELAS_FORA.forEach(function (t) { $('painel-' + t).classList.toggle('ligado', t === qual); });
      $('aba-criar').classList.toggle('ligada', qual === 'criar');
      $('aba-entrar').classList.toggle('ligada', qual === 'entrar');
    }
    if (qual !== 'conta') paraRelogio();
    if (qual !== 'carregando') gravaHash(qual);
  }
  /* sem sessão, a tela que o endereço pede; #conta sem sessão cai no Entrar */
  function telaFora() {
    var h = hashTela();
    return (h === 'entrar' || h === 'conta') ? 'entrar' : h === 'esqueci' ? 'esqueci' : 'criar';
  }

  /* ---- o "esqueci a senha" liga com o correio do servidor ---- */
  function ligaEsqueci(sim) {
    correio = sim === true;
    var a = $('esqueci');
    a.classList.toggle('desligado', !correio);
    a.setAttribute('aria-disabled', correio ? 'false' : 'true');
    if (correio) a.removeAttribute('title'); else a.title = Tx('em breve');
    if (correio && querEsqueci && !SITE.sessao() && tela !== 'esqueci') mostra('esqueci');
  }

  /* ---- a sessão ---- */
  function sessaoMorta(texto, tipo) {
    SITE.esquece();
    SITE.cabecalho();
    dados = null;
    troca = null;
    avatar = null;
    avatarErro = '';
    mostra('entrar');
    aviso('e-aviso', texto, tipo || 'neutro');
  }
  /* 11/09 (pedido do dono: "ao logar na conta o jogo não pode entrar sozinho,
   * às vezes o jogador só quer fazer algo na gestão da conta mesmo"). Entrar
   * agora PÁRA na conta: o painel "Minha conta" abre, com o botão Jogar à
   * mão. Só o CADASTRO segue direto para o jogo — o botão dele promete isso
   * na letra ("Criar conta e jogar") e quem acabou de nascer quer jogar. */
  /* 06/10 (o dono: somente online, "tem que exigir conta sempre!!"): o jogo no ar não abre sem conta — o
   * porteiro do index.html manda para cá e deixa uma marca NA ABA (sessionStorage; nunca no endereço). Quem
   * chegou assim veio para JOGAR: entrar devolve ao jogo sozinho (no aplicativo, dentro do mesmo WebView).
   * A marca é lida uma vez; quem abre a página da conta por conta própria segue parando nela. */
  var CHAVE_VOLTA = 'soterra-volta-jogo';       // a mesma do porteiro (index.html) e do js/core/sessao.js
  function porta() { return !!(SITE.portaDoApp && SITE.portaDoApp()); }
  var voltaAoJogo = false;
  function leVolta() {
    try {
      voltaAoJogo = sessionStorage.getItem(CHAVE_VOLTA) === '1';
      if (voltaAoJogo) sessionStorage.removeItem(CHAVE_VOLTA);
    } catch (e) { voltaAoJogo = false; }
    return voltaAoJogo;
  }
  function entrou(r, direto) {
    // o que o jogo vai ler: token + a conta enxuta
    SITE.guarda({ token: r.token, conta: { id: r.conta.id, nome: r.conta.nome, gm: !!r.conta.gm } });
    // 24/10: no aplicativo a página da conta é só a ENTRADA (SITE.portaDoApp) — entrou, é o jogo; na aba do site
    // de dentro do jogo (SITE.naAba), entrar fecha a aba e o jogo recarrega com a conta que entrou
    if (direto || voltaAoJogo || porta() || (SITE.naAba && SITE.naAba())) { SITE.vaiAoJogo(); return; }
    SITE.cabecalho();
    carregaConta();
  }

  /* depois: {geral, tipo} vai no aviso do topo; {email} no aviso do passo em
   * que a troca de e-mail estiver */
  function carregaConta(depois) {
    depois = depois || {};
    if (!avatar) carregaAvatar();         // o retrato sai junto com a conta, uma vez
    if (!dados) {
      mostra('carregando');
      $('cc-texto').className = 'estado';
      $('cc-texto').textContent = Tx('carregando a sua conta…');
      $('cc-botoes').hidden = true;
    }
    return SITE.api('/api/conta').then(function (r) {
      if (r.status === 401) {
        sessaoMorta(Tx('A sessão desta página tinha vencido (ou foi encerrada em outro lugar). Entre de novo.'));
        return;
      }
      if (!r.ok || !r.conta) {
        if (dados) { aviso('mc-aviso', SITE.erro(r, Tx('não deu para atualizar a conta'))); return; }
        mostra('carregando');
        $('cc-texto').className = 'estado fora';
        $('cc-texto').textContent = r.status === 0 ? Tx('O servidor está fora — a sua conta volta com ele.')
          : r.status === 404 ? Tx('A página da conta ainda não chegou a este servidor.')
          : SITE.erro(r, Tx('não deu para ler a conta'));
        $('cc-botoes').hidden = false;
        return;
      }
      // 24/10: na porta do aplicativo não há "Minha conta" (ela mora na aba do site, dentro do jogo): quem já
      // está com a sessão boa vai jogar
      if (porta()) { SITE.vaiAoJogo(); return; }
      dados = r;
      desenhaConta();
      mostra('conta');
      if (depois.geral) aviso('mc-aviso', depois.geral, depois.tipo || 'certo');
      if (depois.email) aviso(troca && !emOutro ? 'em-aviso2' : 'em-aviso1', depois.email, 'erro');
    });
  }

  /* ---- Minha conta: o desenho ---- */
  function desenhaConta() {
    var c = dados.conta || {};
    $('mc-dados').innerHTML =
      (c.gm
        ? Tx('<dt>Nome</dt><dd>{a} <span class="marca-gm" title="Mestre do Fundo">◆ Mestre do Fundo</span></dd><dt>E-mail</dt><dd>{b}</dd><dt>Criada em</dt><dd>{c}</dd>', { a: E(c.nome), b: E(c.email), c: E(data(c.criadoEm)) })
        : Tx('<dt>Nome</dt><dd>{a}</dd><dt>E-mail</dt><dd>{b}</dd><dt>Criada em</dt><dd>{c}</dd>', { a: E(c.nome), b: E(c.email), c: E(data(c.criadoEm)) }));
    desenhaEmail();
    desenhaSessoes();
    desenhaAtividade();
    desenhaAvatar();
  }

  /* -- o retrato no ranking: as opções são as do servidor, e cada id é
   * conferido pela gramática antes de virar botão ('classe:<id>',
   * 'fus:<a>+<b>' e 'gm'; '' é o automático) */
  var RE_AVATAR = /^(classe:[a-z][a-z0-9]*|fus:[a-z][a-z0-9]*\+[a-z][a-z0-9]*|gm)$/;
  function classesDoJogo() { return (window.JOGO && JOGO.DATA && JOGO.DATA.classes) || {}; }
  function nomeClasse(id) {
    var C = classesDoJogo();
    return (proprio(C, id) && C[id].name) || String(id == null ? '' : id);
  }
  function corClasse(id) {
    var C = classesDoJogo();
    return (proprio(C, id) && C[id].palette && C[id].palette.primary) || '';
  }
  /* o que um id de retrato mostra: {nome, foto} (null = id que o site não entende) */
  function retrato(id) {
    // o Mestre: a arte do Cavaleiro Negro, a MESMA da caixa "Equipe" do ranking (conserto 11/09), na moldura
    // escura do .busto.gm; sem o arquivo, o ◆
    if (id === 'gm') {
      return { nome: Tx('Cavaleiro Negro'), foto: SITE.busto({ src: 'img/equipe-cavaleiro-busto.webp', reserva: 'img/equipe-cavaleiro.webp',
                                                          letra: '◆', cor: '#8a1f2d' }).replace('class="busto', 'class="busto gm') };
    }
    var m = /^classe:([a-z][a-z0-9]*)$/.exec(id || '');
    if (m) {
      var n = nomeClasse(m[1]);
      return { nome: n, foto: SITE.busto({ src: SITE.img('classe', m[1], true), letra: SITE.inicial(n), cor: corClasse(m[1]) }) };
    }
    var par = /^fus:/.test(id || '') ? SITE.parDe(id) : null;
    if (par) {
      var a = nomeClasse(par[0]), b = nomeClasse(par[1]);
      return { nome: a + ' + ' + b, foto: SITE.busto({ src: SITE.img('fusao', par, true), reserva: SITE.img('classe', par[0], true),
                                                       letra: SITE.inicial(a), cor: corClasse(par[0]) }) };
    }
    return null;
  }
  function botaoAvatar(id, foto, nome, sub, atual) {
    return '<button type="button" class="av-op" data-avatar="' + E(id) + '" aria-pressed="' + (atual ? 'true' : 'false') + '"' +
      (avOcupado ? ' disabled' : '') + ' title="' + E(nome) + '">' + foto + '<span class="av-nome">' + E(nome) +
      (sub ? '<br><small>' + E(sub) + '</small>' : '') + '</span></button>';
  }
  function carregaAvatar() {
    return SITE.api('/api/avatar').then(function (r) {
      if (r.status === 401) {
        if (SITE.sessao()) sessaoMorta(Tx('A sessão desta página tinha vencido (ou foi encerrada em outro lugar). Entre de novo.'));
        return;
      }
      if (r.ok && Array.isArray(r.opcoes)) { avatar = r; avatarErro = ''; }
      else {
        avatar = null;
        avatarErro = r.status === 0 ? Tx('O servidor está fora — os retratos voltam com ele.')
          : r.status === 404 ? Tx('A escolha do retrato ainda não chegou a este servidor.')
          : SITE.erro(r, Tx('não deu para ler os retratos'));
      }
      desenhaAvatar();
    });
  }
  function desenhaAvatar() {
    var g = $('av-grade'), ef = $('av-efetivo'), txt = $('av-texto');
    if (!avatar) {
      ef.hidden = true;
      g.innerHTML = '<div class="estado' + (avatarErro ? ' fora' : '') + '">' + E(avatarErro || Tx('carregando os retratos…')) + '</div>';
      return;
    }
    if (avatar.gm) {
      txt.textContent = Tx('A conta do Mestre do Fundo aparece com o Cavaleiro Negro: ele não troca de retrato.');
      ef.hidden = true;
      g.innerHTML = '<div class="av-mestre" data-avatar-mestre>' +
        Tx('{foto}<div><b>Cavaleiro Negro</b><small>o retrato do Mestre do Fundo</small></div>', { foto: retrato('gm').foto }) +
        '</div>';
      return;
    }
    var ops = (Array.isArray(avatar.opcoes) ? avatar.opcoes : []).map(function (o) {
      return o && typeof o.id === 'string' ? o.id : '';
    }).filter(function (id, i, todos) { return RE_AVATAR.test(id) && id !== 'gm' && todos.indexOf(id) === i && !!retrato(id); });
    var escolhido = typeof avatar.escolhido === 'string' ? avatar.escolhido : '';
    var vale = !escolhido || ops.indexOf(escolhido) >= 0;
    txt.textContent = (avatar.semSave
      ? (vale ? Tx('O retrato aparece no ranking. Libere classes no jogo para ganhar mais retratos. Sem save no servidor ainda: por enquanto, só os retratos das classes do começo.') : Tx('O retrato aparece no ranking. Libere classes no jogo para ganhar mais retratos. Sem save no servidor ainda: por enquanto, só os retratos das classes do começo. O retrato escolhido não vale mais (a classe saiu do seu save): o ranking usa o automático.'))
      : (vale ? Tx('O retrato aparece no ranking. Libere classes no jogo para ganhar mais retratos.') : Tx('O retrato aparece no ranking. Libere classes no jogo para ganhar mais retratos. O retrato escolhido não vale mais (a classe saiu do seu save): o ranking usa o automático.')));
    var html = botaoAvatar('', '<span class="busto sem-foto" data-letra="✦"></span>', Tx('Automático'), Tx('o seu melhor herói'),
                           !escolhido || !vale);
    ops.forEach(function (id) {
      var r = retrato(id);
      html += botaoAvatar(id, r.foto, r.nome, '', id === escolhido);
    });
    g.innerHTML = html;
    // o que o ranking mostra agora (o servidor diz; o busto é o mesmo do ranking)
    var e = avatar.efetivo && typeof avatar.efetivo === 'object' ? avatar.efetivo : {};
    var nomeConta = (dados && dados.conta && dados.conta.nome) || '';
    var par = SITE.parDe(e.avatar);
    var agora = par ? nomeClasse(par[0]) + ' + ' + nomeClasse(par[1])
      : proprio(classesDoJogo(), e.classe) && e.classe !== 'gm' ? nomeClasse(e.classe) : Tx('a inicial do seu nome');
    ef.innerHTML = Tx('{a}<span>No ranking agora: <b>{b}</b></span>', { a: SITE.bustoJogador({ avatar: e.avatar, classe: e.classe, nome: nomeConta }), b: E(agora) });
    ef.hidden = false;
  }
  function escolheAvatar(id) {
    if (avOcupado || !avatar || avatar.gm) return;
    avOcupado = true;
    desenhaAvatar();
    aviso('av-aviso', Tx('Trocando o retrato…'), 'neutro');
    SITE.api('/api/avatar', { method: 'POST', body: { avatar: id || null } }).then(function (r) {
      avOcupado = false;
      if (r.status === 401) { sessaoMorta(Tx('A sessão desta página tinha vencido. Entre de novo.')); return; }
      if (!r.ok) { aviso('av-aviso', SITE.erro(r, Tx('não deu para trocar o retrato'))); desenhaAvatar(); return; }
      if (avatar) {
        avatar.escolhido = typeof r.escolhido === 'string' ? r.escolhido : null;
        if (r.efetivo && typeof r.efetivo === 'object') avatar.efetivo = r.efetivo;
      }
      desenhaAvatar();
      aviso('av-aviso', Tx('Retrato trocado: o ranking já mostra.'), 'certo');
    });
  }

  /* -- trocar o e-mail: o passo 2 abre direto quando o servidor tem um pedido aberto */
  function desenhaEmail() {
    var sem = dados.correio === false;
    $('em-sem-correio').hidden = !sem;
    $('em-bt1').disabled = sem;
    var t = dados.trocaEmail;
    troca = t ? { para: t.para, enviadoPara: t.enviadoPara, expiraEm: t.expiraEm, reenviarEm: t.reenviarEm } : null;
    passoEmail(troca && !emOutro ? 2 : 1);
  }
  function paraRelogio() { if (relogio) { clearInterval(relogio); relogio = 0; } }
  function contaReenvio() {
    var bt = $('em-reenviar');
    if (!troca) { paraRelogio(); return; }
    var falta = Math.ceil(Number(troca.reenviarEm) - SITE.agora());
    if (falta > 0) {
      bt.disabled = true;
      bt.textContent = Tx('reenviar em {a}', { a: falta >= 60 ? SITE.duracao(falta) : falta + ' s' });
    } else {
      bt.disabled = false;
      bt.textContent = Tx('reenviar o código');
    }
  }
  function passoEmail(n) {
    if (n === 2 && !troca) n = 1;
    $('em-form1').hidden = n !== 1;
    $('em-form2').hidden = n !== 2;
    $('em-passo1').classList.toggle('ligado', n === 1);
    $('em-passo2').classList.toggle('ligado', n === 2);
    $('em-reenvio').hidden = true;
    paraRelogio();
    if (n !== 2) return;
    var vale = Number(troca.expiraEm) > SITE.agora()
      ? ' ' + Tx('Ele vale até as {a}.', { a: E(SITE.hora(troca.expiraEm)) })
      : Tx(' Se ele já venceu, peça outro.');
    // o servidor manda o endereço já mascarado; sem ele, a página mascara o da conta
    var para = troca.enviadoPara || SITE.mascara(dados && dados.conta && dados.conta.email) || 'o e-mail atual da conta';
    $('em-enviado').innerHTML = Tx('O código foi para <b>{a}</b>, o e-mail atual da conta. Ele troca o e-mail{b}.{vale}', { a: E(para), b: troca.para ? ' ' + Tx('para <b>{a}</b>', { a: E(troca.para) }) : '', vale: vale });
    contaReenvio();
    relogio = setInterval(contaReenvio, 1000);
  }

  /* -- sessões: o navegador em palavras, o IP mascarado e a marca "esta" */
  function ipMascarado(ip) {
    ip = String(ip == null ? '' : ip);
    if (!ip || ip.indexOf('*') >= 0) return ip;
    var v4 = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(ip);
    if (v4) return v4[1] + '.' + v4[2] + '.*.*';
    if (ip.indexOf(':') >= 0) return ip.split(':').slice(0, 2).join(':') + ':…';
    return '';
  }
  function desenhaSessoes() {
    var lista = (Array.isArray(dados.sessoes) ? dados.sessoes : []).filter(function (s) { return s && s.id != null; });
    lista.sort(function (a, b) {
      return (b.estaAqui ? 1 : 0) - (a.estaAqui ? 1 : 0) || (Number(b.ultimoUso) || 0) - (Number(a.ultimoUso) || 0);
    });
    $('mc-sessoes').innerHTML = lista.length ? lista.map(function (s) {
      var ip = ipMascarado(s.ip);
      var miudo = [ip ? 'IP ' + ip : '', s.ultimoUso ? Tx('último uso {a}', { a: SITE.ha(s.ultimoUso) }) : '',
                   s.criadoEm ? Tx('desde {a}', { a: data(s.criadoEm) }) : ''].filter(Boolean).map(E).join(' · ');
      return '<li' + (s.estaAqui ? ' class="esta"' : '') + ' data-sessao="' + E(s.id) + '"><div><b>' +
        E(SITE.navegador(s.agente)) + '</b>' + (s.estaAqui ? '<span class="etiqueta aberto">' + Tx('esta') + '</span>' : '') +
        (miudo ? '<small>' + miudo + '</small>' : '') + '</div>' +
        (s.estaAqui ? '' : '<button type="button" class="btn btn-mini" data-encerrar="' + E(s.id) + '">' + Tx('encerrar') + '</button>') +
        '</li>';
    }).join('') : Tx('<li class="apoio">nenhuma sessão aberta</li>');
    $('ss-outras').disabled = !lista.some(function (s) { return !s.estaAqui; });
  }

  /* -- atividade: só o tipo e a hora (o servidor não manda mais nada) */
  var ATIVIDADE = {
    'cadastro': Tx('conta criada'),
    'login': Tx('entrada na conta'),
    'login-recusado': Tx('tentativa de entrar com a senha errada'),
    'senha-recusada': Tx('senha atual errada na página da conta'),
    'senha-trocada': Tx('senha trocada'),
    'senha-redefinida': Tx('senha redefinida pelo e-mail'),
    'email-pedido': Tx('pedido de troca de e-mail'),
    'email-trocado': Tx('e-mail trocado'),
    'sessoes-encerradas': Tx('sessões encerradas'),
    'esqueci-pedido': Tx('pedido de "esqueci a senha"')
  };
  var ALERTA = { 'login-recusado': true, 'senha-recusada': true };
  function desenhaAtividade() {
    var lista = Array.isArray(dados.atividade) ? dados.atividade.slice(0, 10) : [];
    $('mc-atividade').innerHTML = lista.length ? lista.map(function (a) {
      a = a || {};
      var nome = proprio(ATIVIDADE, a.tipo) ? ATIVIDADE[a.tipo] : String(a.tipo == null ? Tx('acontecimento') : a.tipo);
      return '<li' + (proprio(ALERTA, a.tipo) ? ' class="alerta"' : '') + '><span>' + E(nome) + '</span>' +
        '<time>' + E(SITE.quando(a.em)) + '</time></li>';
    }).join('') : Tx('<li class="apoio">nada registrado ainda</li>');
  }

  /* ---- Minha conta: as ações ---- */
  function pedeCodigo(senha, novo, idAviso, bt) {
    aviso(idAviso, Tx('Mandando o código…'), 'neutro');
    bt.disabled = true;
    return SITE.api('/api/conta/email/pedir', { method: 'POST', body: { senha: senha, novoEmail: novo } }).then(function (r) {
      bt.disabled = false;
      if (r.status === 401) { sessaoMorta(Tx('A sessão desta página tinha vencido. Entre de novo.')); return; }
      if (!r.ok) { aviso(idAviso, SITE.erro(r, Tx('não deu para mandar o código'))); return; }
      limpa(['em-senha', 'em-novo', 'em-novo2', 'em-senha-re', 'em-codigo']);
      troca = { para: novo, enviadoPara: r.enviadoPara, expiraEm: r.expiraEm, reenviarEm: r.reenviarEm };
      emOutro = false;
      aviso('em-aviso1', '');
      passoEmail(2);
      aviso('em-aviso2', Tx('Código enviado para {a}. Confira a caixa de entrada e o spam.', { a: r.enviadoPara || 'o e-mail atual' }), 'certo');
    });
  }

  function encerra(corpo, bt) {
    if (bt) bt.disabled = true;
    aviso('ss-aviso', Tx('Encerrando…'), 'neutro');
    return SITE.api('/api/conta/sessoes/encerrar', { method: 'POST', body: corpo }).then(function (r) {
      if (bt) bt.disabled = false;
      if (r.status === 401) { sessaoMorta(Tx('Esta sessão já tinha sido encerrada. Entre de novo.')); return; }
      if (!r.ok) {
        aviso('ss-aviso', SITE.erro(r, Tx('não deu para encerrar')));
        if (r.status === 404) carregaConta();
        return;
      }
      var n = Number(r.encerradas) || 0;
      if (corpo.todas || r.estaEncerrada) {
        // "sair de todas" inclui esta: a página esquece a sessão logo em seguida
        sessaoMorta(corpo.todas ? Tx('Você saiu de todas as sessões{a}. Entre de novo quando quiser.', { a: n > 1 ? ' (' + n + ')' : '' }) : Tx('Esta sessão foi encerrada. Entre de novo quando quiser.'), 'certo');
        return;
      }
      aviso('ss-aviso', n === 1 ? Tx('1 sessão encerrada.') : n ? Tx('{n} sessões encerradas.', { n: n }) : Tx('Não havia sessão para encerrar.'), 'certo');
      carregaConta();
    });
  }

  /* 15/10 — O CONVITE: `conta.html?convite=<código>#criar` (o link que o amigo mandou; servidor/convites.py).
   * O código vai na consulta, não no hash (o gravaHash reescreve o hash); fica guardado na sessão da aba
   * para sobreviver à troca de tela, mostra a linha "convidado por um amigo" e vai no POST do cadastro. */
  function conviteDaUrl() {
    try {
      var m = /[?&]convite=([A-Za-z0-9]{4,12})/.exec(location.search || '');
      if (m) { sessionStorage.setItem('soterra-convite', m[1].toUpperCase()); return m[1].toUpperCase(); }
      return sessionStorage.getItem('soterra-convite') || null;
    } catch (e) { return null; }
  }
  function mostraConvite() {
    var c = conviteDaUrl(), p = $('c-convite-dica');
    if (!p) return;
    p.hidden = !c;
    if (c) p.innerHTML = Tx('Você veio pelo convite de um amigo: na sua <b>primeira vitória</b>, vocês dois ganham <b>500 vinténs</b>.');
  }
  function inicia() {
    mostraConvite();
    /* -- abas e links de tela */
    $('aba-criar').addEventListener('click', function () { mostra('criar'); });
    $('aba-entrar').addEventListener('click', function () { mostra('entrar'); });
    $('ir-entrar').addEventListener('click', function (ev) { ev.preventDefault(); mostra('entrar'); });
    $('ir-criar').addEventListener('click', function (ev) { ev.preventDefault(); mostra('criar'); });
    $('eq-voltar').addEventListener('click', function (ev) { ev.preventDefault(); mostra('entrar'); });
    window.addEventListener('hashchange', function () {
      if (SITE.sessao()) { if (tela !== 'conta' && tela !== 'carregando') carregaConta(); return; }
      if (hashTela() === 'esqueci') querEsqueci = true;
      mostra(telaFora());
    });
    // sair pelo topo (ou pelo botão da página): a página volta para as abas
    window.addEventListener('site:sessao', function () {
      dados = null;
      troca = null;
      avatar = null;
      avatarErro = '';
      mostra('entrar');
      aviso('e-aviso', Tx('Você saiu desta conta neste navegador.'), 'neutro');
    });
    $('mc-sair').addEventListener('click', function () { SITE.sair(); });
    $('cc-sair').addEventListener('click', function () { SITE.sair(); });
    $('cc-tentar').addEventListener('click', function () { carregaConta(); });

    /* -- criar conta: a lei dos nomes desce quando o formulário é usado, e o
     * envio espera por ela (até PRAZO_LEI) antes de conferir o nome */
    $('painel-criar').addEventListener('focusin', function () { carregaLei(); });
    $('painel-criar').addEventListener('input', function () { carregaLei(); });
    $('painel-criar').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var bt = $('c-bt');
      if (bt.disabled) return;
      if (!lei()) aviso('c-aviso', Tx('Conferindo o nome…'), 'neutro');
      bt.disabled = true;
      esperaLei().then(function (N) {
        bt.disabled = false;
        criaConta(N);
      });
    });
    function criaConta(N) {
      var nome = $('c-nome').value, email = $('c-email').value.trim(),
          senha = $('c-senha').value, senha2 = $('c-senha2').value;
      var erro = null, vn = confereNome(nome, N);
      marca($('c-nome'), !vn.ok);
      marca($('c-email'), !emailParece(email));
      marca($('c-senha'), senha.length < 8);
      marca($('c-senha2'), senha2 !== senha);
      // 02/10: o aceite dos Termos e da Política (o servidor recusa sem ele, e grava a versão)
      var aceitou = !!$('c-aceite').checked;
      $('c-aceite').parentNode.classList.toggle('invalido', !aceitou);
      if (!vn.ok) erro = vn.motivo;
      else if (!emailParece(email)) erro = Tx('Esse e-mail não parece um e-mail.');
      else if (senha.length < 8) erro = Tx('A senha precisa ter pelo menos 8 caracteres.');
      else if (senha2 !== senha) erro = Tx('As duas senhas não batem.');
      else if (!aceitou) erro = Tx('Para criar a conta, leia e aceite os Termos de Uso e a Política de Privacidade.');
      if (erro) { aviso('c-aviso', erro); return; }
      aviso('c-aviso', Tx('Criando a conta…'), 'neutro');
      $('c-bt').disabled = true;
      SITE.api('/api/cadastro', { method: 'POST', semToken: true,
                                  body: { nome: nome, email: email, senha: senha, aceiteTermos: SITE.VERSAO_TERMOS,
                                          convite: conviteDaUrl() || undefined } })
        .then(function (r) {
          $('c-bt').disabled = false;
          if (!r.ok) { aviso('c-aviso', SITE.erro(r, Tx('não deu para criar a conta'))); return; }
          aviso('c-aviso', Tx('Conta criada! Entrando no jogo…'), 'certo');
          entrou(r, true);
        });
    }

    /* -- entrar */
    $('painel-entrar').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var login = $('e-login').value.trim(), senha = $('e-senha').value;
      marca($('e-login'), !login);
      marca($('e-senha'), !senha);
      if (!login || !senha) { aviso('e-aviso', Tx('Informe o nome (ou e-mail) e a senha.')); return; }
      aviso('e-aviso', Tx('Entrando…'), 'neutro');
      $('e-bt').disabled = true;
      SITE.api('/api/login', { method: 'POST', semToken: true, body: { login: login, senha: senha } })
        .then(function (r) {
          $('e-bt').disabled = false;
          if (!r.ok) { aviso('e-aviso', SITE.erro(r, Tx('não deu para entrar'))); return; }
          aviso('e-aviso', Tx('Bem-vindo de volta, {nome}.', { nome: r.conta.nome }), 'certo');
          entrou(r);                 // fica na conta: quem quer jogar aperta Jogar
        });
    });

    /* -- esqueci a senha: sem o correio do servidor, o aviso de sempre */
    $('esqueci').addEventListener('click', function (ev) {
      ev.preventDefault();
      if (correio !== true) {
        aviso('esqueci-aviso', Tx('Recuperação de senha: em breve. Por enquanto, fale com o dono do servidor.'), 'neutro');
        return;
      }
      var digitado = $('e-login').value.trim();
      if (emailParece(digitado) && !$('eq-email').value) $('eq-email').value = digitado;
      querEsqueci = true;
      mostra('esqueci');
    });
    function passoEsqueci(n) {
      $('eq-form2').hidden = n !== 2;
      $('eq-passo1').classList.toggle('ligado', n === 1);
      $('eq-passo2').classList.toggle('ligado', n === 2);
      if (n === 2) $('eq-para').textContent = eqEmail;
    }
    $('eq-form1').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var email = $('eq-email').value.trim();
      marca($('eq-email'), !emailParece(email));
      if (!emailParece(email)) { aviso('eq-aviso1', Tx('Esse e-mail não parece um e-mail.')); return; }
      aviso('eq-aviso1', Tx('Pedindo o código…'), 'neutro');
      $('eq-bt1').disabled = true;
      SITE.api('/api/esqueci', { method: 'POST', semToken: true, body: { email: email } }).then(function (r) {
        $('eq-bt1').disabled = false;
        if (!r.ok) { aviso('eq-aviso1', SITE.erro(r, Tx('não deu para pedir o código'))); return; }
        eqEmail = email;
        aviso('eq-aviso1', r.mensagem || Tx('Se houver conta com esse e-mail, o código chega em instantes.'), 'certo');
        passoEsqueci(2);
      });
    });
    $('eq-ja-tenho').addEventListener('click', function (ev) {
      ev.preventDefault();
      var email = $('eq-email').value.trim();
      if (!emailParece(email)) { marca($('eq-email'), true); aviso('eq-aviso1', Tx('Digite antes o e-mail da conta.')); return; }
      eqEmail = email;
      aviso('eq-aviso1', '');
      passoEsqueci(2);
    });
    $('eq-form2').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var email = eqEmail || $('eq-email').value.trim();
      var cod = codigoDe($('eq-codigo')), nova = $('eq-nova').value, nova2 = $('eq-nova2').value, erro = null;
      marca($('eq-codigo'), !seisDigitos(cod));
      marca($('eq-nova'), nova.length < 8);
      marca($('eq-nova2'), nova2 !== nova);
      if (!emailParece(email)) erro = Tx('Volte ao passo 1 e informe o e-mail da conta.');
      else if (!seisDigitos(cod)) erro = Tx('O código tem 6 dígitos.');
      else if (nova.length < 8) erro = Tx('A senha nova precisa ter pelo menos 8 caracteres.');
      else if (nova2 !== nova) erro = Tx('As duas senhas não batem.');
      if (erro) { aviso('eq-aviso2', erro); return; }
      aviso('eq-aviso2', Tx('Conferindo o código…'), 'neutro');
      $('eq-bt2').disabled = true;
      SITE.api('/api/esqueci/confirmar', { method: 'POST', semToken: true, body: { email: email, codigo: cod, nova: nova } })
        .then(function (r) {
          $('eq-bt2').disabled = false;
          if (!r.ok || !r.token || !r.conta) { aviso('eq-aviso2', SITE.erro(r, Tx('não deu para redefinir a senha'))); return; }
          SITE.guarda({ token: r.token, conta: { id: r.conta.id, nome: r.conta.nome, gm: !!r.conta.gm } });
          SITE.cabecalho();
          limpa(['eq-codigo', 'eq-nova', 'eq-nova2']);
          eqEmail = '';
          aviso('eq-aviso1', '');
          aviso('eq-aviso2', '');
          passoEsqueci(1);
          querEsqueci = false;
          dados = null;
          carregaConta({ geral: Tx('Senha redefinida; as outras sessões foram encerradas.') });
        });
    });

    /* -- trocar a senha */
    $('sn-form').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var atual = $('sn-atual').value, nova = $('sn-nova').value, nova2 = $('sn-nova2').value, erro = null;
      marca($('sn-atual'), !atual);
      marca($('sn-nova'), nova.length < 8 || nova === atual);
      marca($('sn-nova2'), nova2 !== nova);
      if (!atual) erro = Tx('Informe a senha atual.');
      else if (nova.length < 8) erro = Tx('A senha nova precisa ter pelo menos 8 caracteres.');
      else if (nova2 !== nova) erro = Tx('As duas senhas novas não batem.');
      else if (nova === atual) erro = Tx('A senha nova é igual à atual.');
      if (erro) { aviso('sn-aviso', erro); return; }
      aviso('sn-aviso', Tx('Trocando a senha…'), 'neutro');
      $('sn-bt').disabled = true;
      SITE.api('/api/conta/senha', { method: 'POST', body: { atual: atual, nova: nova } }).then(function (r) {
        $('sn-bt').disabled = false;
        if (r.status === 401) { sessaoMorta(Tx('A sessão desta página tinha vencido. Entre de novo.')); return; }
        if (!r.ok) { aviso('sn-aviso', SITE.erro(r, Tx('não deu para trocar a senha'))); return; }
        limpa(['sn-atual', 'sn-nova', 'sn-nova2']);
        var n = Number(r.sessoesEncerradas) || 0;
        aviso('sn-aviso', Tx('Senha trocada. {a}', { a: n === 1 ? Tx('1 outra sessão foi encerrada.')
          : n ? Tx('{n} outras sessões foram encerradas.', { n: n }) : Tx('Não havia outra sessão aberta.') }), 'certo');
        carregaConta();
      });
    });

    /* -- trocar o e-mail, passo 1: a senha e o e-mail novo DUAS vezes */
    $('em-form1').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var senha = $('em-senha').value, novo = $('em-novo').value.trim(), novo2 = $('em-novo2').value.trim(), erro = null;
      var atual = String((dados && dados.conta && dados.conta.email) || '').toLowerCase();
      marca($('em-senha'), !senha);
      marca($('em-novo'), !emailParece(novo));
      marca($('em-novo2'), novo2 !== novo);
      if (!senha) erro = Tx('Informe a senha atual.');
      else if (!emailParece(novo)) erro = Tx('Esse e-mail não parece um e-mail.');
      else if (novo2 !== novo) erro = Tx('Os dois e-mails não batem: digite o e-mail novo igual nas duas vezes.');
      else if (novo.toLowerCase() === atual) erro = Tx('Esse já é o e-mail da conta.');
      if (erro) { aviso('em-aviso1', erro); return; }
      pedeCodigo(senha, novo, 'em-aviso1', $('em-bt1'));
    });
    /* passo 2: o código; reenviar é pedir de novo, e pede a senha outra vez */
    $('em-form2').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var cod = codigoDe($('em-codigo'));
      marca($('em-codigo'), !seisDigitos(cod));
      if (!seisDigitos(cod)) { aviso('em-aviso2', Tx('O código tem 6 dígitos.')); return; }
      aviso('em-aviso2', Tx('Conferindo o código…'), 'neutro');
      $('em-bt2').disabled = true;
      SITE.api('/api/conta/email/confirmar', { method: 'POST', body: { codigo: cod } }).then(function (r) {
        $('em-bt2').disabled = false;
        if (r.status === 401) { sessaoMorta(Tx('A sessão desta página tinha vencido. Entre de novo.')); return; }
        if (!r.ok) {
          var msg = SITE.erro(r, Tx('não deu para conferir o código'));
          if (typeof r.restam === 'number' || r.status !== 400 && r.status !== 409) { aviso('em-aviso2', msg); return; }
          // o pedido venceu, queimou, ou o e-mail ficou com outra conta: o
          // servidor diz em que pé a troca está
          carregaConta({ email: msg });
          return;
        }
        limpa(['em-codigo']);
        troca = null;
        emOutro = false;
        if (r.conta && dados) {
          dados.conta = r.conta;
          dados.trocaEmail = null;
          desenhaConta();
        }
        aviso('em-aviso2', '');
        carregaConta({ geral: Tx('E-mail trocado{a}. O endereço antigo recebeu um aviso.', { a: r.conta && r.conta.email ? ' ' + Tx('para {email}', { email: r.conta.email }) : '' }) });
      });
    });
    $('em-reenviar').addEventListener('click', function () {
      if (!troca || !troca.para) {
        emOutro = true;
        passoEmail(1);
        aviso('em-aviso1', Tx('Digite de novo a senha e o e-mail novo para pedir outro código.'), 'neutro');
        return;
      }
      $('em-reenvio').hidden = false;
      $('em-senha-re').focus();
    });
    $('em-bt-re').addEventListener('click', function () {
      var senha = $('em-senha-re').value;
      if (!senha) { marca($('em-senha-re'), true); aviso('em-aviso2', Tx('Para reenviar, digite a senha atual.')); return; }
      pedeCodigo(senha, troca.para, 'em-aviso2', $('em-bt-re'));
    });
    $('em-outro').addEventListener('click', function (ev) {
      ev.preventDefault();
      emOutro = true;
      aviso('em-aviso2', '');
      passoEmail(1);
    });

    /* -- o retrato no ranking: um clique grava (o atual não pede nada) */
    $('av-grade').addEventListener('click', function (ev) {
      var bt = ev.target.closest ? ev.target.closest('button[data-avatar]') : null;
      if (!bt || bt.disabled || bt.getAttribute('aria-pressed') === 'true') return;
      escolheAvatar(bt.getAttribute('data-avatar'));
    });

    /* -- sessões */
    $('mc-sessoes').addEventListener('click', function (ev) {
      var bt = ev.target.closest ? ev.target.closest('button[data-encerrar]') : null;
      if (bt && !bt.disabled) encerra({ id: bt.getAttribute('data-encerrar') }, bt);
    });
    $('ss-outras').addEventListener('click', function () { encerra({ outras: true }, $('ss-outras')); });
    $('ss-todas').addEventListener('click', function () {
      SITE.confirma({
        titulo: Tx('Sair de todas as sessões?'),
        texto: Tx('Isto encerra também esta página.'),
        nota: Tx('O jogo aberto em qualquer máquina para de salvar na nuvem até entrar de novo.'),
        sim: Tx('Sair de todas'), nao: Tx('Voltar')
      }).then(function (sim) { if (sim) encerra({ todas: true }, $('ss-todas')); });
    });

    /* -- a abertura: o correio (para o esqueci) e, com sessão, a conta */
    SITE.api('/api/saude', { semToken: true }).then(function (r) {
      if (r.ok) SITE.acertaRelogio(r.agora);
      ligaEsqueci(!!r.ok && r.correio === true);
    });
    leVolta();
    if (SITE.sessao()) { voltaAoJogo = false; carregaConta(); }
    else {
      mostra(telaFora());
      // 13/09 (um aparelho só): chegou aqui porque a conta entrou em outro
      // aparelho (o jogo ou outra página do site guardaram a frase)
      var queda = SITE.avisoDeEntrar ? SITE.avisoDeEntrar() : '';
      if (queda) {
        mostra('entrar');
        aviso('e-aviso', queda, 'neutro');
      } else if (voltaAoJogo) {
        // veio do jogo sem conta: a tela diz por quê, e a aba "Criar conta" está ao lado
        aviso('e-aviso', Tx('Para jogar, entre na sua conta — ou crie uma, é rápido.'), 'neutro');
        aviso('c-aviso', Tx('Para jogar, crie a sua conta — ou entre, se já tem uma.'), 'neutro');
      }
    }
  }

  inicia();
})();
