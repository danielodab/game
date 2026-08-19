// SOTERRA — quem entrega os modelos 3D ao jogo (dono: Agente Mobile).
//
// O PROBLEMA, MEDIDO
// ------------------
// O jogo abria carregando 28,7 MB de `assets/embedded/*.js`, dos quais 27,9 MB
// eram uma unica coisa: modelos `.glb` escritos como base64 dentro do codigo.
// Isso e caro tres vezes:
//   1. base64 e 33% maior que o binario (27,9 MB para 20,9 MB de conteudo);
//   2. o motor de JS tem de INTERPRETAR os 27,9 MB como codigo-fonte antes de
//      a primeira linha do jogo rodar — e isso e trabalho de CPU, nao de rede;
//   3. a string fica em UTF-16 no heap (o dobro dos bytes) e o `atob` cria mais
//      uma copia binaria por cima.
// Num celular isso e uma tela preta de varios segundos.
//
// A SOLUCAO, E POR QUE ELA TEM DOIS CAMINHOS
// ------------------------------------------
// `tools/extrai_assets.py` escreve os `.glb` de verdade em
// `assets/models/bundle/`. Este arquivo os busca por XHR quando o jogo esta
// SERVIDO (http://, https://, e o `https://localhost` de dentro do APK).
//
// Mas o usuario abre o `index.html` com dois cliques, e ai o endereco e
// `file://`, onde buscar `.glb` do disco e bloqueado pelo navegador. Nesse
// caso — e so nesse — voltamos ao embutido. As duas portas continuam abertas:
// nenhuma das duas foi sacrificada pela outra.
//
// COMO O RESTO DO JOGO NEM PERCEBE — E POR QUE NAO E POR BASE64
// -------------------------------------------------------------
// `js/render3d/models3d.js` e `js/render3d/models3d_v2.js` leem `JOGO.ASSETS` e
// `JOGO.MODELS` esperando base64, e os dois fazem a MESMA coisa com o que leem:
//
//     var bin = atob(b64);
//     for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
//     loader.parse(u8.buffer, ...)
//
// A tentacao e devolver base64 fabricado a partir do binario que chegou. MEDIMOS
// e nao serve: converter 21 MB para base64 em JS e depois arrastar 21 milhoes de
// `charCodeAt` de volta e mais caro que tudo o que economizamos — no aparelho do
// usuario seria a mesma tela preta com outro nome.
//
// Entao a chave nao guarda o modelo: guarda um BILHETE de 20 bytes
// ('SOTERRA-GLB:' + numero), em base64 de verdade. O codigo dos outros dois
// arquivos roda igual, so que sobre 20 bytes em vez de 3 MB. Na outra ponta,
// `GLTFLoader.parse` esta embrulhado: ao ver um bilhete, troca pelo binario de
// verdade e segue. Nada de base64, nada de copia byte a byte.
//
// Isto e uma PONTE, nao um destino: no dia em que `models3d_v2.js` (dono: Agente
// de Migracao 3D) aceitar ArrayBuffer direto em `JOGO.MODELS`, o bilhete morre e
// este arquivo encolhe. Ver o relatorio.
//
// API
//   JOGO.Bundle.servido            — true quando NAO e file://
//   JOGO.Bundle.busca(opts)        — baixa o manifesto e os binarios
//   JOGO.Bundle.injeta(lista,base,cb) — insere <script> em ordem garantida
//   JOGO.Bundle.info()             — numeros da carga (para tests/carga.html)

var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

