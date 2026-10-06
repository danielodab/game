// SOTERRA — o código do jogo guardado NO APARELHO (só no aplicativo de Android).
//
// O PEDIDO (06/10, o dono): "o jogador pode ter a opção de salvar o jogo no
// celular, mas só consegue conectar ao game com internet". O jogo é SOMENTE
// ONLINE: o que este arquivo guarda são ARQUIVOS (.js e .css), para o aplicativo
// abrir mais rápido e gastar menos dados. Nada de jogar sem rede.
//
// QUEM O REGISTRA: só o js/app_jogo.js, que o index.html só escreve dentro do
// aplicativo. Na web este arquivo existe no servidor e ninguém o chama.
//
// AS TRÊS REGRAS, todas em `alvo()`:
//   1. só responde por pedido GET, da própria origem, de um .js ou .css cujo
//      endereço leva o HASH DO CONTEÚDO (?v=<12 hex>, o do js/versao.js que o
//      servidor/coolify/versao.py grava no build). Quem diz qual hash pedir é a
//      página — e a página, o js/versao.js e o manifesto dos modelos NUNCA
//      passam por aqui: vão sempre à rede. Então o guardado só é usado quando o
//      servidor de AGORA pede exatamente aquele conteúdo. Arquivo que mudou tem
//      endereço novo, não está guardado, desce da rede;
//   2. só GUARDA o que conferiu: o sha-256 do que chegou tem de começar pelo
//      hash do endereço. No rolling update um pedido com o hash novo pode cair
//      no contêiner velho e trazer o arquivo antigo — esse não bate, e não fica;
//   3. a navegação (a página), /api/*, o relé (WebSocket nem chega aqui), a loja
//      e tudo o que não é arquivo com hash ficam FORA: o navegador os busca como
//      se este arquivo não existisse. Por isso, sem rede, a página não abre e
//      vale a tela "sem conexão" da casca.
//
// QUALQUER ERRO AQUI DENTRO vira um pedido comum à rede: o jogo abre como hoje.
//
// A VÁLVULA DE ESCAPE: troque `DESLIGA` para true e publique. O WebView confere
// este arquivo com o servidor a cada abertura (updateViaCache: 'none'); a versão
// nova assume, apaga o que estava guardado e se desregistra. A outra válvula é a
// linha `window.__guardaJogo` do index.html (ver docs/CELULAR.md, seção 9).
'use strict';

var DESLIGA = false;
var NOME = 'soterra-jogo-1';
var HASH = /^\?v=([0-9a-f]{12})$/;
var FORA = /^\/(api|rele|ws|site)\//;

/* O pedido é de um arquivo do jogo com hash? Devolve o hash, ou null (não é comigo). */
function alvo(metodo, endereco, origem) {
  var u;
  try { u = new URL(endereco); } catch (e) { return null; }
  if (metodo !== 'GET' || u.origin !== origem) return null;
  if (FORA.test(u.pathname) || !/\.(js|css)$/.test(u.pathname)) return null;
  if (u.pathname === '/sw.js' || u.pathname === '/js/versao.js') return null;
  var m = HASH.exec(u.search);
  return m ? m[1] : null;
}

function hex(buf) {
  var b = new Uint8Array(buf), s = '';
  for (var i = 0; i < 6; i++) s += (b[i] < 16 ? '0' : '') + b[i].toString(16);
  return s;
}

/* Guarda `resposta` (já lida em `buf`) SE o conteúdo bater com o hash do endereço. */
function guarda(cache, endereco, hash, resposta, buf) {
  return self.crypto.subtle.digest('SHA-256', buf).then(function (d) {
    if (hex(d) !== hash) return false;
    return cache.put(endereco, new Response(buf, { status: 200, headers: {
      'Content-Type': resposta.headers.get('Content-Type') || 'application/octet-stream',
      'X-Soterra-Bytes': String(buf.byteLength) } })).then(function () { return true; });
  });
}

