// SOTERRA — os modelos 3D guardados NO APARELHO (só no aplicativo de Android).
//
// O PEDIDO (04/10, o dono): "sim, tem que ter as duas opções". Na primeira
// abertura do aplicativo o jogador escolhe:
//
//   JOGAR AGORA   — abre na hora; cada modelo desce quando o mapa precisa dele,
//                   como na web, e o que desceu FICA guardado no aparelho;
//   BAIXAR TUDO   — desce o pacote inteiro com barra (MB de MB, quanto falta);
//                   depois os mapas abrem sem esperar e sem gastar dados.
//
// A WEB NÃO CARREGA ESTE ARQUIVO: o index.html só o escreve dentro do
// aplicativo (Capacitor nativo ou `?app=1`), e o js/assets_bundle.js só desvia
// para cá quando `JOGO.AppModelos` existe. Sem ele, o caminho é o de sempre.
//
// ONDE FICA GUARDADO: no Cache Storage do WebView, na origem do jogo.
//   · mora nos DADOS do aplicativo (não é o "limpar cache" do Android que o
//     apaga; só "limpar dados" ou desinstalar) e é da mesma origem do jogo
//     servido, então ler é um `match`, sem ponte nativa no caminho;
//   · o plugin Filesystem obrigaria a passar 250 MB em base64 pela ponte (ou a
//     pôr mais um plugin nativo de download), e nada disso pôde ser compilado
//     nem provado nesta etapa. Se um dia o sistema despejar o cache por falta
//     de espaço, o jogo só baixa de novo o que faltar — nada quebra.
//
// A CHAVE de cada arquivo leva o hash do conteúdo (o do manifesto). Por isso
// "o que mudou" é uma conta simples (A.plano): o que o manifesto pede e não
// está guardado com aquele hash desce; o que está guardado e o manifesto não
// pede mais (saiu, ou mudou de hash) é apagado. Retomar um download que caiu é
// a mesma conta: o que já está guardado não desce de novo.

