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
          if (!falhas.length) { pronto(null); return; }
          // as novas tentativas ja foram (ESPERAS): avisa e deixa o jogador escolher
          telaFalha('Não consegui baixar ' + falhas.length + (falhas.length > 1 ? ' modelos' : ' modelo') +
                    '. Confira a conexão.', function () { vai(falhas); }, function () {
            pronto(new Error(falhas.length + ' modelo(s) não desceram'));
          });
        });
      })(itens);
    }, function (e) { pronto(e); });
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
  //     ABERTOS descem em segundo plano, um arquivo por vez, e cada modelo e
  //     decodificado quando o navegador folga — nunca no meio da batalha.
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
  var fase = 'boot';           // em qual fase cada byte desceu: boot | descida | pre
  medida.porFase = { boot: { itens: 0, bytes: 0 }, descida: { itens: 0, bytes: 0 }, pre: { itens: 0, bytes: 0 } };
  medida.grupos = {};          // grupo -> { itens, bytes } do manifesto
  medida.pre = { estado: 'parada', feitos: 0, total: 0 };
  medida.ganchos = [];         // cada vez que a descida esperou: { onde, faltavam, ms, falhou }

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
  function inicia(it, alta) {
    var id = it.alvo + ':' + it.chave, tent = 0, minhaFase = alta ? fase : 'pre';
    if (alta) vivosAlta++; else vivosBaixa++;
    (function tenta() {
      pega(enderecoModelo(it), 'arraybuffer', function (buf) {
        guarda(it.alvo, it.chave, new Uint8Array(buf));
        medida.bytes += buf.byteLength;
        medida.itens++;
        var pf = medida.porFase[minhaFase] || medida.porFase.descida;
        pf.itens++; pf.bytes += buf.byteLength;
        fim(null);
      }, function (e) {
        if (tent < ESPERAS.length) { setTimeout(tenta, ESPERAS[tent++]); return; }
        medida.erros.push(String(e.message || e));
        fim(e);
      });
    })();
    function fim(err) {
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
             decodAgendada: decodAgendada, estados: n, garantidas: Object.keys(garantidas).length };
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
    return (d.spells && d.spells[id]) || (d.monsterSpells && d.monsterSpells[id]) || null;
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
    var d = D(), md = (d.monsters && d.monsters[id]) || (d.fusionSummons && d.fusionSummons[id]) || null;
    var inv = [];
    ((md && md.spells) || []).forEach(function (sid) { invocacoes(feitico(sid), inv, 0); });
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
    var dg = pedido.dungeonId ? calabouco(pedido.dungeonId) : null;
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
      if (m2 && m2.novos) m2.novos(function () { fecha(); });
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
  /* Chamado por Game.startRun / nextRoom / startDuel ANTES de a descida
   * mudar de tela. false: tudo na mao (ou em casa) — siga na hora. true: o
   * gancho segurou a descida e chama `deNovo` quando os modelos chegarem (ou
   * quando o jogador escolher seguir assim mesmo). */
  B.segura = function (pedido, deNovo) {
    if (!B.sobDemanda()) return false;
    if (ganchoAtivo) return true;                   // um toque a mais no botao: ja estou nisso
    var chaves = B.plano(pedido);
    var faltam = chaves.filter(function (k) { return !pronta(k); });
    vizinhoDoPoco(pedido);
    if (!faltam.length) return false;
    ganchoAtivo = true;
    var t0 = agora(), nome = nomeDoPedido(pedido);
    var registro = { onde: nome, faltavam: faltam.length, ms: 0, falhou: 0 };
    medida.ganchos.push(registro);
    telaAbre('baixando ' + nome + '…');
    function roda() {
      fase = 'descida';
      garante(faltam, function (f, t) { telaAnda('baixando ' + nome + '…', f, t); }, function (falhas) {
        fase = 'boot';
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
          // seguir assim mesmo: o que faltou vai de substituto, sem novo gancho
          for (var i = 0; i < faltam.length; i++) garantidas[faltam[i]] = true;
          registro.ms = Math.round(agora() - t0);
          ganchoAtivo = false;
          telaFecha();
          segue();
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
      fase = 'boot';
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
    var prox = B.plano({ dungeonId: 'poco', sala: (pedido.sala || 0) + 1, party: [] });
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
  function folga(fn) {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(fn, { timeout: 2500 });
    else setTimeout(fn, 250);
  }
  function decodificaDepois(chave) {
    paraDecodificar.push(chave);
    agendaDecodificacao();
  }
  function agendaDecodificacao() {
    if (decodAgendada || !paraDecodificar.length) return;
    decodAgendada = true;
    folga(function () {
      decodAgendada = false;
      var m2 = M2();
      // no meio da batalha, nem um quadro a menos: espera ela acabar
      if (!m2 || !m2.novos || emBatalha() || ganchoAtivo || decodPausada) { setTimeout(agendaDecodificacao, 1500); return; }
      var ch = paraDecodificar.shift();
      m2.novos(function () { agendaDecodificacao(); }, [ch]);
    });
  }
  function preBuscaChaves(chaves) {
    chaves.forEach(function (k) {
      var it = porChave[k];
      if (!it || estado['MODELS:' + k] === 'chegou' || pronta(k)) return;
      medida.pre.total++;
      baixaUm(it, false, function (err) {
        medida.pre.feitos++;
        if (!err) decodificaDepois(k);
      });
    });
  }
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
    Object.keys(porChave).forEach(function (k) { if (/^coroa_pvp_n/.test(k)) fora.push(k); });
    var visto = {}, saida = [];
    fora.forEach(function (k) { if (k && !visto[k] && porChave[k]) { visto[k] = true; saida.push(k); } });
    return saida;
  };
  B.preBusca = function () {
    if (!B.sobDemanda() || medida.pre.estado !== 'parada') return;
    // dois segundos de folga: a praca acabou de montar e desenha os primeiros
    // quadros sem ninguem disputando a rede nem o processador
    medida.pre.estado = 'marcada';
    setTimeout(function () {
      medida.pre.estado = 'rodando';
      medida.pre.t0 = Math.round(agora());
      preBuscaChaves(B.ordemDaPreBusca());
    }, 2000);
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
