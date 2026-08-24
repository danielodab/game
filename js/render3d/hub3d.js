// O Acampamento — o mapa aberto onde a vida online acontece (dono: hub).
var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

/* O QUE ISTO É
 * ============
 * O primeiro pedaço do jogo que não é uma tela nem um tabuleiro: um LUGAR.
 * Chão sem grade, portais para os seis Fechos, o banco, a arena. É aqui que os
 * jogadores um dia vão se ver, conversar e trocar — por enquanto anda nele o
 * herói do jogador, sozinho, mas o mapa já nasce com os pontos onde cada coisa
 * vai morar.
 *
 * POR QUE UM RENDERIZADOR PRÓPRIO, E NÃO O DA BATALHA: o renderizador de
 * batalha é GRADE até o osso — células, roomKey, enquadramento por casas. O
 * acampamento é o oposto (movimento livre, sem célula), e esticar o
 * renderizador de batalha para os dois mundos sujaria os dois. Este aqui é
 * pequeno de propósito: uma cena, um chão, meia dúzia de objetos, um herói.
 *
 * ANDAR É CLICAR: clique no chão e o herói vai. Clique num LUGAR (portal,
 * banco, arena) e o herói vai ATÉ ele e a ação acontece na chegada — não no
 * clique. A diferença é o que faz isto parecer um mundo e não um menu: o corpo
 * atravessa o espaço, e a distância existe.
 */