var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

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

  var A = {};
  JOGO.AppModelos = A;

  var MB = 1048576;
  var ESCOLHA = 'soterra-app-modelos';      // localStorage: 'agora' | 'tudo'
  var NOME = 'soterra-modelos-1';           // o nome do cache
  var PREFIXO = '/_guardado/';              // endereço de mentira: só serve de chave
  var PARALELO = 4;

  A.esperas = [1000, 3000, 8000];           // novas tentativas de um arquivo que falhou (ms)

  // ============================================================ a conta pura
  /* O selo de um arquivo: o hash do conteúdo. Manifesto antigo, sem hash, cai
   * no carimbo da extração — muda tudo de uma vez, mas nunca serve arte velha. */
  function selo(it, man) { return it.hash || ('v' + ((man && man.gerado) || '1')); }
  A.selo = selo;

  /* O que fazer para o aparelho ficar igual ao manifesto.
   * guardados: [{ arquivo, hash }]. Devolve
   *   baixar  — itens do manifesto que faltam (novos ou de hash diferente)
   *   apagar  — guardados que o manifesto não pede mais (saíram ou mudaram)
   *   total/feitos/faltam — em bytes;  nTotal/nFeitos — em arquivos */
  A.plano = function (man, guardados) {
    var r = { baixar: [], apagar: [], total: 0, feitos: 0, faltam: 0, nTotal: 0, nFeitos: 0 };
    var itens = (man && man.itens) || [], quer = {}, ordem = [], tem = {}, i, it;
    for (i = 0; i < itens.length; i++) {
      it = itens[i];
      if (!it || !it.arquivo || quer[it.arquivo]) continue;   // dois itens podem apontar o mesmo arquivo
      quer[it.arquivo] = it;
      ordem.push(it);
      r.nTotal++;
      r.total += it.bytes || 0;
    }
    for (i = 0; i < (guardados || []).length; i++) {
      var g = guardados[i];
      it = quer[g.arquivo];
      if (it && selo(it, man) === g.hash && !tem[g.arquivo]) tem[g.arquivo] = true;
      else r.apagar.push(g);
    }
    for (i = 0; i < ordem.length; i++) {
      if (tem[ordem[i].arquivo]) { r.nFeitos++; r.feitos += ordem[i].bytes || 0; }
      else r.baixar.push(ordem[i]);
    }
    r.faltam = r.total - r.feitos;
    return r;
  };

  /* "246,5" — megabytes com uma casa e vírgula, como se escreve aqui. */
  A.mb = function (bytes) {
    return (Math.round(10 * (bytes || 0) / MB) / 10).toFixed(1).replace('.', ',');
  };
  /* Quanto falta, em palavras. Sem velocidade medida, não chuta. */
  A.resta = function (bytes, porSegundo) {
    if (!(porSegundo > 0) || !(bytes > 0)) return '';
    var s = bytes / porSegundo;
    if (s < 60) return Tx('menos de 1 min');
    return Tx('cerca de {a} min', { a: Math.round(s / 60) });
  };
  /* A rede, quando dá para saber: 'movel', 'wifi' ou '?'. O WebView do Android
   * informa `connection.type`; onde ele não existe, não se adivinha. */
  A.rede = function (c) {
    var t = c && c.type;
    if (t === 'cellular') return 'movel';
    if (t === 'wifi' || t === 'ethernet') return 'wifi';
    return '?';
  };
  /* Cabe? est = { quota, usage } do navigator.storage.estimate(). Devolve null
   * quando não dá para saber. A folga (5% + 20 MB) é do índice do próprio cache. */
  A.cabe = function (faltam, est) {
    if (!est || !(est.quota > 0)) return null;
    var livre = Math.max(0, est.quota - (est.usage || 0));
    return { cabe: livre >= faltam * 1.05 + 20 * MB, livre: livre };
  };

  // ============================================================ o que guarda
  function chave(arquivo, s) { return PREFIXO + encodeURI(arquivo) + '?h=' + encodeURIComponent(s); }
  function deChave(url) {
    try {
      var u = new URL(url);
      if (u.pathname.indexOf(PREFIXO) !== 0) return null;
      return { arquivo: decodeURI(u.pathname.slice(PREFIXO.length)), hash: u.searchParams.get('h') || '' };
    } catch (e) { return null; }
  }
  var real = null;
  function guardaReal() {
    if (real) return real;
    var C = (typeof window !== 'undefined') ? window.caches : null;
    if (!C || !C.open || typeof Response === 'undefined') return null;
    function abre() { return C.open(NOME); }
    real = {
      lista: function () {
        return abre().then(function (c) { return c.keys(); }).then(function (ks) {
          var l = [];
          for (var i = 0; i < ks.length; i++) { var d = deChave(ks[i].url); if (d) l.push(d); }
          return l;
        });
      },
      le: function (arquivo, s) {
        return abre().then(function (c) { return c.match(chave(arquivo, s)); })
          .then(function (r) { return r ? r.arrayBuffer() : null; });
      },
      grava: function (arquivo, s, buf) {
        return abre().then(function (c) {
          return c.put(chave(arquivo, s), new Response(buf, { headers: {
            'Content-Type': 'application/octet-stream', 'Content-Length': String(buf.byteLength) } }));
        });
      },
      apaga: function (arquivo, s) { return abre().then(function (c) { return c.delete(chave(arquivo, s)); }); },
      limpa: function () { return C.delete(NOME); }
    };
    return real;
  }
  /* As provas trocam `A._guarda` (um armazenamento de mentira) e `A._busca` (uma rede de mentira). */
  function guarda() { return A._guarda || guardaReal(); }
  A.ativo = function () { return !!guarda(); };

  A._busca = function (url) {
    // 2 min por arquivo (o maior tem 1,7 MB): sinal que sumiu não deixa o download pendurado
    var ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var t = ctl ? setTimeout(function () { try { ctl.abort(); } catch (e) {} }, 120000) : null;
    return fetch(url, ctl ? { signal: ctl.signal } : undefined).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.arrayBuffer();
    }).then(function (b) { if (t) clearTimeout(t); return b; },
            function (e) { if (t) clearTimeout(t); throw e; });
  };

  // ============================================================ o estado
  var st = { man: null, url: null, tem: null, baixando: null };

  function cofre(k, v) {
    try {
      if (v === undefined) return window.localStorage.getItem(k);
      if (v === null) window.localStorage.removeItem(k); else window.localStorage.setItem(k, v);
    } catch (e) {}
    return null;
  }
  A.escolha = function () { var e = cofre(ESCOLHA); return (e === 'agora' || e === 'tudo') ? e : null; };
  A.escolhe = function (e) { cofre(ESCOLHA, e); };

  /* Lê o que está guardado, apaga o que o manifesto não pede mais e devolve o plano. */
  function sincroniza() {
    var g = guarda();
    return g.lista().then(function (l) {
      var p = A.plano(st.man, l), tem = {}, i;
      for (i = 0; i < l.length; i++) tem[l[i].arquivo] = l[i].hash;
      for (i = 0; i < p.apagar.length; i++) {
        if (tem[p.apagar[i].arquivo] === p.apagar[i].hash) delete tem[p.apagar[i].arquivo];
      }
      st.tem = tem;
      return Promise.all(p.apagar.map(function (x) {
        return g.apaga(x.arquivo, x.hash).then(null, function () {});
      })).then(function () { return p; });
    });
  }
  A.sincroniza = function () { return (guarda() && st.man) ? sincroniza() : Promise.resolve(null); };

  // ---- o que o js/assets_bundle.js chama: primeiro o guardado, depois a rede
  A.le = function (it, cb) {
    var g = guarda(), s = selo(it, st.man);
    if (!g || !st.tem || st.tem[it.arquivo] !== s) return cb(null);
    g.le(it.arquivo, s).then(function (b) { cb(b || null); }, function () { cb(null); });
  };
  A.grava = function (it, buf) {
    var g = guarda(), s = selo(it, st.man);
    if (!g || !st.tem) return;
    // sem espaço, ou cache indisponível: o modelo já está em uso, só não fica guardado
    g.grava(it.arquivo, s, buf).then(function () { st.tem[it.arquivo] = s; }, function () {});
  };

  function dorme(ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); }
  function agora() { return Date.now(); }

  /* Baixa o que falta do plano. aoAndar({feitos,total,faltam,porSegundo}).
   * Resolve { ok, motivo } — motivo: 'pausa', 'rede', 'espaco' ou 'guarda'.
   * O que já foi gravado fica: chamar de novo com um plano novo CONTINUA. */
  function baixa(p, aoAndar) {
    var fila = p.baixar.slice(), feitos = p.feitos, vivos = 0, parou = null, t0 = agora(), b0 = feitos;
    var g = guarda();
    function um(it, tent) {
      return A._busca(st.url(it)).then(function (buf) {
        return g.grava(it.arquivo, selo(it, st.man), buf).then(function () { return 'ok'; }, function (e) {
          return /quota|space|espa/i.test(String((e && e.name) || '') + String((e && e.message) || '')) ? 'espaco' : 'guarda';
        });
      }, function () {
        if (parou || tent >= A.esperas.length) return 'rede';
        return dorme(A.esperas[tent]).then(function () { return parou ? 'rede' : um(it, tent + 1); });
      });
    }
    return new Promise(function (fim) {
      st.baixando = { para: function (m) { parou = parou || m || 'pausa'; } };
      function acaba() {
        if (vivos) return;
        st.baixando = null;
        fim({ ok: !parou && !fila.length, motivo: parou, feitos: feitos, total: p.total });
      }
      function gira() {
        while (!parou && vivos < PARALELO && fila.length) (function (it) {
          vivos++;
          um(it, 0).then(function (r) {
            vivos--;
            if (r === 'ok') {
              st.tem[it.arquivo] = selo(it, st.man);
              feitos += it.bytes || 0;
              var dt = (agora() - t0) / 1000;
              try {
                aoAndar({ feitos: feitos, total: p.total, faltam: p.total - feitos,
                          porSegundo: dt > 1 ? (feitos - b0) / dt : 0 });
              } catch (e) {}
            } else if (!parou) parou = r;
            gira();
          });
        })(fila.shift());
        if (parou || !fila.length) acaba();
      }
      gira();
    });
  }

  /* Apaga o pacote inteiro. Quem tinha escolhido "tudo" volta a "jogar agora":
   * senão a próxima abertura baixaria tudo de novo, contra a vontade dele. */
  A.apagaTudo = function () {
    var g = guarda();
    if (st.baixando) st.baixando.para('pausa');
    st.tem = {};
    A.escolhe('agora');
    return g ? g.limpa().then(null, function () {}) : Promise.resolve();
  };

  // ============================================================ as telas
  // Estilo próprio, na linha: esta tela aparece antes do css do jogo terminar de chegar.
  var COR = 'color:#e8e0d0;font:16px/1.5 "Segoe UI",Roboto,sans-serif';
  var raizEl = null;
  function fecha() {
    if (raizEl && raizEl.parentNode) raizEl.parentNode.removeChild(raizEl);
    raizEl = null;
  }
  function cria(tag, css, texto, id) {
    var e = document.createElement(tag);
    if (css) e.style.cssText = css;
    if (texto != null) e.textContent = texto;
    if (id) e.id = id;
    return e;
  }
  function caixa(titulo) {
    fecha();
    raizEl = cria('div', 'position:fixed;inset:0;z-index:99990;display:flex;align-items:center;justify-content:center;' +
      'background:#0b0d10;padding:20px;overflow:auto;' + COR, null, 'app-modelos');
    raizEl.setAttribute('role', 'dialog');
    var cx = cria('div', 'width:100%;max-width:380px;margin:auto');
    cx.appendChild(cria('h2', 'margin:0 0 10px;font-size:22px;color:#e9c46a;text-align:center', titulo));
    raizEl.appendChild(cx);
    (document.body || document.documentElement).appendChild(raizEl);
    return cx;
  }
  function paragrafo(cx, texto, id) {
    return cx.appendChild(cria('p', 'margin:0 0 14px;text-align:center;color:#c9c2b4', texto, id));
  }
  /* Um botão grande com a explicação embaixo: a escolha tem de caber no polegar. */
  function botao(cx, id, rotulo, dica, cor, fn) {
    var b = cria('button', 'display:block;width:100%;min-height:56px;margin:0 0 12px;padding:12px 14px;border-radius:10px;' +
      'border:1px solid #5a4a2a;text-align:left;cursor:pointer;background:' + cor + ';' + COR, null, id);
    b.type = 'button';
    b.appendChild(cria('b', 'display:block;font-size:17px', rotulo));
    if (dica) b.appendChild(cria('span', 'display:block;font-size:13.5px;color:#c9c2b4', dica));
    b.addEventListener('click', fn);
    cx.appendChild(b);
    return b;
  }
  function aviso(titulo, texto, botoes) {
    var cx = caixa(titulo);
    paragrafo(cx, texto, 'am-txt');
    for (var i = 0; i < botoes.length; i++) botao(cx, botoes[i][0], botoes[i][1], null, i ? '#2a3038' : '#3a2f16', botoes[i][2]);
  }
  function conexao() { return A._conexao !== undefined ? A._conexao : (typeof navigator !== 'undefined' ? navigator.connection : null); }
  function estimativa() {
    if (A._estimativa !== undefined) return Promise.resolve(A._estimativa);
    try {
      if (navigator.storage && navigator.storage.estimate) return navigator.storage.estimate().then(null, function () { return null; });
    } catch (e) {}
    return Promise.resolve(null);
  }

  /* O CÓDIGO DO JOGO (06/10, js/app_jogo.js): nas duas opções o que desce fica guardado; no "Baixar
   * tudo" o resto desce junto, em pano de fundo. Sem o AppJogo (ou desligado), nada muda aqui. */
  function jogoGuardado() { var G = JOGO.AppJogo; return !!(G && G.ligado && G.ligado()); }
  function pesoJogo() { return jogoGuardado() ? (JOGO.AppJogo.peso() || 0) : 0; }

  /* A PRIMEIRA ABERTURA: as duas opções. */
  function telaEscolha(p, segue) {
    var cx = caixa(Tx('Modelos do jogo'));
    paragrafo(cx, Tx('Os cenários e personagens em 3D ficam no servidor. Escolha como baixar — dá para mudar depois, nas Configurações.'));
    botao(cx, 'am-agora', Tx('Jogar agora'),
          Tx('Abre na hora. Cada mapa baixa o que precisa na primeira vez e fica guardado no aparelho.'), '#2a3038',
          function () { A.escolhe('agora'); fecha(); segue(); });
    // com o código do jogo junto (js/app_jogo.js): o número do botão é o que vai ocupar no aparelho
    botao(cx, 'am-tudo', Tx('Baixar tudo — {a} MB', { a: A.mb(p.faltam + pesoJogo()) }),
          Tx('Baixa o pacote inteiro agora. Depois os mapas abrem sem esperar e sem gastar dados.'), '#3a2f16',
          function () { pedeTudo(p, segue, true); });
    if (jogoGuardado()) paragrafo(cx, Tx('O jogo também fica guardado no aparelho, para abrir mais rápido. Mesmo assim, é preciso internet para entrar e jogar.'), 'am-online')
      .style.fontSize = '13.5px';
    var r = A.rede(conexao());
    paragrafo(cx, r === 'movel' ? Tx('Você está nos dados móveis: baixar tudo gasta {a} MB do seu plano.', { a: A.mb(p.faltam) })
                : r === 'wifi' ? Tx('Você está no Wi-Fi.') : Tx('Se puder, baixe tudo no Wi-Fi.'), 'am-rede')
      .style.fontSize = '13.5px';
  }

  /* Antes de baixar: cabe no aparelho? está nos dados móveis? A tela de escolha
   * já mostrou o tamanho; aqui só se pergunta de novo nos dados móveis, que é
   * onde custa dinheiro. */
  function pedeTudo(p, segue, primeira) {
    estimativa().then(function (est) {
      var c = A.cabe(p.faltam, est);
      if (c && !c.cabe) {
        return aviso(Tx('Falta espaço'), Tx('O pacote precisa de {a} MB e o aparelho tem {b} MB livres para o jogo. Libere espaço e tente de novo.', { a: A.mb(p.faltam), b: A.mb(c.livre) }), [
          ['am-continuar', Tx('Tentar de novo'), function () { pedeTudo(p, segue, primeira); }],
          ['am-jogar', Tx('Jogar agora, sem baixar tudo'), function () { if (!A.escolha()) A.escolhe('agora'); fecha(); segue(); }]
        ]);
      }
      if (A.rede(conexao()) === 'movel') {
        return aviso(Tx('Dados móveis'), Tx('Você não está no Wi-Fi. Baixar agora gasta {a} MB do seu plano de dados.', { a: A.mb(p.faltam) }), [
          ['am-sim', Tx('Baixar mesmo assim'), function () { comeca(p, segue); }],
          // a vontade fica gravada: na próxima abertura, já no Wi-Fi, o download começa sozinho
          ['am-nao', Tx('Esperar o Wi-Fi e jogar agora'), function () { A.escolhe('tudo'); fecha(); segue(); }]
        ]);
      }
      comeca(p, segue);
    });
  }
  function comeca(p, segue) {
    A.escolhe('tudo');
    try { if (jogoGuardado()) JOGO.AppJogo.completa(); } catch (e) {}   // o código do jogo, em pano de fundo
    // pede ao WebView para não despejar este armazenamento por conta própria (onde ele atende)
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().then(null, function () {}); } catch (e) {}
    telaProgresso(p, segue);
  }

  function telaProgresso(p, segue) {
    var cx = caixa(Tx('Baixando os modelos'));
    var trilho = cria('div', 'height:12px;border-radius:6px;background:#22272e;overflow:hidden;margin:0 0 10px');
    var barra = cria('div', 'height:100%;width:0;background:#e9c46a;transition:width .2s', null, 'am-barra');
    trilho.appendChild(barra);
    cx.appendChild(trilho);
    var txt = paragrafo(cx, '', 'am-txt');
    function pinta(a) {
      barra.style.width = (a.total ? Math.round(100 * a.feitos / a.total) : 100) + '%';
      var r = A.resta(a.faltam, a.porSegundo);
      txt.textContent = Tx('{a} de {b} MB · faltam {c} MB{d}', { a: A.mb(a.feitos), b: A.mb(a.total), c: A.mb(a.faltam), d: r ? ' · ' + r : '' });
    }
    pinta({ feitos: p.feitos, total: p.total, faltam: p.faltam, porSegundo: 0 });
    botao(cx, 'am-pausa', Tx('Pausar e jogar agora'), Tx('O que já baixou fica guardado. O resto continua na próxima abertura.'), '#2a3038',
          function () { if (st.baixando) st.baixando.para('pausa'); });
    baixa(p, pinta).then(function (r) {
      if (r.ok || r.motivo === 'pausa') { fecha(); segue(); return; }
      // refaz a conta pelo que está guardado DE VERDADE e oferece continuar dali
      function deNovo() { sincroniza().then(function (p2) { telaProgresso(p2, segue); }, function () { fecha(); segue(); }); }
      var guardado = Tx('{a} de {b} MB', { a: A.mb(r.feitos), b: A.mb(r.total) });
      if (r.motivo === 'rede') {
        var voltou = function () { window.removeEventListener('online', voltou); if (raizEl) deNovo(); };
        window.addEventListener('online', voltou);        // a rede voltou: continua sem esperar o toque
        aviso(Tx('A conexão caiu'), Tx('O que já baixou está guardado: {guardado}. O download continua de onde parou.', { guardado: guardado }), [
          ['am-continuar', Tx('Continuar'), function () { window.removeEventListener('online', voltou); deNovo(); }],
          ['am-jogar', Tx('Jogar agora e continuar depois'), function () { window.removeEventListener('online', voltou); fecha(); segue(); }]
        ]);
      } else {
        aviso(r.motivo === 'espaco' ? Tx('Faltou espaço no aparelho') : Tx('Não consegui guardar'),
          Tx('{a}O que já baixou está guardado: {guardado}.', { a: r.motivo === 'espaco' ? Tx('Libere {a} MB e continue.', { a: A.mb(r.total - r.feitos) }) + ' ' : Tx('O aparelho recusou a gravação. '), guardado: guardado }), [
          ['am-continuar', Tx('Tentar de novo'), deNovo],
          ['am-jogar', Tx('Jogar agora'), function () { fecha(); segue(); }]
        ]);
      }
    });
  }

  /* Quem escolheu "tudo" e ainda tem o que baixar: o download caiu, o
   * aplicativo fechou no meio, ou a arte mudou no servidor. */
  function retoma(p, segue) {
    if (A.rede(conexao()) !== 'movel') return pedeTudo(p, segue, false);
    aviso(Tx('Faltam {a} MB', { a: A.mb(p.faltam) }), Tx('Há modelos para baixar (download interrompido ou arte nova) e você está nos dados móveis.'), [
      ['am-sim', Tx('Baixar agora'), function () { comeca(p, segue); }],
      ['am-nao', Tx('Depois, no Wi-Fi'), function () { fecha(); segue(); }]
    ]);
  }

  /* A ABERTURA. op: { man, url(it), segue() } — o js/assets_bundle.js chama com
   * o manifesto na mão, ANTES de baixar a base. `segue` roda uma vez só. */
  A.abertura = function (op) {
    var foi = false;
    function segue() { if (foi) return; foi = true; try { op.segue(); } catch (e) {} }
    st.man = op.man;
    st.url = op.url;
    if (!guarda()) return segue();           // WebView sem Cache Storage: tudo pela rede, como a web
    sincroniza().then(function (p) {
      var e = A.escolha();
      if (!e) return telaEscolha(p, segue);
      if (e === 'tudo' && p.baixar.length) return retoma(p, segue);
      segue();
    }, function () { st.tem = null; segue(); });
  };

  /* A SEÇÃO DAS CONFIGURAÇÕES (js/ui/hud.js a pendura só no aplicativo): o
   * espaço usado, baixar tudo depois, apagar. Usa as classes da ficha. */
  A.secaoConfig = function () {
    if (!guarda() || !st.man) return null;
    var sec = document.createElement('section');
    sec.className = 'cfg-sec';
    sec.id = 'cfg-modelos';
    function pinta() {
      sincroniza().then(function (p) {
        sec.textContent = '';
        var h = document.createElement('h3'); h.className = 'bk-tit'; h.textContent = Tx('Modelos no aparelho');
        sec.appendChild(h);
        var ln = document.createElement('div'); ln.className = 'cfg-linha';
        var tx = document.createElement('div'); tx.className = 'cfg-tx';
        var b = document.createElement('b'); b.className = 'cfg-tit'; b.id = 'cfg-modelos-uso';
        b.textContent = Tx('{a} de {b} MB guardados', { a: A.mb(p.feitos), b: A.mb(p.total) });
        var d = document.createElement('span'); d.className = 'cfg-dica';
        d.textContent = p.baixar.length
          ? Tx('{nFeitos} de {nTotal} arquivos. O que falta baixa quando o mapa precisa — ou tudo de uma vez.', { nFeitos: p.nFeitos, nTotal: p.nTotal })
          : Tx('O pacote está completo: os mapas abrem sem baixar nada.');
        tx.appendChild(b); tx.appendChild(d); ln.appendChild(tx);
        var bs = document.createElement('div');
        function mini(id, rotulo, cls, fn) {
          var x = document.createElement('button');
          x.type = 'button'; x.id = id; x.className = 'btn-mini ' + cls; x.textContent = rotulo;
          x.addEventListener('click', fn);
          bs.appendChild(x);
        }
        if (p.baixar.length) mini('cfg-modelos-baixar', Tx('Baixar tudo ({a} MB)', { a: A.mb(p.faltam) }), 'btn-gold',
          function () { pedeTudo(p, pinta, false); });
        if (p.nFeitos) mini('cfg-modelos-apagar', Tx('Apagar'), '', function () {
          aviso(Tx('Apagar os modelos?'), Tx('Libera {a} MB. O jogo volta a baixar cada mapa quando precisar.', { a: A.mb(p.feitos) }), [
            ['am-nao', Tx('Cancelar'), function () { fecha(); }],
            ['am-sim', Tx('Apagar'), function () { A.apagaTudo().then(function () { fecha(); pinta(); }); }]
          ]);
        });
        ln.appendChild(bs);
        sec.appendChild(ln);
      }, function () {});
    }
    pinta();
    return sec;
  };

  A._estado = st;                            // as provas olham
})();