/* Da rede, guardando se conferir. Devolve [resposta para a página, promessa de ter guardado]. */
function daRede(cache, pedido, endereco, hash) {
  return fetch(pedido).then(function (r) {
    if (!r || r.status !== 200 || r.type !== 'basic') return [r, Promise.resolve(false)];
    var copia = r.clone();
    return [r, copia.arrayBuffer().then(function (buf) { return guarda(cache, endereco, hash, copia, buf); })
      .then(null, function () { return false; })];
  });
}

self.addEventListener('install', function () { self.skipWaiting(); });

self.addEventListener('activate', function (ev) {
  ev.waitUntil(DESLIGA
    ? caches.delete(NOME).then(null, function () {}).then(function () { return self.registration.unregister(); })
    : self.clients.claim());
});

self.addEventListener('fetch', function (ev) {
  if (DESLIGA) return;
  var hash = null;
  try { hash = alvo(ev.request.method, ev.request.url, self.location.origin); } catch (e) {}
  if (!hash) return;                                  // não é comigo: o navegador busca como sempre
  var pedido = ev.request;
  ev.respondWith(caches.open(NOME).then(function (cache) {
    return cache.match(pedido.url).then(function (tem) {
      if (tem) return tem;
      return daRede(cache, pedido, pedido.url, hash).then(function (par) {
        ev.waitUntil(par[1]);
        return par[0];
      });
    });
  }).then(null, function () { return fetch(pedido); }));   // cache cheio, quebrado, o que for: a rede
});

/* Os recados da página (js/app_jogo.js), respondidos pela porta que veio junto:
 *   acerta { urls, completar } — apaga o guardado que o servidor não pede mais (as versões velhas) e,
 *                                com `completar`, baixa o que falta da lista ("Baixar tudo");
 *   estado                     — quantos arquivos e quantos bytes estão guardados;
 *   apaga                      — apaga tudo. */
function estado(cache) {
  return cache.keys().then(function (ks) {
    return Promise.all(ks.map(function (k) { return cache.match(k); })).then(function (rs) {
      var bytes = 0;
      for (var i = 0; i < rs.length; i++) bytes += rs[i] ? (+rs[i].headers.get('X-Soterra-Bytes') || 0) : 0;
      return { n: ks.length, bytes: bytes };
    });
  });
}

function acerta(cache, urls, completar) {
  var quer = {}, fila = [], i, origem = self.location.origin;
  for (i = 0; i < urls.length; i++) {
    var abs = new URL(urls[i], self.registration.scope).href;
    if (alvo('GET', abs, origem)) quer[abs] = true;
  }
  return cache.keys().then(function (ks) {
    var tem = {}, sai = [];
    for (i = 0; i < ks.length; i++) { if (quer[ks[i].url]) tem[ks[i].url] = true; else sai.push(ks[i]); }
    if (completar) for (var u in quer) if (!tem[u]) fila.push(u);
    return Promise.all(sai.map(function (k) { return cache.delete(k); }));
  }).then(function () {
    // um de cada vez: é pano de fundo, o jogo está abrindo na frente
    function proximo() {
      if (!fila.length) return null;
      var u = fila.shift();
      return daRede(cache, new Request(u), u, alvo('GET', u, origem))
        .then(function (par) { return par[1]; }).then(proximo, proximo);
    }
    return proximo();
  }).then(function () { return estado(cache); });
}

self.addEventListener('message', function (ev) {
  var d = ev.data || {}, porta = ev.ports && ev.ports[0];
  function responde(r) { try { if (porta) porta.postMessage(r); } catch (e) {} }
  var p;
  if (DESLIGA) p = Promise.resolve({ n: 0, bytes: 0, desligado: true });
  else if (d.tipo === 'apaga') p = caches.delete(NOME).then(function () { return { n: 0, bytes: 0 }; });
  else if (d.tipo === 'acerta') p = caches.open(NOME).then(function (c) { return acerta(c, d.urls || [], !!d.completar); });
  else if (d.tipo === 'estado') p = caches.open(NOME).then(estado);
  else return;
  ev.waitUntil(p.then(responde, function (e) { responde({ erro: String((e && e.message) || e) }); }));
});