(function () {
  'use strict';

  var Hub = {};
  JOGO.Hub = Hub;

  var THREE = null;
  var renderer = null, scene = null, camera = null;
  var container = null, canvas = null;
  var rodando = false, ultimoT = 0;

  var heroi = null;                 // { node, mixer, alvo, andando, plaquinha, plaquinhaTitulo }
  var nomeJogador = null;           // o nome batizado no DB, para a plaquinha
  var tituloJogador = null;         // o título de conquista, pendurado abaixo do nome
  var lugares = [];                 // { id, tipo, pos, raio, node, rotulo }
  var fantasmas = {};               // id da Rede -> corpo igual ao do heroi
  var aoChegar = null;              // callback pendente da caminhada atual
  var raycaster = null, chao = null;
  var relogio = 0;

  /* ANDAR ou CORRER decide-se pela DISTÂNCIA: até 4 m é um passo (chegar ao
   * portal do lado), acima disso o corpo corre — com o clipe `run` que toda
   * classe tem. Um mundo aberto onde se atravessa o mapa a passo de tabuleiro
   * parece um menu com chão. */
  var VEL_ANDA = 3.2, VEL_CORRE = 6.0, DIST_CORRIDA = 4.0;
  var RAIO_MAPA = 26;

  /* A câmera 3D: a MESMA gramática da batalha — arrastar orbita e inclina,
   * roda dá zoom, toque curto age. Orbita em volta DO HERÓI: no mapa aberto o
   * corpo é a âncora, e deslocar o pivô para longe do próprio personagem é se
   * perder num minimapa. */
  var cam = { ang: 0.0, tilt: 0.95, dist: 16,
              minDist: 7, maxDist: 30, minTilt: 0.35, maxTilt: 1.25 };
  var TAP_PX = 6;                   // o mesmo limiar clique/arrasto da batalha

  // ---------------------------------------------------------------- utilidades
  /* O FILME DO PORTAL (CGHEVEN, folha 4x4 de 16 quadros): UMA textura para os
   * seis portais — todos giram no mesmo quadro, e o tique avança o offset uma
   * vez só. A tinta do Fecho continua no material; a folha dá o redemoinho. */
  var texPortal = null, TEX_PORTAL_N = 4;
  function texturaPortal() {
    if (texPortal !== null) return texPortal || null;
    var A = (typeof JOGO !== 'undefined') ? JOGO.FX_ANIM : null;
    if (!A || !A['portal:unico'] || !THREE) { texPortal = false; return null; }
    var img = new Image();
    var tex = new THREE.Texture(img);
    img.onload = function () { tex.needsUpdate = true; };
    img.src = 'data:image/jpeg;base64,' + A['portal:unico'];
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    if (THREE.sRGBEncoding != null) tex.encoding = THREE.sRGBEncoding;
    tex.repeat.set(1 / TEX_PORTAL_N, 1 / TEX_PORTAL_N);
    texPortal = tex;
    return tex;
  }

  /* AS CHAMAS DA BRASA: uma textura por paleta de chama, compartilhada por
   * todo corpo que carrega fogo — o tique avança o offset de cada paleta uma
   * vez só, e todas as chamas da praça ardem no mesmo quadro. */
  var texChamas = {}, TEX_CHAMA_N = 4;
  var texBrilhos = {};
  var COR_BRILHO = { fire: '#ff9a4a', blueish_flame: '#5fe6cd', magic: '#c9a6ff' };
  /* O HALO da chama: um gradiente radial desenhado em canvas, tingido pela
   * paleta — o fogo passa a ILUMINAR o entorno, nao so a existir. */
  function texturaBrilho(paleta) {
    if (texBrilhos[paleta] !== undefined) return texBrilhos[paleta] || null;
    if (!THREE) { texBrilhos[paleta] = false; return null; }
    var cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    var g = cv.getContext('2d');
    var gr = g.createRadialGradient(64, 64, 4, 64, 64, 62);
    gr.addColorStop(0, COR_BRILHO[paleta] || '#ffb45f');
    gr.addColorStop(0.55, 'rgba(120,80,40,0.25)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
    var tex = new THREE.Texture(cv);
    tex.needsUpdate = true;
    if (THREE.sRGBEncoding != null) tex.encoding = THREE.sRGBEncoding;
    texBrilhos[paleta] = tex;
    return tex;
  }
  function poeQuadro(tex, q) {
    tex.offset.set((q % TEX_CHAMA_N) / TEX_CHAMA_N,
      (TEX_CHAMA_N - 1 - Math.floor(q / TEX_CHAMA_N)) / TEX_CHAMA_N);
  }
  function texturaChama(paleta) {
    if (texChamas[paleta] !== undefined) return texChamas[paleta] || null;
    var A = (typeof JOGO !== 'undefined') ? JOGO.FX_ANIM : null;
    var chave = 'chama:' + paleta;
    if (!A || !A[chave] || !THREE) { texChamas[paleta] = false; return null; }
    var img = new Image();
    var tex = new THREE.Texture(img);
    img.onload = function () { tex.needsUpdate = true; };
    img.src = 'data:image/jpeg;base64,' + A[chave];
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    if (THREE.sRGBEncoding != null) tex.encoding = THREE.sRGBEncoding;
    tex.repeat.set(1 / TEX_CHAMA_N, 1 / TEX_CHAMA_N);
    texChamas[paleta] = tex;
    return tex;
  }

  function M2() { return JOGO.Models3D2 || null; }
  function K() { return JOGO.Models3D || null; }

  function corDoTema(tema) {
    // a cor de cada Fecho no portal: aproveita as cores de elemento do jogo
    var mapa = { garden: '#6fae53', cistern: '#4a7d96', forge: '#d4553f',
                 scaffold: '#c8b6ff', mine: '#8a6a4f', heart: '#c94f6d' };
    return mapa[tema] || '#d8dee4';
  }

  /* Rótulo flutuante: um sprite com texto desenhado em canvas. É o mesmo truque
   * dos números de dano — barato e legível de qualquer ângulo. */
  function rotulo(texto, cor, escala) {
    var cv = document.createElement('canvas');
    cv.width = 512; cv.height = 128;
    var g = cv.getContext('2d');
    g.font = '600 44px Georgia, serif';
    g.textAlign = 'center';
    g.shadowColor = 'rgba(0,0,0,.85)'; g.shadowBlur = 10;
    g.fillStyle = cor || '#f0ead8';
    g.fillText(texto, 256, 78);
    var tex = new THREE.Texture(cv);
    tex.needsUpdate = true;
    if (THREE.sRGBEncoding != null) tex.encoding = THREE.sRGBEncoding;
    var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    var e = escala || 1;
    sp.scale.set(6.4 * e, 1.6 * e, 1);
    return sp;
  }

  // ------------------------------------------------------------------- a cena
  function montaCena() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0d1512);
    scene.fog = new THREE.Fog(0x0d1512, RAIO_MAPA * 0.9, RAIO_MAPA * 2.1);

    scene.add(new THREE.HemisphereLight(0xcfe8d8, 0x1a2420, 0.95));
    var sol = new THREE.DirectionalLight(0xffe9c4, 1.05);
    sol.position.set(12, 22, 8);
    scene.add(sol);

    // O CHÃO SEM GRADE — o pedido literal. Um disco de terra batida; o
    // acabamento vem da luz e da névoa, não de textura de célula.
    chao = new THREE.Mesh(
      new THREE.CircleGeometry(RAIO_MAPA, 56),
      new THREE.MeshStandardMaterial({ color: 0x2c3a2c, roughness: 1 })
    );
    chao.rotation.x = -Math.PI / 2;
    scene.add(chao);
    // uma borda mais escura, para o mundo não terminar num fio duro
    var borda = new THREE.Mesh(
      new THREE.RingGeometry(RAIO_MAPA * 0.94, RAIO_MAPA, 56),
      new THREE.MeshBasicMaterial({ color: 0x121a14 })
    );
    borda.rotation.x = -Math.PI / 2;
    borda.position.y = 0.01;
    scene.add(borda);

    camera = new THREE.PerspectiveCamera(46, 1, 0.1, 220);

    montaPortais();
    montaBanco();
    montaMercado();
    montaArena();
    montaEnfeites();
  }

  /* OS SEIS PORTAIS, num arco ao norte — "lado a lado", como pedido. Cada um é
   * um anel de pedra com o miolo aceso na cor do Fecho e o nome flutuando em
   * cima. A ordem é a ordem de profundidade dos calabouços: ler o arco da
   * esquerda para a direita é ler a progressão do jogo. */
  function montaPortais() {
    var ds = (JOGO.DATA && JOGO.DATA.dungeons) || [];
    var lista = Array.isArray(ds) ? ds : Object.keys(ds).map(function (k) { return ds[k]; });
    var n = lista.length || 6;
    for (var i = 0; i < n; i++) {
      var dg = lista[i];
      if (!dg || !dg.id) continue;
      // arco de -55° a +55°, ao norte (z negativo), a 3/4 do raio
      var ang = (-0.96 + (1.92 * i / Math.max(1, n - 1)));
      var px = Math.sin(ang) * RAIO_MAPA * 0.74;
      var pz = -Math.cos(ang) * RAIO_MAPA * 0.74;
      var cor = new THREE.Color(corDoTema(dg.theme));

      var g = new THREE.Group();
      var aro = new THREE.Mesh(
        new THREE.TorusGeometry(1.7, 0.26, 12, 40),
        new THREE.MeshStandardMaterial({ color: 0x5a5348, roughness: 0.9 })
      );
      aro.position.y = 2.1;
      g.add(aro);
      var tp = texturaPortal();
      var miolo = new THREE.Mesh(
        new THREE.CircleGeometry(1.5, 32),
        // com o filme: aditivo tingido pela cor do Fecho — cada portal
        // redemoinha na própria cor; sem ele, o disco chapado de sempre
        tp ? new THREE.MeshBasicMaterial({ map: tp, color: cor, transparent: true,
                                           opacity: 0.85, blending: THREE.AdditiveBlending,
                                           side: THREE.DoubleSide, depthWrite: false })
           : new THREE.MeshBasicMaterial({ color: cor, transparent: true, opacity: 0.42,
                                           side: THREE.DoubleSide, depthWrite: false })
      );
      miolo.position.y = 2.1;
      g.add(miolo);
      var base = new THREE.Mesh(
        new THREE.CylinderGeometry(1.9, 2.2, 0.5, 24),
        new THREE.MeshStandardMaterial({ color: 0x4a443c, roughness: 1 })
      );
      base.position.y = 0.25;
      g.add(base);
      var r = rotulo(dg.name || dg.id, '#f0ead8');
      r.position.y = 4.4;
      g.add(r);

      g.position.set(px, 0, pz);
      g.lookAt(0, 0, 0);              // o portal encara o centro do acampamento
      scene.add(g);
      lugares.push({ id: dg.id, tipo: 'portal', nome: dg.name || dg.id,
                     pos: new THREE.Vector3(px, 0, pz), raio: 3.4, node: g, miolo: miolo });
    }
  }

  /* O MERCADINHO: a barraca fecha o triângulo do sul — Banco a sudeste,
   * Arena a sudoeste, Mercadinho no MEIO-SUL, atrás de onde o herói nasce.
   * (A primeira posição escolhida espelhava o banco... em cima da ARENA, e
   * os dois letreiros viraram um borrão — a foto do Daniel pegou.) */
  function montaMercado() {
    var px = 0, pz = RAIO_MAPA * 0.62;
    var g = new THREE.Group();
    var kit = K();
    if (kit && kit.buildProp) {
      try {
        // só chaves que EXISTEM no kit do jardim: crates (plural!), barrel,
        // bottle — 'crate' e 'table' não existem lá e sairiam nulos calados
        var balcao = kit.buildProp('garden', 'crates', 9); if (balcao) g.add(balcao);
        var pilha2 = kit.buildProp('garden', 'crates', 4);
        if (pilha2) { pilha2.position.set(-1.25, 0, 0.55); g.add(pilha2); }
        var barril = kit.buildProp('garden', 'barrel', 6);
        if (barril) { barril.position.set(1.3, 0, 0.5); g.add(barril); }
        var garrafa = kit.buildProp('garden', 'bottle', 7);
        if (garrafa) { garrafa.position.set(0.15, 0.7, 0.1); g.add(garrafa); }
      } catch (e) {}
    }
    var r = rotulo('Mercadinho', '#9bd06a');
    r.position.y = 3.2;
    g.add(r);
    g.position.set(px, 0, pz);
    scene.add(g);
    lugares.push({ id: 'mercado', tipo: 'mercado', nome: 'Mercadinho',
                   pos: new THREE.Vector3(px, 0, pz), raio: 3.0, node: g });
  }

  /* O BANCO: mesa, baú e moedas do próprio kit — as peças já existiam. */
  function montaBanco() {
    var px = RAIO_MAPA * 0.55, pz = RAIO_MAPA * 0.30;
    var g = new THREE.Group();
    var kit = K();
    if (kit && kit.buildProp) {
      try {
        var mesa = kit.buildProp('garden', 'table', 3); if (mesa) g.add(mesa);
        var bau = kit.buildProp('garden', 'chest', 7);
        if (bau) { bau.position.set(0.4, 0.95, 0); g.add(bau); }
        var moedas = kit.buildProp('garden', 'coins', 11);
        if (moedas) { moedas.position.set(-0.55, 0.95, 0.2); g.add(moedas); }
        var tocha = kit.buildProp('garden', 'torch', 5);
        if (tocha) { tocha.position.set(1.4, 0, 0.8); g.add(tocha); }
      } catch (e) {}
    }
    var r = rotulo('Banco', '#e8c25a');
    r.position.y = 3.2;
    g.add(r);
    g.position.set(px, 0, pz);
    scene.add(g);
    lugares.push({ id: 'banco', tipo: 'banco', nome: 'Banco',
                   pos: new THREE.Vector3(px, 0, pz), raio: 3.0, node: g });
  }

  /* A ARENA: o círculo de duelo, ainda selado. Existe DESDE JÁ no mapa porque o
   * lugar precisa nascer antes do sistema — quem entra no acampamento tem de
   * ver onde o PvP vai acontecer. O painel dela diz o que está vindo. */
  function montaArena() {
    var px = -RAIO_MAPA * 0.55, pz = RAIO_MAPA * 0.30;
    var g = new THREE.Group();
    var anel = new THREE.Mesh(
      new THREE.RingGeometry(2.4, 3.1, 40),
      new THREE.MeshBasicMaterial({ color: 0xc94f6d, transparent: true, opacity: 0.34,
                                    side: THREE.DoubleSide, depthWrite: false })
    );
    anel.rotation.x = -Math.PI / 2;
    anel.position.y = 0.03;
    g.add(anel);
    var kit = K();
    if (kit && kit.buildProp) {
      try {
        var b1 = kit.buildProp('garden', 'barrier', 2); if (b1) { b1.position.set(-2.6, 0, -1.4); g.add(b1); }
        var b2 = kit.buildProp('garden', 'barrier', 9); if (b2) { b2.position.set(2.6, 0, -1.4); g.add(b2); }
      } catch (e) {}
    }
    var r = rotulo('Arena', '#e08098');
    r.position.y = 3.2;
    g.add(r);
    g.position.set(px, 0, pz);
    scene.add(g);
    lugares.push({ id: 'arena', tipo: 'arena', nome: 'Arena',
                   pos: new THREE.Vector3(px, 0, pz), raio: 3.4, node: g });
  }

  /* Vida em volta: meia dúzia das peças de cenário do usuário, espalhadas com
   * semente fixa — o acampamento nasce igual toda vez. */
  function montaEnfeites() {
    var m2 = M2();
    var cat = JOGO.CENARIO && JOGO.CENARIO.garden;
    if (!m2 || !cat) return;
    var pecas = (cat.sotaque || []).concat(cat.borda || []);
    if (!pecas.length) return;
    for (var i = 0; i < 8; i++) {
      var chave = pecas[(i * 5 + 3) % pecas.length];
      var cena = null;
      try { cena = m2.rawScene(chave); } catch (e) {}
      if (!cena) continue;
      var no = cena.clone(true);
      // porte de enfeite; assenta pelo pé, mesma receita do tabuleiro
      no.updateMatrixWorld(true);
      var cx = new THREE.Box3().setFromObject(no);
      var alt = cx.max.y - cx.min.y;
      if (alt > 0.01) no.scale.setScalar(Math.min(2.2, 1.4 / alt) * (1 + (i % 3) * 0.35));
      no.updateMatrixWorld(true);
      cx = new THREE.Box3().setFromObject(no);
      no.position.y = -cx.min.y;
      var ang = 0.55 + i * 0.72;
      no.position.x = Math.sin(ang) * RAIO_MAPA * (0.82 + (i % 2) * 0.08);
      no.position.z = Math.cos(ang) * RAIO_MAPA * (0.82 + (i % 2) * 0.08);
      scene.add(no);
    }
  }

  // ------------------------------------------------------------------ o herói
  function montaHeroi(classId) {
    var m2 = M2();
    if (!m2) return;
    var node = null;
    try { node = m2.unit(classId || 'sumo', { classId: classId || 'sumo' }); } catch (e) {}
    if (!node) return;
    node.position.set(0, 0, RAIO_MAPA * 0.35);
    scene.add(node);
    heroi = { node: node, alvo: null, andando: false };
    try { node.userData.play('idle', { fade: 0 }); } catch (e) {}
    if (nomeJogador) pendura(nomeJogador, tituloJogador, brasaDoHeroi);
  }

  /* O NOME ACIMA DA CABEÇA — a primeira marca de jogo online que o corpo
   * carrega ("como o jogo será online, o nome do usuario deve aparecer acima
   * da cabeça"). A plaquinha é FILHA do nó do herói: anda, corre e troca de
   * corpo junto, sem uma linha no tique — e sprite sempre encara a câmera.
   * Os fantasmas da rede vão pendurar a deles por este mesmo caminho. */
  /* Pendura nome (e título) em QUALQUER corpo — herói ou fantasma. */
  function penduraEm(corpo, nome, titulo, brasaTier) {
    if (!corpo || !THREE) return;
    ['plaquinha', 'plaquinhaTitulo', 'chamaBrasa'].forEach(function (campo) {
      if (!corpo[campo]) return;
      corpo.node.remove(corpo[campo]);
      try {
        corpo[campo].material.map.dispose();
        corpo[campo].material.dispose();
      } catch (e) {}
      corpo[campo] = null;
    });
    ['chamaGlow', 'chamaInner'].forEach(function (campo) {
      if (!corpo[campo]) return;
      corpo.node.remove(corpo[campo]);
      try { corpo[campo].material.dispose(); } catch (e) {}
      corpo[campo] = null;
    });
    if (corpo.chamaCoroa) {
      corpo.chamaCoroa.forEach(function (m2) {
        corpo.node.remove(m2);
        try { m2.material.dispose(); } catch (e) {}
      });
      corpo.chamaCoroa = null;
    }
    if (corpo.chamaTexs) {
      corpo.chamaTexs.forEach(function (t2) { try { t2.dispose(); } catch (e) {} });
      corpo.chamaTexs = null;
    }
    corpo.chamaFase = null;
    if (!nome) return;
    var alto = (corpo.node.userData.height || 2.1);
    var sp = rotulo(nome, '#f0ead8', 0.42);
    sp.position.y = alto + (titulo ? 0.66 : 0.5);
    corpo.node.add(sp);
    corpo.plaquinha = sp;
    // o TÍTULO de conquista: linha menor e dourada, abaixo do nome — é a
    // recompensa social do quadro de missões, visível de longe
    if (titulo) {
      var st2 = rotulo(titulo, '#e8c25a', 0.30);
      st2.position.y = alto + 0.38;
      corpo.node.add(st2);
      corpo.plaquinhaTitulo = st2;
    }
    // A CHAMA DA BRASA — o lugar das asas de nação, do jeito do SOTERRA:
    // o fogo da arena arde ACIMA do nome, na paleta e no tamanho do tier.
    // Sprite não serve (não anima folha); é um bilhete aditivo que o tique
    // vira para a câmera junto com o offset da paleta.
    if (brasaTier && brasaTier.tam) {
      var texBase = texturaChama(brasaTier.paleta || 'fire');
      if (texBase) {
        var baseY = alto + (titulo ? 0.66 : 0.5) + 0.42;
        var tamC = brasaTier.tam;
        // FASE PROPRIA: cada fogo da praca arde no seu tempo — sincronizado
        // era luz de arvore de natal, nao fogo
        corpo.chamaFase = Math.random() * 13;
        corpo.chamaTexs = [];
        function novaChama(escala, opac) {
          var t2 = texBase.clone();
          t2.needsUpdate = true;
          corpo.chamaTexs.push(t2);
          var m2 = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
            new THREE.MeshBasicMaterial({
              map: t2, transparent: true, depthWrite: false,
              blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
              opacity: opac
            }));
          m2.scale.set(escala, escala, 1);
          corpo.node.add(m2);
          return m2;
        }

        // o HALO atras de tudo, pulsando devagar no tique
        var texG = texturaBrilho(brasaTier.paleta || 'fire');
        if (texG) {
          var glow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
            new THREE.MeshBasicMaterial({
              map: texG, transparent: true, depthWrite: false,
              blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
              opacity: 0.3
            }));
          glow.scale.set(tamC * 2.1, tamC * 2.1, 1);
          glow.position.y = baseY + tamC * 0.35;
          corpo.node.add(glow);
          corpo.chamaGlow = glow;
        }

        var chamaG = novaChama(tamC, 0.9);
        chamaG.position.y = baseY + tamC * 0.35;
        corpo.chamaBrasa = chamaG;
        corpo.chamaTam = tamC;
        corpo.chamaBaseY = baseY;

        // LABAREDA e COROA ganham um MIOLO interno menor e mais rapido —
        // duas camadas defasadas leem como profundidade, nao como adesivo
        if (brasaTier.id === 'labareda' || brasaTier.coroa) {
          var inner = novaChama(tamC * 0.55, 0.75);
          inner.position.y = baseY + tamC * 0.28;
          corpo.chamaInner = inner;
        }

        // A COROA: as duas pontas ORBITAM a cabeca devagar — uma coroa
        // girando, e o degrau que so o 1o do placar carrega
        if (brasaTier.coroa) {
          corpo.chamaCoroa = [];
          [0, 1].forEach(function (i2) {
            var m3 = novaChama(tamC * 0.5, 0.8);
            m3.position.set(0, baseY + tamC * 0.16, 0);
            m3.userData.orbita = i2 * Math.PI;   // pontas opostas
            corpo.chamaCoroa.push(m3);
          });
        }
      }
    }
  }
  function pendura(nome, titulo, brasaTier) { penduraEm(heroi, nome, titulo, brasaTier); }

  // -------------------------------------------------------------- a caminhada
  /* UM passo de caminhada para QUALQUER corpo (herói ou fantasma): mesmo
   * limiar de chegada, mesma velocidade, mesma virada. Devolve true no
   * quadro em que o corpo chega. */
  function andaCorpo(corpo, dt) {
    if (!corpo.alvo) return false;
    var p = corpo.node.position;
    var dx = corpo.alvo.x - p.x, dz = corpo.alvo.z - p.z;
    var dist = Math.hypot(dx, dz);
    if (dist < 0.12) {
      corpo.alvo = null;
      corpo.andando = false;
      corpo.clipe = null;
      try { corpo.node.userData.play('idle', { fade: 0.18 }); } catch (e) {}
      return true;
    }
    var passo = Math.min(dist, (corpo.vel || VEL_ANDA) * dt);
    p.x += dx / dist * passo;
    p.z += dz / dist * passo;
    corpo.node.rotation.y = Math.atan2(dx, dz);
    return false;
  }

  /* Manda um corpo andar: decide andar/correr pela distância e troca o
   * clipe — a MESMA regra para herói e fantasma. */
  function mandaAndar(corpo, x, z) {
    corpo.alvo = new THREE.Vector3(x, 0, z);
    var d = Math.hypot(x - corpo.node.position.x, z - corpo.node.position.z);
    var corre = d > DIST_CORRIDA;
    corpo.vel = corre ? VEL_CORRE : VEL_ANDA;
    var clipe = corre ? 'run' : 'walk';
    if (!corpo.andando || corpo.clipe !== clipe) {
      corpo.andando = true;
      corpo.clipe = clipe;
      try { corpo.node.userData.play(clipe, { fade: 0.15 }); } catch (e) {}
    }
  }

  function andarAte(destino, chegada) {
    if (!heroi) return;
    aoChegar = chegada || null;
    mandaAndar(heroi, destino.x, destino.z);
    // a Rede fica sabendo: os outros mandam o fantasma DESTE corpo andar
    if (Hub.aoAndar) { try { Hub.aoAndar(destino.x, destino.z); } catch (e) {} }
  }

  function tique(dt) {
    relogio += dt;
    // o FILME dos portais: um passo de offset por quadro serve os seis miolos
    // (mesma conta de linha/coluna do updateFilmes do fx3d — flipY do three)
    if (texPortal) {
      var qp = Math.floor(relogio * 13) % (TEX_PORTAL_N * TEX_PORTAL_N);
      var cc = qp % TEX_PORTAL_N, rr = Math.floor(qp / TEX_PORTAL_N);
      texPortal.offset.set(cc / TEX_PORTAL_N, (TEX_PORTAL_N - 1 - rr) / TEX_PORTAL_N);
    }
    // O FOGO VIVO: cada corpo com fase propria — quadro, tremulacao, halo
    // pulsando, miolo defasado e a orbita da Coroa, tudo num passo so
    if (camera) {
      var TOTAL_Q = TEX_CHAMA_N * TEX_CHAMA_N;
      var animaFogo = function (corpoC) {
        if (!corpoC || !corpoC.chamaBrasa) return;
        var fase = corpoC.chamaFase || 0;
        var tamF = corpoC.chamaTam || 1;
        var giro = Math.atan2(camera.position.x - corpoC.node.position.x,
                              camera.position.z - corpoC.node.position.z) -
                   corpoC.node.rotation.y;

        // quadro proprio (a fase desloca) + tremulacao de escala (~7%)
        if (corpoC.chamaTexs) {
          for (var ti = 0; ti < corpoC.chamaTexs.length; ti++) {
            var ritmo = ti === 0 ? 14 : 19;      // o miolo e as pontas ardem mais rapido
            poeQuadro(corpoC.chamaTexs[ti],
              Math.floor(relogio * ritmo + fase * 7 + ti * 5) % TOTAL_Q);
          }
        }
        var treme = 1 + 0.07 * Math.sin(relogio * 9 + fase);
        corpoC.chamaBrasa.scale.set(tamF * treme, tamF * treme, 1);
        corpoC.chamaBrasa.rotation.y = giro;

        if (corpoC.chamaGlow) {
          corpoC.chamaGlow.material.opacity = 0.26 + 0.09 * Math.sin(relogio * 2.3 + fase);
          corpoC.chamaGlow.rotation.y = giro;
        }
        if (corpoC.chamaInner) {
          var t2 = tamF * 0.55 * (1 + 0.10 * Math.sin(relogio * 13 + fase + 2));
          corpoC.chamaInner.scale.set(t2, t2, 1);
          corpoC.chamaInner.rotation.y = giro;
        }
        if (corpoC.chamaCoroa) {
          var raio = tamF * 0.48;
          corpoC.chamaCoroa.forEach(function (m3) {
            var ang = relogio * 1.1 + (m3.userData.orbita || 0) + fase;
            m3.position.x = Math.cos(ang) * raio;
            m3.position.z = Math.sin(ang) * raio;
            m3.rotation.y = giro;
          });
        }
      };
      animaFogo(heroi);
      for (var fk2 in fantasmas) {
        if (fantasmas.hasOwnProperty(fk2)) animaFogo(fantasmas[fk2]);
      }
    }
    for (var i = 0; i < lugares.length; i++) {
      var l = lugares[i];
      if (!l.miolo) continue;
      // com filme a respiração é sutil (o movimento já vem dele); sem filme,
      // a respiração de sempre é o único movimento do mundo
      l.miolo.material.opacity = texPortal
        ? 0.78 + Math.sin(relogio * 1.8 + i) * 0.07
        : 0.34 + Math.sin(relogio * 1.8 + i) * 0.10;
    }

    if (heroi) {
      var chegou = andaCorpo(heroi, dt);
      if (chegou && aoChegar) { var f = aoChegar; aoChegar = null; f(); }
      try { if (heroi.node.userData.mixer) heroi.node.userData.mixer.update(dt); } catch (e) {}

      // os FANTASMAS andam pelo mesmo verbo do herói
      for (var fk in fantasmas) {
        if (!fantasmas.hasOwnProperty(fk)) continue;
        var fcorpo = fantasmas[fk];
        andaCorpo(fcorpo, dt);
        try { if (fcorpo.node.userData.mixer) fcorpo.node.userData.mixer.update(dt); } catch (e) {}
      }

      // câmera ORBITAL centrada no herói: o jogador gira, inclina e aproxima;
      // o corpo é sempre a âncora. Esférica clássica: tilt 0 = de cima.
      var hp = heroi.node.position;
      var st2 = Math.sin(cam.tilt), ct2 = Math.cos(cam.tilt);
      camera.position.set(
        hp.x + Math.sin(cam.ang) * st2 * cam.dist,
        1.2 + ct2 * cam.dist,
        hp.z + Math.cos(cam.ang) * st2 * cam.dist);
      camera.lookAt(hp.x, 1.6, hp.z);
    }

    // aviso de proximidade: quem escuta decide o que mostrar
    if (heroi && Hub.aoAproximar) {
      var perto = null;
      for (var j = 0; j < lugares.length; j++) {
        var d2 = heroi.node.position.distanceTo(lugares[j].pos);
        if (d2 < lugares[j].raio) { perto = lugares[j]; break; }
      }
      if (perto !== ultimoPerto) { ultimoPerto = perto; Hub.aoAproximar(perto); }
    }
  }
  var ultimoPerto = null;

  // ------------------------------------------------------------------ entrada
  /* O botão esquerdo tem DOIS trabalhos, divididos pelo mesmo limiar da
   * batalha: mexeu menos de TAP_PX e soltou = clique (anda até o ponto);
   * passou do limiar = ÓRBITA, e o clique não dispara no soltar. A roda dá
   * zoom. É a gramática que o jogador já aprendeu no tabuleiro. */
  var arrasto = null;

  function aoApertar(ev) {
    if (!canvas) return;
    arrasto = { x: ev.clientX, y: ev.clientY, moveu: false };
    ev.preventDefault();
  }
  function aoMover(ev) {
    if (!arrasto) return;
    var dx = ev.clientX - arrasto.x, dy = ev.clientY - arrasto.y;
    if (!arrasto.moveu && Math.hypot(dx, dy) > TAP_PX) arrasto.moveu = true;
    if (arrasto.moveu) {
      cam.ang -= dx * 0.007;
      cam.tilt = Math.max(cam.minTilt, Math.min(cam.maxTilt, cam.tilt - dy * 0.005));
    }
    arrasto.x = ev.clientX; arrasto.y = ev.clientY;
  }
  function aoSoltar(ev) {
    if (!arrasto) return;
    var foiTap = !arrasto.moveu;
    arrasto = null;
    if (foiTap) aoClicar(ev);
  }
  function aoRodar(ev) {
    ev.preventDefault();
    cam.dist = Math.max(cam.minDist, Math.min(cam.maxDist,
      cam.dist * Math.exp(ev.deltaY * 0.0012)));
  }

  function aoClicar(ev) {
    if (!renderer || !camera || !chao) return;
    var r = canvas.getBoundingClientRect();
    var mx = ((ev.clientX - r.left) / r.width) * 2 - 1;
    var my = -((ev.clientY - r.top) / r.height) * 2 + 1;
    raycaster.setFromCamera({ x: mx, y: my }, camera);

    // primeiro os LUGARES (clicar no portal anda até ele)…
    for (var i = 0; i < lugares.length; i++) {
      var hits = raycaster.intersectObject(lugares[i].node, true);
      if (hits && hits.length) {
        var l = lugares[i];
        andarAte(l.pos, function () { if (Hub.aoAproximar) Hub.aoAproximar(l); });
        return;
      }
    }
    // …depois o chão: andar até o ponto
    var no = raycaster.intersectObject(chao);
    if (no && no.length) {
      var p = no[0].point;
      // não deixa sair do mapa
      var d = Math.hypot(p.x, p.z);
      if (d > RAIO_MAPA * 0.92) {
        var k = (RAIO_MAPA * 0.92) / d;
        p.x *= k; p.z *= k;
      }
      andarAte(p, null);
    }
  }

  // -------------------------------------------------------------------- laço
  function quadro(t) {
    if (!rodando) return;
    var dt = Math.min((t - ultimoT) / 1000 || 0.016, 0.1);
    ultimoT = t;
    tique(dt);
    renderer.render(scene, camera);
    requestAnimationFrame(quadro);
  }

  function ajusta() {
    if (!renderer || !container) return;
    var w = container.clientWidth || 800, h = container.clientHeight || 500;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------------ pública
  /* aoAproximar(lugar|null) — o hud pendura aqui o painel de portal/banco/arena */
  Hub.aoAproximar = null;

  Hub.entrar = function (cont, classId) {
    THREE = window.THREE;
    if (!THREE) return false;
    container = cont;
    if (!renderer) {
      canvas = document.createElement('canvas');
      canvas.className = 'hub-canvas';
      container.appendChild(canvas);
      renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      if (THREE.sRGBEncoding != null) renderer.outputEncoding = THREE.sRGBEncoding;
      raycaster = new THREE.Raycaster();
      montaCena();
      canvas.style.touchAction = 'none';
      canvas.addEventListener('pointerdown', aoApertar);
      canvas.addEventListener('pointermove', aoMover);
      canvas.addEventListener('pointerup', aoSoltar);
      canvas.addEventListener('pointercancel', function () { arrasto = null; });
      canvas.addEventListener('wheel', aoRodar, { passive: false });
      window.addEventListener('resize', ajusta);
    } else if (canvas.parentElement !== container) {
      container.appendChild(canvas);
    }
    if (!heroi) montaHeroi(classId);
    else if (classId && heroi.classId !== classId) {
      // trocou de herói entre visitas: o corpo acompanha
      scene.remove(heroi.node); heroi = null; montaHeroi(classId);
    }
    if (heroi) heroi.classId = classId;
    ajusta();
    /* Reentrar com o hub JA NA TELA (trocou o líder da dupla pela ficha) não
     * passa pelo sair() — e um segundo requestAnimationFrame aqui abriria um
     * SEGUNDO laço, dobrando o render para sempre. Só se inicia um laço
     * quando não há laço: o vivo continua e apanha o herói novo sozinho. */
    if (!rodando) {
      rodando = true;
      ultimoT = performance.now();
      requestAnimationFrame(quadro);
    }
    return true;
  };

  Hub.sair = function () {
    rodando = false;               // o rAF morre sozinho no próximo quadro
    ultimoPerto = null;
    // os corpos dos fantasmas saem de cena; a REDE continua ligada — ao
    // voltar ao Acampamento a HUD os reconstrói de Rede.pares()
    for (var fk in fantasmas) {
      if (fantasmas.hasOwnProperty(fk)) scene.remove(fantasmas[fk].node);
    }
    fantasmas = {};
  };

  /* A presença em rede vai mandar FANTASMAS andarem pelo mesmo caminho do
   * herói — o destino chega por mensagem, não por clique. E o próprio defeito
   * "não está correndo" só é testável se o teste puder LER o que o herói faz:
   * até aqui tudo era privado e a única prova era o olho. */
  /* Quem sabe o nome é o DB, e quem fala com o DB é a HUD (pintaConta e o
   * batismo): ela empurra o nome para cá. Vazio tira a plaquinha. */
  var brasaDoHeroi = null;         // o tier da chama ({paleta, tam, nome})
  Hub.nomeia = function (nome, titulo, brasaTier) {
    nomeJogador = String(nome || '').trim() || null;
    tituloJogador = String(titulo || '').trim() || null;
    brasaDoHeroi = brasaTier || null;
    pendura(nomeJogador, tituloJogador, brasaDoHeroi);
  };
  /* OS FANTASMAS — os outros jogadores da Rede, de corpo inteiro no mapa.
   * Entram com classe, nome e título; andam pelo MESMO verbo do herói
   * (mandaAndar/andaCorpo); o pulso corrige deriva grande sem teleporte
   * nervoso. A HUD é quem traduz eventos da Rede nestas chamadas. */
  Hub.aoAndar = null;
  Hub.fantasmaEntra = function (id, perfil) {
    if (!scene || fantasmas[id]) return false;
    var m2 = M2();
    if (!m2) return false;
    var node = null;
    var classe = (perfil && perfil.classe) || 'sumo';
    try { node = m2.unit(classe, { classId: classe }); } catch (e) {}
    if (!node) return false;
    node.position.set((perfil && perfil.x) || 0, 0, (perfil && perfil.z) || RAIO_MAPA * 0.35);
    scene.add(node);
    var corpo = { node: node, alvo: null, andando: false };
    fantasmas[id] = corpo;
    try { node.userData.play('idle', { fade: 0 }); } catch (e) {}
    var tierF = null;
    if (perfil && perfil.resumo && typeof perfil.resumo.brasa === 'number' &&
        JOGO.Brasa && JOGO.Brasa.tierDe) {
      tierF = JOGO.Brasa.tierDe(perfil.resumo.brasa, false);
      // a mesma regra do herói: a faísca da Fagulha é de quem JÁ lutou
      if (tierF && tierF.min === 0 && !(perfil.resumo.partidas > 0)) tierF = null;
    }
    penduraEm(corpo, (perfil && perfil.nome) || '?', (perfil && perfil.titulo) || '', tierF);
    return true;
  };
  Hub.fantasmaAlvo = function (id, x, z) {
    var corpo = fantasmas[id];
    if (corpo) mandaAndar(corpo, x, z);
  };
  Hub.fantasmaPulso = function (id, x, z) {
    var corpo = fantasmas[id];
    if (!corpo || corpo.alvo) return;          // andando, deixa chegar
    var p = corpo.node.position;
    if (Math.hypot(x - p.x, z - p.z) > 2.0) {  // deriva grande: anda até lá
      mandaAndar(corpo, x, z);
    }
  };
  Hub.fantasmaSai = function (id) {
    var corpo = fantasmas[id];
    if (!corpo) return;
    scene.remove(corpo.node);
    delete fantasmas[id];
  };
  Hub.fantasmas = function () { return Object.keys(fantasmas); };

  Hub.irPara = function (x, z) {
    if (!heroi || !THREE) return false;
    andarAte(new THREE.Vector3(x, 0, z), null);
    return true;
  };
  Hub._estado = function () {
    return {
      pos: heroi ? { x: +heroi.node.position.x.toFixed(2),
                     z: +heroi.node.position.z.toFixed(2) } : null,
      andando: heroi ? !!heroi.andando : null,
      nome: nomeJogador,
      titulo: tituloJogador,
      chama: !!(heroi && heroi.chamaBrasa),
      chamaCoroa: !!(heroi && heroi.chamaCoroa && heroi.chamaCoroa.length === 2),
      chamaPaleta: brasaDoHeroi ? (brasaDoHeroi.paleta || null) : null,
      chamaTier: brasaDoHeroi ? (brasaDoHeroi.id || null) : null,
      corpo: (heroi && heroi.node.userData && heroi.node.userData.look &&
              heroi.node.userData.look.model) || null,
      plaquinha: !!(heroi && heroi.plaquinha),
      plaquinhaTitulo: !!(heroi && heroi.plaquinhaTitulo),
      clipe: heroi ? (heroi.clipe || 'idle') : null,
      vel: heroi ? (heroi.vel || 0) : null,
      cam: { ang: +cam.ang.toFixed(3), tilt: +cam.tilt.toFixed(3), dist: +cam.dist.toFixed(2) }
    };
  };
})();
