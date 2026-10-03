/* sessao.js — quem está logado no cartório (a API de contas, servidor/api.py).
 *
 * A SESSÃO mora em localStorage 'soterra-sessao' = {token, conta:{id, nome, gm}}
 * — a MESMA chave que o site (site/site.js) grava ao entrar. Site e jogo
 * vivem na mesma origem no VPS (o Caddy serve os dois), então logar no site
 * já deixa o jogo logado; em file:// a chave também é uma só por navegador.
 *
 *   Sessao.ativa()             há token?
 *   Sessao.conta()/contaId()   {id, nome, gm} / o id no cartório (ou null)
 *   Sessao.base()              onde mora a API: '' (mesma origem, /api/* pelo
 *                              Caddy), a de `?api=` (lembrada), ou a de casa
 *                              (http://127.0.0.1:8300) quando aberto do disco
 *   Sessao.api(rota, op)       fetch JSON com o token; resolve SEMPRE com
 *                              {status, ok, ...} — rede fora vira status 0
 *   Sessao.entrar(login, senha) / cadastrar(nome, email, senha) / sair()
 *   Sessao.vigiaInatividade()  o relogio de 15 min sem jogar (desloga)
 *   Sessao.derrubada(motivo, token)  13/09, UM APARELHO SÓ: a conta entrou em
 *                              outro aparelho — o jogo cai aqui (ver o bloco)
 *   Sessao.vigiaOutroAparelho()  a olhada leve em /api/eu a cada 30 s
 *   Sessao.paginaConta()       o endereço da página de conta do site
 *
 * Só biblioteca do navegador. Sem sessão o jogo é o de sempre (local). */