(function () {
  'use strict';

  var B = {};
  JOGO.Bundle = B;

  var proto = (typeof location !== 'undefined' && location.protocol) || 'file:';
  // `?embutido=1` forca o caminho antigo mesmo servido — serve para comparar os
  // dois tempos de boot na MESMA maquina, que e a unica comparacao honesta.
  var forcaEmbutido = /[?&]embutido=1/.test((typeof location !== 'undefined' && location.search) || '');
  B.servido = (proto !== 'file:') && !forcaEmbutido;
  B.modo = B.servido ? 'busca' : 'embutido';

  var medida = {
    modo: B.modo, itens: 0, bytes: 0, trocas: 0,
    msManifesto: 0, msBinarios: 0, erros: []
  };
  B.info = function () { return medida; };

  function agora() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  }

  // ------------------------------------------------------------------ bilhete
  var MARCA = 'SOTERRA-GLB:';        // 12 bytes
  var acervo = [];                   // indice -> Uint8Array do modelo

  function bilhete(u8) {
    var n = acervo.push(u8) - 1;
    var num = '00000000' + n;
    return btoa(MARCA + num.slice(-8));    // 20 bytes -> 28 chars de base64
  }

  function guarda(alvoNome, chave, u8) {
    var gaveta = JOGO[alvoNome] = JOGO[alvoNome] || {};
    gaveta[chave] = bilhete(u8);
  }

  /* Troca o bilhete pelo binario na entrada do GLTFLoader. Fica ligado uma vez
   * so; o que nao for bilhete passa reto, entao qualquer outro `parse` do jogo
   * continua igual. */
  var pontePronta = false;
  function ligaPonte() {
    if (pontePronta) return true;
    if (typeof THREE === 'undefined' || !THREE.GLTFLoader || !THREE.GLTFLoader.prototype) return false;
    var proto = THREE.GLTFLoader.prototype;
    var original = proto.parse;
    if (!original || original.__soterra) return (pontePronta = true);

    function eBilhete(ab) {
      if (!(ab instanceof ArrayBuffer) || ab.byteLength !== MARCA.length + 8) return -1;
      var v = new Uint8Array(ab), i;
      for (i = 0; i < MARCA.length; i++) if (v[i] !== MARCA.charCodeAt(i)) return -1;
      var n = 0;
      for (i = MARCA.length; i < v.length; i++) n = n * 10 + (v[i] - 48);
      return n;
    }

    proto.parse = function (data, path, onLoad, onError) {
      var n = eBilhete(data);
      if (n >= 0 && acervo[n]) {
        var u8 = acervo[n];
        acervo[n] = null;                       // some da memoria assim que serve
        medida.trocas++;
        data = (u8.byteOffset === 0 && u8.byteLength === u8.buffer.byteLength)
          ? u8.buffer : u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
      }
      return original.call(this, data, path, onLoad, onError);
    };
    proto.parse.__soterra = true;
    pontePronta = true;
    return true;
  }
  B.ligaPonte = ligaPonte;

  // ------------------------------------------------------------------- rede
  function pega(url, tipo, ok, falha) {
    var x = new XMLHttpRequest();
    x.open('GET', url, true);
    if (tipo) x.responseType = tipo;
    x.onload = function () {
      // file:// devolve status 0 com corpo valido; http devolve 200..299
      if (x.status === 0 ? !!x.response : (x.status >= 200 && x.status < 300)) ok(x.response);
      else falha(new Error(url + ' -> HTTP ' + x.status));
    };
    x.onerror = function () { falha(new Error(url + ' -> falha de rede')); };
    x.send();
  }

  /* Baixa manifesto + binarios. opts: { base, progresso(feitos,total), pronto(err) } */
  B.busca = function (opts) {
    opts = opts || {};
    var base = opts.base || '';
    var pronto = opts.pronto || function () {};
    var progresso = opts.progresso || function () {};
    if (!B.servido) { pronto(null); return; }

    var t0 = agora();
    pega(base + 'assets/models/bundle/manifest.json?v=' + Date.now(), 'json', function (man) {
      medida.msManifesto = agora() - t0;
      if (typeof man === 'string') { try { man = JSON.parse(man); } catch (e) { man = null; } }
      if (!man || !man.itens || !man.itens.length) {
        return pronto(new Error('manifesto vazio — rode tools/extrai_assets.py'));
      }
      if (man.meshyClips) {
        JOGO.MESHY_CLIPS = JOGO.MESHY_CLIPS || {};
        for (var mk in man.meshyClips) JOGO.MESHY_CLIPS[mk] = man.meshyClips[mk];
      }
      // marca de versao vinda do manifesto: o binario so e rebaixado do cache
      // quando o manifesto muda. Carimbar Date.now() aqui, como fazemos com os
      // .js, jogaria 21 MB fora a cada F5.
      var v = '?v=' + encodeURIComponent(man.gerado || '1');
      var itens = man.itens;
      medida.itens = itens.length;

      var t1 = agora();
      var i = 0, vivos = 0, feitos = 0, erro = null;
      var PARALELO = 8;

      function passo() {
        while (vivos < PARALELO && i < itens.length) {
          (function (it) {
            vivos++;
            pega(base + man.base + it.arquivo + v, 'arraybuffer', function (buf) {
              guarda(it.alvo, it.chave, new Uint8Array(buf));
              medida.bytes += buf.byteLength;
              vivos--; feitos++; progresso(feitos, itens.length);
              passo();
            }, function (e) {
              erro = erro || e; medida.erros.push(String(e.message || e));
              vivos--; feitos++; progresso(feitos, itens.length);
              passo();
            });
          })(itens[i++]);
        }
        if (vivos === 0 && i >= itens.length) {
          medida.msBinarios = agora() - t1;
          pronto(erro);
        }
      }
      passo();
    }, function (e) { pronto(e); });
  };

  // ---------------------------------------------------------------- scripts
  /* Insere <script> um atras do outro. `async=false` em script inserido por
   * codigo e o que o HTML manda para PRESERVAR A ORDEM — sem isso a arvore de
   * dependencias do jogo (que e a ordem da lista) desmonta. */
  B.injeta = function (lista, base, cb) {
    // A ponte tem de estar de pe ANTES do primeiro script que decodifica modelo
    // (`models3d.js` faz isso na propria avaliacao). THREE vem na fase A, entao
    // isto resolve em um ou dois giros — mas esperar e obrigatorio.
    if (B.servido && !ligaPonte()) {
      setTimeout(function () { B.injeta(lista, base, cb); }, 20);
      return;
    }
    var restam = lista.length;
    if (!restam) { if (cb) cb(); return; }
    for (var i = 0; i < lista.length; i++) {
      var s = document.createElement('script');
      s.src = base + lista[i] + (window.__V || '');
      s.async = false;
      s.onload = s.onerror = function () { if (--restam === 0 && cb) cb(); };
      document.head.appendChild(s);
    }
  };

  /* Avisa o navegador para JA ir buscando os .js da segunda fase enquanto os
   * 21 MB de modelo descem. Sem isto, os dois viram fila indiana. */
  B.aquece = function (lista, base) {
    if (!document.head) return;
    for (var i = 0; i < lista.length; i++) {
      var l = document.createElement('link');
      l.rel = 'preload'; l.as = 'script';
      l.href = base + lista[i] + (window.__V || '');
      document.head.appendChild(l);
    }
  };
})();
