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
  // A ANTESSALA (03/09): a mesma máquina da praça monta o PÁTIO de uma sala
  // do calabouço — null = praça; 'garden:1' = antessala da sala 2 da Estufa
  var RAIO_SALA = 15;
  var salaAtual = null, salaCfg = null, salaPlantada = false, salaTentativas = 0;
  function chaveSala(s) { return s.dungeonId + ':' + s.roomIndex; }
  function raioAtual() { return salaAtual ? RAIO_SALA : RAIO_MAPA; }
  var fantasmas = {};               // id da Rede -> corpo igual ao do heroi
  var bicho = null;                 // o PET do avatar: { node, alvo, andando, petId, semCorrida }
  var aoChegar = null;              // callback pendente da caminhada atual
  var raycaster = null, chao = null;
  var relogio = 0;
  var tAvalia = 0;                  // relógio da avaliação do teto de fantasmas

  /* ANDAR ou CORRER decide-se pela DISTÂNCIA: até 4 m é um passo (chegar ao
   * portal do lado), acima disso o corpo corre — com o clipe `run` que toda
   * classe tem. Um mundo aberto onde se atravessa o mapa a passo de tabuleiro
   * parece um menu com chão. */
  /* A PRAÇA CRESCEU E VIROU QUADRADA (30/08, pedido: "faça o mapa um pouco
   * maior e quadrado... preciso que ele fique grande"). `RAIO_MAPA` passou a
   * ser o MEIO-LADO do quadrado (lado = 80 m, antes era um disco de r=26).
   * O passo subiu junto — atravessar 80 m no passo antigo levava 13 s e
   * parecia um menu com chão. */
  var VEL_ANDA = 3.8, VEL_CORRE = 7.5, DIST_CORRIDA = 4.0;
  var RAIO_MAPA = 40;
  /* o tronco da Árvore-Mundo é SÓLIDO: quem anda desliza por fora dele */
  var TRONCO_RAIO = 4.6;

  /* A câmera 3D: a MESMA gramática da batalha — arrastar orbita e inclina,
   * roda dá zoom, toque curto age. Orbita em volta DO HERÓI: no mapa aberto o
   * corpo é a âncora, e deslocar o pivô para longe do próprio personagem é se
   * perder num minimapa. maxDist acompanhou o mapa novo. */
  var cam = { ang: 0.0, tilt: 0.95, dist: 20,
              minDist: 7, maxDist: 48, minTilt: 0.35, maxTilt: 1.25 };
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

  /* AS LAJOTAS DA PRAÇA (30/08): textura procedural de pedras cinza com
   * junta escura, em padrão corrido (cada fileira desloca meia lajota).
   * O tom de cada pedra sai de um hash do índice — nada de Math.random,
   * a praça é a mesma em toda visita. Um tile de 256px cobre 4×4 m e se
   * repete: em 80 m são 20 repetições, longe o bastante para o olho não
   * pegar o carimbo. */
  var texLajotas = null;
  function texturaLajotas() {
    if (texLajotas) return texLajotas;
    var cv = document.createElement('canvas');
    cv.width = 256; cv.height = 256;
    var g = cv.getContext('2d');
    g.fillStyle = '#3f4348';                       // a junta, escura
    g.fillRect(0, 0, 256, 256);
    var NL = 4, lado = 256 / NL, junta = 5;
    for (var jj = 0; jj < NL; jj++) {
      var desloca = (jj % 2) * (lado / 2);         // padrão corrido
      for (var ii = -1; ii <= NL; ii++) {
        var h = ((ii * 7 + jj * 13 + 5) * 2654435761) % 100;
        var tom = 108 + (h % 26) - 12;             // cinza 96..122
        g.fillStyle = 'rgb(' + tom + ',' + (tom + 2) + ',' + (tom + 5) + ')';
        g.fillRect(ii * lado + desloca + junta / 2, jj * lado + junta / 2,
                   lado - junta, lado - junta);
        // um fio de luz na borda de cima: leitura de pedra, não de ladrilho
        g.fillStyle = 'rgba(255,255,255,0.07)';
        g.fillRect(ii * lado + desloca + junta / 2, jj * lado + junta / 2,
                   lado - junta, 3);
      }
    }
    var tex = new THREE.CanvasTexture(cv);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(RAIO_MAPA / 2, RAIO_MAPA / 2);
    if (THREE.sRGBEncoding != null) tex.encoding = THREE.sRGBEncoding;
    texLajotas = tex;
    return tex;
  }

  function corDoTema(tema) {
    // a cor de cada Fecho no portal: aproveita as cores de elemento do jogo
    var mapa = { garden: '#6fae53', cistern: '#4a7d96', forge: '#d4553f',
                 scaffold: '#c8b6ff', mine: '#8a6a4f', heart: '#c94f6d' };
    return mapa[tema] || '#d8dee4';
  }

  /* Rótulo flutuante: um sprite com texto desenhado em canvas. É o mesmo truque
   * dos números de dano — barato e legível de qualquer ângulo.
   * `op.placa` desenha o texto DENTRO de um retângulo com borda — o pedido do
   * dono para o nome do personagem ("deve aparecer dentro de algum
   * retângulo"). O desenho é o da bandeira da Sede: fundo escuro, filete
   * dourado. A largura da placa abraça o texto, não o canvas inteiro —
   * placa de nome curto não pode parecer um outdoor. */
  function rotulo(texto, cor, escala, op) {
    var cv = document.createElement('canvas');
    cv.width = 512; cv.height = 128;
    var g = cv.getContext('2d');
    g.font = '600 44px Georgia, serif';
    g.textAlign = 'center';
    if (op && op.placa) {
      var larg = Math.min(492, Math.ceil(g.measureText(texto).width) + 56);
      var x0 = (512 - larg) / 2;
      g.fillStyle = op.fundo || 'rgba(24,18,10,0.88)';
      g.fillRect(x0, 18, larg, 92);
      g.strokeStyle = op.borda || '#c9a227';
      g.lineWidth = op.traco || 5;
      g.strokeRect(x0 + 2.5, 20.5, larg - 5, 87);
    }
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
    // névoa recalibrada para o mapa grande: no ajuste antigo ela engoliria
    // metade da praça nova antes de o jogador dar dez passos
    scene.fog = new THREE.Fog(0x0d1512, raioAtual() * 1.4, raioAtual() * 3.4);

    scene.add(new THREE.HemisphereLight(0xcfe8d8, 0x1a2420, 0.95));
    var sol = new THREE.DirectionalLight(0xffe9c4, 1.05);
    sol.position.set(12, 22, 8);
    scene.add(sol);

    // O CHÃO SEM GRADE — agora QUADRADO e de LAJOTAS CINZA (pedido 30/08:
    // "o chão cinza como se fosse lajotas"). A textura é desenhada em canvas
    // na hora — pedras de tons variados com junta escura, padrão corrido —
    // e se repete pela praça inteira. Determinística: a mesma praça em toda
    // visita, como tudo aqui.
    chao = montaChao();
    scene.add(chao);
    // o mundo em volta, mais escuro, para a praça não terminar num fio duro
    var fundo = new THREE.Mesh(
      new THREE.PlaneGeometry(raioAtual() * 5, raioAtual() * 5),
      new THREE.MeshBasicMaterial({ color: 0x121a14 })
    );
    fundo.rotation.x = -Math.PI / 2;
    fundo.position.y = -0.02;
    scene.add(fundo);

    camera = new THREE.PerspectiveCamera(46, 1, 0.1, 300);

    // a antessala é OUTRA cena: pátio murado, porta e saída — sem praça
    if (salaAtual) { montaSala(); return; }

    montaPortais();
    montaBanco();
    montaMercado();
    montaArena();
    montaSede();
    montaForja();
    montaLoteria();
    // as CONSTRUÇÕES do usuário (árvore, arena, banco, mercado, sede) vestem
    // os volumes acima quando os GLBs abrirem — a sonda de sempre
    construcoesPlantadas = false;
    construcoesTentativas = 0;
    montaConstrucoes();
    enfeitesPlantados = false;       // cena nova, moitas novas
    enfeitesTentativas = 0;
    montaEnfeites();
  }

  /* A ANTESSALA: um pátio pequeno da sala, murado no tema do calabouço, com
   * a PORTA para a batalha ao norte e a SAÍDA ao sul. Os muros do tema vêm
   * do kit do cenário (garden/cistern…) por sonda, como as construções da
   * praça; sem kit, blocos de pedra na cor do tema. */
  function montaSala() {
    var R = RAIO_SALA;
    var cor = new THREE.Color(corDoTema(salaCfg && salaCfg.tema));
    // a porta: o mesmo arco dos portais, aceso na cor do tema
    var g = new THREE.Group();
    var aro = new THREE.Mesh(
      new THREE.TorusGeometry(1.7, 0.26, 12, 40),
      new THREE.MeshStandardMaterial({ color: 0x5a5348, roughness: 0.9 })
    );
    aro.position.y = 2.1;
    g.add(aro);
    var miolo = new THREE.Mesh(
      new THREE.CircleGeometry(1.5, 32),
      new THREE.MeshBasicMaterial({ color: cor, transparent: true, opacity: 0.55,
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
    var r = rotulo('Para a batalha', '#f0ead8');
    r.position.y = 4.4;
    g.add(r);
    g.position.set(0, 0, -R * 0.72);
    g.lookAt(0, 0, 0);
    g.scale.setScalar(1.3);
    scene.add(g);
    lugares.push({ id: 'porta', tipo: 'porta', nome: 'Para a batalha',
                   pos: new THREE.Vector3(0, 0, -R * 0.72), raio: 4.2, node: g, miolo: miolo });
    // a saída: dois degraus de pedra ao sul
    var s = new THREE.Group();
    var degrau = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.5, 1.6),
                                new THREE.MeshStandardMaterial({ color: 0x4a443c, roughness: 1 }));
    degrau.position.y = 0.25;
    s.add(degrau);
    var degrau2 = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.5, 1.0),
                                 new THREE.MeshStandardMaterial({ color: 0x3e3931, roughness: 1 }));
    degrau2.position.set(0, 0.75, 0.6);
    s.add(degrau2);
    // o rótulo é um sprite de tamanho fixo: perto da câmera (a saída fica
    // do lado do herói) ele enchia a tela — menor, e a saída vai para o LESTE,
    // fora da linha câmera→herói→porta
    var r2 = rotulo('Sair do calabouço', '#d8cfb8');
    r2.position.y = 2.6;
    r2.scale.multiplyScalar(0.55);
    s.add(r2);
    s.position.set(R * 0.82, 0, R * 0.30);
    s.rotation.y = -Math.PI / 2;
    scene.add(s);
    lugares.push({ id: 'saida', tipo: 'saida', nome: 'Sair do calabouço',
                   pos: new THREE.Vector3(R * 0.82, 0, R * 0.30), raio: 3.6, node: s });
    salaPlantada = false;
    salaTentativas = 0;
    plantaSala();
  }
  function plantaPeca(chave, altAlvo, teto, x, z, rot) {
    var m2 = M2(), cena = null;
    if (!m2) return null;
    try { cena = m2.rawScene(chave); } catch (e) {}
    if (!cena) return null;
    var no = cena.clone(true);
    no.rotation.y = rot || 0;
    no.updateMatrixWorld(true);
    var cx = new THREE.Box3().setFromObject(no);
    var alt = cx.max.y - cx.min.y;
    var larg = Math.max(cx.max.x - cx.min.x, cx.max.z - cx.min.z);
    if (!isFinite(alt) || alt <= 0.01) return null;
    var k = altAlvo / alt;
    if (teto && isFinite(larg) && larg > 0.01 && larg * k > teto) k = teto / larg;
    no.scale.multiplyScalar(k);
    no.updateMatrixWorld(true);
    cx = new THREE.Box3().setFromObject(no);
    no.position.set(x - (cx.min.x + cx.max.x) / 2, -cx.min.y, z - (cx.min.z + cx.max.z) / 2);
    scene.add(no);
    return no;
  }
  function plantaSala() {
    if (salaPlantada || !salaAtual || salaTentativas > 400) return;
    var m2 = M2();
    var minha = salaAtual;
    if (!m2 || !m2.isReady || !m2.isReady()) {
      salaTentativas++;
      setTimeout(function () { if (salaAtual === minha) plantaSala(); }, 250);
      return;
    }
    if (salaPlantada || !scene) return;
    salaPlantada = true;
    var R = RAIO_SALA, tema = salaCfg && salaCfg.tema;
    var cat = (JOGO.CENARIO && tema) ? JOGO.CENARIO[tema] : null;
    var muros = (cat && cat.alto) || [];
    var n = 0;
    // os quatro lados, um muro a cada 4,6 m; o vão do norte é a porta e o
    // do sul é a saída
    for (var lado = 0; lado < 4; lado++) {
      for (var k = -3; k <= 3; k++) {
        if ((lado === 0 || lado === 2) && k === 0) continue;
        var tt = k * 4.6;
        var x = (lado === 1) ? R * 0.96 : (lado === 3) ? -R * 0.96 : tt;
        var z = (lado === 0) ? -R * 0.96 : (lado === 2) ? R * 0.96 : tt;
        var rot = (lado === 0 || lado === 2) ? 0 : Math.PI / 2;
        var chave = muros.length ? muros[(n++) % muros.length] : null;
        var no = chave ? plantaPeca(chave, 3.1, 4.8, x, z, rot) : null;
        if (!no) {
          var bloco = new THREE.Mesh(
            new THREE.BoxGeometry(4.4, 3.0, 1.0),
            new THREE.MeshStandardMaterial({ color: new THREE.Color(corDoTema(tema)).multiplyScalar(0.45), roughness: 1 })
          );
          bloco.position.set(x, 1.5, z);
          bloco.rotation.y = rot;
          scene.add(bloco);
        }
      }
    }
  }
  /* Trocar de cena (praça ↔ sala, sala ↔ sala): fantasmas e lugares saem,
   * o herói e o bicho renascem na cena nova pelo caminho de sempre. */
  function refazCena() {
    for (var fk in fantasmas) {
      if (fantasmas.hasOwnProperty(fk) && fantasmas[fk].corpo) scene.remove(fantasmas[fk].corpo.node);
    }
    fantasmas = {};
    lugares.length = 0;
    ultimoPerto = null;
    heroi = null;
    bicho = null;
    montaCena();
  }

  /* O CHÃO (10/09, pedido do dono: "o mapa está muito quadrado, fica
   * estranho"): a praça deixou de ser um quadrado — é uma SUPERELIPSE
   * (|x/R|^n + |z/R|^n = 1, n = 3,2: um quadrado de cantos bem redondos),
   * com um MEIO-FIO de pedra escura correndo a borda inteira. A antessala
   * continua quadrada: é um pátio murado. A mesma curva prende a caminhada
   * (dentroDoMapa), então ninguém anda no escuro além do meio-fio. */
  var MAPA_N = 3.2;
  function raioNaDirecao(ang) {
    // o raio da superelipse naquela direção (para a curva e para o clamp)
    var c = Math.cos(ang), s = Math.sin(ang);
    return raioAtual() / Math.pow(Math.pow(Math.abs(c), MAPA_N) + Math.pow(Math.abs(s), MAPA_N), 1 / MAPA_N);
  }
  function dentroDoMapa(p, folga) {
    var lim = folga || 0.94;
    if (salaAtual) {
      var l = raioAtual() * lim;
      p.x = Math.max(-l, Math.min(l, p.x));
      p.z = Math.max(-l, Math.min(l, p.z));
      return p;
    }
    var ang = Math.atan2(p.z, p.x);
    var rmax = raioNaDirecao(ang) * lim;
    var r = Math.hypot(p.x, p.z);
    if (r > rmax) { p.x *= rmax / r; p.z *= rmax / r; }
    return p;
  }
  function montaChao() {
    var mat = new THREE.MeshStandardMaterial({ map: texturaLajotas(), roughness: 1 });
    if (salaAtual) {
      var quad = new THREE.Mesh(new THREE.PlaneGeometry(raioAtual() * 2, raioAtual() * 2), mat);
      quad.rotation.x = -Math.PI / 2;
      return quad;
    }
    var forma = new THREE.Shape(), N = 128, pontos = [];
    for (var i = 0; i < N; i++) {
      var a = (i / N) * Math.PI * 2, rr = raioNaDirecao(a);
      var x = Math.cos(a) * rr, y = Math.sin(a) * rr;
      pontos.push(new THREE.Vector3(x, 0, y));
      if (i === 0) forma.moveTo(x, y); else forma.lineTo(x, y);
    }
    forma.closePath();
    var geo = new THREE.ShapeGeometry(forma, 1);
    // a lajota se repete a cada 4 m, como no quadrado de antes (uv = mundo/4)
    var uv = geo.attributes.uv, pos = geo.attributes.position;
    for (var k = 0; k < uv.count; k++) uv.setXY(k, pos.getX(k) / 4, pos.getY(k) / 4);
    uv.needsUpdate = true;
    var grupo = new THREE.Group();
    var piso = new THREE.Mesh(geo, mat);
    piso.rotation.x = -Math.PI / 2;
    grupo.add(piso);
    // o meio-fio: um tubo de pedra fechado pela borda toda
    var curva = new THREE.CatmullRomCurve3(pontos, true, 'catmullrom', 0.5);
    var tubo = new THREE.Mesh(new THREE.TubeGeometry(curva, 256, 0.42, 8, true),
                              new THREE.MeshStandardMaterial({ color: 0x2f3338, roughness: 1 }));
    tubo.position.y = 0.05;
    grupo.add(tubo);
    return grupo;
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
      // arco de -63° a +63°, ao norte (z negativo), a 3/4 do meio-lado.
      // No mapa antigo sobrava 0,5 m entre as zonas de conversa de dois
      // portais vizinhos — era a queixa dos "portais colados". Agora cada
      // vizinho fica a ~13 m do outro, com espaço para o cantinho temático
      // — e os extremos não descem tanto a ponto de a Sede e a Arena os
      // taparem da câmera padrão.
      var ang = (-1.10 + (2.20 * i / Math.max(1, n - 1)));
      var px = Math.sin(ang) * RAIO_MAPA * 0.75;
      var pz = -Math.cos(ang) * RAIO_MAPA * 0.75;
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
      // O PORTAL FECHADO (08/09): existe, mas com um X VERMELHO no miolo e o
      // miolo apagado — a HUD não oferece a descida (lugar.fechado)
      var fechado = !!(JOGO.DATA.portalFechado && JOGO.DATA.portalFechado(dg.id));
      if (fechado) {
        miolo.material.color = new THREE.Color(0x3a3f44);
        miolo.material.opacity = 0.28;
        var matX = new THREE.MeshBasicMaterial({ color: 0xff2e2e });
        [Math.PI / 4, -Math.PI / 4].forEach(function (rz) {
          var barra = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.3, 0.12), matX);
          barra.position.set(0, 2.1, 0.08);
          barra.rotation.z = rz;
          g.add(barra);
        });
      }
      var r = rotulo((dg.name || dg.id) + (fechado ? ' — fechado' : ''), fechado ? '#ff8a8a' : '#f0ead8');
      r.position.y = 4.4;
      g.add(r);

      g.position.set(px, 0, pz);
      g.lookAt(0, 0, 0);              // o portal encara o centro do acampamento
      // no mapa grande o portal do porte antigo virava miniatura; o grupo
      // inteiro sobe 1,3× — aro, base e rótulo juntos, proporção preservada
      g.scale.setScalar(1.3);
      scene.add(g);
      lugares.push({ id: dg.id, tipo: 'portal', nome: dg.name || dg.id,
                     tema: dg.theme || null, fechado: fechado,
                     pos: new THREE.Vector3(px, 0, pz), raio: 4.2, node: g, miolo: miolo });
    }
  }

  /* O MERCADINHO: a barraca fecha o triângulo do sul — Banco a sudeste,
   * Arena a sudoeste, Mercadinho no MEIO-SUL, atrás de onde o herói nasce.
   * (A primeira posição escolhida espelhava o banco... em cima da ARENA, e
   * os dois letreiros viraram um borrão — a foto do Daniel pegou.) */
  function montaMercado() {
    // a tenda saiu do meio-sul: ali ela nascia DENTRO da câmera inicial
    // (que fica às costas do herói) e o toldo tomava a primeira tela
    var px = -RAIO_MAPA * 0.60, pz = RAIO_MAPA * 0.50;   // a rua das barracas (10/09)
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
                   pos: new THREE.Vector3(px, 0, pz), raio: 6.0, node: g });
  }

  /* O BANCO: mesa, baú e moedas do próprio kit — as peças já existiam. */
  function montaBanco() {
    // o cofre foi para o CANTO sudeste: em (0.60, 0.25) ele nascia a 4,8 m
    // da Sede — dois prédios de 12-14 m de largura, um DENTRO do outro
    // (a foto do dono pegou a fortaleza engolindo a cúpula)
    var px = RAIO_MAPA * 0.70, pz = RAIO_MAPA * 0.40;
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
                   pos: new THREE.Vector3(px, 0, pz), raio: 6.0, node: g });
  }

  /* A ARENA: o círculo de duelo, ainda selado. Existe DESDE JÁ no mapa porque o
   * lugar precisa nascer antes do sistema — quem entra no acampamento tem de
   * ver onde o PvP vai acontecer. O painel dela diz o que está vindo. */
  function montaArena() {
    // subiu um degrau ao norte quando o coliseu cresceu (teto 24 m):
    // na posição antiga a arquibancada engolia a tenda do Mercadinho
    var px = -RAIO_MAPA * 0.64, pz = RAIO_MAPA * 0.04;
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
    // o raio acompanha o coliseu de 24 m: 13 do centro = um passo da parede
    lugares.push({ id: 'arena', tipo: 'arena', nome: 'Arena',
                   pos: new THREE.Vector3(px, 0, pz), raio: 13.0, node: g });
  }

  /* A FORJA (30/08): a barraca do ferreiro ganhou endereço na praça — o
   * jogador chega, põe a peça e a pedra na bancada e bate. Enquanto a arte
   * da barraca não chega, mesa + tocha + barril seguram o lugar (o mesmo
   * contrato dos outros: a sonda veste com `praca_forja` quando existir). */
  function montaForja() {
    var px = RAIO_MAPA * 0.30, pz = RAIO_MAPA * 0.68;    // a rua das barracas (10/09)
    var g = new THREE.Group();
    var kit = K();
    if (kit && kit.buildProp) {
      try {
        var mesa = kit.buildProp('garden', 'table', 8); if (mesa) g.add(mesa);
        var tocha1 = kit.buildProp('garden', 'torch', 3);
        if (tocha1) { tocha1.position.set(-1.3, 0, 0.4); g.add(tocha1); }
        var tocha2 = kit.buildProp('garden', 'torch', 9);
        if (tocha2) { tocha2.position.set(1.3, 0, 0.4); g.add(tocha2); }
        var barril2 = kit.buildProp('garden', 'barrel', 12);
        if (barril2) { barril2.position.set(1.6, 0, -0.8); g.add(barril2); }
      } catch (e) {}
    }
    var r = rotulo('Forja', '#e0955a');
    r.position.y = 3.2;
    g.add(r);
    g.position.set(px, 0, pz);
    scene.add(g);
    lugares.push({ id: 'forja', tipo: 'forja', nome: 'Forja',
                   pos: new THREE.Vector3(px, 0, pz), raio: 5.0, node: g });
  }

  /* A BARRAQUINHA DA SORTE (03/09, pedido do dono: "deveria ter uma
   * barraquinha de loteria só para esse giro da sorte"): a roleta dos selos
   * saiu do Mercadinho e ganhou endereço — uma tenda listrada a sudoeste,
   * entre o Mercadinho e o herói. Corpo de primitivas até a arte dele
   * chegar (o prompt foi dado); o lugar e a ficha já são os definitivos. */
  function montaLoteria() {
    var px = -RAIO_MAPA * 0.26, pz = RAIO_MAPA * 0.70;   // a rua das barracas (10/09)
    var g = new THREE.Group();
    // o balcão
    var balcao = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.0, 1.2),
                                new THREE.MeshStandardMaterial({ color: 0x6b4a2e, roughness: 0.9 }));
    balcao.position.set(0, 0.5, 0.6);
    g.add(balcao);
    // os quatro postes e o telhado de lona listrada (canvas)
    var poste = new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 1 });
    [[-1.5, -0.7], [1.5, -0.7], [-1.5, 1.1], [1.5, 1.1]].forEach(function (p) {
      var m = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 2.6, 8), poste);
      m.position.set(p[0], 1.3, p[1]);
      g.add(m);
    });
    var cv = document.createElement('canvas');
    cv.width = 128; cv.height = 32;
    var ctx = cv.getContext('2d');
    for (var i = 0; i < 8; i++) { ctx.fillStyle = i % 2 ? '#e8c25a' : '#a4232b'; ctx.fillRect(i * 16, 0, 16, 32); }
    var tex = new THREE.CanvasTexture(cv);
    tex.wrapS = THREE.RepeatWrapping; tex.repeat.set(2, 1);
    var lona = new THREE.Mesh(new THREE.ConeGeometry(2.6, 1.4, 4, 1, true),
                              new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, side: THREE.DoubleSide }));
    lona.position.set(0, 3.2, 0.2);
    lona.rotation.y = Math.PI / 4;
    g.add(lona);
    // a roda da sorte, pendurada na frente
    var roda = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.12, 12),
                              new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }));
    roda.rotation.x = Math.PI / 2;
    roda.position.set(0, 1.9, -0.3);
    g.add(roda);
    var r = rotulo('Barraquinha da Sorte', '#ffd98a');
    r.position.y = 4.4;
    g.add(r);
    g.position.set(px, 0, pz);
    // sem girar o grupo: a obra do dono encara o centro pelo montaObra, como
    // as outras construções (a roda das primitivas já nasce virada para lá)
    scene.add(g);
    lugares.push({ id: 'loteria', tipo: 'loteria', nome: 'Barraquinha da Sorte',
                   pos: new THREE.Vector3(px, 0, pz), raio: 4.0, node: g, roda: roda });
  }

  /* A SEDE DAS GUILDAS (25/08): o estandarte a leste. O lugar existe ANTES
   * da casa própria — a casa 3D de cada guilda vem com a fase do lobby;
   * hoje a porta abre a ficha da guilda. */
  function montaSede() {
    // afastada do extremo leste do arco: a fortaleza tapava o portal do
    // Coração Partido na câmera padrão (mesma coluna de visada)
    var px = RAIO_MAPA * 0.62, pz = RAIO_MAPA * 0.06;
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
                   pos: new THREE.Vector3(px, 0, pz), raio: 6.5, node: g });
  }

  /* AS CONSTRUÇÕES DA PRAÇA (30/08): a arte do usuário veste os lugares. Os
   * volumes provisórios (caixotes do banco, anel da arena, bandeira da sede)
   * continuam nascendo primeiro — são síncronos e seguram o clique — e a
   * sonda os troca pelo GLB quando `models-praca.js` abrir, preservando o
   * RÓTULO de cada lugar (ele sobe para o teto do prédio novo).
   * A ÁRVORE-MUNDO entra aqui também: grande e em destaque no MEIO do mapa,
   * como pedido — os seis climas dos calabouços nos galhos dela. */
  var construcoesPlantadas = false, construcoesTentativas = 0;
  var ARVORE_ALT = 17;
  function agendaConstrucoes() {
    // 400 pelo mesmo motivo do agendaEnfeites: o relógio virtual do
    // headless queimava o limite antes de o decode real terminar
    if (construcoesPlantadas || construcoesTentativas > 400) return;
    construcoesTentativas++;
    setTimeout(montaConstrucoes, 500);
  }
  function montaConstrucoes() {
    if (construcoesPlantadas || !scene) return;
    var m2 = M2();
    var sonda = null;
    try { sonda = m2 && m2.rawScene && m2.rawScene('praca_arvore'); } catch (e) {}
    if (!sonda) { agendaConstrucoes(); return; }
    construcoesPlantadas = true;

    /* alvoAlt = altura da construção; teto = largura máxima antes de a
     * altura ceder (a ARENA é um coliseu deitado: mais larga que alta por
     * natureza, e é a largura que manda nela). */
    var OBRAS = {
      mercado: { chave: 'praca_mercado', alvoAlt: 6.5, teto: 11 },
      banco:   { chave: 'praca_banco',   alvoAlt: 8.0, teto: 12 },
      // "muito maior, mais imponente" (30/08): o coliseu quase dobrou —
      // é a segunda silhueta do mapa, atrás só da Árvore-Mundo
      arena:   { chave: 'praca_arena',   alvoAlt: 9.5, teto: 24 },
      sede:    { chave: 'praca_sede',    alvoAlt: 9.5, teto: 14 },
      // a barraca do ferreiro veste quando a arte chegar (embute_praca)
      forja:   { chave: 'praca_forja',   alvoAlt: 6.0, teto: 10 },
      // a tenda da sorte (03/09): a arte do dono veste as primitivas
      loteria: { chave: 'praca_loteria', alvoAlt: 5.5, teto: 9 }
    };
    function montaObra(chave, alvoAlt, teto, rotY) {
      var cena = null;
      try { cena = m2.rawScene(chave); } catch (e) {}
      if (!cena) return null;
      var no = cena.clone(true);
      // a ROTAÇÃO entra ANTES da medição: centrar primeiro e girar depois
      // deslocaria o centro junto — o mesmo tombo de eixo de sempre
      no.rotation.y = rotY || 0;
      no.updateMatrixWorld(true);
      var cx = new THREE.Box3().setFromObject(no);
      var alt = cx.max.y - cx.min.y;
      var larg = Math.max(cx.max.x - cx.min.x, cx.max.z - cx.min.z);
      if (!isFinite(alt) || alt < 0.01) return null;
      var k = alvoAlt / alt;
      if (isFinite(larg) && larg > 0.01 && larg * k > teto) k = teto / larg;
      no.scale.multiplyScalar(k);
      no.updateMatrixWorld(true);
      cx = new THREE.Box3().setFromObject(no);
      no.position.y -= cx.min.y;                        // assenta pelo pé
      no.position.x -= (cx.min.x + cx.max.x) / 2;       // e centra na casa
      no.position.z -= (cx.min.z + cx.max.z) / 2;
      return { no: no, alt: cx.max.y - cx.min.y };
    }

    for (var i = 0; i < lugares.length; i++) {
      var lg = lugares[i];
      var obra = OBRAS[lg.tipo];
      if (!obra) continue;
      // o prédio ENCARA o centro da praça, como os portais
      var feito = montaObra(obra.chave, obra.alvoAlt, obra.teto,
                            Math.atan2(-lg.pos.x, -lg.pos.z));
      if (!feito) continue;
      // fora os volumes provisórios; o RÓTULO fica e sobe para o teto
      var rot = null;
      for (var c = lg.node.children.length - 1; c >= 0; c--) {
        var filho = lg.node.children[c];
        if (filho.isSprite) { rot = filho; continue; }
        lg.node.remove(filho);
      }
      lg.node.add(feito.no);
      if (rot) rot.position.y = feito.alt + 1.4;
    }

    // A ÁRVORE-MUNDO: o coração do mapa. Não é `lugar` (não abre painel) —
    // é o marco que amarra os seis climas; o tronco é sólido (TRONCO_RAIO).
    var arv = montaObra('praca_arvore', ARVORE_ALT, 30, 2.4);
    if (arv) scene.add(arv.no);
    // CARGA SOB DEMANDA (10/09): com a praça de pé — construções E enfeites —
    // os calabouços ABERTOS começam a descer em segundo plano, devagar
    talvezPreBusca();
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
    // 400 tentativas, não 40: no headless o relógio é VIRTUAL e as 40
    // queimavam em segundos reais, antes de o decode dos GLBs terminar —
    // a foto saía de praça pelada. Em tempo real nada muda: planta na
    // primeira tentativa em que o kit abriu.
    if (enfeitesPlantados || enfeitesTentativas > 400) return;
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

    /* OS ENFEITES COM ENDEREÇO (10/09, pedido do dono: "tem uns itens
     * aleatórios no mapa, preciso que organize eles"). Nada de anel
     * sorteado: cada peça tem um lugar com sentido —
     *   · seis ÁRVORES: os quatro cantos redondos da praça e as duas que
     *     ladeiam a chegada do herói ao sul, cada uma com um vaso ao pé;
     *   · a BANCADA DO MERCADO: carrinho e canteiro encostados no
     *     Mercadinho; a ESCADA apoiada na Sede; TRONCO e REGADOR na Forja;
     *   · duas REDOMAS simétricas ao pé da Árvore-Mundo.
     * Tudo fora do raio de conversa dos lugares (longeDosLugares). */
    var R = RAIO_MAPA;
    var ARVORES = [[-0.74, -0.74], [0.74, -0.74], [-0.74, 0.74], [0.74, 0.74], [-0.16, 0.92], [0.16, 0.92]];
    ARVORES.forEach(function (a, i) {
      var x = a[0] * R, z = a[1] * R;
      if (!longeDosLugares(x, z)) return;
      planta('jd_estufa_arvore', 1 + (i % 3) * 0.12, x, z, i * 1.1);
      planta('jd_vaso', 1.1, x + Math.sin(i * 1.3) * 1.6, z + Math.cos(i * 1.3) * 1.6, i * 0.7);
    });
    function aoLadoDe(id, dx, dz) {
      for (var j = 0; j < lugares.length; j++) if (lugares[j].id === id) {
        return { x: lugares[j].pos.x + dx, z: lugares[j].pos.z + dz };
      }
      return null;
    }
    var pM = aoLadoDe('mercado', -5.6, 1.2);
    if (pM) { planta('jd_carrinho', 1, pM.x, pM.z, 0.6); planta('jd_canteiro', 1, pM.x + 1.6, pM.z + 1.3, 1.9); }
    var pS = aoLadoDe('sede', 0.8, 6.2);
    if (pS) planta('jd_escada', 1, pS.x, pS.z, 2.4);
    var pF = aoLadoDe('forja', 5.4, 0.6);
    if (pF) { planta('jd_tronco', 1, pF.x, pF.z, 0.9); planta('jd_regador', 1, pF.x + 1.2, pF.z - 1.4, 2.2); }
    planta('jd_redoma', 1, -TRONCO_RAIO - 1.4, 1.2, 0.4);
    planta('jd_redoma', 1, TRONCO_RAIO + 1.4, -1.2, 2.0);

    /* OS CANTINHOS TEMÁTICOS DOS PORTAIS (30/08, pedido: "perto de cada um
     * deles coloque elementos daquele mapa"). Cada portal com catálogo de
     * cenário próprio ganha um pedaço do SEU calabouço ao pé: duas muretas
     * flanqueando, uma peça alta e um enfeite atrás. Hoje só o Jardim
     * (garden) e a Água (cistern) têm catálogo — "os outros deixa sem até
     * eu criar". Determinístico, como tudo na praça. */
    function plantaTema(chave, altAlvo, teto, x, z, rot) {
      var cena = null;
      try { cena = m2.rawScene(chave); } catch (e) {}
      if (!cena) return null;
      var no = cena.clone(true);
      no.rotation.y = rot || 0;
      no.updateMatrixWorld(true);
      var cx = new THREE.Box3().setFromObject(no);
      var alt = cx.max.y - cx.min.y;
      var larg = Math.max(cx.max.x - cx.min.x, cx.max.z - cx.min.z);
      if (!isFinite(alt) || alt <= 0.01) return null;
      var k = altAlvo / alt;
      if (teto && isFinite(larg) && larg > 0.01 && larg * k > teto) k = teto / larg;
      no.scale.multiplyScalar(k);
      no.updateMatrixWorld(true);
      cx = new THREE.Box3().setFromObject(no);
      no.position.set(x - (cx.min.x + cx.max.x) / 2, -cx.min.y,
                      z - (cx.min.z + cx.max.z) / 2);
      scene.add(no);
      return no;
    }
    /* 10/09, pedido do dono: "os itens ao lado dos portais liberados,
     * principalmente os muros, estão muito pequenos; esse cenário ao redor
     * desses portais deve estar mais dentro do tema". Só os portais ABERTOS
     * ganham cantinho — e ele virou um pedaço de verdade do calabouço: três
     * muros altos (3,1 m, o mesmo porte da batalha) num arco atrás do portal,
     * dois pilares flanqueando a boca, duas peças altas nas pontas, dois
     * enfeites e uma peça de chão na frente. Portal fechado fica pelado: o
     * X vermelho já diz tudo. */
    cantinhoFeito = {};
    cantinhoCena = scene;
    plantaCantinhos = function () {
    if (!scene || scene !== cantinhoCena) return;
    lugares.forEach(function (lg, li) {
      if (lg.tipo !== 'portal' || !lg.tema || lg.fechado) return;
      if (cantinhoFeito[lg.id]) return;
      var catT = JOGO.CENARIO && JOGO.CENARIO[lg.tema];
      if (!catT) return;
      // SOB DEMANDA: no jogo servido as peças do calabouço descem DEPOIS da
      // praça (pré-busca). Planta só com todas na mão — meio cantinho não —
      // e o aviso do Models3D2 (aoChegar) chama de novo quando chegarem.
      var precisa = [catT.alto, catT.pilar, catT.sotaque_alto, catT.sotaque, catT.chao];
      var falta = false;
      precisa.forEach(function (lista) {
        (lista || []).forEach(function (ch) { if (!m2.rawScene(ch)) falta = true; });
      });
      if (falta) return;
      cantinhoFeito[lg.id] = true;
      var px2 = lg.pos.x, pz2 = lg.pos.z;
      var r0 = Math.max(0.01, Math.hypot(px2, pz2));
      var ux = px2 / r0, uz = pz2 / r0;      // radial: para FORA do centro
      var tx = -uz, tz = ux;                 // tangencial: ao longo do arco
      var rotT = Math.atan2(tx, tz);         // o muro corre com o arco
      function pega(lista, k) { return (lista && lista.length) ? lista[(li + k) % lista.length] : null; }
      // os três muros do fundo, num arco de 5 m atrás do portal
      [[-5.2, 2.2, rotT + 0.35], [0, 3.4, rotT], [5.2, 2.2, rotT - 0.35]].forEach(function (m, k) {
        var muro = pega(catT.alto, k);
        if (muro) plantaTema(muro, 3.1, 7.0, px2 + tx * m[0] + ux * m[1], pz2 + tz * m[0] + uz * m[1], m[2]);
      });
      // os pilares na boca do portal
      var pilar = pega(catT.pilar, 0);
      if (pilar) {
        plantaTema(pilar, 3.4, 2.0, px2 + tx * 3.0 - ux * 0.6, pz2 + tz * 3.0 - uz * 0.6, rotT);
        plantaTema(pilar, 3.4, 2.0, px2 - tx * 3.0 - ux * 0.6, pz2 - tz * 3.0 - uz * 0.6, rotT);
      }
      // as peças altas nas pontas do arco
      var alto1 = pega(catT.sotaque_alto, 0), alto2 = pega(catT.sotaque_alto, 1);
      if (alto1) plantaTema(alto1, 3.2, 3.0, px2 + tx * 7.6 + ux * 0.4, pz2 + tz * 7.6 + uz * 0.4, li * 1.3);
      if (alto2) plantaTema(alto2, 3.2, 3.0, px2 - tx * 7.6 + ux * 0.4, pz2 - tz * 7.6 + uz * 0.4, li * 2.1);
      // dois enfeites e a peça de chão na frente, fora da pista do portal
      var enf1 = pega(catT.sotaque, 0), enf2 = pega(catT.sotaque, 2), chaoP = pega(catT.chao, 0);
      if (enf1) plantaTema(enf1, 1.6, 2.6, px2 + tx * 4.6 - ux * 2.6, pz2 + tz * 4.6 - uz * 2.6, li * 0.8);
      if (enf2) plantaTema(enf2, 1.6, 2.6, px2 - tx * 4.6 - ux * 2.6, pz2 - tz * 4.6 - uz * 2.6, li * 1.7);
      if (chaoP) plantaTema(chaoP, 0.7, 2.4, px2 + tx * 1.2 - ux * 4.4, pz2 + tz * 1.2 - uz * 4.4, li * 0.5);
    });
    };
    plantaCantinhos();
    if (!ouveModelos && m2.aoChegar) {
      ouveModelos = true;
      m2.aoChegar(function () { try { plantaCantinhos(); } catch (eC) {} });
    }
    talvezPreBusca();
  }
  // os cantinhos que esperam peça (SOB DEMANDA): a cena da praça em que
  // nasceram, os portais já plantados e quem replanta quando modelo chega
  var cantinhoFeito = {}, cantinhoCena = null, ouveModelos = false;
  var plantaCantinhos = function () {};
  /* A pré-busca dos calabouços abertos (JOGO.Bundle.preBusca) só liga com o
   * Acampamento PRONTO: construções e enfeites plantados. Liga uma vez só. */
  function talvezPreBusca() {
    if (!construcoesPlantadas || !enfeitesPlantados) return;
    try { if (JOGO.Bundle && JOGO.Bundle.preBusca) JOGO.Bundle.preBusca(); } catch (eB) {}
  }

  // ------------------------------------------------------------------ o herói
  function montaHeroi(classId) {
    var m2 = M2();
    if (!m2) return;
    var node = null;
    try { node = m2.unit(classId || 'sumo', { classId: classId || 'sumo' }); } catch (e) {}
    if (!node) return;
    node.position.set(0, 0, raioAtual() * 0.35);
    scene.add(node);
    heroi = { node: node, alvo: null, andando: false };
    try { node.userData.play('idle', { fade: 0 }); } catch (e) {}
    if (nomeJogador) pendura(nomeJogador, tituloJogador, brasaDoHeroi, guildaDoHeroi);
    esperaCorpo(heroi, classId || 'sumo');
  }

  /* SOB DEMANDA (conserto 10/09): no jogo servido o corpo PRÓPRIO de uma
   * fusão ('fus:a+b' — o avatar, o fantasma que anda de fusão) não desce no
   * boot. O corpo nasce com a fusão composta (visível) e pede o próprio;
   * quando o Models3D2 o abre (aoChegar), troca na hora, no mesmo lugar.
   * Em casa (file://) tudo já está aberto e nada disto acontece. */
  var ouveCorpos = false;
  function esperaCorpo(corpo, classId) {
    var m2 = M2(), Bd = JOGO.Bundle;
    var fk = (Bd && Bd.corpoDe) ? Bd.corpoDe(classId) : null;
    corpo.esperaCorpo = (fk && m2 && !m2.hasModel(fk)) ? fk : null;
    if (!corpo.esperaCorpo) return;
    if (!ouveCorpos && m2.aoChegar) {
      ouveCorpos = true;
      m2.aoChegar(function () { try { trocaCorposQueChegaram(); } catch (eT) {} });
    }
    try { if (Bd.pede) Bd.pede([fk]); } catch (eP) {}
  }
  function trocaCorposQueChegaram() {
    var m2 = M2();
    if (!m2 || !scene) return;
    if (heroi && heroi.esperaCorpo && m2.hasModel(heroi.esperaCorpo)) remontaHeroi();
    for (var id in fantasmas) {
      if (!fantasmas.hasOwnProperty(id)) continue;
      var reg = fantasmas[id], c = reg.corpo;
      if (!c || !c.esperaCorpo || !m2.hasModel(c.esperaCorpo)) continue;
      var alvoF = c.alvo, ryF = c.node.rotation.y;
      desmaterializa(reg);
      if (materializa(reg) && reg.corpo) {
        reg.corpo.node.rotation.y = ryF;
        if (alvoF) mandaAndar(reg.corpo, alvoF.x, alvoF.z);
      }
    }
  }
  /* A COROA SOB DEMANDA (11/09, "coroas em 3d girando sumiu"). No jogo servido
   * as dez coroas não descem no boot (grupo 'coroas' do manifesto), e a
   * pré-busca as deixava por ÚLTIMO, depois dos calabouços: a plaquinha montava
   * antes, com o bilhete PNG, e nunca mais trocava. Agora a coroa que falta é
   * pedida na hora (Bundle.pede: baixa e abre já, ~0,5 MB) e, quando o
   * Models3D2 a abre (aoChegar), o bilhete vira a coroa 3D que gira, no mesmo
   * lugar — no herói e nos fantasmas. Em casa (file://) as dez já estão
   * abertas e nada disto acontece. */
  var ouveCoroas = false;
  function esperaCoroa(nivel) {
    var m2 = M2(), Bd = JOGO.Bundle;
    if (!m2 || !m2.aoChegar) return;
    if (!ouveCoroas) {
      ouveCoroas = true;
      m2.aoChegar(function () { try { trocaCoroasQueChegaram(); } catch (eT) {} });
    }
    try { if (Bd && Bd.pede) Bd.pede(['coroa_pvp_n' + nivel]); } catch (eP) {}
  }
  function trocaCoroa(corpo) {
    var e = corpo && corpo.coroaEspera;
    if (!e) return;
    var coroa = modeloCoroa(e.nivel, e.tam);
    if (!coroa) return;                   // ainda não abriu: a próxima leva tenta de novo
    if (corpo.coroaPvp) {
      corpo.node.remove(corpo.coroaPvp);
      // a textura do bilhete é do cache (texturaCoroa): só a geometria e o material saem
      try { corpo.coroaPvp.geometry.dispose(); corpo.coroaPvp.material.dispose(); } catch (e2) {}
    }
    coroa.position.y = e.base3d;
    coroa.userData.baseY = e.base3d;
    coroa.userData.fase = Math.random() * 9;
    coroa.userData.gira3d = true;
    corpo.node.add(coroa);
    corpo.coroaPvp = coroa;
    corpo.coroaEspera = null;
  }
  function trocaCoroasQueChegaram() {
    if (!scene) return;
    trocaCoroa(heroi);
    for (var id in fantasmas) {
      if (fantasmas.hasOwnProperty(id) && fantasmas[id].corpo) trocaCoroa(fantasmas[id].corpo);
    }
  }
  /* O herói troca de corpo sem sair do lugar: posição, rumo, a caminhada
   * (o `aoChegar` dela mora fora do herói e continua valendo), a aura, as
   * placas (montaHeroi pendura de novo) e o bicho. */
  function remontaHeroi() {
    var velho = heroi;
    if (!velho) return;
    var p = velho.node.position.clone(), ry = velho.node.rotation.y;
    scene.remove(velho.node);
    heroi = null;
    montaHeroi(velho.classId);
    if (!heroi) { heroi = velho; scene.add(velho.node); return; }
    heroi.classId = velho.classId;
    heroi.node.position.copy(p);
    heroi.node.rotation.y = ry;
    if (velho.aura) acendeAura(heroi, true);
    if (velho.alvo) mandaAndar(heroi, velho.alvo.x, velho.alvo.z);
    sincronizaBicho();
  }

  // ------------------------------------------------------------------ o bicho
  /* O PET DO AVATAR anda ao lado do dono (03/09: "ele deve no mapa geral andar
   * ao lado do dono sempre acompanhando"). É um corpo como outro qualquer —
   * anda pelo mesmo andaCorpo — com um alvo que é o OMBRO do herói: um ponto
   * atrás e à direita, que gira com ele. Perto do ponto ele para e respira;
   * longe, anda; muito longe (o dono correu), corre. Pet sem clipe de corrida
   * (os seis antigos não trouxeram) anda em velocidade de corrida. */
  var BICHO_LADO = 1.35, BICHO_ANG = 2.35, BICHO_FOLGA = 0.9;
  function petDoAvatar(classId) {
    var P = JOGO.Progress;
    if (!P || !P.hero) return null;
    var h = null;
    try { h = P.hero(classId || (heroi && heroi.classId) || 'sumo'); } catch (e) {}
    return (h && h.pet) || null;
  }
  function ombroDoDono() {
    var hp = heroi.node.position, a = heroi.node.rotation.y + BICHO_ANG;
    return { x: hp.x + Math.sin(a) * BICHO_LADO, z: hp.z + Math.cos(a) * BICHO_LADO };
  }
  function montaBicho(petId) {
    if (bicho) { scene.remove(bicho.node); bicho = null; }
    if (!petId || !heroi) return;
    var m2 = M2();
    if (!m2) return;
    var node = null;
    try { node = m2.unit(petId, { kind: 'pet' }); } catch (e) {}
    if (!node) return;
    var alvo = ombroDoDono();
    node.position.set(alvo.x, 0, alvo.z);
    node.rotation.y = heroi.node.rotation.y;
    scene.add(node);
    var semCorrida = true;
    try {
      var cr = node.userData.clipFor('run'), ci = node.userData.clipFor('idle');
      semCorrida = !cr || cr === ci;
    } catch (e) {}
    bicho = { node: node, alvo: null, andando: false, petId: petId, semCorrida: semCorrida };
    try { node.userData.play('idle', { fade: 0 }); } catch (e) {}
  }
  /* O bicho segue o que a ficha diz: vestiu/soltou pet no inventário, o corpo
   * da praça troca sozinho (chamado ao entrar e a cada reavaliação do teto). */
  function sincronizaBicho() {
    if (!heroi) return;
    var pid = petDoAvatar(heroi.classId);
    if ((bicho ? bicho.petId : null) !== pid) montaBicho(pid);
  }
  function segueDono(dt) {
    if (!bicho || !heroi) return;
    var alvo = ombroDoDono();
    var p = bicho.node.position;
    var d = Math.hypot(alvo.x - p.x, alvo.z - p.z);
    // parte quando o ombro fugiu; enquanto anda, persegue o ombro que se move
    if (d > BICHO_FOLGA || (bicho.alvo && d > 0.25)) mandaAndar(bicho, alvo.x, alvo.z);
    andaCorpo(bicho, dt);
    try { if (bicho.node.userData.mixer) bicho.node.userData.mixer.update(dt); } catch (e) {}
  }

  /* O NOME ACIMA DA CABEÇA — a primeira marca de jogo online que o corpo
   * carrega ("como o jogo será online, o nome do usuario deve aparecer acima
   * da cabeça"). A plaquinha é FILHA do nó do herói: anda, corre e troca de
   * corpo junto, sem uma linha no tique — e sprite sempre encara a câmera.
   * Os fantasmas da rede vão pendurar a deles por este mesmo caminho. */
  /* Pendura nome (e título, e a GUILDA) em QUALQUER corpo — herói ou
   * fantasma. Desde 30/08 o NOME vem numa PLACA (retângulo com filete
   * dourado, pedido do dono) e a guilda — emblema + nome — numa placa menor
   * ACIMA dele. A coroa do ranking flutua acima de tudo. */
  /* 11/09: `grupo` ('membro' | 'lider' | null) — o parceiro do meu grupo leva
   * a placa de borda dourada grossa, com ◆ (ou ♛ se lidera) antes do nome. */
  function penduraEm(corpo, nome, titulo, brasaTier, guilda, grupo) {
    if (!corpo || !THREE) return;
    ['plaquinha', 'plaquinhaTitulo', 'plaquinhaGuilda'].forEach(function (campo) {
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
    corpo.coroaEspera = null;
    if (!nome) return;
    var alto = (corpo.node.userData.height || 2.1);
    var temGuilda = !!(guilda && guilda.nome);
    var sp = grupo
      ? rotulo((grupo === 'lider' ? '♛ ' : '◆ ') + nome, '#ffe7a6', 0.42,
               { placa: true, borda: '#ffcf3f', traco: 9, fundo: 'rgba(44,32,8,0.92)' })
      : rotulo(nome, '#f0ead8', 0.42, { placa: true });
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
    // A PLACA DA GUILDA: emblema + nome, acima do nome do personagem — a
    // bandeira que o corpo carrega ("com seu logo da guild e nome da guild
    // em cima"). Placa própria, um degrau menor que a do nome.
    var altoGuilda = 0;
    if (temGuilda) {
      var gtx = (guilda.emblema || '⚑') + ' ' + guilda.nome;
      var sg = rotulo(gtx, '#ffd98a', 0.30, { placa: true, borda: '#8a6f2e' });
      sg.position.y = alto + (titulo ? 0.66 : 0.5) + 0.52;
      corpo.node.add(sg);
      corpo.plaquinhaGuilda = sg;
      altoGuilda = 0.52;
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
        // a coroa sobe um degrau quando há placa de guilda no caminho
        var baseK3 = alto + (titulo ? 0.66 : 0.5) + 0.34 + altoGuilda;
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
          var baseK = alto + (titulo ? 0.66 : 0.5) + 0.34 + altoGuilda + tamK * 0.45;
          bilhete.position.y = baseK;
          bilhete.userData.baseY = baseK;
          bilhete.userData.fase = Math.random() * 9;
          corpo.node.add(bilhete);
          corpo.coroaPvp = bilhete;
        }
        // 11/09: no jogo servido a coroa 3D pode não ter descido ainda — o
        // bilhete segura o lugar e vira a 3D quando ela abrir (esperaCoroa)
        corpo.coroaEspera = { nivel: brasaTier.nivel, tam: tamK,
                              base3d: alto + (titulo ? 0.66 : 0.5) + 0.34 + altoGuilda };
        esperaCoroa(brasaTier.nivel);
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
  function pendura(nome, titulo, brasaTier, guilda) {
    penduraEm(heroi, nome, titulo, brasaTier, guilda);
  }

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
    // o TRONCO da Árvore-Mundo é sólido: passo que entra nele é empurrado
    // radialmente para a borda — na prática o corpo DESLIZA contornando o
    // tronco, sem travar (o alvo continua o mesmo e o próximo passo tenta
    // de novo, um pouco mais adiante na tangente).
    var dTr = Math.hypot(p.x, p.z);
    if (!salaAtual && dTr < TRONCO_RAIO && dTr > 0.01) {
      var kTr = TRONCO_RAIO / dTr;
      p.x *= kTr; p.z *= kTr;
    }
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
    var clipe = (corre && !corpo.semCorrida) ? 'run' : 'walk';
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
      segueDono(dt);                 // o bicho atrás do ombro do dono

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
      if (tAvalia > 1.2) { tAvalia = 0; avaliaCorpos(); sincronizaBicho(); }

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
    var no = raycaster.intersectObject(chao, true);
    if (no && no.length) {
      var p = no[0].point;
      // não deixa sair do mapa — o clamp virou POR EIXO com a praça quadrada
      // (o radial de antes cortava os cantos, que agora são chão de verdade)
      dentroDoMapa(p, 0.94);
      // e o tronco da Árvore-Mundo não é destino: alvo dentro dele é
      // empurrado para a borda — o resto do desvio acontece no passo
      // (na antessala não há árvore)
      var dT = Math.hypot(p.x, p.z);
      if (!salaAtual && dT < TRONCO_RAIO + 0.4) {
        var kT = (TRONCO_RAIO + 0.4) / Math.max(0.01, dT);
        p.x *= kT; p.z *= kT;
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

  Hub.entrar = function (cont, classId, opts) {
    THREE = window.THREE;
    if (!THREE) return false;
    container = cont;
    // A ANTESSALA (03/09): a cena é a da praça ou a de UMA sala do calabouço;
    // trocar de sala (ou voltar à praça) refaz a cena inteira
    var salaNova = (opts && opts.sala) ? chaveSala(opts.sala) : null;
    var trocouSala = salaNova !== salaAtual;
    var jaTinha = !!renderer;
    salaAtual = salaNova;
    salaCfg = (opts && opts.sala) || null;
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
    if (jaTinha && trocouSala) refazCena();
    if (!heroi) montaHeroi(classId);
    else if (classId && heroi.classId !== classId) {
      // trocou de herói entre visitas: o corpo acompanha
      scene.remove(heroi.node); heroi = null; montaHeroi(classId);
    }
    if (heroi) heroi.classId = classId;
    sincronizaBicho();
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
   * batismo): ela empurra o nome para cá. Vazio tira a plaquinha.
   * ARGUMENTO `undefined` PRESERVA o que já está pendurado (30/08): a ficha
   * de missões chamava nomeia(nome, titulo) e APAGAVA a coroa sem querer, e
   * a guilda carrega numa promise que chega depois do resto — cada pedaço
   * agora atualiza só o que trouxe. `null` explícito continua limpando. */
  var brasaDoHeroi = null;         // o tier da coroa ({nivel, tam, nome})
  var guildaDoHeroi = null;        // a placa da guilda ({nome, emblema})
  Hub.nomeia = function (nome, titulo, brasaTier, guilda) {
    if (nome !== undefined) nomeJogador = String(nome || '').trim() || null;
    if (titulo !== undefined) tituloJogador = String(titulo || '').trim() || null;
    if (brasaTier !== undefined) brasaDoHeroi = brasaTier || null;
    if (guilda !== undefined) guildaDoHeroi = guilda || null;
    pendura(nomeJogador, tituloJogador, brasaDoHeroi, guildaDoHeroi);
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
  /* A PLACA DE GRUPO (11/09): o parceiro do meu grupo ganha borda dourada e
   * ◆ — ou ♛, se é quem lidera. O js/core/grupo.js chama ao formar, ao passar
   * a liderança e ao desfazer (papel null). Fantasma sem corpo (acima do teto
   * de 20) guarda a marca para quando materializar. */
  var marcasGrupo = {};
  Hub.marcaGrupo = function (id, papel) {
    if (!id) return false;
    if (papel === 'lider' || papel === 'membro') marcasGrupo[id] = papel;
    else delete marcasGrupo[id];
    var reg = fantasmas[id];
    if (reg && reg.corpo) {
      var pf = reg.perfil || {};
      penduraEm(reg.corpo, pf.nome || '?', pf.titulo || '', reg.tierF || null, reg.guildaF || null,
                marcasGrupo[id] || null);
    }
    return true;
  };
  Hub._marcaGrupo = function (id) { return marcasGrupo[id] || null; };   // provas
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
    // a GUILDA do fantasma já viaja dentro do resumo do perfil (a Rede não
    // precisou mudar) — a placa dele nasce igual à do herói
    var guildaF = (perfil && perfil.resumo && perfil.resumo.guilda) || null;
    reg.tierF = tierF;
    reg.guildaF = guildaF;
    penduraEm(corpo, (perfil && perfil.nome) || '?', (perfil && perfil.titulo) || '', tierF, guildaF,
              marcasGrupo[reg.id] || null);
    if (perfil && perfil.aura) acendeAura(corpo, true);   // a vaidade é pública
    esperaCorpo(corpo, classe);           // fusão: o corpo próprio vem vindo
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
    var reg = { id: id, perfil: perfil || {},
                x: (perfil && perfil.x) || 0,
                z: (perfil && perfil.z) || raioAtual() * 0.35,
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
  Hub.salaAtual = function () { return salaAtual; };
  Hub._corposAtivos = function () {              // painel de teste e provas
    var n = 0;
    for (var k in fantasmas) {
      if (fantasmas.hasOwnProperty(k) && fantasmas[k].corpo) n++;
    }
    return n;
  };
  /* o modelo que o corpo de um fantasma veste (provas) */
  Hub._corpoFantasma = function (id) {
    var r = fantasmas[id], u = r && r.corpo && r.corpo.node.userData;
    return (u && u.look && u.look.model) || null;
  };

  Hub.irPara = function (x, z) {
    if (!heroi || !THREE) return false;
    andarAte(new THREE.Vector3(x, 0, z), null);
    return true;
  };
  /* câmera por fora, SÓ para as páginas de prova enquadrarem a foto — o
   * jogador continua com a órbita de arrastar/roda de sempre */
  Hub._cam = function (o) {
    if (!o) return;
    if (o.dist != null) cam.dist = Math.max(cam.minDist, Math.min(cam.maxDist, o.dist));
    if (o.tilt != null) cam.tilt = Math.max(cam.minTilt, Math.min(cam.maxTilt, o.tilt));
    if (o.ang != null) cam.ang = o.ang;
  };

  Hub._estado = function () {
    return {
      pos: heroi ? { x: +heroi.node.position.x.toFixed(2),
                     z: +heroi.node.position.z.toFixed(2) } : null,
      andando: heroi ? !!heroi.andando : null,
      bicho: bicho ? { id: bicho.petId, x: +bicho.node.position.x.toFixed(2),
                       z: +bicho.node.position.z.toFixed(2), andando: !!bicho.andando,
                       clipe: bicho.clipe || 'idle' } : null,
      sala: salaAtual,                    // 03/09: null = praça
      nome: nomeJogador,
      titulo: tituloJogador,
      coroaVisivel: !!(heroi && heroi.coroaPvp),
      coroaNivel: brasaDoHeroi ? (brasaDoHeroi.nivel || null) : null,
      // 11/09: a coroa é o modelo 3D que gira (e não o bilhete PNG de reserva)?
      coroa3d: !!(heroi && heroi.coroaPvp && heroi.coroaPvp.userData && heroi.coroaPvp.userData.gira3d),
      coroaGiro: (heroi && heroi.coroaPvp) ? +heroi.coroaPvp.rotation.y.toFixed(3) : null,
      corpo: (heroi && heroi.node.userData && heroi.node.userData.look &&
              heroi.node.userData.look.model) || null,
      plaquinha: !!(heroi && heroi.plaquinha),
      plaquinhaTitulo: !!(heroi && heroi.plaquinhaTitulo),
      plaquinhaGuilda: !!(heroi && heroi.plaquinhaGuilda),
      construcoes: !!construcoesPlantadas,
      enfeites: !!enfeitesPlantados,
      clipe: heroi ? (heroi.clipe || 'idle') : null,
      vel: heroi ? (heroi.vel || 0) : null,
      cam: { ang: +cam.ang.toFixed(3), tilt: +cam.tilt.toFixed(3), dist: +cam.dist.toFixed(2) }
    };
  };
})();
