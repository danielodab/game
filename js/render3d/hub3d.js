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
  var tAvalia = 0;                  // relógio da avaliação do teto de fantasmas

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

  /* AS COROAS DO RANKING PVP — a arte do usuário (10 níveis, PNG com alfa,
   * coroas-pvp.js). Uma textura por nível, compartilhada por todo corpo que
   * carrega aquela coroa. */
  var texCoroas = {};
  function texturaCoroa(nivel) {
    var chave = 'n' + nivel;
    if (texCoroas[chave] !== undefined) return texCoroas[chave] || null;
    var A = (typeof JOGO !== 'undefined') ? JOGO.COROAS_PVP : null;
    if (!A || !A[chave] || !THREE) { texCoroas[chave] = false; return null; }
    var img = new Image();
    var tex = new THREE.Texture(img);
    img.onload = function () { tex.needsUpdate = true; };
    img.src = 'data:image/png;base64,' + A[chave];
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    if (THREE.sRGBEncoding != null) tex.encoding = THREE.sRGBEncoding;
    texCoroas[chave] = tex;
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
    montaSede();
    enfeitesPlantados = false;       // cena nova, moitas novas
    enfeitesTentativas = 0;
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

  /* A SEDE DAS GUILDAS (25/08): o estandarte a leste. O lugar existe ANTES
   * da casa própria — a casa 3D de cada guilda vem com a fase do lobby;
   * hoje a porta abre a ficha da guilda. */
  function montaSede() {
    var px = RAIO_MAPA * 0.62, pz = -RAIO_MAPA * 0.04;
    var g = new THREE.Group();
    var mastro = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.13, 4.4, 8),
      new THREE.MeshBasicMaterial({ color: 0x6b5136 }));
    mastro.position.y = 2.2;
    g.add(mastro);
    var cv = document.createElement('canvas');
    cv.width = 256; cv.height = 128;
    var g2 = cv.getContext('2d');
    g2.fillStyle = 'rgba(24,18,10,0.92)';
    g2.fillRect(0, 0, 256, 128);
    g2.strokeStyle = '#c9a227';
    g2.lineWidth = 6;
    g2.strokeRect(3, 3, 250, 122);
    g2.fillStyle = '#ffd98a';
    g2.textAlign = 'center';
    g2.font = '700 44px Georgia';
    g2.fillText('⚑', 128, 52);
    g2.font = '700 30px Georgia';
    g2.fillText('GUILDAS', 128, 100);
    var bandeira = new THREE.Mesh(
      new THREE.PlaneGeometry(2.4, 1.2),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv),
        side: THREE.DoubleSide, transparent: true }));
    bandeira.position.set(1.25, 3.6, 0);
    g.add(bandeira);
    var r = rotulo('Sede das Guildas', '#d8b25e');
    r.position.y = 5.0;
    g.add(r);
    g.position.set(px, 0, pz);
    scene.add(g);
    lugares.push({ id: 'sede', tipo: 'sede', nome: 'Sede das Guildas',
                   pos: new THREE.Vector3(px, 0, pz), raio: 3.2, node: g });
  }

  /* Vida em volta: meia dúzia das peças de cenário do usuário, espalhadas com
   * semente fixa — o acampamento nasce igual toda vez. */
  /* OS ENFEITES v2 (25/08: "muito jogados e minúsculos"): cenografia em vez
   * de espalhamento. Nada de peça solitária de 1,4 m perdida no gramado —
   * MOITAS de 3-4 peças, com uma ÂNCORA de porte (3-4 m) e satélites
   * encostados nela em rotações vivas: agrupamento lê como intenção, tamanho
   * lê como mundo. As moitas moram no anel externo (entre os portais) e em
   * três bolsões internos, SEMPRE longe dos lugares de porta — banco,
   * mercado, arena e portais têm raio de conversa, e enfeite ali vira ruído
   * de toque. Determinístico: a praça é a mesma em toda visita. */
  /* A CORRIDA DO KIT (defeito antigo, pego em 25/08): os GLBs do cenário
   * podem abrir DEPOIS do build da praça — rawScene devolve null e quem
   * perdia a corrida ganhava praça pelada (era por isso que os enfeites ora
   * apareciam, ora não). A sonda espera o kit abrir e replanta uma vez só. */
  var enfeitesPlantados = false, enfeitesTentativas = 0;
  function agendaEnfeites() {
    if (enfeitesPlantados || enfeitesTentativas > 40) return;
    enfeitesTentativas++;
    setTimeout(montaEnfeites, 500);
  }
  function montaEnfeites() {
    if (enfeitesPlantados || !scene) return;
    var m2 = M2();
    var cat = JOGO.CENARIO && JOGO.CENARIO.garden;
    if (!m2 || !cat) { agendaEnfeites(); return; }
    var pecas = (cat.sotaque || []).concat(cat.borda || []);
    if (!pecas.length) return;
    var sonda = null;
    try { sonda = m2.rawScene(pecas[0]); } catch (e) {}
    if (!sonda) { agendaEnfeites(); return; }
    enfeitesPlantados = true;

    /* Altura-alvo POR PEÇA: o acervo do jardim é prop de tabuleiro (0,17 a
     * 0,49 de altura natural) e um alvo único fazia a REDOMA virar um ovo de
     * 4 metros. Árvore pode ser árvore; regador não pode ser prédio. */
    var ALVO = {
      jd_estufa_arvore: 4.4, jd_escada: 2.6, jd_tronco: 1.6, jd_carrinho: 1.4,
      jd_canteiro: 1.2, jd_vaso: 1.2, jd_regador: 1.0, jd_redoma: 0.9
    };
    function planta(chave, mult, x, z, rot) {
      var cena = null;
      try { cena = m2.rawScene(chave); } catch (e) {}
      if (!cena) return null;
      var no = cena.clone(true);
      no.updateMatrixWorld(true);
      var cx = new THREE.Box3().setFromObject(no);
      var alt = cx.max.y - cx.min.y;
      if (alt > 0.01) no.scale.setScalar(((ALVO[chave] || 1.0) * (mult || 1)) / alt);
      no.rotation.y = rot || 0;
      no.updateMatrixWorld(true);
      cx = new THREE.Box3().setFromObject(no);   // assenta pelo pé, como sempre
      no.position.set(x, -cx.min.y, z);
      scene.add(no);
      return no;
    }
    function longeDosLugares(x, z) {
      for (var j = 0; j < lugares.length; j++) {
        var dx = x - lugares[j].pos.x, dz = z - lugares[j].pos.z;
        if (Math.hypot(dx, dz) < (lugares[j].raio || 3) + 3) return false;
      }
      return true;
    }

    /* As moitas: no anel externo a âncora é a ÁRVORE (a única peça com porte
     * de âncora — a variação de altura e rotação disfarça a repetição); nos
     * bolsões internos, composições "de trabalho" do jardim: escada apoiada,
     * carrinho com canteiro, tronco caído. */
    var SATELITES = ['jd_tronco', 'jd_vaso', 'jd_canteiro', 'jd_regador',
                     'jd_redoma', 'jd_carrinho'];
    var moitas = [];
    for (var v = 0; v < 8; v++) {
      moitas.push({ ang: 0.39 + v * (Math.PI / 4),
                    raio: RAIO_MAPA * (0.84 + (v % 2) * 0.06),
                    anc: 'jd_estufa_arvore', mult: 1 + (v % 3) * 0.14 });
    }
    [['jd_escada', 0.9], ['jd_carrinho', 2.6], ['jd_tronco', 4.4]]
      .forEach(function (par) {
        moitas.push({ ang: par[1], raio: RAIO_MAPA * 0.56,
                      anc: par[0], mult: 1 });
      });

    var pi = 0;
    moitas.forEach(function (mo, mi) {
      var cx0 = Math.sin(mo.ang) * mo.raio;
      var cz0 = Math.cos(mo.ang) * mo.raio;
      if (!longeDosLugares(cx0, cz0)) return;          // porta é porta
      planta(mo.anc, mo.mult, cx0, cz0, mi * 1.7);
      var sats = 2 + (mi % 2);
      for (var s2 = 0; s2 < sats; s2++) {
        var a3 = mi * 2.1 + s2 * (Math.PI * 2 / sats) + 0.7;
        planta(SATELITES[pi++ % SATELITES.length],
               1 + (s2 % 2) * 0.25,
               cx0 + Math.sin(a3) * (1.5 + s2 * 0.5),
               cz0 + Math.cos(a3) * (1.5 + s2 * 0.5),
               a3 * 2.3);
      }
    });
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
    ['plaquinha', 'plaquinhaTitulo'].forEach(function (campo) {
      if (!corpo[campo]) return;
      corpo.node.remove(corpo[campo]);
      try {
        corpo[campo].material.map.dispose();
        corpo[campo].material.dispose();
      } catch (e) {}
      corpo[campo] = null;
    });
    if (corpo.coroaPvp) {
      corpo.node.remove(corpo.coroaPvp);
      try { corpo.coroaPvp.material.dispose(); } catch (e) {}
      corpo.coroaPvp = null;
    }
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
    // A COROA DO RANKING — a arte do usuário, no lugar das chamas ("essa
    // coroa ficará acima da cabeça ao invés das chamas"). AGORA EM 3D
    // (30/08): as dez coroas viraram modelo (coroas-pvp-3d.js) e a de cada
    // corpo flutua e GIRA devagar acima do nome — coroa de verdade não é
    // adesivo que encara a câmera. O bilhete PNG continua como fallback
    // (e no perfil 2D). A regra do novato mora na HUD.
    if (brasaTier && brasaTier.nivel) {
      var tamK = brasaTier.tam || 0.6;
      var coroa = modeloCoroa(brasaTier.nivel, tamK);
      if (coroa) {
        var baseK3 = alto + (titulo ? 0.66 : 0.5) + 0.34;
        coroa.position.y = baseK3;
        coroa.userData.baseY = baseK3;
        coroa.userData.fase = Math.random() * 9;
        coroa.userData.gira3d = true;
        corpo.node.add(coroa);
        corpo.coroaPvp = coroa;
      } else {
        var texK = texturaCoroa(brasaTier.nivel);
        if (texK) {
          var bilhete = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
            new THREE.MeshBasicMaterial({
              map: texK, transparent: true, depthWrite: false,
              side: THREE.DoubleSide
            }));
          bilhete.scale.set(tamK, tamK, 1);
          var baseK = alto + (titulo ? 0.66 : 0.5) + 0.34 + tamK * 0.45;
          bilhete.position.y = baseK;
          bilhete.userData.baseY = baseK;
          bilhete.userData.fase = Math.random() * 9;
          corpo.node.add(bilhete);
          corpo.coroaPvp = bilhete;
        }
      }
    }
  }

  /* A COROA EM 3D: clone do modelo da patente, normalizado pela LARGURA —
   * coroa é aro, não torre; o `tam` do tier (que era o lado do bilhete) vira
   * o diâmetro, um dedo menor. Assenta e centra aqui pelo mesmo motivo de
   * `pecaUsuario`: o arquivo não promete base no zero nem centro no eixo.
   * Os materiais são do TEMPLATE (clone compartilha) — quem remover a coroa
   * não deve descartá-los, e o try/catch do cleanup já ignora Group. */
  function modeloCoroa(nivel, tam) {
    var M2 = (typeof JOGO !== 'undefined') ? JOGO.Models3D2 : null;
    // `THREE` do módulo só é preenchido no init da praça; a PROVA chama esta
    // função sem levantar o Hub inteiro, então resolve-se pelo global também.
    var T = THREE || (typeof window !== 'undefined' ? window.THREE : null);
    if (!M2 || !M2.rawScene || !T) return null;
    var cena = null;
    try { cena = M2.rawScene('coroa_pvp_n' + nivel); } catch (e) {}
    if (!cena) return null;
    var no = cena.clone(true);
    no.updateMatrixWorld(true);
    var bb = new T.Box3().setFromObject(no);
    var larg = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z);
    if (!isFinite(larg) || larg < 0.001) return null;
    no.scale.multiplyScalar((tam * 0.72) / larg);
    var berco = new T.Group();
    berco.add(no);
    no.updateMatrixWorld(true);
    var cb = new T.Box3().setFromObject(no);
    if (isFinite(cb.min.y)) no.position.y -= cb.min.y;
    var mx = (cb.min.x + cb.max.x) / 2, mz = (cb.min.z + cb.max.z) / 2;
    if (isFinite(mx)) no.position.x -= mx;
    if (isFinite(mz)) no.position.z -= mz;
    return berco;
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
    // A COROA flutua de leve — realeza não balança muito. A 3D GIRA devagar
    // (modelo tem todos os lados); o bilhete PNG encara a câmera, como antes.
    if (camera) {
      var viraCoroa = function (corpoC) {
        if (!corpoC || !corpoC.coroaPvp) return;
        var m = corpoC.coroaPvp;
        if (m.userData.gira3d) {
          m.rotation.y = relogio * 0.5 + (m.userData.fase || 0);
        } else {
          m.rotation.y = Math.atan2(camera.position.x - corpoC.node.position.x,
                                    camera.position.z - corpoC.node.position.z) -
                         corpoC.node.rotation.y;
        }
        m.position.y = m.userData.baseY +
                       Math.sin(relogio * 1.6 + (m.userData.fase || 0)) * 0.05;
      };
      viraCoroa(heroi);
      for (var fk2 in fantasmas) {
        if (fantasmas.hasOwnProperty(fk2)) viraCoroa(fantasmas[fk2].corpo);
      }
      // A AURA respira: o anel gira devagar, as labaredas sobem e somem
      var pulsaAura = function (corpoA) {
        if (!corpoA || !corpoA.aura) return;
        for (var ai = 0; ai < corpoA.aura.children.length; ai++) {
          var ch = corpoA.aura.children[ai];
          if (ch.isSprite) {
            var f2 = (relogio * 0.45 + (ch.userData.fase || 0)) % 1.0;
            ch.position.y = 0.7 + f2 * 1.0;
            ch.material.opacity = 0.34 * (1 - f2);
          } else {
            ch.material.opacity = 0.28 + Math.sin(relogio * 2.1) * 0.09;
            ch.rotation.z = relogio * 0.35;
          }
        }
      };
      pulsaAura(heroi);
      for (var fk2b in fantasmas) {
        if (fantasmas.hasOwnProperty(fk2b)) pulsaAura(fantasmas[fk2b].corpo);
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

      // os FANTASMAS COM CORPO andam pelo mesmo verbo do herói; os sem corpo
      // são só dado e não custam nada aqui
      for (var fk in fantasmas) {
        if (!fantasmas.hasOwnProperty(fk)) continue;
        var fcorpo = fantasmas[fk].corpo;
        if (!fcorpo) continue;
        andaCorpo(fcorpo, dt);
        try { if (fcorpo.node.userData.mixer) fcorpo.node.userData.mixer.update(dt); } catch (e) {}
      }
      // o TETO reavalia de tempos em tempos quem merece corpo
      tAvalia += dt;
      if (tAvalia > 1.2) { tAvalia = 0; avaliaCorpos(); }

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

    // antes de tudo, os FANTASMAS: tocar num jogador é o gesto social —
    // convida para a TROCA (a HUD decide o que fazer com o toque)
    if (Hub.aoTocarFantasma) {
      for (var fk3 in fantasmas) {
        if (!fantasmas.hasOwnProperty(fk3)) continue;
        if (!fantasmas[fk3].corpo) continue;     // sem corpo, sem toque
        var hitsF = raycaster.intersectObject(fantasmas[fk3].corpo.node, true);
        if (hitsF && hitsF.length) {
          try { Hub.aoTocarFantasma(fk3); } catch (e) {}
          return;
        }
      }
    }

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
      if (fantasmas.hasOwnProperty(fk) && fantasmas[fk].corpo) {
        scene.remove(fantasmas[fk].corpo.node);
      }
    }
    fantasmas = {};
  };

  /* A presença em rede vai mandar FANTASMAS andarem pelo mesmo caminho do
   * herói — o destino chega por mensagem, não por clique. E o próprio defeito
   * "não está correndo" só é testável se o teste puder LER o que o herói faz:
   * até aqui tudo era privado e a única prova era o olho. */
  /* Quem sabe o nome é o DB, e quem fala com o DB é a HUD (pintaConta e o
   * batismo): ela empurra o nome para cá. Vazio tira a plaquinha. */
  var brasaDoHeroi = null;         // o tier da coroa ({nivel, tam, nome})
  Hub.nomeia = function (nome, titulo, brasaTier) {
    nomeJogador = String(nome || '').trim() || null;
    tituloJogador = String(titulo || '').trim() || null;
    brasaDoHeroi = brasaTier || null;
    pendura(nomeJogador, tituloJogador, brasaDoHeroi);
  };
  /* A AURA DO COLECIONADOR (pedido 25/08): o Traje fechado acende "um fogo
   * quase transparente e branco" — um ANEL no chão e três labaredas macias
   * subindo do corpo. Tudo canvas + aditivo, sem textura externa; o tique
   * pulsa. Vale para o herói (Hub.aura) e para fantasmas com perfil.aura —
   * a vaidade tem de ser PÚBLICA, senão não é vaidade. */
  var texAuraDisco = null, texAuraChama = null;
  function fazTexRadial(stops) {
    var cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    var g2 = cv.getContext('2d');
    var gr = g2.createRadialGradient(64, 64, 4, 64, 64, 62);
    for (var i = 0; i < stops.length; i++) gr.addColorStop(stops[i][0], stops[i][1]);
    g2.fillStyle = gr;
    g2.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(cv);
  }
  function acendeAura(corpo, liga) {
    if (!corpo || !THREE) return;
    if (!liga) {
      if (corpo.aura) { corpo.node.remove(corpo.aura); corpo.aura = null; }
      return;
    }
    if (corpo.aura) return;
    if (!texAuraDisco) {
      texAuraDisco = fazTexRadial([[0, 'rgba(255,255,255,0)'],
        [0.55, 'rgba(255,255,255,0.5)'], [0.75, 'rgba(255,255,255,0.16)'],
        [1, 'rgba(255,255,255,0)']]);
      texAuraChama = fazTexRadial([[0, 'rgba(255,255,255,0.85)'],
        [0.5, 'rgba(255,250,240,0.25)'], [1, 'rgba(255,255,255,0)']]);
    }
    var g = new THREE.Group();
    var disco = new THREE.Mesh(
      new THREE.PlaneGeometry(2.2, 2.2),
      new THREE.MeshBasicMaterial({ map: texAuraDisco, transparent: true, opacity: 0.34,
        depthWrite: false, blending: THREE.AdditiveBlending }));
    disco.rotation.x = -Math.PI / 2;
    disco.position.y = 0.05;
    g.add(disco);
    for (var f = 0; f < 3; f++) {
      var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: texAuraChama,
        transparent: true, opacity: 0.32, depthWrite: false,
        blending: THREE.AdditiveBlending, color: 0xffffff }));
      sp.scale.set(0.5, 1.05, 1);
      sp.position.set(Math.cos(f * 2.1) * 0.35, 0.9, Math.sin(f * 2.1) * 0.35);
      sp.userData.fase = f * 0.33;
      g.add(sp);
    }
    corpo.node.add(g);
    corpo.aura = g;
  }
  Hub.aura = function (liga) {
    acendeAura(heroi, !!liga);
    return !!heroi;
  };

  /* OS FANTASMAS — os outros jogadores da Rede. Desde o TETO (pedido 25/08,
   * "opção 1"): a praça aceita QUALQUER número de conectados, mas corpo 3D
   * só os TETO_FANTASMAS mais próximos do herói. Todo par vira um REGISTRO
   * ({perfil, x, z, corpo}); quem está no teto ganha o corpo inteiro (GLB,
   * nome, coroa, aura), quem está longe vive como DADO — a posição continua
   * andando no papel, e chegar perto materializa. A avaliação roda a cada
   * ~1,2s com HISTERESE e uma troca por vez: instanciar GLB custa caro, e a
   * fronteira do teto não pode virar pisca-pisca de corpos. */
  Hub.aoAndar = null;
  Hub.aoTocarFantasma = null;
  Hub.TETO_FANTASMAS = 20;
  var MARGEM_TROCA = 2.0;           // só larga o corpo quem ficou 2m atrás do corte

  function materializa(reg) {
    if (!reg || reg.corpo || !scene) return false;
    var m2 = M2();
    if (!m2) return false;
    var node = null;
    var perfil = reg.perfil;
    var classe = (perfil && perfil.classe) || 'sumo';
    try { node = m2.unit(classe, { classId: classe }); } catch (e) {}
    if (!node) return false;
    node.position.set(reg.x, 0, reg.z);
    scene.add(node);
    var corpo = { node: node, alvo: null, andando: false };
    reg.corpo = corpo;
    try { node.userData.play('idle', { fade: 0 }); } catch (e) {}
    var tierF = null;
    if (perfil && perfil.resumo && typeof perfil.resumo.brasa === 'number' &&
        JOGO.Brasa && JOGO.Brasa.tierDe) {
      tierF = JOGO.Brasa.tierDe(perfil.resumo.brasa, false);
      // a mesma regra do herói: a faísca da Fagulha é de quem JÁ lutou
      if (tierF && tierF.min === 0 && !(perfil.resumo.partidas > 0)) tierF = null;
    }
    penduraEm(corpo, (perfil && perfil.nome) || '?', (perfil && perfil.titulo) || '', tierF);
    if (perfil && perfil.aura) acendeAura(corpo, true);   // a vaidade é pública
    return true;
  }
  function desmaterializa(reg) {
    if (!reg || !reg.corpo) return;
    var p = reg.corpo.node.position;
    reg.x = p.x;                        // o dado herda o último passo do corpo
    reg.z = p.z;
    scene.remove(reg.corpo.node);
    reg.corpo = null;
  }

  /* A decisão PURA (testável sem 3D): dado [{id, dist, temCorpo}], quem
   * ganha corpo e quem larga — no máximo `porVez` de cada, e ninguém larga
   * sem estar FOLGADAMENTE atrás do corte (histerese). */
  // exposto para a PROVA das coroas medir o que a praça pendura de verdade
  Hub._modeloCoroa = modeloCoroa;

  Hub._escolheCorpos = function (lista, teto, margem, porVez) {
    porVez = porVez || 1;
    var orden = lista.slice().sort(function (a, b) { return a.dist - b.dist; });
    var corte = orden.length > teto ? orden[teto - 1] : null;
    var entra = [], sai = [];
    for (var i = 0; i < orden.length; i++) {
      var f = orden[i];
      if (i < teto) {
        if (!f.temCorpo && entra.length < porVez) entra.push(f.id);
      } else if (f.temCorpo && sai.length < porVez &&
                 (!corte || f.dist > corte.dist + margem)) {
        sai.push(f.id);
      }
    }
    return { entra: entra, sai: sai };
  };

  function avaliaCorpos() {
    if (!heroi) return;
    var hp = heroi.node.position;
    var lista = [];
    for (var id in fantasmas) {
      if (!fantasmas.hasOwnProperty(id)) continue;
      var reg = fantasmas[id];
      var fx = reg.corpo ? reg.corpo.node.position.x : reg.x;
      var fz = reg.corpo ? reg.corpo.node.position.z : reg.z;
      lista.push({ id: id, dist: Math.hypot(fx - hp.x, fz - hp.z),
                   temCorpo: !!reg.corpo });
    }
    var d = Hub._escolheCorpos(lista, Hub.TETO_FANTASMAS, MARGEM_TROCA, 1);
    for (var s = 0; s < d.sai.length; s++) desmaterializa(fantasmas[d.sai[s]]);
    for (var e2 = 0; e2 < d.entra.length; e2++) materializa(fantasmas[d.entra[e2]]);
  }

  Hub.fantasmaEntra = function (id, perfil) {
    if (!scene || fantasmas[id]) return false;
    var reg = { perfil: perfil || {},
                x: (perfil && perfil.x) || 0,
                z: (perfil && perfil.z) || RAIO_MAPA * 0.35,
                corpo: null };
    fantasmas[id] = reg;
    // dentro do teto? corpo na hora — acima dele, espera a avaliação decidir
    if (Hub._corposAtivos() < Hub.TETO_FANTASMAS) materializa(reg);
    return true;
  };
  Hub.fantasmaAlvo = function (id, x, z) {
    var reg = fantasmas[id];
    if (!reg) return;
    if (reg.corpo) mandaAndar(reg.corpo, x, z);
    else { reg.x = x; reg.z = z; }               // sem corpo, anda no papel
  };
  Hub.fantasmaPulso = function (id, x, z) {
    var reg = fantasmas[id];
    if (!reg) return;
    if (!reg.corpo) { reg.x = x; reg.z = z; return; }
    if (reg.corpo.alvo) return;                  // andando, deixa chegar
    var p = reg.corpo.node.position;
    if (Math.hypot(x - p.x, z - p.z) > 2.0) {    // deriva grande: anda até lá
      mandaAndar(reg.corpo, x, z);
    }
  };
  Hub.fantasmaSai = function (id) {
    var reg = fantasmas[id];
    if (!reg) return;
    if (reg.corpo) scene.remove(reg.corpo.node);
    delete fantasmas[id];
  };
  Hub.fantasmas = function () { return Object.keys(fantasmas); };
  Hub._corposAtivos = function () {              // painel de teste e provas
    var n = 0;
    for (var k in fantasmas) {
      if (fantasmas.hasOwnProperty(k) && fantasmas[k].corpo) n++;
    }
    return n;
  };

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
      coroaVisivel: !!(heroi && heroi.coroaPvp),
      coroaNivel: brasaDoHeroi ? (brasaDoHeroi.nivel || null) : null,
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
