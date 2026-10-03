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
// CACHE
// -----
// Cada modelo desce com o hash do CONTEUDO dele (`?h=`, do manifesto que o
// extrai_assets.py escreve): modelo que nao mudou mantem o endereco de um
// deploy para o outro, e o Caddy manda o navegador guardar por um ano. Os
// <script> que este arquivo insere levam o hash do arquivo deles
// (`window.__url`, que o index.html monta com o js/versao.js do build).
//
// API
//   JOGO.Bundle.servido            — true quando NAO e file://
//   JOGO.Bundle.busca(opts)        — baixa o manifesto e os binarios DA BASE
//                                    (sob demanda; ?carga=tudo = todos, como antes)
//   JOGO.Bundle.segura(pedido, deNovo) — o gancho de descer (Game.startRun e cia.):
//                                    false = tudo na mao, siga; true = segurou a
//                                    descida atras da #carga e chama deNovo depois
//   JOGO.Bundle.plano(pedido)      — as chaves de modelo de uma descida
//   JOGO.Bundle.preBusca()         — os calabouços ABERTOS em segundo plano
//                                    (nao liga com Economia de Dados / 2G);
//                                    abre so a vitrine da praca, o resto espera o gancho
//   JOGO.Bundle.vitrine()          — o que a pre-busca abre (null = abre tudo)
//   JOGO.Bundle.pede(chaves, cb)   — baixa e abre JA, sem tela: o corpo do avatar,
//                                    do fantasma, o guarda-roupa; devolve quantas buscou
//   JOGO.Bundle.corpoDe(ap)        — o corpo proprio de uma aparencia 'fus:a+b' (ou null)
//   JOGO.Bundle.adianta(chaves)    — pre-busca avulsa (fila baixa)
//   JOGO.Bundle.tudo(cb)           — o que faltar, de uma vez (provas do pacote)
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

  // ----------------------------------------------------------------- enderecos
  var MANIFESTO = 'assets/models/bundle/manifest.json';

  /* O hash que o build (servidor/coolify/versao.py -> js/versao.js) gravou
   * para um arquivo, ou '' sem build (o js/versao.js 'dev' do git). */
  function hashDoBuild(f) {
    var V = (typeof window !== 'undefined') ? window.SOTERRA_VERSAO : null;
    if (!V || !V.arquivos || !V.versao || V.versao === 'dev') return '';
    return Object.prototype.hasOwnProperty.call(V.arquivos, f) ? V.arquivos[f] : '';
  }

  /* O endereco de um script: o do index.html (`window.__url`, com o hash do
   * build) quando existe; nas paginas de teste, o carimbo `window.__V`. */
  function endereco(base, f) {
    if (typeof window !== 'undefined' && typeof window.__url === 'function') return base + window.__url(f);
    return base + f + ((typeof window !== 'undefined' && window.__V) || '');
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
  /* `prazo` (ms, opcional) e o vigia de download PARADO: se nada chegar
   * nesse tempo — nem o primeiro byte, nem o seguinte —, o pedido e
   * cancelado e cai como falha de rede (novas tentativas e, no fim, o aviso
   * com os dois botoes). E prazo SEM PROGRESSO, nao de duracao: conexao
   * lenta que continua pingando bytes nunca estoura; sinal que sumiu no
   * tunel estoura. Sem ele, um download empacado deixava a #carga de pe
   * para sempre, sem botao nenhum. Devolve o XHR: quem cancela chama
   * abort(), que nao dispara nem `ok` nem `falha`. */
  function pega(url, tipo, ok, falha, prazo) {
    var x = new XMLHttpRequest(), vigia = null, acabou = false;
    function para() {
      acabou = true;
      if (vigia) { clearTimeout(vigia); vigia = null; }
    }
    function arma() {
      if (!prazo || acabou) return;
      if (vigia) clearTimeout(vigia);
      vigia = setTimeout(function () {
        if (acabou) return;
        para();
        try { x.abort(); } catch (e) {}
        falha(new Error(url + ' -> ' + prazo + ' ms sem receber nada'));
      }, prazo);
    }
    x.open('GET', url, true);
    if (tipo) x.responseType = tipo;
    x.onprogress = arma;
    x.onload = function () {
      if (acabou) return;
      para();
      // file:// devolve status 0 com corpo valido; http devolve 200..299
      if (x.status === 0 ? !!x.response : (x.status >= 200 && x.status < 300)) ok(x.response);
      else falha(new Error(url + ' -> HTTP ' + x.status));
    };
    x.onerror = function () {
      if (acabou) return;
      para();
      falha(new Error(url + ' -> falha de rede'));
    };
    x.onabort = para;
    x.send();
    arma();
    return x;
  }

  /* Baixa manifesto + binarios. opts: { base, progresso(feitos,total), pronto(err) } */
  B.busca = function (opts) {
    opts = opts || {};
    var base = opts.base || '';
    var pronto = opts.pronto || function () {};
    var progresso = opts.progresso || function () {};
    if (!B.servido) { pronto(null); return; }

    var t0 = agora();
    // O manifesto e o indice dos modelos: vai com o hash dele quando o build
    // o gravou, senao com o carimbo do instante. O Caddy o serve com
    // no-cache de todo jeito, entao ele sempre confere com o servidor.
    pega(base + MANIFESTO + '?v=' + (hashDoBuild(MANIFESTO) || Date.now()), 'json', function (man) {
      medida.msManifesto = agora() - t0;
      if (typeof man === 'string') { try { man = JSON.parse(man); } catch (e) { man = null; } }
      if (!man || !man.itens || !man.itens.length) {
        return pronto(new Error('manifesto vazio — rode tools/extrai_assets.py'));
      }
      if (man.meshyClips) {
        JOGO.MESHY_CLIPS = JOGO.MESHY_CLIPS || {};
        for (var mk in man.meshyClips) JOGO.MESHY_CLIPS[mk] = man.meshyClips[mk];
      }
      baseModelos = base;
      indexa(man);
      // SOB DEMANDA: antes do menu, so a base. Com ?carga=tudo, ou com um
      // manifesto sem grupos, desce tudo — o jeito de antes.
      var itens = B.sobDemanda()
        ? man.itens.filter(function (it) { return (it.grupo || 'base') === 'base'; })
        : man.itens;
      medida.boot = { itens: itens.length, bytes: 0, grupos: B.sobDemanda() ? ['base'] : ['todos'] };
      for (var bi = 0; bi < itens.length; bi++) medida.boot.bytes += itens[bi].bytes || 0;

      var t1 = agora();
      fase = 'boot';
      (function vai(lista) {
        baixaLista(lista, progresso, function (falhas) {
          medida.msBinarios = agora() - t1;
          if (!falhas.length) { fase = 'avulso'; pronto(null); return; }
          // as novas tentativas ja foram (ESPERAS): avisa e deixa o jogador escolher
          telaFalha('Não consegui baixar ' + falhas.length + (falhas.length > 1 ? ' modelos' : ' modelo') +
                    '. Confira a conexão.', function () { vai(falhas); }, function () {
            fase = 'avulso';
            pronto(new Error(falhas.length + ' modelo(s) não desceram'));
          });
        });
      })(itens);
    }, function (e) { pronto(e); }, B.prazos.manifesto);
  };

  /* O endereco de um binario: o hash DO CONTEUDO dele (it.hash). O que nao
   * mudou mantem o endereco entre extracoes e deploys, e fica no cache. Antes
   * era o carimbo `gerado`, um so para todos — qualquer extracao jogava os
   * 134 MB fora do cache de todo jogador. Manifesto antigo, sem hash, ainda
   * cai no carimbo. Carimbar Date.now() aqui, como o index.html faz em casa
   * com os .js, jogaria tudo fora a cada F5. */
  function enderecoModelo(it) {
    return baseModelos + man.base + it.arquivo +
      (it.hash ? '?h=' + it.hash : '?v=' + encodeURIComponent(man.gerado || '1'));
  }

  // ================================================ CARGA SOB DEMANDA (10/09)
  //
  // O PEDIDO: "porque demora tanto?" — a tela parava em "modelos 26/212". Os
  // 212 modelos (134 MB) desciam TODOS antes do menu, e o jogador so ia usar a
  // praca e um calabouco. Agora:
  //   · antes do menu desce so o grupo `base` do manifesto (menu, Acampamento,
  //     herois, pets): 35 MB;
  //   · cada calabouco baixa os modelos DELE na hora de descer (`B.segura`,
  //     chamado por Game.startRun/nextRoom/startDuel), atras da #carga;
  //   · com o Acampamento de pe (hub3d chama `B.preBusca`), os calabouços
  //     ABERTOS descem em segundo plano, um arquivo por vez, e o que a praca
  //     MOSTRA (Hub.vitrine: corredores, chefes, o Campo) e decodificado
  //     quando o navegador folga — nunca no meio da batalha. O resto (monstro
  //     comum, peca fora do corredor, coroa) fica baixado e FECHADO ate o
  //     gancho da descida (22/09): aberto, um modelo guarda ~12 MB de textura
  //     descompactada; fechado, o ~1 MB do .glb.
  // Em casa (file://) nada disso liga: tudo continua embutido.
  //
  // O QUE BAIXAR NAO E LISTA ESCRITA A MAO: `B.plano` le os mesmos dados que o
  // jogo usa (salas, monstros e o que eles invocam, cenario do tema, a dupla, a
  // fusao do par e as invocacoes dela) e pergunta ao Models3D2 qual modelo
  // cada um veste. Monstro novo, sala nova, fusao nova: entram sozinhos.

  var man = null;              // o manifesto, depois da busca do boot
  var baseModelos = '';        // o `base` de quem chamou a busca ('' ou '../')
  var porChave = {};           // chave -> item (so os de JOGO.MODELS)
  var estado = {};             // chave -> 'baixando' | 'chegou' | 'falhou'
  var esperando = {};          // chave -> [fn(err)]
  var garantidas = {};         // chave -> true: ja passou por um gancho (chegou ou desistimos)
  var filaAlta = [], filaBaixa = [];
  var vivosAlta = 0, vivosBaixa = 0;
  var PARALELO_ALTA = 6, PARALELO_BAIXA = 1;
  // tres novas tentativas por modelo antes de desistir (a 4a falha avisa)
  var ESPERAS = [600, 1800, 4000];
  // o vigia de download PARADO (ms sem receber nenhum byte): estourou, conta
  // como falha de rede. Exposto para as provas encurtarem a espera.
  B.prazos = { parado: 20000, manifesto: 15000 };
  var fase = 'boot';           // em qual fase cada byte desceu: boot | descida | pre | avulso
  medida.porFase = { boot: { itens: 0, bytes: 0 }, descida: { itens: 0, bytes: 0 }, pre: { itens: 0, bytes: 0 },
                     avulso: { itens: 0, bytes: 0 } };      // avulso: o que B.pede buscou fora de descida
  medida.grupos = {};          // grupo -> { itens, bytes } do manifesto
  medida.pre = { estado: 'parada', feitos: 0, total: 0, soBaixados: 0 };   // soBaixados: fora da vitrine, fechados
  medida.ganchos = [];         // cada vez que a descida esperou: { onde, faltavam, ms, falhou }
  medida.vizinhos = [];        // o Poco: cada andar seguinte planejado cedo { sala, existia, chaves }
  // o decodificador de folga: levas, as que sairam pelo prazo do rIC, modelos,
  // e os ms de ESPERA (do agendar ao rIC disparar) e de ABRIR, somados
  medida.decod = { levas: 0, porPrazo: 0, modelos: 0, esperaMs: 0, abrirMs: 0 };

  var forcaTudo = /[?&]carga=tudo/.test((typeof location !== 'undefined' && location.search) || '');

  function chaveItem(it) { return it.alvo === 'MODELS' ? it.chave : null; }

  function indexa(m) {
    man = m;
    porChave = {};
    for (var i = 0; i < m.itens.length; i++) {
      var it = m.itens[i], k = chaveItem(it);
      if (k) porChave[k] = it;
      var g = it.grupo || 'base';
      var gg = medida.grupos[g] = medida.grupos[g] || { itens: 0, bytes: 0 };
      gg.itens++; gg.bytes += it.bytes || 0;
    }
  }

  /* O manifesto tem grupos? Um manifesto velho (sem `grupo`) desce tudo no
   * boot, como antes — o jogo nao pode depender de o extrai_assets.py ter
   * rodado de novo. */
  function temGrupos(m) {
    for (var i = 0; i < m.itens.length; i++) if (m.itens[i].grupo) return true;
    return false;
  }
  B.sobDemanda = function () { return !!(B.servido && man && !forcaTudo && temGrupos(man)); };

  // ------------------------------------------------------------ a fila
  function baixaUm(it, alta, feito) {
    var id = it.alvo + ':' + it.chave;
    if (estado[id] === 'chegou') { if (feito) feito(null); return; }
    if (feito) (esperando[id] = esperando[id] || []).push(feito);
    if (estado[id] === 'baixando') {
      if (alta) {                                   // o gancho passa na frente
        var j = filaBaixa.indexOf(it);
        if (j >= 0) { filaBaixa.splice(j, 1); filaAlta.push(it); gira(); }
        // ja no ar pela fila baixa (um arquivo por vez, talvez parado ou
        // esperando a proxima tentativa): larga esse voo e recomeca na alta —
        // o gancho nao fica refem de um download de segundo plano
        else if (voos[id] && !voos[id].alta) { voos[id].cancela(); filaAlta.push(it); gira(); }
      }
      return;
    }
    estado[id] = 'baixando';
    (alta ? filaAlta : filaBaixa).push(it);
    gira();
  }
  function gira() {
    while (vivosAlta < PARALELO_ALTA && filaAlta.length) inicia(filaAlta.shift(), true);
    // a pre-busca so anda com a fila do gancho vazia, e um arquivo por vez
    while (!filaAlta.length && !vivosAlta && vivosBaixa < PARALELO_BAIXA && filaBaixa.length) {
      inicia(filaBaixa.shift(), false);
    }
  }
  var voos = {};               // id -> o download no ar: { alta, cancela() }
  function inicia(it, alta) {
    var id = it.alvo + ':' + it.chave, tent = 0, minhaFase = alta ? fase : 'pre';
    var cancelado = false, xhr = null, pausa = null;
    if (alta) vivosAlta++; else vivosBaixa++;
    voos[id] = { alta: alta, cancela: function () {
      // quem cancela reenfileira: aqui so solta a vaga, sem avisar ninguem
      if (cancelado) return;
      cancelado = true;
      if (pausa) clearTimeout(pausa);
      if (xhr) { try { xhr.abort(); } catch (e) {} }
      if (alta) vivosAlta--; else vivosBaixa--;
      delete voos[id];
    } };
    (function tenta() {
      pausa = null;
      if (cancelado) return;
      xhr = pega(enderecoModelo(it), 'arraybuffer', function (buf) {
        if (cancelado) return;
        guarda(it.alvo, it.chave, new Uint8Array(buf));
        medida.bytes += buf.byteLength;
        medida.itens++;
        var pf = medida.porFase[minhaFase] || medida.porFase.descida;
        pf.itens++; pf.bytes += buf.byteLength;
        fim(null);
      }, function (e) {
        if (cancelado) return;
        if (tent < ESPERAS.length) { pausa = setTimeout(tenta, ESPERAS[tent++]); return; }
        medida.erros.push(String(e.message || e));
        fim(e);
      }, B.prazos.parado);
    })();
    function fim(err) {
      delete voos[id];
      if (alta) vivosAlta--; else vivosBaixa--;
      estado[id] = err ? 'falhou' : 'chegou';
      var fs = esperando[id] || [];
      esperando[id] = [];
      for (var i = 0; i < fs.length; i++) { try { fs[i](err); } catch (e2) {} }
      gira();
    }
  }
  B.estadoDe = function (chave) { return estado['MODELS:' + chave] || null; };
  /* O estado da fila, para as provas (tests/sob_demanda.py). */
  B.diag = function () {
    var n = { baixando: 0, chegou: 0, falhou: 0 };
    for (var k in estado) if (Object.prototype.hasOwnProperty.call(estado, k)) n[estado[k]] = (n[estado[k]] || 0) + 1;
    return { ganchoAtivo: ganchoAtivo, filaAlta: filaAlta.length, filaBaixa: filaBaixa.length,
             vivosAlta: vivosAlta, vivosBaixa: vivosBaixa, paraDecodificar: paraDecodificar.length,
             decodAgendada: decodAgendada, estados: n, garantidas: Object.keys(garantidas).length,
             voos: Object.keys(voos).length };
  };

  /* Baixa uma lista de itens (prioridade alta) e chama pronto(falhas[]). */
  function baixaLista(itens, progresso, pronto) {
    var total = itens.length, feitos = 0, falhas = [];
    if (!total) { pronto(falhas); return; }
    for (var i = 0; i < itens.length; i++) {
      (function (it) {
        baixaUm(it, true, function (err) {
          feitos++;
          if (err) falhas.push(it);
          if (progresso) progresso(feitos, total);
          if (feitos === total) pronto(falhas);
        });
      })(itens[i]);
    }
  }

  // ------------------------------------------------------------ o plano
  function D() { return JOGO.DATA || {}; }
  function M2() { return JOGO.Models3D2 || null; }
  function lista(o) {
    if (!o) return [];
    if (Array.isArray(o)) return o;
    return Object.keys(o).map(function (k) { return o[k]; });
  }
  function calabouco(id) {
    var ds = lista(D().dungeons);
    for (var i = 0; i < ds.length; i++) if (ds[i] && ds[i].id === id) return ds[i];
    return null;
  }
  /* 02/10: o mapa de luta que não é calabouço (DATA.arenas) e que tem monstro — a Câmara do Eco. Os de
   * duelo seguem pelo `cenario` de sempre (o pedido de duelo nem passa por aqui). */
  function mapaPve(id) {
    var ar = lista(D().arenas);
    for (var i = 0; i < ar.length; i++) if (ar[i] && ar[i].id === id && ar[i].modo === 'eco') return ar[i];
    return null;
  }
  /* Tudo o que um objeto de dados manda INVOCAR (efeito summon), a qualquer
   * profundidade — formas de fusao guardam o efeito dentro de `mechanic`. */
  function invocacoes(obj, fora, fundo) {
    if (!obj || typeof obj !== 'object' || (fundo || 0) > 6) return;
    if (obj.type === 'summon' && typeof obj.monsterId === 'string') { fora.push(obj.monsterId); return; }
    var ks = Array.isArray(obj) ? obj : Object.keys(obj).map(function (k) { return obj[k]; });
    for (var i = 0; i < ks.length; i++) {
      if (ks[i] && typeof ks[i] === 'object') invocacoes(ks[i], fora, (fundo || 0) + 1);
    }
  }
  function feitico(id) {
    var d = D();
    return (d.spells && d.spells[id]) || (d.monsterSpells && d.monsterSpells[id]) ||
           (d.itemSpells && d.itemSpells[id]) || (d.petSpells && d.petSpells[id]) || null;
  }
  function modeloDe(defId, opts) {
    var m2 = M2();
    if (!m2 || !m2.lookFor) return null;
    try { var lk = m2.lookFor(defId, opts || {}); return lk ? lk.model : null; } catch (e) { return null; }
  }
  /* O monstro, o corpo dele e o de quem ele invoca (um nivel so: invocacao
   * nao invoca). */
  function doMonstro(id, fora) {
    var mdl = modeloDe(id);
    if (mdl) fora.push(mdl);
    var d = D(), md = (d.monsters && d.monsters[id]) || (d.fusionSummons && d.fusionSummons[id]) ||
                     (d.ecoMonstros && d.ecoMonstros[id]) || null;
    var inv = [];
    ((md && md.spells) || []).forEach(function (sid) { invocacoes(feitico(sid), inv, 0); });
    // 02/10: o Eco não invoca por feitiço — ele CHAMA os Ecos Menores na troca de fase (DATA.eco.menores)
    if (md && md.supremo && d.eco && d.eco.menores) {
      Object.keys(d.eco.menores).forEach(function (el) { inv.push(d.eco.menores[el]); });
    }
    inv.forEach(function (sid) { var m = modeloDe(sid); if (m) fora.push(m); });
  }
  function doTema(tema, fora) {
    var cat = tema && JOGO.CENARIO && JOGO.CENARIO[tema];
    if (!cat) return;
    for (var papel in cat) {
      if (!Object.prototype.hasOwnProperty.call(cat, papel) || !Array.isArray(cat[papel])) continue;
      for (var i = 0; i < cat[papel].length; i++) if (typeof cat[papel][i] === 'string') fora.push(cat[papel][i]);
    }
  }
  function classeDoHeroi(hid) {
    var P = JOGO.Progress, h = null;
    try { h = P && P.hero ? P.hero(hid) : null; } catch (e) { h = null; }
    return (h && (h.classId || h.cls)) || hid;
  }
  function daDupla(ids, fora) {
    var cls = (ids || []).map(classeDoHeroi);
    // o que o GRIMORIO de cada heroi invoca: o Progress sabe o que ele leva
    // (base, caminho, item, conjunto — e o Mestre, que leva QUALQUER feitico
    // do jogo, sem classId nenhum)
    (ids || []).forEach(function (hid) {
      var P = JOGO.Progress, sps = [];
      try { sps = (P && P.spellsFor) ? (P.spellsFor(hid) || []) : []; } catch (e) { sps = []; }
      sps.forEach(function (sid) {
        var inv = [];
        invocacoes(feitico(sid), inv, 0);
        inv.forEach(function (m) { doMonstro(m, fora); });
      });
    });
    cls.forEach(function (c) {
      var m = modeloDe(c, { classId: c });
      if (m) fora.push(m);
      // o que os feiticos da classe invocam (o Xama: o rebanho inteiro)
      lista(D().spells).forEach(function (sp) {
        if (sp && sp.classId === c) {
          var inv = [];
          invocacoes(sp.effects, inv, 0);
          inv.forEach(function (sid) { doMonstro(sid, fora); });
        }
      });
    });
    if (cls.length === 2 && M2() && M2().modeloDaFusao) {
      var a = cls[0], b = cls[1];
      if (a > b) { var t = a; a = b; b = t; }
      var corpo = M2().modeloDaFusao(a, b);
      if (corpo) fora.push(corpo);
      if (porChave['muro_' + a + '_' + b]) fora.push('muro_' + a + '_' + b);   // o escudo do par
      var inv2 = [];
      invocacoes(D().fusionForms && D().fusionForms[a + '+' + b], inv2, 0);
      inv2.forEach(function (sid) { doMonstro(sid, fora); });
    }
  }

  /* As chaves de modelo de uma descida — o cenario primeiro, depois quem
   * mora nele, depois a dupla. pedido: { dungeonId, sala, party, duelo, duplas }.
   * Calabouco normal: as salas todas (e o mesmo tema). Poco: so a sala
   * pedida — as salas dele sao sorteadas, e a lista delas diz o que baixar. */
  B.plano = function (pedido) {
    pedido = pedido || {};
    var fora = [];
    var dg = pedido.dungeonId ? (calabouco(pedido.dungeonId) || (pedido.duelo ? null : mapaPve(pedido.dungeonId))) : null;
    if (pedido.duelo && !dg) dg = calabouco(pedido.cenario || 'greenhouse');
    var salas = [];
    if (dg && !pedido.duelo) {
      var rs = dg.rooms || [];
      var s0 = Math.max(0, pedido.sala || 0);
      salas = (dg.id === 'poco') ? (rs[s0] ? [rs[s0]] : []) : rs.slice(s0);
    }
    if (dg) {
      if (pedido.duelo || !salas.length) doTema(dg.theme, fora);
      salas.forEach(function (r) { doTema((r && r.sceneryTheme) || dg.theme, fora); });
    }
    salas.forEach(function (r) {
      lista(r && r.monsters).forEach(function (mid) { if (typeof mid === 'string') doMonstro(mid, fora); });
    });
    if (pedido.duplas) pedido.duplas.forEach(function (dp) { daDupla(dp, fora); });
    else daDupla(pedido.party, fora);
    // so o que o manifesto conhece, sem repetir
    var visto = {}, saida = [];
    for (var i = 0; i < fora.length; i++) {
      var k = fora[i];
      if (!k || visto[k] || !porChave[k]) continue;
      visto[k] = true;
      saida.push(k);
    }
    return saida;
  };

  function pronta(k) {
    var m2 = M2();
    return !!(garantidas[k] || (m2 && m2.decodificado && m2.decodificado(k)));
  }

  /* Baixa E decodifica as chaves; pronto(falhas[] de itens). */
  function garante(chaves, progresso, pronto) {
    var itens = [];
    for (var i = 0; i < chaves.length; i++) if (porChave[chaves[i]]) itens.push(porChave[chaves[i]]);
    baixaLista(itens, progresso, function (falhas) {
      var m2 = M2();
      function fecha() {
        for (var j = 0; j < itens.length; j++) {
          if (falhas.indexOf(itens[j]) < 0) garantidas[itens[j].chave] = true;
        }
        pronto(falhas);
      }
      // abre SO o que esta descida usa — o resto que desceu em segundo plano
      // continua com o decodificador de folga, nao atras da tela
      if (m2 && m2.novos) m2.novos(function () { fecha(); }, chaves);
      else fecha();
    });
  }

  // ------------------------------------------------------------ a #carga
  function el(id) { return (typeof document !== 'undefined') ? document.getElementById(id) : null; }
  function acoes(caixa) {
    var a = caixa.querySelector('.carga-acoes');
    if (!a) {
      a = document.createElement('div');
      a.className = 'carga-acoes';
      a.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;justify-content:center';
      caixa.appendChild(a);
    }
    return a;
  }
  function telaAbre(texto) {
    var c = el('carga'), b = el('carga-barra'), t = el('carga-txt');
    if (!c) return;
    // por cima das fichas da HUD (z 60-95), que o gancho pode ter aberto
    c.style.zIndex = '9500';
    c.hidden = false;
    if (b) b.style.width = '0%';
    if (t) t.textContent = texto;
    var a = c.querySelector('.carga-acoes');
    if (a) a.parentNode.removeChild(a);
  }
  function telaAnda(texto, feitos, total) {
    var b = el('carga-barra'), t = el('carga-txt');
    if (b) b.style.width = Math.round(100 * feitos / Math.max(1, total)) + '%';
    if (t) t.textContent = texto + ' ' + feitos + '/' + total;
  }
  function telaFecha() {
    var c = el('carga');
    if (!c) return;
    var a = c.querySelector('.carga-acoes');
    if (a) a.parentNode.removeChild(a);
    c.hidden = true;
    c.style.zIndex = '';
  }
  /* A falha que sobrou depois das tentativas: diz o que faltou e oferece
   * tentar de novo (so o que faltou) ou seguir com os substitutos — que sao
   * visiveis (esqueleto, peca do kit), nunca buraco. */
  function telaFalha(texto, tentar, seguir) {
    var c = el('carga'), t = el('carga-txt');
    if (!c) { seguir(); return; }
    c.hidden = false;
    if (t) t.textContent = texto;
    var a = acoes(c);
    a.innerHTML = '';
    function botao(rotulo, cls, fn) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn ' + cls;
      b.textContent = rotulo;
      b.onclick = function () { a.innerHTML = ''; fn(); };
      a.appendChild(b);
      return b;
    }
    botao('Tentar de novo', 'btn-primary carga-tentar', tentar);
    botao('Seguir assim mesmo', 'btn-ghost carga-seguir', seguir);
  }
  B.telaFalha = telaFalha;

  function nomeDoPedido(p) {
    if (p.duelo) return 'o duelo';
    var dg = p.dungeonId ? calabouco(p.dungeonId) : null;
    if (dg && dg.id === 'poco') return 'o andar ' + ((p.sala || 0) + 1) + ' do Poço';
    var n = dg ? (dg.name || dg.id) : 'a descida';
    // "A Estufa Soterrada" no meio da frase vira "a Estufa Soterrada"
    return n.replace(/^(A|O|As|Os) /, function (m) { return m.toLowerCase(); });
  }
  /* "de" + nome, com a contração do português: da Estufa, do andar, do duelo */
  function deNome(n) {
    var m = /^(a|o|as|os) /.exec(n);
    return m ? 'd' + n : 'de ' + n;
  }

  // ------------------------------------------------------------ o gancho
  var ganchoAtivo = false;
  // o que o jogador mandou "seguir assim mesmo" sem: vale SO para a volta
  // sincrona do deNovo — a proxima descida que precisar pede de novo
  var pulaNaVolta = null;
  /* Chamado por Game.startRun / nextRoom / startDuel ANTES de a descida
   * mudar de tela. false: tudo na mao (ou em casa) — siga na hora. true: o
   * gancho segurou a descida e chama `deNovo` quando os modelos chegarem (ou
   * quando o jogador escolher seguir assim mesmo). */
  B.segura = function (pedido, deNovo) {
    if (!B.sobDemanda()) return false;
    if (ganchoAtivo) return true;                   // um toque a mais no botao: ja estou nisso
    var chaves = B.plano(pedido);
    var faltam = chaves.filter(function (k) { return !pronta(k) && !(pulaNaVolta && pulaNaVolta[k]); });
    vizinhoDoPoco(pedido);
    if (!faltam.length) return false;
    ganchoAtivo = true;
    var t0 = agora(), nome = nomeDoPedido(pedido);
    var registro = { onde: nome, faltavam: faltam.length, ms: 0, falhou: 0 };
    medida.ganchos.push(registro);
    // a pre-busca deixa baixado e FECHADO o que a praca nao mostra: a descida
    // entao so abre, e a tela nao diz que esta baixando o que ja chegou
    var soAbre = faltam.every(function (k) { return estado['MODELS:' + k] === 'chegou'; });
    var verbo = soAbre ? 'abrindo ' : 'baixando ';
    if (soAbre) registro.soAbriu = true;
    telaAbre(verbo + nome + '…');
    function roda() {
      fase = 'descida';
      garante(faltam, function (f, t) { telaAnda(verbo + nome + '…', f, t); }, function (falhas) {
        fase = 'avulso';
        if (!falhas.length) {
          registro.ms = Math.round(agora() - t0);
          ganchoAtivo = false;
          telaFecha();
          segue();
          return;
        }
        registro.falhou++;
        telaFalha('Não consegui baixar ' + falhas.length + (falhas.length > 1 ? ' modelos' : ' modelo') +
                  ' ' + deNome(nome) + '. Confira a conexão.', roda, function () {
          // seguir assim mesmo: ESTA descida vai com os substitutos (a volta
          // do deNovo e sincrona e cabe no try). O que faltou NAO fica
          // condenado ate o F5: volta agora para a fila baixa, e a proxima
          // descida que precisar dele pede de novo
          var faltou = falhas.map(function (it) { return it.chave; });
          pulaNaVolta = {};
          for (var i = 0; i < faltou.length; i++) pulaNaVolta[faltou[i]] = true;
          registro.ms = Math.round(agora() - t0);
          registro.seguiu = faltou.length;
          ganchoAtivo = false;
          telaFecha();
          try { segue(); } finally { pulaNaVolta = null; }
          preBuscaChaves(faltou.filter(function (k) { return !pronta(k); }));
        });
      });
    }
    // a descida de volta: erro nela aparece no console, não some calado
    function segue() {
      try { deNovo(); }
      catch (eN) { if (typeof console !== 'undefined' && console.error) console.error('[Bundle] a descida quebrou:', eN); }
    }
    // NADA pode deixar a #carga de pé: se o gancho quebrar aqui, ela fecha,
    // o gancho solta e a descida segue na hora (com os substitutos)
    try { roda(); }
    catch (e) {
      ganchoAtivo = false;
      fase = 'avulso';
      registro.erro = String((e && e.message) || e);
      telaFecha();
      if (typeof console !== 'undefined' && console.error) console.error('[Bundle] gancho:', e);
      return false;
    }
    return true;
  };

  /* O Poco sorteia a sala seguinte antes de o pe chegar nela: ela ja pode ir
   * descendo em segundo plano. */
  function vizinhoDoPoco(pedido) {
    if (!pedido || pedido.dungeonId !== 'poco') return;
    var s = (pedido.sala || 0) + 1;
    // o nextRoom so sorteia esse andar DEPOIS do gancho (preparar(roomIndex
    // + 2) depois do ++), e o plano achava a sala vazia do 2o andar em
    // diante. Sortear agora e o mesmo sorteio, so mais cedo: preparar so
    // acrescenta o que falta, e a chamada do nextRoom vira no-op
    try { if (JOGO.Poco && JOGO.Poco.preparar) JOGO.Poco.preparar(s + 1); } catch (e) {}
    var dg = calabouco('poco');
    var prox = B.plano({ dungeonId: 'poco', sala: s, party: [] });
    medida.vizinhos.push({ sala: s, existia: !!(dg && dg.rooms && dg.rooms[s]), chaves: prox.length });
    if (medida.vizinhos.length > 20) medida.vizinhos.shift();
    if (economiaDeDados()) return;             // economia de dados: so o gancho baixa
    preBuscaChaves(prox);
  }

  // ------------------------------------------------------------ a pre-busca
  var paraDecodificar = [], decodAgendada = false, decodPausada = false;
  /* So para as provas: segura a decodificacao em segundo plano, para a
   * descida seguinte encontrar os modelos BAIXADOS mas ainda fechados — o
   * caminho em que o gancho so decodifica (tests/sob_demanda.py). */
  B.pausaDecodificacao = function (sim) {
    decodPausada = !!sim;
    if (!decodPausada) agendaDecodificacao();
  };
  function emBatalha() {
    var G = JOGO.Game;
    return !!(G && G.screen === 'battle');
  }
  // Na praca o laco de quadros quase nao deixa folga: com prazo de 2,5 s o
  // requestIdleCallback so saia pelo prazo (medido: 6 de 53 abertos em 90 s).
  // Prazo curto; pelo prazo (a praca desenhando sem parar), um modelo — um
  // tranco curto a cada 0,6 s; com folga de verdade (nenhum quadro na fila),
  // ate tres de uma vez.
  function folga(fn) {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(fn, { timeout: 600 });
    else setTimeout(fn, 250);
  }
  function decodificaDepois(chave) {
    paraDecodificar.push(chave);
    agendaDecodificacao();
  }
  function agendaDecodificacao() {
    if (decodAgendada || !paraDecodificar.length) return;
    decodAgendada = true;
    var tAgendou = agora();
    folga(function (dl) {
      decodAgendada = false;
      var m2 = M2();
      // no meio da batalha, nem um quadro a menos: espera ela acabar
      if (!m2 || !m2.novos || emBatalha() || ganchoAtivo || decodPausada) { setTimeout(agendaDecodificacao, 1500); return; }
      // o que o gancho de uma descida (ou o pede) ja abriu sai da fila sem
      // gastar uma folga: senao cada um custava 0,6 s so para nada acontecer
      if (m2.decodificado) paraDecodificar = paraDecodificar.filter(function (k) { return !m2.decodificado(k); });
      if (!paraDecodificar.length) return;
      var livre = 0;
      try { livre = (dl && !dl.didTimeout && dl.timeRemaining) ? dl.timeRemaining() : 0; } catch (e) { livre = 0; }
      var leva = paraDecodificar.splice(0, livre > 40 ? 3 : 1);
      medida.decod.levas++;
      medida.decod.modelos += leva.length;
      if (dl && dl.didTimeout) medida.decod.porPrazo++;
      medida.decod.esperaMs += Math.round(agora() - tAgendou);
      var tAbre = agora();
      m2.novos(function () { medida.decod.abrirMs += Math.round(agora() - tAbre); agendaDecodificacao(); }, leva);
    });
  }
  /* `abre` (opcional): { chave: true } do que abrir quando chegar; o resto so
   * baixa e fica fechado ate um gancho ou um pede. Sem ele, abre tudo — o
   * andar seguinte do Poco, o avulso e a nova tentativa seguem assim. */
  function preBuscaChaves(chaves, abre) {
    chaves.forEach(function (k) {
      var it = porChave[k];
      if (!it || estado['MODELS:' + k] === 'chegou' || pronta(k)) return;
      medida.pre.total++;
      baixaUm(it, false, function (err) {
        medida.pre.feitos++;
        if (err) return;
        if (!abre || abre[k]) decodificaDepois(k);
        else medida.pre.soBaixados++;
      });
    });
  }
  /* A vitrine da praca (Hub.vitrine) como { chave: true }, ou null quando nao
   * ha Hub ou ele nao devolveu nada — ai a pre-busca abre tudo, como antes:
   * corredor sem peca aberta nunca planta, e isso e pior que memoria. */
  function vitrine() {
    var H = JOGO.Hub, ks = null;
    try { ks = (H && H.vitrine) ? H.vitrine() : null; } catch (e) { ks = null; }
    if (!ks || !ks.length) return null;
    var mapa = {};
    for (var i = 0; i < ks.length; i++) if (ks[i]) mapa[ks[i]] = true;
    return mapa;
  }
  B.vitrine = function () { var v = vitrine(); return v ? Object.keys(v) : null; };
  /* A ordem: o Calabouco do Dia, os outros ABERTOS (o cenario de cada um
   * antes dos monstros — os cantinhos dos portais esperam as pecas), a fusao
   * e as invocacoes da dupla escolhida, e as coroas do ranking. Portal
   * FECHADO nao se pre-busca: JOGO.DATA.portalFechado. */
  B.ordemDaPreBusca = function () {
    var d = D(), abertos = [];
    lista(d.dungeons).forEach(function (dg) {
      if (!dg || !dg.id || dg.id === 'poco') return;
      if (d.portalFechado && d.portalFechado(dg.id)) return;
      abertos.push(dg.id);
    });
    var dia = null;
    try { dia = JOGO.Diario && JOGO.Diario.hoje ? JOGO.Diario.hoje() : null; } catch (e) { dia = null; }
    if (dia && abertos.indexOf(dia.dungeonId) > 0) {
      abertos.splice(abertos.indexOf(dia.dungeonId), 1);
      abertos.unshift(dia.dungeonId);
    }
    var fora = [];
    abertos.forEach(function (id) {                       // o cenario de todos primeiro
      var dg = calabouco(id), c = [];
      (dg.rooms || []).forEach(function (r) { doTema((r && r.sceneryTheme) || dg.theme, c); });
      if (!c.length) doTema(dg.theme, c);
      fora = fora.concat(c);
    });
    abertos.forEach(function (id) { fora = fora.concat(B.plano({ dungeonId: id, party: [] })); });
    var sel = [];
    try { sel = (JOGO.UI && JOGO.UI.selection) ? JOGO.UI.selection() : []; } catch (e2) { sel = []; }
    fora = fora.concat(B.plano({ party: sel }));
    // 20/09: o CAMPO DE PVP tambem e um lugar para onde se desce — o cenario
    // dele (os muros e as barreiras do dono) nao esta no grupo `base`, entao
    // vem aqui, em segundo plano, enquanto o jogador anda pela praca. Quem
    // entrar antes de chegar ve as pecas provisorias e o hub3d pede as que
    // faltam (Bundle.pede).
    try { doTema(((D().campoPvp) || {}).tema, fora); } catch (eC) {}
    Object.keys(porChave).forEach(function (k) { if (/^coroa_pvp_n/.test(k)) fora.push(k); });
    var visto = {}, saida = [];
    fora.forEach(function (k) { if (k && !visto[k] && porChave[k]) { visto[k] = true; saida.push(k); } });
    return saida;
  };
  /* ECONOMIA DE DADOS: o navegador diz que o plano e curto (Save-Data) ou a
   * conexao e 2G. A pre-busca nao liga — sao uns 40 MB que o jogador talvez
   * nunca use; cada calabouco desce so na hora de descer (o gancho). O
   * preco: os cantinhos dos portais ficam sem cenario (hub3d so planta com
   * todas as pecas). Reavaliada a cada chamada: a conexao pode melhorar. */
  function economiaDeDados() {
    var c = (typeof navigator !== 'undefined') &&
            (navigator.connection || navigator.mozConnection || navigator.webkitConnection);
    return !!(c && (c.saveData || /(^|-)2g$/.test(c.effectiveType || '')));
  }
  B.economiaDeDados = economiaDeDados;
  B.preBusca = function () {
    if (!B.sobDemanda()) return;
    if (medida.pre.estado !== 'parada' && medida.pre.estado !== 'economia') return;
    if (economiaDeDados()) { medida.pre.estado = 'economia'; return; }
    // dois segundos de folga: a praca acabou de montar e desenha os primeiros
    // quadros sem ninguem disputando a rede nem o processador
    medida.pre.estado = 'marcada';
    setTimeout(function () {
      medida.pre.estado = 'rodando';
      medida.pre.t0 = Math.round(agora());
      preBuscaChaves(B.ordemDaPreBusca(), vitrine());
    }, 2000);
  };

  /* O corpo PROPRIO de uma aparencia de fusao ('fus:a+b'), ou null. O
   * avatar e os fantasmas andam com a aparencia no campo `classe`. */
  B.corpoDe = function (ap) {
    var m = /^fus:([^+:]+)\+([^+:]+)$/.exec(String(ap || ''));
    var m2 = M2();
    return (m && m2 && m2.modeloDaFusao) ? m2.modeloDaFusao(m[1], m[2]) : null;
  };
  /* Baixa e ABRE ja (prioridade alta, sem tela) o que falta das chaves —
   * para quem mostra modelo fora de uma descida: o corpo do avatar, o do
   * fantasma, o guarda-roupa, o perfil. Devolve quantas foi buscar; com 0
   * (tudo na mao, ou em casa) `cb` nem e chamado — nada chegou, nada a
   * repintar. cb(falhas[] de chaves, pedidas). O que falhar volta para a
   * fila baixa; quando chegar, o aoChegar do Models3D2 avisa. */
  B.pede = function (chaves, cb) {
    if (!B.sobDemanda()) return 0;
    var visto = {}, ks = [];
    (chaves || []).forEach(function (k) {
      if (k && !visto[k] && porChave[k] && !pronta(k)) { visto[k] = true; ks.push(k); }
    });
    if (!ks.length) return 0;
    garante(ks, null, function (falhas) {
      var fk = falhas.map(function (it) { return it.chave; });
      if (fk.length) preBuscaChaves(fk);
      if (cb) {
        try { cb(fk, ks.length); }
        catch (e) { if (typeof console !== 'undefined' && console.error) console.error('[Bundle] pede:', e); }
      }
    });
    return ks.length;
  };
  /* Pre-busca avulsa: as chaves vao para a fila baixa (um arquivo por vez,
   * so com o gancho parado) e abrem na folga. */
  B.adianta = function (chaves) {
    if (B.sobDemanda()) preBuscaChaves(chaves || []);
  };

  /* Tudo o que falta, com prioridade, e decodificado — as provas do pacote
   * (tests/pacote_servido.py, carga_prova.py) cobram o bundle INTEIRO. */
  B.tudo = function (cb) {
    if (!B.servido || !man) { if (cb) cb([]); return; }
    var itens = man.itens.filter(function (it) { return estado[it.alvo + ':' + it.chave] !== 'chegou'; });
    baixaLista(itens, null, function (falhas) {
      var m2 = M2();
      if (m2 && m2.novos) m2.novos(function () { if (cb) cb(falhas); });
      else if (cb) cb(falhas);
    });
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
      s.src = endereco(base, lista[i]);
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
      l.href = endereco(base, lista[i]);
      document.head.appendChild(l);
    }
  };
})();
