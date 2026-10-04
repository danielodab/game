// O Santuário dos Elementos na tela — o desenho das quatro regras (dono: render).
var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

/* O QUE ISTO É (03/10)
 * ============
 * A regra do calabouço especial 'elementsanctum' mora em js/core/santuario.js e o
 * dado em js/core/data/santuario.js. AQUI mora só o que a tela mostra dela — e
 * tudo o que a regra tem de dizer ao jogador ANTES de valer:
 *
 *   FOGO   o ESCURO de verdade: a casa que o meu lado não vê fica preta (um véu
 *          no chão e um volume de breu por cima), a que ele vê fica em penumbra,
 *          e a que um braseiro aceso clareia fica com luz quente. O braseiro
 *          ganha chama, halo e uma luz pontual quando acende. (Quem some no
 *          breu é o Game que decide: Game.ocultoNaTela.)
 *   ÁGUA   a lâmina d'água nas casas alagadas, os veios correndo para onde a
 *          correnteza vai levar no fim da rodada, o jorro na bica que verte e o
 *          sinal na bica que vai verter na rodada seguinte; a ponte por cima.
 *   TERRA  o soquete no chão, o bloco do pilar que sobe e desce (animado), e o
 *          AVISO uma rodada antes: a casa pintada e a seta ▲ (vai subir) ou ▼
 *          (vai descer); o pilar que espera alguém sair de cima pisca.
 *   AR     as setas no chão da zona do vento apontando para onde a rajada
 *          sopra, o cata-vento girando para ela (e a seta-fantasma da direção
 *          da rodada seguinte), o respiro com a coluna de vento e o aro das
 *          casas calmas.
 *   ALTAR  o Altar dos Quatro no meio da última sala.
 *
 * AS PEÇAS DE ARTE. Cada peça de mecânica tem a chave do kit do dono
 * (JOGO.CENARIO['santuario'], prefixo el_: el_braseiro, el_bica, el_cata_vento,
 * el_soquete, el_poca, el_ponte, el_respiro, el_pilar_vivo, el_marco_altar).
 * Com o modelo na página, a peça veste a arte; sem ele, uma primitiva segura o
 * lugar — a regra se lê igual nos dois casos, e quando o modelo chega (o kit
 * desce na hora da descida) a sala se refaz sozinha. Fogo, água correndo,
 * vento e avisos são sempre do código: a arte vem parada e apagada de propósito.
 *
 * O TABULEIRO NÃO VESTE AS CASAS DE MECÂNICA. `casas(st)` diz ao renderizador
 * quais casas são do Santuário (braseiro, respiro, bica, cata-vento, altar,
 * pilar): para o DESENHO elas são chão liso, e a peça de cima é daqui. Sem
 * isto o montador punha um muro de cenário em cima do pilar vivo (que sobe e
 * desce) e uma mureta qualquer no lugar do braseiro.
 *
 * PEÇA DE MECÂNICA NÃO É ENFEITE. O catálogo do kit lista braseiro, respiro,
 * bica e cata-vento também como `sotaque` — o montador os espalharia pelas
 * fileiras de muro, e um braseiro que não acende ao lado de um que acende é
 * mentira de tabuleiro. `preparaCatalogo` os tira das listas de enfeite: no
 * Santuário cada um só aparece onde a regra o põe.
 *
 * Nada aqui muda regra: lê o estado (Santuario.info) e desenha. As provas
 * CONTAM o que foi desenhado (Santuario3D.naTela) em vez de olhar foto. */