(function () {
  'use strict';
  var JOGO = window.JOGO = window.JOGO || {};
  var S = JOGO.Sessao = {};
  S.CHAVE = 'soterra-sessao';
  S.CHAVE_API = 'soterra-api-base';

  function armazem() {
    try { return window.localStorage || null; } catch (e) { return null; }
  }
  function leLocal(chave) {
    var s = armazem();
    try { return s ? s.getItem(chave) : null; } catch (e) { return null; }
  }
  function gravaLocal(chave, valor) {
    var s = armazem();
    if (!s) return;
    try { if (valor === null) s.removeItem(chave); else s.setItem(chave, valor); } catch (e) {}
  }

  /* NO AR (página servida por um domínio de verdade) a API é SEMPRE a mesma
   * origem: um link com `?api=` de fora mandaria senha e token para outro
   * servidor, e o valor ficaria gravado. Lá o ?api= é ignorado e o que estiver
   * lembrado é apagado. Em casa (file://, localhost, 127.0.0.1) ele vale. */
  S.ehLocal = function (proto, host) {
    return proto === 'file:' || host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
  };
  S.base = function () {
    if (!S.ehLocal(location.protocol, location.hostname)) {
      gravaLocal(S.CHAVE_API, null);
      return '';
    }
    var m = /[?&]api=([^&]+)/.exec(location.search || '');
    if (m) {
      var pedida = decodeURIComponent(m[1]).replace(/\/+$/, '');
      gravaLocal(S.CHAVE_API, pedida);
      return pedida;
    }
    var lembrada = leLocal(S.CHAVE_API);
    if (lembrada) return lembrada;
    if (location.protocol === 'file:') return 'http://127.0.0.1:8300';
    return '';
  };

  S.ler = function () {
    try {
      var s = JSON.parse(leLocal(S.CHAVE) || 'null');
      return (s && typeof s.token === 'string' && s.token && s.conta && typeof s.conta === 'object') ? s : null;
    } catch (e) { return null; }
  };
  S.ativa = function () { return !!S.ler(); };
  S.token = function () { var s = S.ler(); return s ? s.token : null; };
  S.conta = function () { var s = S.ler(); return s ? s.conta : null; };
  S.contaId = function () {
    var c = S.conta();
    return (c && typeof c.id === 'number') ? c.id : null;
  };
  S.guarda = function (s) { gravaLocal(S.CHAVE, JSON.stringify(s)); anotaDaPagina(s); };
  S.esquece = function () { gravaLocal(S.CHAVE, null); };

  /* Há como falar com o cartório daqui? (`fetch` existe e a origem é http[s]
   * ou há uma API de casa apontada.) */
  S.disponivel = function () {
    return typeof window.fetch === 'function';
  };

  S.api = function (rota, op) {
    op = op || {};
    if (typeof window.fetch !== 'function') {
      return Promise.resolve({ ok: false, status: 0, erro: 'este navegador não tem fetch' });
    }
    var cab = { 'Content-Type': 'application/json' };
    var s = S.ler();
    var tokenUsado = (s && op.semToken !== true) ? s.token : null;
    if (tokenUsado) cab.Authorization = 'Bearer ' + tokenUsado;
    var pedido = { method: op.method || 'GET', headers: cab };
    if (op.body !== undefined) pedido.body = JSON.stringify(op.body);
    if (op.keepalive) pedido.keepalive = true;
    var fetchFn = (typeof S._fetch === 'function') ? S._fetch : window.fetch.bind(window);
    try {
      return fetchFn(S.base() + rota, pedido).then(function (r) {
        return r.json().catch(function () { return { ok: false, erro: 'resposta que não é JSON' }; })
          .then(function (j) {
            if (!j || typeof j !== 'object') j = { ok: false };
            j.status = r.status;
            // 13/09, UM APARELHO SÓ: o token desta página caiu por um login em
            // outro aparelho. Se a MESMA conta entrou de novo neste navegador
            // (outra aba, o site), a página adota o token novo e o pedido sai
            // de novo uma vez com ele; senão o jogo cai aqui (S.derrubada)
            if (j.status === 401 && j.motivo === S.MOTIVO_OUTRO_APARELHO && tokenUsado) {
              if (S.derrubada(j.motivo, tokenUsado) === false && !op._deNovo) {
                var op2 = {};
                for (var k in op) if (Object.prototype.hasOwnProperty.call(op, k)) op2[k] = op[k];
                op2._deNovo = true;
                return S.api(rota, op2);
              }
              j.derrubada = derrubadaJa;
            }
            return j;
          });
      }).catch(function () {
        return { ok: false, status: 0, erro: 'o servidor está fora (não respondeu)' };
      });
    } catch (e) {
      return Promise.resolve({ ok: false, status: 0, erro: 'o servidor está fora (não respondeu)' });
    }
  };

  S.entrar = function (login, senha) {
    return S.api('/api/login', { method: 'POST', semToken: true, body: { login: login, senha: senha } })
      .then(function (r) {
        if (r.ok && r.token && r.conta) S.guarda({ token: r.token, conta: r.conta });
        return r;
      });
  };
  /* 02/10: `aceite` é a versão dos Termos de Uso e da Política de Privacidade que a
   * pessoa leu e aceitou (o servidor recusa o cadastro sem ela, e grava a versão) */
  S.cadastrar = function (nome, email, senha, aceite) {
    return S.api('/api/cadastro', { method: 'POST', semToken: true,
                                    body: { nome: nome, email: email, senha: senha, aceiteTermos: aceite } })
      .then(function (r) {
        if (r.ok && r.token && r.conta) S.guarda({ token: r.token, conta: r.conta });
        return r;
      });
  };
  /* 02/10, OS DIREITOS DO TITULAR (servidor/privacidade.py): baixar os dados (o
   * JSON de tudo o que o servidor guarda) e excluir a conta (o nome EXATO e a senha;
   * excluída, a sessão local sai junto — o token já morreu no servidor). */
  S.meusDados = function () { return S.api('/api/conta/meus-dados'); };
  S.excluir = function (nome, senha) {
    return S.api('/api/conta/excluir', { method: 'POST', body: { nome: nome, senha: senha } })
      .then(function (r) {
        if (r.ok) S.esquece();
        return r;
      });
  };
  S.sair = function () {
    var s = S.ler();
    var p = s ? S.api('/api/logout', { method: 'POST', body: {} }) : Promise.resolve({ ok: true, status: 0 });
    S.esquece();                       // o local sai mesmo com o servidor fora
    return p;
  };

  /* ====================================================================
   * O RELÓGIO DA INATIVIDADE (12/09, pedido do dono: "15 min de inatividade a
   * conta desloga para não consumir servidor").
   *
   * O que custa servidor numa aba parada são DUAS coisas: o token vivo no
   * cartório e a conexão do relé (um WebSocket aberto por aba). Então o prazo
   * fecha as duas: `Sessao.sair()` (que avisa o /api/logout e apaga a chave
   * local) e `Rede.sair()`.
   *
   * NÃO navega para fora sozinho. Uma página que se manda embora enquanto
   * alguém lê a ficha do personagem perde o que a pessoa estava fazendo sem
   * ela ter pedido; quem pendura `aoInativo` (a HUD) mostra o aviso e deixa o
   * "entrar de novo" na mão do jogador. Sem ninguém pendurado, o relógio
   * ainda desliga o que custa — é o pedido.
   *
   * O QUE CONTA COMO JOGAR: toque, tecla, roda do mouse e a aba voltando para
   * a frente. O relógio corre com a aba escondida (é exatamente a aba
   * esquecida em segundo plano que o dono quer desligar), e um `tique` de 30 s
   * basta — não há nada a mostrar antes do fim. */
  S.INATIVO_MS = 15 * 60 * 1000;
  S.aoInativo = null;             // a HUD pendura o aviso aqui
  var ultimoToque = 0, vigiaId = null, jaDeslogou = false;
  S.tocou = function () { ultimoToque = Date.now(); };
  S.ociosoMs = function () { return ultimoToque ? (Date.now() - ultimoToque) : 0; };
  function desligaPorInatividade() {
    if (jaDeslogou) return;
    jaDeslogou = true;
    if (vigiaId) { try { clearInterval(vigiaId); } catch (e) {} vigiaId = null; }
    var tinha = S.ativa();
    try { if (tinha) S.sair(); } catch (e1) {}
    try { if (JOGO.Rede && JOGO.Rede.sair) JOGO.Rede.sair(); } catch (e2) {}
    if (typeof S.aoInativo === 'function') { try { S.aoInativo({ tinhaConta: tinha }); } catch (e3) {} }
  }
  S._desligaPorInatividade = desligaPorInatividade;   // as provas chamam direto
  /* O MESTRE NÃO CAI POR INATIVIDADE (19/09, pedido do dono: "a conta admin não tem
   * limite de 15 min no game"). A conta do cartório diz se é gm ({id, nome, gm} —
   * conferida pelo servidor no login, não pelo save); o relógio segue correndo (o
   * tocou() continua valendo para quem trocar de conta na mesma aba), só não desliga. */
  S.isentoDeInatividade = function () {
    var c = S.conta();
    return !!(c && c.gm);
  };
  // um tique do vigia (o mesmo que o setInterval chama; as provas chamam direto)
  S._tiqueInatividade = function () {
    if (S.isentoDeInatividade()) return false;
    if (S.ociosoMs() < S.INATIVO_MS) return false;
    desligaPorInatividade();
    return true;
  };
  S.vigiaInatividade = function () {
    if (vigiaId || typeof document === 'undefined' || typeof setInterval !== 'function') return false;
    S.tocou();
    var marca = function () { S.tocou(); };
    ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(function (ev) {
      try { document.addEventListener(ev, marca, true); } catch (e) {}
    });
    try {
      document.addEventListener('visibilitychange', function () {
        if (!document.hidden) S.tocou();
      });
    } catch (e4) {}
    vigiaId = setInterval(function () { S._tiqueInatividade(); }, 30000);
    return true;
  };

  /* ====================================================================
   * UM APARELHO SÓ (13/09, pedido do dono: "uma conta só pode estar logada em
   * um dispositivo.. se outro tentar logar, no que estava logado cai o jogo").
   *
   * O servidor apaga as outras sessões da conta a cada login certo, e o token
   * velho passa a ouvir 401 com motivo 'outro-aparelho' (servidor/conta.py).
   * Aqui é o PONTO ÚNICO onde isso vira "cai o jogo", chamado por três
   * caminhos: (a) qualquer pedido do S.api que volta esse 401; (b) o relé, que
   * manda {t:'derrubado'} ou fecha com 4001 (js/core/rede.js); (c) a olhada em
   * /api/eu a cada 30 s (vigiaOutroAparelho), que só corre com sessão e com a
   * aba à vista — escondida, para; ao voltar, olha na hora.
   *
   * ANTES DE DERRUBAR: se o localStorage já tem OUTRO token da MESMA conta, o
   * jogador entrou de novo neste navegador (outra aba, o site): a página adota
   * o token novo e segue, sem cair (o S.api repete o pedido; o relé religa com
   * o token novo). Token novo de OUTRA conta não é adotado: o jogo desta página
   * nasceu com a conta de antes, e subir o save dela na outra seria pior.
   *
   * DERRUBAR é: a Nuvem para (nenhum PUT mais — o save velho não pode subir
   * por cima do aparelho novo), as filas da Autoridade param, a Rede sai sem
   * religar, a agenda e a praça param, o laço do jogo para (js/main.js olha
   * derrubadaJa) e uma capa cobre tudo com o "Entrar de novo". Nada de alert().
   * Sem sessão (file://, jogo local) nada disto roda: não há token para cair. */
  S.MOTIVO_OUTRO_APARELHO = 'outro-aparelho';     // o de servidor/conta.py e servidor/rele_ident.py
  S.FRASE_DERRUBADA = 'Sua conta entrou em outro aparelho. Este jogo foi encerrado aqui.';
  S.CHAVE_AVISO = 'soterra-aviso-entrar';         // sessionStorage: a frase que a página de entrar mostra (site/conta.js)
  S.VIGIA_MS = 30000;
  S.semRecarga = false;                            // provas: o "Entrar de novo" não navega
  var derrubadaJa = false, capaDerrubada = null, tiraTeclas = null;
  var daPagina = null;                             // {token, contaId} com que esta página joga
  function anotaDaPagina(s) {
    daPagina = (s && typeof s.token === 'string') ? { token: s.token, contaId: (s.conta && typeof s.conta.id === 'number') ? s.conta.id : null } : null;
  }
  anotaDaPagina(S.ler());
  function avisaPagina(nome, det) {
    try { window.dispatchEvent(new CustomEvent(nome, { detail: det })); } catch (e) {}
  }

  S.derrubadaJa = function () { return derrubadaJa; };

  /* true = o jogo caiu (ou já tinha caído); false = havia um token novo da
   * mesma conta neste navegador e a página o adotou. */
  S.derrubada = function (motivo, tokenUsado) {
    if (derrubadaJa) return true;
    var atual = S.ler();
    var usado = tokenUsado || (daPagina && daPagina.token) || null;
    var contaAntes = daPagina ? daPagina.contaId : null;
    if (atual && usado && atual.token !== usado &&
        (contaAntes === null || (atual.conta && atual.conta.id === contaAntes))) {
      anotaDaPagina(atual);
      avisaPagina('soterra:sessao', { tipo: 'adotou' });
      return false;
    }
    derrubadaJa = true;
    encerraTudo();
    avisaPagina('soterra:sessao', { tipo: 'derrubada', motivo: motivo || S.MOTIVO_OUTRO_APARELHO });
    S.mostraDerrubada();
    return true;
  };

  function encerraTudo() {
    paraVigia();
    // o relógio da inatividade também para: ele avisaria o /api/logout e poria outra capa por cima desta
    jaDeslogou = true;
    if (vigiaId) { try { clearInterval(vigiaId); } catch (e0) {} vigiaId = null; }
    var J = JOGO;
    try { if (J.Nuvem && J.Nuvem.parar) J.Nuvem.parar(); } catch (e1) {}
    try { if (J.Autoridade && J.Autoridade.parar) J.Autoridade.parar(); } catch (e2) {}
    try { if (J.Rede && J.Rede.sair) J.Rede.sair(); } catch (e3) {}
    try { if (J.Agenda && J.Agenda.parar) J.Agenda.parar(); } catch (e4) {}
    try { if (J.Hub && J.Hub.sair) J.Hub.sair(); } catch (e5) {}
  }

  /* A capa: as classes da tela de inatividade (css/style.css, .inativo-capa),
   * presa no #ui-root do jogo; numa página sem essa folha, o mínimo em linha. */
  S.mostraDerrubada = function () {
    if (typeof document === 'undefined' || !document.body) return null;
    if (capaDerrubada && capaDerrubada.parentNode) return capaDerrubada;
    var raiz = document.getElementById('ui-root') || document.body;
    var capa = document.createElement('div');
    capa.className = 'inativo-capa sessao-derrubada';
    capa.setAttribute('role', 'alertdialog');
    capa.setAttribute('aria-modal', 'true');
    capa.setAttribute('aria-labelledby', 'sessao-derrubada-titulo');
    var cx = document.createElement('div');
    cx.className = 'inativo-cx';
    var h = document.createElement('h2');
    h.id = 'sessao-derrubada-titulo';
    h.textContent = 'Sua conta entrou em outro aparelho.';
    var p = document.createElement('p');
    p.textContent = 'Este jogo foi encerrado aqui.';
    var p2 = document.createElement('p');
    p2.textContent = 'Uma conta fica aberta em um aparelho por vez. Se não foi você, entre e troque a senha na página da conta.';
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-primary';
    b.textContent = 'Entrar de novo';
    b.addEventListener('click', function () { S.entrarDeNovo(); });
    cx.appendChild(h); cx.appendChild(p); cx.appendChild(p2); cx.appendChild(b);
    capa.appendChild(cx);
    raiz.appendChild(capa);
    capa.style.zIndex = '2147483000';               // por cima de qualquer ficha, dica ou aviso da HUD
    try {
      if (window.getComputedStyle(capa).position === 'static') {
        capa.style.cssText += ';position:fixed;inset:0;display:flex;align-items:center;justify-content:center;' +
          'padding:24px;background:rgba(6,8,10,.9);color:#e8e0d0;font:14px/1.5 sans-serif;text-align:center';
      }
      if (raiz === document.body) capa.style.position = 'fixed';
    } catch (e) {}
    // as teclas não chegam mais ao jogo (a HUD abre fichas com I, M, Esc…);
    // no botão, Enter e espaço seguem valendo
    tiraTeclas = function (ev) {
      if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();
      ev.stopPropagation();
      if (!capa.contains(ev.target)) ev.preventDefault();
    };
    ['keydown', 'keyup', 'keypress'].forEach(function (t) { window.addEventListener(t, tiraTeclas, true); });
    try { b.focus(); } catch (e2) {}
    capaDerrubada = capa;
    return capa;
  };

  /* "Entrar de novo": com um token novo neste navegador (entrou por outra aba
   * depois da queda), só recarrega; senão esquece a sessão morta e vai para a
   * tela de entrar do site, que mostra a frase. */
  S.entrarDeNovo = function () {
    var atual = S.ler();
    var novo = !!(atual && daPagina && atual.token !== daPagina.token);
    if (!novo) {
      S.esquece();
      try { window.sessionStorage.setItem(S.CHAVE_AVISO, S.FRASE_DERRUBADA); } catch (e) {}
    }
    if (S.semRecarga) return novo ? 'recarrega' : 'entrar';
    try { if (window.__boot && window.__boot.recarregando) window.__boot.recarregando('sessao'); } catch (eB) {}
    try {
      if (novo) location.reload();
      else location.href = S.paginaConta() + '#entrar';
    } catch (e2) {}
    return novo ? 'recarrega' : 'entrar';
  };

  /* A OLHADA LEVE: GET /api/eu a cada 30 s, só com sessão e com a aba à vista
   * (o relé derruba na hora; isto é para quem está sem relé, ou no relé do
   * outro contêiner). Uma de cada vez; o S.api cuida do 401 com motivo. */
  var vigiaAparelho = null, vigiaLigada = false, olhando = false;
  function paraVigia() {
    if (vigiaAparelho) { try { clearInterval(vigiaAparelho); } catch (e) {} vigiaAparelho = null; }
  }
  S.confereAparelho = function () {
    if (derrubadaJa || olhando || !S.ativa()) return Promise.resolve(null);
    olhando = true;
    return S.api('/api/eu').then(function (r) { olhando = false; return r; });
  };
  S.vigiaOutroAparelho = function () {
    if (vigiaLigada || derrubadaJa || typeof document === 'undefined' || typeof setInterval !== 'function' || !S.ativa()) return false;
    vigiaLigada = true;
    function liga() {
      if (vigiaAparelho || derrubadaJa) return;
      vigiaAparelho = setInterval(function () { if (!document.hidden) S.confereAparelho(); }, S.VIGIA_MS);
    }
    try {
      document.addEventListener('visibilitychange', function () {
        if (derrubadaJa) return;
        if (document.hidden) { paraVigia(); return; }
        S.confereAparelho();
        liga();
      });
    } catch (e) {}
    if (!document.hidden) liga();
    return true;
  };

  /* A raiz do site, relativa ao jogo. As duas páginas abaixo saem daqui. */
  function raizDoSite() {
    return String(location.href || '').split('#')[0].split('?')[0].replace(/[^\/\\]*$/, '');
  }
  /* A página de conta do site, relativa ao jogo (raiz/site/conta.html). */
  S.paginaConta = function () { return raizDoSite() + 'site/conta.html'; };
  /* A porta de SAÍDA do jogo (11/09): a capa do site, onde se cuida da conta,
   * da loja e do ranking. O save já está gravado a cada passo — sair é sair. */
  S.paginaSite = function () { return raizDoSite() + 'site/index.html'; };
  /* 02/10: os Termos de Uso e a Política de Privacidade (o link da ficha Contas) */
  S.paginaTermos = function () { return raizDoSite() + 'site/termos.html'; };
  S.paginaPrivacidade = function () { return raizDoSite() + 'site/privacidade.html'; };
})();