(function () {
  'use strict';
  if (typeof THREE === 'undefined') return;

  var S3 = {};
  JOGO.Santuario3D = S3;

  function R() { return JOGO.Renderer || null; }
  function Mo() { return JOGO.Models3D2 || null; }
  function Sa() { return JOGO.Santuario || null; }
  function En() { return JOGO.Engine || null; }
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function cor(c) { var m = Mo(); return (m && m.col3) ? m.col3(c) : new THREE.Color(c); }

  var CELL = 2.0, WALL_H = CELL * 1.55;
  var VETOR = { n: [0, -1], s: [0, 1], l: [1, 0], o: [-1, 0] };
  var COR = { fogo: '#ff8c3a', agua: '#57c8ec', terra: '#9bd06a', ar: '#c8b6ff' };
  var DIRS = [[0, -1], [0, 1], [-1, 0], [1, 0]];

  /* AS CHAVES DO KIT e a medida de cada peça no tabuleiro (metros; a casa tem 2,0 e o muro 3,1):
   *   alt          altura-alvo, com `teto` de largura (a peça nunca passa da casa dela)
   *   larg         o maior lado horizontal; `altMax` achata o que ficaria alto demais para pisar
   *   estica       a caixa cheia (largura, altura E fundo): o pilar vivo tem de tapar a casa inteira
   * As alturas do braseiro e do respiro são as do briefing (docs/PROMPTS_LANCAMENTO.md, seção 4):
   * o montador de cenário poria todo `sotaque` a 0,95 m. */
  var PECA = {
    braseiro: { chave: 'el_braseiro', alt: 1.4, teto: CELL * 0.8 },
    respiro:  { chave: 'el_respiro', alt: 1.0, teto: CELL * 0.85 },
    bica:     { chave: 'el_bica', alt: WALL_H, teto: CELL * 0.95 },
    cata:     { chave: 'el_cata_vento', alt: WALL_H, teto: CELL * 0.95 },
    soquete:  { chave: 'el_soquete', larg: CELL * 0.98, altMax: 0.12 },
    ponte:    { chave: 'el_ponte', larg: CELL * 1.0, altMax: 0.18 },
    poca:     { chave: 'el_poca', larg: CELL * 0.98, altMax: 0.10 },
    pilar:    { chave: 'el_pilar_vivo', larg: CELL * 0.96, alt: WALL_H, estica: true },
    altar:    { chave: 'el_marco_altar', alt: WALL_H, teto: CELL * 2.9 }
  };
  S3.PECA = PECA;
  var MECANICA_PADRAO = ['el_braseiro', 'el_pilar_vivo', 'el_soquete', 'el_respiro', 'el_cata_vento',
                         'el_bica', 'el_poca', 'el_ponte'];
  // quantas poças do dono entram numa sala (cada modelo são milhares de triângulos: a lâmina d'água é do código)
  var POCAS_MAX = 6;
  // quantas luzes pontuais de braseiro (FIXAS por sala: mudar o número de luzes no meio da luta recompila o shader)
  function luzesMax() { return (JOGO.Mobile && JOGO.Mobile.economico && JOGO.Mobile.economico()) ? 0 : 4; }
  function comVolume() { return !(JOGO.Mobile && JOGO.Mobile.economico && JOGO.Mobile.economico()); }

  // ================================================================ A SALA
  function calabouco(st) {
    var e = En();
    try { return (e && e.calabouco) ? e.calabouco(st.dungeonId) : null; } catch (err) { return null; }
  }
  function salaDe(st) {
    var dg = st ? calabouco(st) : null;
    return (dg && dg.rooms) ? dg.rooms[st.roomIndex] : null;
  }
  function plantaDe(st) {
    var room = salaDe(st), s = Sa();
    return (room && room.santuario && s && s.leSala) ? s.leSala(room) : null;
  }
  function meuLado() {
    var g = JOGO.Game;
    try { return (g && g.meuLado) ? g.meuLado() : 'player'; } catch (e) { return 'player'; }
  }

  /* AS CASAS QUE O TABULEIRO DEIXA LISAS (ver o cabeçalho): { w, h, mapa } com 1 na casa de mecânica.
   * Guardada por sala; o renderizador pergunta a cada casa de cada montagem. */
  var casasCache = { de: null, v: null };
  S3.casas = function (st) {
    if (!st || !st.santuario) return null;
    var room = salaDe(st);
    if (!room || !room.santuario) return null;
    if (casasCache.de === room.santuario) return casasCache.v;
    var p = plantaDe(st);
    if (!p) return null;
    var mapa = new Uint8Array(p.w * p.h);
    function marca(l) { for (var i = 0; i < l.length; i++) mapa[l[i].y * p.w + l[i].x] = 1; }
    marca(p.braseiros); marca(p.respiros); marca(p.bicas); marca(p.cataVentos); marca(p.altar); marca(p.pilares);
    casasCache = { de: room.santuario, v: { w: p.w, h: p.h, mapa: mapa } };
    return casasCache.v;
  };

  /* O CATÁLOGO antes de a sala montar: (1) sem kit próprio, o tema veste o de reserva do calabouço
   * (`temaReserva`: o do Coração Partido) — uma CÓPIA, marcada, para o kit de verdade entrar por cima
   * quando existir; (2) as peças de mecânica saem das listas de enfeite (ver o cabeçalho). */
  S3.preparaCatalogo = function (st) {
    var dg = st ? calabouco(st) : null, room = salaDe(st);
    if (!dg || !room || !room.santuario) return null;
    var tema = room.sceneryTheme || dg.theme;
    var C = JOGO.CENARIO = JOGO.CENARIO || {};
    if (!C[tema] && dg.temaReserva && C[dg.temaReserva]) {
      var copia = {}, de = C[dg.temaReserva];
      for (var k in de) if (own(de, k)) copia[k] = Array.isArray(de[k]) ? de[k].slice() : de[k];
      copia.deReserva = dg.temaReserva;
      C[tema] = copia;
    }
    var cat = C[tema];
    if (cat && !cat.semMecanicaNoEnfeite) {
      var mec = {};
      (Array.isArray(cat.mecanica) ? cat.mecanica : MECANICA_PADRAO).forEach(function (c) { mec[c] = true; });
      var limpa = function (o) {
        ['sotaque', 'sotaque_alto', 'chao'].forEach(function (papel) {
          if (o && Array.isArray(o[papel])) o[papel] = o[papel].filter(function (c) { return !mec[c]; });
        });
      };
      limpa(cat);
      if (cat.regioes) for (var r in cat.regioes) if (own(cat.regioes, r)) limpa(cat.regioes[r]);
      cat.semMecanicaNoEnfeite = true;
    }
    return cat || null;
  };

  /* O AMBIENTE (céu, névoa, luz) da sala. O tema 'santuario' tem a luz NEUTRA de templo — as quatro
   * pedras do kit não são tingidas pelo jogo, e uma luz com cor própria puxaria as quatro para ela.
   * A Câmara Apagada tem a dela: quase sem luz geral, para o braseiro aceso ser o que ilumina. */
  var AMBIENTE = {
    'santuario':      { fog: '#2b2d38', sky: '#c6ccdc', gnd: '#2a2a36', sun: '#fff3dc', sunI: 1.06, hemiI: 0.84, rim: '#e6e0ff' },
    'santuario:fogo': { fog: '#0c0b12', sky: '#7d7f98', gnd: '#15141c', sun: '#ffe0b4', sunI: 0.42, hemiI: 0.40, rim: '#ff9a5a' }
  };
  S3.ambiente = function (st, tema) {
    var r = R(), room = salaDe(st);
    if (!r || !r.poeAmbiente || !room || !room.santuario) return null;
    S3.preparaCatalogo(st);
    r.poeAmbiente('santuario', AMBIENTE['santuario'], true);         // só se o tema ainda não tem o dele
    r.poeAmbiente('santuario:fogo', AMBIENTE['santuario:fogo']);
    return room.santuario.regra === 'fogo' ? 'santuario:fogo' : (tema || 'santuario');
  };

  // ================================================================ AS PEÇAS
  var proprios = [];             // geometrias, materiais e texturas FEITOS aqui (os do kit não são nossos)
  function meu(o) { proprios.push(o); return o; }
  function mat(o) { return meu(new THREE.MeshStandardMaterial(o)); }
  function matLuz(c, op, aditivo) {
    return meu(new THREE.MeshBasicMaterial({ color: cor(c), transparent: true, opacity: op, depthWrite: false,
      side: THREE.DoubleSide, blending: aditivo ? THREE.AdditiveBlending : THREE.NormalBlending }));
  }
  function malha(g, geo, m, x, y, z) {
    var me = new THREE.Mesh(meu(geo), m);
    me.position.set(x || 0, y || 0, z || 0);
    g.add(me);
    return me;
  }

  /* AS PRIMITIVAS: o que segura o lugar de cada peça enquanto a arte não está na página. Já nascem
   * na medida do tabuleiro (base em y = 0, centradas), com a frente para +z. */
  function primitiva(tipo) {
    var g = new THREE.Group();
    var ferro = mat({ color: cor('#2c2a30'), roughness: 0.6, metalness: 0.55 });
    var pedra = mat({ color: cor('#6f6a7a'), roughness: 0.92 });
    var bronze = mat({ color: cor('#b58a4a'), roughness: 0.45, metalness: 0.6 });
    var i;
    if (tipo === 'braseiro') {
      for (i = 0; i < 3; i++) {
        var a = i * Math.PI * 2 / 3;
        var perna = malha(g, new THREE.CylinderGeometry(0.045, 0.06, 1.05, 6), ferro, Math.cos(a) * 0.3, 0.52, Math.sin(a) * 0.3);
        perna.rotation.z = Math.cos(a) * 0.3; perna.rotation.x = -Math.sin(a) * 0.3;
      }
      malha(g, new THREE.CylinderGeometry(0.52, 0.3, 0.34, 14), ferro, 0, 1.2, 0);
      malha(g, new THREE.CylinderGeometry(0.44, 0.44, 0.08, 14), mat({ color: cor('#1a1614'), roughness: 1 }), 0, 1.36, 0);
    } else if (tipo === 'respiro') {
      malha(g, new THREE.CylinderGeometry(0.62, 0.7, 0.92, 16), mat({ color: cor('#cfc8d6'), roughness: 0.85 }), 0, 0.46, 0);
      malha(g, new THREE.TorusGeometry(0.6, 0.06, 6, 20), bronze, 0, 0.94, 0).rotation.x = Math.PI / 2;
      malha(g, new THREE.CylinderGeometry(0.42, 0.42, 0.04, 16), mat({ color: cor('#15131a'), roughness: 1 }), 0, 0.95, 0);
    } else if (tipo === 'bica') {
      malha(g, new THREE.BoxGeometry(0.9, WALL_H, 0.6), mat({ color: cor('#5f7f96'), roughness: 0.9 }), 0, WALL_H / 2, -0.1);
      malha(g, new THREE.BoxGeometry(0.5, 0.42, 0.62), mat({ color: cor('#4f9a8a'), roughness: 0.5, metalness: 0.5 }), 0, WALL_H * 0.66, 0.38);
      malha(g, new THREE.BoxGeometry(0.26, 0.16, 0.1), mat({ color: cor('#0c1418'), roughness: 1 }), 0, WALL_H * 0.63, 0.7);
    } else if (tipo === 'cata') {
      malha(g, new THREE.CylinderGeometry(0.55, 0.62, 0.3, 16), pedra, 0, 0.15, 0);
      malha(g, new THREE.CylinderGeometry(0.06, 0.08, WALL_H - 0.5, 8), bronze, 0, 0.3 + (WALL_H - 0.5) / 2, 0);
      // a seta: aponta para +x (é o que `frenteDaSeta` mede num modelo)
      malha(g, new THREE.BoxGeometry(1.3, 0.1, 0.06), bronze, -0.05, WALL_H - 0.3, 0);
      var ponta = malha(g, new THREE.ConeGeometry(0.2, 0.42, 4), bronze, 0.78, WALL_H - 0.3, 0);
      ponta.rotation.z = -Math.PI / 2;
      malha(g, new THREE.BoxGeometry(0.34, 0.4, 0.04), bronze, -0.72, WALL_H - 0.3, 0);
    } else if (tipo === 'soquete') {
      var gran = mat({ color: cor('#9a8660'), roughness: 0.95 });
      var L = CELL * 0.98, b = 0.2;
      malha(g, new THREE.BoxGeometry(L, 0.08, b), gran, 0, 0.04, -(L - b) / 2);
      malha(g, new THREE.BoxGeometry(L, 0.08, b), gran, 0, 0.04, (L - b) / 2);
      malha(g, new THREE.BoxGeometry(b, 0.08, L - 2 * b), gran, -(L - b) / 2, 0.04, 0);
      malha(g, new THREE.BoxGeometry(b, 0.08, L - 2 * b), gran, (L - b) / 2, 0.04, 0);
    } else if (tipo === 'ponte') {
      malha(g, new THREE.BoxGeometry(CELL * 1.0, 0.1, CELL * 0.8), mat({ color: cor('#d8d4cc'), roughness: 0.9 }), 0, 0.13, 0);
      malha(g, new THREE.BoxGeometry(0.24, 0.1, CELL * 0.7), pedra, -CELL * 0.36, 0.05, 0);
      malha(g, new THREE.BoxGeometry(0.24, 0.1, CELL * 0.7), pedra, CELL * 0.36, 0.05, 0);
    } else if (tipo === 'pilar') {
      var grn = mat({ color: cor('#b89a62'), roughness: 0.95 });
      malha(g, new THREE.BoxGeometry(CELL * 0.92, WALL_H, CELL * 0.92), grn, 0, WALL_H / 2, 0);
      malha(g, new THREE.BoxGeometry(CELL * 0.96, 0.16, CELL * 0.96), mat({ color: cor('#8a744a'), roughness: 0.95 }), 0, WALL_H - 0.08, 0);
      for (i = -1; i <= 1; i += 2) malha(g, new THREE.BoxGeometry(0.1, WALL_H * 0.8, 0.02), mat({ color: cor('#5e7a48'), roughness: 1 }), i * CELL * 0.33, WALL_H * 0.5, CELL * 0.465);
    } else if (tipo === 'altar') {
      malha(g, new THREE.CylinderGeometry(2.7, 2.85, 0.3, 28), pedra, 0, 0.15, 0);
      malha(g, new THREE.CylinderGeometry(2.1, 2.25, 0.3, 28), mat({ color: cor('#807a8c'), roughness: 0.9 }), 0, 0.45, 0);
      malha(g, new THREE.SphereGeometry(0.75, 16, 12), mat({ color: cor('#54505e'), roughness: 0.8 }), 0, 1.0, 0);
      var els = ['fogo', 'agua', 'ar', 'terra'];
      for (i = 0; i < 4; i++) {
        var an = Math.PI / 4 + i * Math.PI / 2;
        malha(g, new THREE.CylinderGeometry(0.42, 0.3, 0.3, 12),
          mat({ color: cor(COR[els[i]]), roughness: 0.6, emissive: cor(COR[els[i]]), emissiveIntensity: 0.25 }),
          Math.cos(an) * 1.65, 0.75, Math.sin(an) * 1.65);
      }
    } else return null;
    g.traverse(function (o) { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    g.userData.primitiva = true;
    return g;
  }

  function modeloDe(tipo) {
    var m = Mo(), def = PECA[tipo];
    if (!m || !def || !m.hasModel || !m.hasModel(def.chave)) return null;
    try { return m.rawScene(def.chave); } catch (e) { return null; }
  }

  /* UM LOTE: as cópias de uma peça numa (ou poucas) chamada de desenho — uma InstancedMesh por malha da
   * peça, com a geometria uma só na placa. O modelo do kit tem milhares de triângulos e a sala põe até
   * 24 pilares e 24 soquetes: copiado por peça seriam dezenas de chamadas a mais num quadro de celular.
   * A `base` assenta, centra e põe a peça na medida (PECA); `poe(i, x, y, z, rot)` é o pé de cada cópia.
   * A primitiva já nasce na medida: a base dela é a identidade. */
  function lote(tipo, n, sombra) {
    var cena = modeloDe(tipo), def = PECA[tipo], prim = false;
    if (!cena) { cena = primitiva(tipo); prim = true; }
    if (!cena || n < 1) return null;
    cena.updateMatrixWorld(true);
    var base = new THREE.Matrix4(), medida = null;
    if (!prim) {
      var bb = new THREE.Box3().setFromObject(cena);
      var w0 = bb.max.x - bb.min.x, h0 = bb.max.y - bb.min.y, d0 = bb.max.z - bb.min.z;
      if (!(w0 > 1e-4 && h0 > 1e-4 && d0 > 1e-4)) return null;
      var lado = Math.max(w0, d0), kx, ky, kz, k;
      if (def.estica) { kx = def.larg / w0; kz = def.larg / d0; ky = def.alt / h0; }
      else if (def.alt) {
        k = def.alt / h0;
        if (def.teto && lado * k > def.teto) k = def.teto / lado;
        kx = ky = kz = k;
      } else {
        k = def.larg / lado;
        kx = kz = ky = k;
        if (def.altMax && h0 * ky > def.altMax) ky = def.altMax / h0;
      }
      base.makeScale(kx, ky, kz);
      base.multiply(new THREE.Matrix4().makeTranslation(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2));
      medida = { larg: w0 * kx, alt: h0 * ky, prof: d0 * kz, longoEmX: w0 >= d0 };
    }
    var g = new THREE.Group(), partes = [];
    cena.traverse(function (o) {
      if (!o.isMesh || !o.geometry) return;
      var im = new THREE.InstancedMesh(o.geometry, o.material, n);
      im.castShadow = sombra !== false; im.receiveShadow = true;
      im.frustumCulled = false;            // as cópias se espalham pela sala: a esfera de uma não vale
      g.add(im);
      partes.push({ im: im, local: new THREE.Matrix4().multiplyMatrices(base, o.matrixWorld) });
    });
    if (!partes.length) return null;
    var pe = new THREE.Matrix4(), giro = new THREE.Matrix4(), tudo = new THREE.Matrix4();
    return {
      no: g, n: n, primitiva: prim, medida: medida, cena: cena,
      poe: function (i, x, y, z, rot) {
        pe.makeTranslation(x, y, z);
        giro.makeRotationY(rot || 0);
        pe.multiply(giro);
        for (var q = 0; q < partes.length; q++) {
          tudo.multiplyMatrices(pe, partes[q].local);
          partes[q].im.setMatrixAt(i, tudo);
          partes[q].im.instanceMatrix.needsUpdate = true;
        }
      }
    };
  }

  /* PARA ONDE A PEÇA OLHA, medido na própria malha (a folha do Meshy não garante a frente):
   *   frenteDoTopo  — a bica: a carranca sai para um lado no alto da estela. O centro dos vértices do
   *                   terço de cima, contra o centro da caixa, diz para que lado;
   *   frenteDaSeta  — o cata-vento: no terço de cima, o eixo comprido é a seta; a PONTA é o lado em que
   *                   a peça afina (a cauda tem penas e é larga).
   * Devolvem o ângulo em volta de Y (atan2(x, z), a convenção do rotation.y) ou null se a malha não diz. */
  function verticesDoAlto(cena, fracao) {
    cena.updateMatrixWorld(true);
    var bb = new THREE.Box3().setFromObject(cena), v = new THREE.Vector3(), pts = [];
    var corte = bb.min.y + (bb.max.y - bb.min.y) * fracao;
    cena.traverse(function (o) {
      if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
      var pos = o.geometry.attributes.position, passo = Math.max(1, Math.floor(pos.count / 4000));
      for (var i = 0; i < pos.count; i += passo) {
        v.fromBufferAttribute(pos, i); o.localToWorld(v);
        if (v.y >= corte) pts.push([v.x, v.y, v.z]);
      }
    });
    return { bb: bb, pts: pts };
  }
  function frenteDoTopo(cena) {
    var a = verticesDoAlto(cena, 0.55), n = a.pts.length;
    if (n < 8) return null;
    var sx = 0, sz = 0;
    for (var i = 0; i < n; i++) { sx += a.pts[i][0]; sz += a.pts[i][2]; }
    var dx = sx / n - (a.bb.min.x + a.bb.max.x) / 2, dz = sz / n - (a.bb.min.z + a.bb.max.z) / 2;
    var lado = Math.max(a.bb.max.x - a.bb.min.x, a.bb.max.z - a.bb.min.z);
    if (Math.sqrt(dx * dx + dz * dz) < lado * 0.03) return null;
    return Math.atan2(dx, dz);
  }
  function frenteDaSeta(cena) {
    var a = verticesDoAlto(cena, 0.7), n = a.pts.length;
    if (n < 12) return null;
    var minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, i;
    for (i = 0; i < n; i++) {
      minX = Math.min(minX, a.pts[i][0]); maxX = Math.max(maxX, a.pts[i][0]);
      minZ = Math.min(minZ, a.pts[i][2]); maxZ = Math.max(maxZ, a.pts[i][2]);
    }
    var emX = (maxX - minX) >= (maxZ - minZ), e = emX ? 0 : 2, o2 = emX ? 2 : 0;
    var lo = emX ? minX : minZ, hi = emX ? maxX : maxZ, comp = hi - lo;
    if (comp < 1e-4) return null;
    // a abertura (no outro eixo horizontal e na altura) de cada ponta do eixo comprido
    function abertura(de, ate) {
      var a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity, c = 0;
      for (var j = 0; j < n; j++) {
        var t = (a.pts[j][e] - lo) / comp;
        if (t < de || t > ate) continue;
        c++;
        a0 = Math.min(a0, a.pts[j][o2]); a1 = Math.max(a1, a.pts[j][o2]);
        b0 = Math.min(b0, a.pts[j][1]); b1 = Math.max(b1, a.pts[j][1]);
      }
      return c ? (a1 - a0) + (b1 - b0) : null;
    }
    var baixa = abertura(0, 0.1), alta = abertura(0.9, 1);
    if (baixa == null || alta == null || Math.abs(baixa - alta) < comp * 0.02) return null;
    var sinal = alta < baixa ? 1 : -1;                    // a ponta é o lado que afina
    return emX ? Math.atan2(sinal, 0) : Math.atan2(0, sinal);
  }
  S3._frenteDaSeta = frenteDaSeta;        // provas
  S3._frenteDoTopo = frenteDoTopo;

  var iconeMat = {};
  function icone(txt, c) {
    var k = txt + '|' + c;
    if (!iconeMat[k]) {
      var cv = document.createElement('canvas');
      cv.width = cv.height = 96;
      var x = cv.getContext('2d');
      x.fillStyle = 'rgba(10,13,18,0.74)';
      x.beginPath(); x.arc(48, 48, 36, 0, Math.PI * 2); x.fill();
      x.strokeStyle = c; x.lineWidth = 4; x.stroke();
      x.fillStyle = c;
      x.font = 'bold 44px Verdana, Segoe UI Symbol, sans-serif';
      x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText(String(txt), 48, 51);
      var tex = meu(new THREE.CanvasTexture(cv));
      if (THREE.sRGBEncoding != null) tex.encoding = THREE.sRGBEncoding;
      iconeMat[k] = meu(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    }
    var sp = new THREE.Sprite(iconeMat[k]);
    sp.scale.set(0.7, 0.7, 1);
    sp.renderOrder = 21;
    return sp;
  }

  // ================================================================ A MONTAGEM
  var est = null;               // a sala montada
  function pos(x, y) { return R().world(x, y, 0); }
  function chao() {
    var m = Mo();
    return m.tileFlatGeo();      // um plano de uma casa, deitado (é do registro de modelos: não se descarta aqui)
  }
  function ladrilhos(n, material, yOff, ordem) {
    var im = new THREE.InstancedMesh(chao(), material, Math.max(1, n));
    im.count = 0; im.frustumCulled = false; im.renderOrder = ordem || 2;
    im.userData.y = yOff;
    return im;
  }
  var m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), v3 = new THREE.Vector3(), e3 = new THREE.Vector3(), eul = new THREE.Euler();
  function poeLadrilho(im, i, x, y, escala, rot) {
    var p = pos(x, y);
    q4.setFromEuler(eul.set(0, rot || 0, 0));
    m4.compose(v3.set(p.x, im.userData.y, p.z), q4, e3.set(escala || 1, 1, escala || 1));
    im.setMatrixAt(i, m4);
  }

  function modelosProntos() {
    var m = Mo(), s = '';
    for (var t in PECA) if (own(PECA, t)) s += (m && m.hasModel && m.hasModel(PECA[t].chave)) ? '1' : '0';
    return s;
  }

  function limpa() {
    if (est && est.raiz && est.raiz.parent) est.raiz.parent.remove(est.raiz);
    // só o que foi FEITO aqui: a geometria e o material das peças do kit são do registro de modelos
    for (var i = 0; i < proprios.length; i++) { try { proprios[i].dispose(); } catch (e) {} }
    proprios.length = 0;
    iconeMat = {};
    est = null;
  }
  S3.limpa = limpa;

  function monta(st, chave) {
    limpa();
    var r = R(), s = Sa(), p = plantaDe(st);
    if (!r || !s || !p || !r.scene || !r.scene()) return;
    CELL = r.CELL || CELL;
    var raiz = new THREE.Group();
    raiz.name = 'santuario';
    r.scene().add(raiz);
    var e = est = { chave: chave, raiz: raiz, p: p, sig: '', impulso: 0,
                    pilares: [], bicas: [], catas: [], brs: [], luzes: [], casasAgua: [], pontes: [], casasVento: [], casasEscuro: [] };
    var i, c, L;

    // ---------------------------------------------------------------- TERRA
    e.pilares = [];
    if (p.pilares.length) {
      e.lSoq = lote('soquete', p.pilares.length, false);
      e.lPil = lote('pilar', p.pilares.length);
      if (e.lSoq) raiz.add(e.lSoq.no);
      if (e.lPil) raiz.add(e.lPil.no);
      // o aviso: a casa pintada (uma cor para quem sobe, outra para quem desce) e a seta em cima
      e.avSobe = ladrilhos(p.pilares.length, matLuz('#ffb347', 0.5), 0.085, 4);
      e.avDesce = ladrilhos(p.pilares.length, matLuz('#7fe0a8', 0.5), 0.085, 4);
      raiz.add(e.avSobe); raiz.add(e.avDesce);
      for (i = 0; i < p.pilares.length; i++) {
        c = pos(p.pilares[i].x, p.pilares[i].y);
        if (e.lSoq) e.lSoq.poe(i, c.x, 0.01, c.z, 0);
        var alto = !!st.santuario.pl[i];
        var sobe = icone('▲', '#ffb347'), desce = icone('▼', '#7fe0a8'), espera = icone('!', '#ffd76b');
        sobe.position.set(c.x, 1.5, c.z); desce.position.set(c.x, WALL_H + 0.55, c.z); espera.position.set(c.x, 2.5, c.z);
        sobe.visible = desce.visible = espera.visible = false;
        raiz.add(sobe); raiz.add(desce); raiz.add(espera);
        e.pilares.push({ x: p.pilares[i].x, y: p.pilares[i].y, wx: c.x, wz: c.z, k: alto ? 1 : 0, alvo: alto ? 1 : 0,
                         sobe: sobe, desce: desce, espera: espera, vai: null, esperando: false });
      }
    }

    // ---------------------------------------------------------------- ÁGUA
    var casasAgua = [], pontes = [], k2;
    for (k2 in p.agua) if (own(p.agua, k2) && !p.pontes[k2]) casasAgua.push(k2.split(',').map(Number));
    for (k2 in p.pontes) if (own(p.pontes, k2)) pontes.push(k2.split(',').map(Number));
    e.casasAgua = casasAgua;
    if (casasAgua.length) {
      /* a LÂMINA: um quadrado por casa alagada numa malha só. Translúcida, por cima do piso — a casa
       * alagada continua sendo chão em que se pisa, só que com um dedo d'água */
      var geo = meu(new THREE.BufferGeometry()), vs = [], ns = [], h2 = CELL / 2, yA = 0.07;
      for (i = 0; i < casasAgua.length; i++) {
        c = pos(casasAgua[i][0], casasAgua[i][1]);
        vs.push(c.x - h2, yA, c.z - h2, c.x - h2, yA, c.z + h2, c.x + h2, yA, c.z + h2,
                c.x - h2, yA, c.z - h2, c.x + h2, yA, c.z + h2, c.x + h2, yA, c.z - h2);
        for (var q = 0; q < 6; q++) ns.push(0, 1, 0);
      }
      geo.setAttribute('position', new THREE.Float32BufferAttribute(vs, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(ns, 3));
      e.lamina = new THREE.Mesh(geo, meu(new THREE.MeshStandardMaterial({
        color: cor('#2f7fb0'), emissive: cor('#0c3550'), emissiveIntensity: 0.55, roughness: 0.18, metalness: 0.1,
        transparent: true, opacity: 0.6, depthWrite: false })));
      e.lamina.renderOrder = 1; e.lamina.receiveShadow = true;
      raiz.add(e.lamina);
      // os VEIOS: dois riscos claros por casa, correndo para onde a correnteza leva
      e.veios = new THREE.InstancedMesh(meu(new THREE.PlaneGeometry(CELL * 0.42, 0.07).rotateX(-Math.PI / 2)),
        matLuz('#cfeeff', 0.5), casasAgua.length * 2);
      e.veios.frustumCulled = false; e.veios.renderOrder = 2;
      raiz.add(e.veios);
      // as poças do dono: poucas, espalhadas (a de mais perto de cada bica primeiro)
      var escolhidas = [];
      p.bicas.forEach(function (b) {
        var v = VETOR[b.dir], kk = (b.x + v[0]) + ',' + (b.y + v[1]);
        if (p.agua[kk] && !p.pontes[kk]) escolhidas.push([b.x + v[0], b.y + v[1]]);
      });
      for (i = 0; i < casasAgua.length && escolhidas.length < POCAS_MAX; i += Math.max(1, Math.floor(casasAgua.length / POCAS_MAX))) {
        if (!escolhidas.some(function (o) { return Math.abs(o[0] - casasAgua[i][0]) + Math.abs(o[1] - casasAgua[i][1]) < 3; })) escolhidas.push(casasAgua[i]);
      }
      if (modeloDe('poca') && escolhidas.length) {
        e.lPoca = lote('poca', escolhidas.length, false);
        if (e.lPoca) {
          raiz.add(e.lPoca.no);
          for (i = 0; i < escolhidas.length; i++) { c = pos(escolhidas[i][0], escolhidas[i][1]); e.lPoca.poe(i, c.x, 0.012, c.z, (i % 4) * Math.PI / 2); }
        }
      }
    }
    e.pontes = pontes;
    if (pontes.length) {
      e.lPonte = lote('ponte', pontes.length, false);
      if (e.lPonte) {
        raiz.add(e.lPonte.no);
        var longoEmX = e.lPonte.medida ? e.lPonte.medida.longoEmX : true;
        for (i = 0; i < pontes.length; i++) {
          // a laje corre com a fileira de pontes: o comprido dela na direção em que se atravessa
          var emX = !!(p.pontes[(pontes[i][0] - 1) + ',' + pontes[i][1]] || p.pontes[(pontes[i][0] + 1) + ',' + pontes[i][1]]);
          c = pos(pontes[i][0], pontes[i][1]);
          e.lPonte.poe(i, c.x, 0.075, c.z, (emX === longoEmX) ? 0 : Math.PI / 2);
        }
      }
    }
    e.bicas = [];
    if (p.bicas.length) {
      e.lBica = lote('bica', p.bicas.length);
      var frB = (e.lBica && !e.lBica.primitiva) ? frenteDoTopo(e.lBica.cena) : 0;
      if (frB == null) frB = 0;                           // a folha do Meshy vem com a frente para +z
      for (i = 0; i < p.bicas.length; i++) {
        var bv = VETOR[p.bicas[i].dir];
        c = pos(p.bicas[i].x, p.bicas[i].y);
        var rotB = Math.atan2(bv[0], bv[1]) - frB;
        if (e.lBica) e.lBica.poe(i, c.x, 0, c.z, rotB);
        // o JORRO (só na bica que verte): uma faixa de água da boca da carranca até o chão
        var jorro = new THREE.Mesh(meu(new THREE.PlaneGeometry(0.34, WALL_H * 0.62)), matLuz('#8fdcff', 0.62));
        jorro.position.set(c.x + bv[0] * 0.92, WALL_H * 0.31, c.z + bv[1] * 0.92);
        jorro.rotation.y = Math.atan2(bv[0], bv[1]);
        jorro.renderOrder = 3; jorro.visible = false;
        var sinal = icone('≈', '#8fdcff');
        sinal.position.set(c.x, WALL_H + 0.5, c.z); sinal.visible = false;
        raiz.add(jorro); raiz.add(sinal);
        e.bicas.push({ x: p.bicas[i].x, y: p.bicas[i].y, dir: p.bicas[i].dir, jorro: jorro, sinal: sinal, verte: false, proxima: false });
      }
      if (e.lBica) raiz.add(e.lBica.no);
    }

    // ---------------------------------------------------------------- AR
    e.setas = null; e.casasVento = [];
    if (p.vento.length) {
      var visto = {};
      for (i = 0; i < p.vento.length; i++) {
        var z = p.vento[i];
        for (var yy = z[1]; yy <= z[3]; yy++) for (var xx = z[0]; xx <= z[2]; xx++) {
          var kv = xx + ',' + yy, t = st.grid.tiles[yy] && st.grid.tiles[yy][xx];
          if (visto[kv] || !t || t.type !== 'floor' || p.calmas[kv] || ((xx + yy) & 1)) continue;
          visto[kv] = true;
          e.casasVento.push([xx, yy]);
        }
      }
      // a SETA de chão: uma ponta de flecha deitada, apontando para +z no descanso
      var forma = new THREE.Shape();
      forma.moveTo(0, 0.42); forma.lineTo(0.3, 0.02); forma.lineTo(0.1, 0.02); forma.lineTo(0.1, -0.42);
      forma.lineTo(-0.1, -0.42); forma.lineTo(-0.1, 0.02); forma.lineTo(-0.3, 0.02); forma.lineTo(0, 0.42);
      var gSeta = meu(new THREE.ShapeGeometry(forma));
      gSeta.rotateX(Math.PI / 2);                        // deita: a ponta (y da forma) vai para +z
      e.setas = new THREE.InstancedMesh(gSeta, matLuz('#d9ccff', 0.34), Math.max(1, e.casasVento.length));
      e.setas.frustumCulled = false; e.setas.renderOrder = 2;
      raiz.add(e.setas);
      // as casas CALMAS: um aro claro em volta de cada uma
      var calmas = [];
      for (k2 in p.calmas) if (own(p.calmas, k2)) {
        var cc = k2.split(',').map(Number), tc = st.grid.tiles[cc[1]] && st.grid.tiles[cc[1]][cc[0]];
        if (tc && tc.type === 'floor') calmas.push(cc);
      }
      e.calmas = calmas;
      if (calmas.length) {
        e.aros = new THREE.InstancedMesh(meu(new THREE.RingGeometry(CELL * 0.33, CELL * 0.42, 22).rotateX(-Math.PI / 2)),
          matLuz('#c9ffe6', 0.55), calmas.length);
        e.aros.frustumCulled = false; e.aros.renderOrder = 3;
        for (i = 0; i < calmas.length; i++) {
          c = pos(calmas[i][0], calmas[i][1]);
          m4.makeTranslation(c.x, 0.075, c.z);
          e.aros.setMatrixAt(i, m4);
        }
        raiz.add(e.aros);
      }
      if (p.respiros.length) {
        e.lResp = lote('respiro', p.respiros.length);
        // a COLUNA de vento que sai de cada respiro (a arte vem sem ela, de propósito)
        e.colunas = new THREE.InstancedMesh(meu(new THREE.CylinderGeometry(0.34, 0.2, 2.6, 12, 1, true)),
          matLuz('#e6dcff', 0.16, true), p.respiros.length);
        e.colunas.frustumCulled = false; e.colunas.renderOrder = 3;
        for (i = 0; i < p.respiros.length; i++) {
          c = pos(p.respiros[i].x, p.respiros[i].y);
          if (e.lResp) e.lResp.poe(i, c.x, 0, c.z, 0);
          m4.makeTranslation(c.x, 1.0 + 1.3, c.z);
          e.colunas.setMatrixAt(i, m4);
        }
        if (e.lResp) raiz.add(e.lResp.no);
        raiz.add(e.colunas);
      }
      e.catas = [];
      if (p.cataVentos.length) {
        e.lCata = lote('cata', p.cataVentos.length);
        var frS = (e.lCata && !e.lCata.primitiva) ? frenteDaSeta(e.lCata.cena) : Math.atan2(1, 0);
        if (frS == null) frS = Math.atan2(1, 0);
        e.frenteDaSeta = frS;
        if (e.lCata) raiz.add(e.lCata.no);
        for (i = 0; i < p.cataVentos.length; i++) {
          c = pos(p.cataVentos[i].x, p.cataVentos[i].y);
          // a direção de AGORA, grande, em cima do cata-vento (lê-se de qualquer ângulo de câmera) e a
          // da rodada seguinte, quando vira, em âmbar
          var agora = new THREE.Mesh(gSeta, matLuz('#ffffff', 0.9));
          var depois = new THREE.Mesh(gSeta, matLuz('#ffb347', 0.75));
          agora.scale.setScalar(2.1); depois.scale.setScalar(1.5);
          agora.position.set(c.x, WALL_H + 0.45, c.z); depois.position.set(c.x, WALL_H + 0.95, c.z);
          agora.renderOrder = depois.renderOrder = 22;
          agora.material.depthTest = false; depois.material.depthTest = false;
          depois.visible = false;
          raiz.add(agora); raiz.add(depois);
          e.catas.push({ x: p.cataVentos[i].x, y: p.cataVentos[i].y, wx: c.x, wz: c.z, ang: null, alvo: 0, agora: agora, depois: depois });
        }
      }
    }

    // ---------------------------------------------------------------- FOGO
    e.brs = [];
    if (p.braseiros.length) {
      e.lBr = lote('braseiro', p.braseiros.length);
      if (e.lBr) raiz.add(e.lBr.no);
      var halo = (JOGO.Models3D && JOGO.Models3D.makeHalo) ? JOGO.Models3D.makeHalo : null;
      var mChama = matLuz('#ffb24a', 0.9, true), mMiolo = matLuz('#fff0b8', 0.9, true);
      var gChama = meu(new THREE.ConeGeometry(0.3, 0.75, 8).translate(0, 0.375, 0));
      var gMiolo = meu(new THREE.ConeGeometry(0.15, 0.5, 8).translate(0, 0.25, 0));
      for (i = 0; i < p.braseiros.length; i++) {
        c = pos(p.braseiros[i].x, p.braseiros[i].y);
        if (e.lBr) e.lBr.poe(i, c.x, 0, c.z, (i * 2.1) % (Math.PI * 2));
        var fogo = new THREE.Group();
        var ch = new THREE.Mesh(gChama, mChama), mi = new THREE.Mesh(gMiolo, mMiolo);
        ch.renderOrder = mi.renderOrder = 5;
        fogo.add(ch); fogo.add(mi);
        if (halo) { try { var hl = halo('#ff9a4a', 2.6, 0.5); hl.position.y = 0.35; fogo.add(hl); } catch (eH) {} }
        fogo.position.set(c.x, 1.32, c.z);
        fogo.visible = false;
        raiz.add(fogo);
        e.brs.push({ x: p.braseiros[i].x, y: p.braseiros[i].y, wx: c.x, wz: c.z, fogo: fogo, chama: ch, aceso: false, clarao: 0, ph: i * 1.7 });
      }
      // as luzes: número FIXO na sala (ver luzesMax); a que não tem braseiro aceso fica com intensidade 0
      e.luzes = [];
      for (i = 0; i < Math.min(luzesMax(), p.braseiros.length); i++) {
        var lz = new THREE.PointLight(cor('#ff9a48'), 0, CELL * 5.5, 2);
        lz.position.set(0, 1.9, 0);
        raiz.add(lz);
        e.luzes.push(lz);
      }
    }
    e.casasEscuro = [];
    if (p.escuro.length) {
      var vistoE = {};
      for (i = 0; i < p.escuro.length; i++) {
        var ze = p.escuro[i];
        for (var ye = ze[1]; ye <= ze[3]; ye++) for (var xe = ze[0]; xe <= ze[2]; xe++) {
          var ke = xe + ',' + ye, te = st.grid.tiles[ye] && st.grid.tiles[ye][xe];
          if (vistoE[ke] || !te || te.type === 'hole') continue;
          vistoE[ke] = true;
          e.casasEscuro.push([xe, ye]);
        }
      }
      var nE = e.casasEscuro.length;
      e.breu = ladrilhos(nE, matLuz('#020205', 0.78), 0.045, 2);
      e.penumbra = ladrilhos(nE, matLuz('#05050c', 0.34), 0.045, 2);
      e.luz = ladrilhos(nE, matLuz('#ffb060', 0.13, true), 0.046, 2);
      raiz.add(e.breu); raiz.add(e.penumbra); raiz.add(e.luz);
      if (comVolume()) {
        /* O VOLUME de breu: uma caixa translúcida por casa que o meu lado não vê. O véu do chão sozinho
         * deixava os muros e os enfeites de dentro do escuro acesos como de dia; atravessando várias
         * caixas, o que está mais para dentro fica mais apagado. Só as faces de fora desenham (uma
         * camada por caixa), sem gravar profundidade. Desligado no celular econômico (é tela cheia
         * de transparência). */
        e.volume = new THREE.InstancedMesh(meu(new THREE.BoxGeometry(CELL, 2.3, CELL).translate(0, 1.15, 0)),
          meu(new THREE.MeshBasicMaterial({ color: cor('#020205'), transparent: true, opacity: 0.2, depthWrite: false })), Math.max(1, nE));
        e.volume.count = 0; e.volume.frustumCulled = false; e.volume.renderOrder = 6;
        raiz.add(e.volume);
      }
    }

    // ---------------------------------------------------------------- O ALTAR
    if (p.altar.length) {
      e.lAltar = lote('altar', 1);
      if (e.lAltar) {
        var ax = 0, ay = 0;
        for (i = 0; i < p.altar.length; i++) { ax += p.altar[i].x; ay += p.altar[i].y; }
        c = pos(ax / p.altar.length, ay / p.altar.length);
        e.lAltar.poe(0, c.x, 0, c.z, 0);
        raiz.add(e.lAltar.no);
      }
    }
  }

  // ================================================================ O QUE MUDA
  function assinatura(st) {
    var S = st.santuario, lado = meuLado(), s = S.br.join('') + '|' + S.pl.join('') + '|' + S.es.join('') + '|' + S.av + '|' + st.round + '|' + lado + '|';
    if (est && est.casasEscuro.length) {
      // o véu depende de ONDE está cada um do meu lado e de quem enxerga no escuro (a fusão muda o elemento)
      var rg = Sa().regras;
      for (var i = 0; i < st.units.length; i++) {
        var u = st.units[i];
        if (u.alive && !u.offBoard && u.side === lado) s += u.x + ',' + u.y + (rg.veNoEscuro(u) ? 'F' : '') + ';';
      }
    }
    return s;
  }

  function sincroniza(st) {
    var e = est, s = Sa(), info = s.info(st), i, n;
    if (!info) return;
    e.info = info;
    // ---- pilares: para onde cada um vai e o aviso
    if (info.pilares) {
      var nS = 0, nD = 0;
      for (i = 0; i < e.pilares.length; i++) {
        var q = info.pilares.lista[i], P = e.pilares[i];
        P.alvo = q.alto ? 1 : 0;
        P.vai = q.vai; P.esperando = !!q.espera;
        // quem espera segue avisado: vai subir assim que a casa esvaziar
        var vaiSubir = q.vai === 'sobe' || q.espera;
        P.sobe.visible = !!vaiSubir && !q.espera; P.espera.visible = !!q.espera; P.desce.visible = q.vai === 'desce';
        if (vaiSubir) poeLadrilho(e.avSobe, nS++, P.x, P.y, 0.94);
        if (q.vai === 'desce') poeLadrilho(e.avDesce, nD++, P.x, P.y, 0.94);
      }
      e.avSobe.count = nS; e.avDesce.count = nD;
      e.avSobe.instanceMatrix.needsUpdate = true; e.avDesce.instanceMatrix.needsUpdate = true;
    }
    // ---- água: a bica que verte e a que vai verter
    if (info.agua) {
      for (i = 0; i < e.bicas.length; i++) {
        var b = info.agua.bicas[i];
        e.bicas[i].verte = !!b.verte;
        e.bicas[i].proxima = !b.verte && info.agua.proxima !== info.agua.dir && b.dir === info.agua.proxima;
        e.bicas[i].jorro.visible = e.bicas[i].verte;
        e.bicas[i].sinal.visible = e.bicas[i].proxima;
      }
      e.correnteza = info.agua.dir;
    }
    // ---- vento
    if (info.vento) {
      e.vento = info.vento.dir; e.ventoDepois = (info.vento.proxima !== info.vento.dir) ? info.vento.proxima : null;
      var v = VETOR[e.vento], alvo = Math.atan2(v[0], v[1]);
      for (i = 0; i < e.catas.length; i++) {
        e.catas[i].alvo = alvo;
        if (e.catas[i].ang == null) e.catas[i].ang = alvo;
        e.catas[i].depois.visible = !!e.ventoDepois;
        if (e.ventoDepois) { var vd = VETOR[e.ventoDepois]; e.catas[i].depois.rotation.y = Math.atan2(vd[0], vd[1]); }
      }
    }
    // ---- fogo: os braseiros e o véu
    if (info.escuro) {
      for (i = 0; i < e.brs.length; i++) {
        var ac = !!info.escuro.braseiros[i].aceso;
        if (ac !== e.brs[i].aceso) e.brs[i].clarao = 1;
        e.brs[i].aceso = ac;
        e.brs[i].fogo.visible = ac;
      }
      // as luzes vão para os acesos mais perto do meu lado
      var lado = meuLado(), meus = st.units.filter(function (u) { return u.alive && !u.offBoard && u.side === lado; });
      var acesos = e.brs.filter(function (b2) { return b2.aceso; }).map(function (b2) {
        var d = 999;
        meus.forEach(function (u) { d = Math.min(d, Math.abs(u.x - b2.x) + Math.abs(u.y - b2.y)); });
        return { b: b2, d: d };
      }).sort(function (a, b2) { return a.d - b2.d; });
      for (i = 0; i < e.luzes.length; i++) {
        if (acesos[i]) { e.luzes[i].position.set(acesos[i].b.wx, 1.9, acesos[i].b.wz); e.luzes[i].userData.base = 2.4; }
        else e.luzes[i].userData.base = 0;
      }
      // o véu: breu (o meu lado não vê), penumbra (vê) e luz (o braseiro clareia)
      var rg = s.regras, visao = info.escuro.visao, ve = false;
      for (i = 0; i < meus.length; i++) if (rg.veNoEscuro(meus[i])) { ve = true; break; }
      var nB = 0, nP = 0, nL = 0, nV = 0;
      for (i = 0; i < e.casasEscuro.length; i++) {
        var cx = e.casasEscuro[i][0], cy = e.casasEscuro[i][1];
        if (rg.iluminada(st, cx, cy)) { poeLadrilho(e.luz, nL++, cx, cy, 1); continue; }
        var vista = ve;
        for (n = 0; !vista && n < meus.length; n++) if (Math.abs(meus[n].x - cx) + Math.abs(meus[n].y - cy) <= visao) vista = true;
        if (vista) poeLadrilho(e.penumbra, nP++, cx, cy, 1);
        else {
          poeLadrilho(e.breu, nB++, cx, cy, 1);
          if (e.volume) { var pv = pos(cx, cy); m4.makeTranslation(pv.x, 0, pv.z); e.volume.setMatrixAt(nV++, m4); }
        }
      }
      e.breu.count = nB; e.penumbra.count = nP; e.luz.count = nL;
      e.breu.instanceMatrix.needsUpdate = e.penumbra.instanceMatrix.needsUpdate = e.luz.instanceMatrix.needsUpdate = true;
      if (e.volume) { e.volume.count = nV; e.volume.instanceMatrix.needsUpdate = true; }
    }
  }

  function anima(st, dt, t) {
    var e = est, i, pulso = 0.5 + 0.5 * Math.sin(t * 4.2);
    e.impulso = Math.max(0, e.impulso - dt * 1.4);
    // ---- pilares: o bloco sobe e desce em ~0,7 s; baixo, o topo fica rente ao soquete
    if (e.lPil) {
      for (i = 0; i < e.pilares.length; i++) {
        var P = e.pilares[i];
        if (P.k !== P.alvo || !P.posto) {
          var passo = dt / 0.7;
          P.k = P.k < P.alvo ? Math.min(P.alvo, P.k + passo) : Math.max(P.alvo, P.k - passo);
          var s = P.k * P.k * (3 - 2 * P.k);
          e.lPil.poe(i, P.wx, -(WALL_H - 0.06) * (1 - s), P.wz, 0);
          P.posto = true;
        }
        if (P.sobe.visible) P.sobe.position.y = 1.5 + 0.14 * pulso;
        if (P.desce.visible) P.desce.position.y = WALL_H + 0.55 - 0.14 * pulso;
        if (P.espera.visible) P.espera.position.y = 2.5 + 0.1 * pulso;
      }
      e.avSobe.material.opacity = 0.26 + 0.34 * pulso;
      e.avDesce.material.opacity = 0.2 + 0.26 * pulso;
    }
    // ---- água: os veios correm para onde a correnteza leva (mais depressa no instante em que ela leva)
    if (e.veios && e.correnteza) {
      var v = VETOR[e.correnteza], rot = Math.atan2(v[0], v[1]) + Math.PI / 2, vel = 0.32 + e.impulso * 1.6;
      e.fase = ((e.fase || 0) + dt * vel) % 1;
      for (i = 0; i < e.casasAgua.length; i++) {
        var c = pos(e.casasAgua[i][0], e.casasAgua[i][1]);
        for (var j = 0; j < 2; j++) {
          var f = (e.fase + (i * 0.37 + j * 0.5)) % 1, d = (f - 0.5) * CELL * 0.9, lado = (j ? 0.24 : -0.24) * CELL;
          q4.setFromEuler(eul.set(0, rot, 0));
          var esc = Math.sin(f * Math.PI);                 // nasce e some dentro da casa
          m4.compose(v3.set(c.x + v[0] * d - v[1] * lado, 0.085, c.z + v[1] * d + v[0] * lado), q4, e3.set(0.25 + 0.75 * esc, 1, 1));
          e.veios.setMatrixAt(i * 2 + j, m4);
        }
      }
      e.veios.instanceMatrix.needsUpdate = true;
      e.lamina.material.opacity = 0.56 + 0.06 * Math.sin(t * 1.3);
      for (i = 0; i < e.bicas.length; i++) {
        if (e.bicas[i].verte) e.bicas[i].jorro.material.opacity = 0.5 + 0.2 * Math.sin(t * 9 + i);
        if (e.bicas[i].proxima) e.bicas[i].sinal.position.y = WALL_H + 0.5 + 0.12 * pulso;
      }
    }
    // ---- vento: as setas deslizam na direção da rajada; o cata-vento gira até ela
    if (e.setas && e.vento) {
      var w = VETOR[e.vento], rw = Math.atan2(w[0], w[1]);
      e.faseV = ((e.faseV || 0) + dt * (0.22 + e.impulso * 1.8)) % 1;
      for (i = 0; i < e.casasVento.length; i++) {
        var cv = pos(e.casasVento[i][0], e.casasVento[i][1]);
        var fv = (e.faseV + i * 0.193) % 1, dv = (fv - 0.5) * CELL * 0.7, ev = 0.55 + 0.45 * Math.sin(fv * Math.PI);
        q4.setFromEuler(eul.set(0, rw, 0));
        m4.compose(v3.set(cv.x + w[0] * dv, 0.08, cv.z + w[1] * dv), q4, e3.set(ev, 1, ev));
        e.setas.setMatrixAt(i, m4);
      }
      e.setas.count = e.casasVento.length;
      e.setas.instanceMatrix.needsUpdate = true;
      // a virada avisada: as setas do chão ficam âmbar na rodada antes de girar
      e.setas.material.color.copy(cor(e.ventoDepois ? '#ffcf8a' : '#d9ccff'));
      e.setas.material.opacity = (e.ventoDepois ? 0.3 + 0.2 * pulso : 0.34) + e.impulso * 0.3;
      for (i = 0; i < e.catas.length; i++) {
        var C = e.catas[i], dif = C.alvo - C.ang;
        while (dif > Math.PI) dif -= Math.PI * 2;
        while (dif < -Math.PI) dif += Math.PI * 2;
        if (Math.abs(dif) > 1e-3 || !C.posto) {
          C.ang += dif * Math.min(1, dt * 3.5);
          if (e.lCata) e.lCata.poe(i, C.wx, 0, C.wz, C.ang - (e.frenteDaSeta || 0));
          C.posto = true;
        }
        C.agora.rotation.y = C.ang;
        if (C.depois.visible) C.depois.material.opacity = 0.4 + 0.4 * pulso;
      }
      if (e.colunas) e.colunas.material.opacity = 0.12 + 0.07 * Math.sin(t * 3.1);
      if (e.aros) e.aros.material.opacity = 0.4 + 0.2 * Math.sin(t * 2.2);
    }
    // ---- fogo: a chama treme, a luz respira, o clarão de quem acabou de acender ou apagar
    for (i = 0; e.brs && i < e.brs.length; i++) {
      var b = e.brs[i];
      if (b.clarao > 0) b.clarao = Math.max(0, b.clarao - dt * 1.8);
      if (!b.aceso) continue;
      var tr = 0.86 + 0.14 * Math.sin(t * 11 + b.ph) + 0.08 * Math.sin(t * 23 + b.ph * 2);
      b.fogo.scale.set(1, tr + b.clarao * 0.8, 1);
    }
    for (i = 0; e.luzes && i < e.luzes.length; i++) {
      var base = e.luzes[i].userData.base || 0;
      e.luzes[i].intensity = base ? base * (0.9 + 0.1 * Math.sin(t * 7 + i * 2.3)) : 0;
    }
  }

  // ================================================================ AS PORTAS
  /* Um quadro: monta a sala (a primeira vez, ao trocar de sala e quando uma peça do kit abre), acerta o
   * que mudou no estado e anima. Sala que não é do Santuário: desmonta o que houver e sai. */
  S3.quadro = function (st, dt, t) {
    if (!st || !st.santuario || !st.grid || !Sa() || !R() || !Mo()) { if (est) limpa(); return; }
    var chave = st.dungeonId + '|' + st.roomIndex + '|' + st.grid.w + 'x' + st.grid.h + '|' + modelosProntos();
    if (!est || est.chave !== chave) monta(st, chave);
    if (!est) return;
    var sig = assinatura(st);
    if (sig !== est.sig) { est.sig = sig; sincroniza(st); }
    anima(st, dt || 0.016, t || 0);
  };

  /* O que o motor avisou: o clarão do braseiro já sai do estado; aqui só o IMPULSO — no instante em
   * que a correnteza e a rajada levam, os veios e as setas disparam. */
  S3.evento = function (ev) {
    if (!ev || !est) return;
    if (ev.type === 'santuarioMare' || ev.type === 'santuarioRajada') est.impulso = 1;
  };

  /* O RELATÓRIO do que está na tela, para as provas contarem (julgar por foto não vale). */
  S3.naTela = function () {
    var e = est;
    if (!e) return null;
    var m = Mo(), modelos = {};
    for (var t in PECA) if (own(PECA, t)) modelos[PECA[t].chave] = !!(m && m.hasModel && m.hasModel(PECA[t].chave));
    return {
      sala: e.chave, regras: e.p.regras.slice(), modelos: modelos, naCena: !!(e.raiz && e.raiz.parent),
      braseiros: (e.brs || []).map(function (b) { return { x: b.x, y: b.y, aceso: b.aceso, chama: b.fogo.visible }; }),
      luzes: (e.luzes || []).filter(function (l) { return (l.userData.base || 0) > 0; }).length,
      luzesNaSala: (e.luzes || []).length,
      veu: e.breu ? { breu: e.breu.count, penumbra: e.penumbra.count, luz: e.luz.count, volume: e.volume ? e.volume.count : null,
                      casas: e.casasEscuro.length } : null,
      agua: e.lamina ? { casas: e.casasAgua.length, veios: e.veios.count, pontes: e.pontes.length, correnteza: e.correnteza || null,
                         pocas: e.lPoca ? e.lPoca.n : 0,
                         bicas: e.bicas.map(function (b) { return { x: b.x, y: b.y, dir: b.dir, verte: b.verte, jorro: b.jorro.visible, proxima: b.sinal.visible }; }) } : null,
      pilares: e.pilares.length ? {
        soquetes: e.lSoq ? e.lSoq.n : 0, blocos: e.lPil ? e.lPil.n : 0,
        lista: e.pilares.map(function (P) { return { x: P.x, y: P.y, alto: P.alvo === 1, k: +P.k.toFixed(3), vai: P.vai, espera: P.esperando,
                                                    avisoSobe: P.sobe.visible, avisoDesce: P.desce.visible, avisoEspera: P.espera.visible }; }),
        avisosSobe: e.avSobe.count, avisosDesce: e.avDesce.count } : null,
      vento: e.setas ? { dir: e.vento || null, depois: e.ventoDepois || null, setas: e.setas.count, calmas: (e.calmas || []).length,
                         respiros: e.lResp ? e.lResp.n : 0,
                         cataVentos: e.catas.map(function (C) { return { x: C.x, y: C.y, angulo: C.ang, alvo: C.alvo, fantasma: C.depois.visible }; }) } : null,
      altar: !!e.lAltar,
      primitivas: ['lBr', 'lBica', 'lCata', 'lSoq', 'lPonte', 'lPil', 'lResp', 'lAltar'].filter(function (k) { return e[k] && e[k].primitiva; })
    };
  };
})();
