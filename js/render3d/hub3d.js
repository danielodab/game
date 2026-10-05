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
  /* SÓLIDOS AVULSOS (12/09): o que barra o passo sem ser um `lugar` — os
   * muros do corredor de cada portal, os pilares da boca e o chefe parado
   * ao lado dela. Círculos {x, z, r}, a mesma conta da parede das
   * construções: barato de testar e suficiente para uma peça de cenário. */
  var solidos = [];
  // 19/09: `dono` (o id do lugar) diz de quem é o sólido — a prova do corredor do
  // portão do Campo ignora os dele mesmo ao medir a folga da base do arco
  function marcaSolido(x, z, r, dono) { solidos.push({ x: x, z: z, r: r, dono: dono || null }); }
  // A ANTESSALA (03/09): a mesma máquina da praça monta o PÁTIO de uma sala
  // do calabouço — null = praça; 'garden:1' = antessala da sala 2 da Estufa
  var RAIO_SALA = 15;
  var salaAtual = null, salaCfg = null, salaPlantada = false, salaTentativas = 0;
  function chaveSala(s) { return s.dungeonId + ':' + s.roomIndex; }
  function raioAtual() { return salaAtual ? RAIO_SALA : campoAtivo ? campoCfg().meioLado : RAIO_MAPA; }
  /* O CAMPO DE PVP (14/09, dono: "um mapa exclusivo de PvP… uma 'sala de espera' e ao
   * atacar entra automaticamente em uma batalha"). É mais uma CENA desta máquina, como a
   * antessala: Hub.entraCampo troca a praça pelo Campo e Hub.saiCampo volta. O desenho
   * mora em js/core/data/campo_pvp.js (provisório até o dono desenhar o dele); a regra
   * (coroa, ataque, batalha) é da HUD e do js/core — aqui só a cena, o passo e quem se vê.
   *   · zonaAtual — 'praca' ou 'campo': fantasma de outra zona fica no PAPEL (sem corpo e
   *     sem toque). A antessala conta como praça (a sala já é filtrada pela HUD).
   *   · aparenciaCampo — no Campo o corpo é o do 1º herói escolhido (dono, 14/09: "o 1º a
   *     selecionar fica a aparência e o segundo fica selecionado, é o elemento surpresa");
   *     classeAvatar guarda o corpo de sempre, que volta na saída.
   *   · caixas — os muros do Campo são RETÂNGULOS girados, não círculos: um círculo que
   *     cobrisse um muro de 8 m engoliria 4 m de cada lado dele. */
  var campoAtivo = false, zonaAtual = 'praca', aparenciaCampo = null, classeAvatar = null;
  var auraDoHeroi = false;
  var auraCorDoHeroi = null;   // 04/10: a aura comprada na loja (a cor do elemento); null = a branca do Colecionador
  var caixas = [];
  var CAMPO_RESERVA = { meioLado: 30, chao: {}, muros: [], tochas: [], saida: { x: 0, z: 24 }, nasce: { x: 0, z: 20 } };
  /* A SEDE POR DENTRO (04/10, dono: "os jogadores da mesma guild entrar nesse mapa (sem esses
   * pilares estratégicos) e lá dentro ser o banco da guild e o pessoal ter um chat"). É a
   * TERCEIRA cena desta máquina e anda pelos trilhos do Campo: `campoAtivo` continua
   * dizendo "cena quadrada e murada" (chão, clamp, sem Árvore), e `sedeId` diz QUAL — o id
   * da guilda. A zona é 'sede:<id>': só ganha corpo o fantasma da MESMA sede. Para fora,
   * Hub.naCampo() segue sendo só o Campo de PvP (a HUD ataca por ele). */
  var sedeId = null, sedeInfo = null, sedeObra = null;
  var SEDE_PAREDE = 11.25, SEDE_MODULOS = 9;       // meia-largura até o eixo da parede; módulos por lado
  var SEDE_CFG = { meioLado: 11, chao: { pedra: '#6b5a49', junta: '#2a211b', terra: '#5b4635' }, muros: [], tochas: [],
                   saida: { x: 0, z: 9.4 }, nasce: { x: 0, z: 6 }, tema: 'sede', borda: {}, enfeites: [], bandeiras: [] };
  function zonaDaCena() { return sedeId ? ('sede:' + sedeId) : (campoAtivo ? 'campo' : 'praca'); }
  function normZona(z) {
    if (z === 'campo') return 'campo';
    return (typeof z === 'string' && /^sede:[\w-]{1,40}$/.test(z)) ? z : 'praca';
  }
  function campoCfg() {
    if (sedeId) return SEDE_CFG;
    var C = (JOGO.DATA && JOGO.DATA.campoPvp) || CAMPO_RESERVA;
    return {
      meioLado: (+C.meioLado > 5) ? +C.meioLado : 30,
      chao: C.chao || {},
      muros: Array.isArray(C.muros) ? C.muros : [],
      tochas: Array.isArray(C.tochas) ? C.tochas : [],
      saida: C.saida || CAMPO_RESERVA.saida,
      nasce: C.nasce || CAMPO_RESERVA.nasce,
      /* 19/09: o catálogo que veste os muros, os enfeites e as bandeiras (ver o topo do
       * campo_pvp.js). 20/09: vale QUALQUER catálogo carregado — o do dono ('pvp', o lote
       * do Campo) inclusive; antes a lista era fixa em jardim/cisterna e um tema novo caía
       * calado no jardim, que foi o que aconteceu com o lote de 20/09. 'misto' alterna os
       * dois emprestados. Sem catálogo nenhum na mão, o jardim veste. */
      tema: temaDoCampo(C.tema),
      borda: C.borda || {},
      enfeites: Array.isArray(C.enfeites) ? C.enfeites : [],
      bandeiras: Array.isArray(C.bandeiras) ? C.bandeiras : null
    };
  }
  /* 20/09: o tema do Campo é válido se há catálogo com esse nome (JOGO.CENARIO), ou se é
   * 'misto' (alterna jardim e cisterna). O lote do dono chega como 'pvp'. */
  function temaDoCampo(t) {
    if (t === 'misto') return t;
    var cat = JOGO.CENARIO || {};
    if (t && cat[t]) return t;
    return cat.pvp ? 'pvp' : 'garden';
  }
  function naZona(reg) {
    var z = reg && reg.perfil && reg.perfil.zona;
    return normZona(z) === zonaAtual;
  }
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
  /* 12/09 (dono: "precisa afastar mais a arena... e organizar mais as
   * barracas; se for preciso aumente esse mapa"). A praça foi de 40 para 50:
   * com os corredores dos portais ocupando 15 m para dentro do arco, a arena
   * de 24 m de vão não tinha como ficar no oeste sem invadir um deles. Com
   * 50, o arco dos portais, a arena, a Sede e a rua das barracas ficam em
   * quatro faixas que não se encostam.
   * 19/09 (dono, com foto: "melhore a praça central pois o portal do mapa pvp
   * está no meio... se for necessário aumente o mapa geral para encaixar esse
   * pvp. Os portais de calabouços e muros preciso manter nesse padrão"). A
   * praça foi de 50 para 58 (lado 116 m): a entrada do Campo deixou o gramado
   * de dentro do anel e virou o SÉTIMO PORTÃO do arco, com o mesmo corredor
   * dos portais — e um corredor de 20 m de fundo por 11 de boca não cabia no
   * oeste sem o mapa crescer E o quarteirão da batalha (Arena, Poço, Forja)
   * descer para o canto sudoeste. Medido (scratchpad/praca_geo.js): 54 é o
   * menor R em que todas as réguas fecham (sobra 0,57 m); com 58 a pior sobra
   * é 1,66 m, margem para a arte girar. O arco dos seis NÃO mudou (mesmos
   * ângulos, passo e ordem): só o raio dele cresce com R. */
  var RAIO_MAPA = 58;
  /* O ARCO DOS PORTAIS, num lugar só: o primeiro ângulo, o passo entre vizinhos
   * e o raio (fração do meio-lado). montaPortais lê daqui e o portão do Campo
   * fica no mesmo leque, ARCO_CAMPO a oeste do portal 0 (PRACA.campo).
   * 22/09 (dono, com foto: "afaste um pouco o portal e seus muros de pvp dos portais
   * de calabouços"): o portão era o dente seguinte, a um passo (0,44), e os muros da
   * fileira dele ficavam a 1,41 m dos da Estufa — as duas pistas liam como uma só.
   * Com 0,60 sobram 6,25 m de grama de muro a muro (scratchpad/oeste.js). */
  var ARCO_A0 = -1.10, ARCO_PASSO = 0.44, ARCO_R = 0.75, ARCO_CAMPO = 0.60;
  /* o tronco da Árvore-Mundo é SÓLIDO: quem anda desliza por fora dele */
  var TRONCO_RAIO = 4.6;
  /* AS MEDIDAS DO CORREDOR DO PORTAL, num lugar só — a prova
   * (tests/corredores.html) as lê por Hub._corredorMedidas() em vez de
   * repetir número, que era como a prova passava a mentir depois de um
   * ajuste de cenário. */
  var CORREDOR = {
    comp: 12.5,        // da boca até o portal
    fundo: 6.2,        // o quanto o fundo passa atrás do portal
    larg: 4.2,         // meia-largura do corredor
    camDe: -3.2,       // onde o corredor abre na câmara do portal
    camLarg: 5.2,      // meia-largura da câmara
    bocaLarg: 3.6,     // os pilares da boca entram um pouco (vizinho perto)
    chefeD: 2.8,       // o chefe, atrás do portal
    chefeFolga: 0.45,  // entre o corpo do chefe e a face do muro
    muroR: 1.9,        // o raio sólido de uma peça de muro
    alt: 3.4,          // a altura do muro
    /* 20/09: O CORREDOR DO PORTÃO do Campo é outro bicho — ABERTO no fim. O portal de
     * espadas do dono tem 9,5 m de largura por 7,8 de fundo (mais que a pista de 8,4),
     * então a fileira começa 1 m mais longe e PARA a 6,5 m do meio do arco: a ponta do
     * muro não entra no leque de lâminas. Sem câmara, sem degrau e sem fundo — quem chega
     * ao fim do caminho entra no arco. `teto` e `fundura` peneiram os módulos: na praça a
     * peça é escalada INTEIRA (plantaTema), então só entra o módulo que chega aos 3,4 m
     * dentro de 4,9 m de largura e sem comer mais de 2,0 m de pista. */
    portao: { comp: 13.5, fim: -6.5, passo: 3.4, teto: 4.9, fundura: 2.0 }
  };
  /* AS CONTAS QUE FIXARAM ESSES NÚMEROS (12/09, com RAIO_MAPA 50) — medidas,
   * não gosto. Os números entre parênteses são os de hoje (19/09, R 58: o
   * arco cresceu com o mapa e as folgas só aumentaram):
   *   · os portais vizinhos do arco estão a 2·37,5·sen(0,22) = 16,37 m um do
   *     outro (hoje 2·43,5·sen(0,22) = 18,99 m) — e NÃO os ~13 m que um
   *     comentário antigo dizia: aquilo era com RAIO_MAPA 40. A corda cresce
   *     com a profundidade: 15,05 m em d=-3,2 (hoje 17,6).
   *   · uma câmara de 6,6 de meia-largura punha os muros de duas saletas
   *     vizinhas a 2,87 m entre centros — sólidos de 1,9 sobrepostos em
   *     0,93 m, a cunha entre os corredores desaparecendo e o arco virando
   *     parede corrida. Com 5,2 sobrava ~1,2 m de folga real (hoje 8,23 m
   *     entre os muros das câmaras vizinhas).
   *   · o corredor encurtou de 15 para 12,5 porque na boca a corda é menor
   *     (10,9 m em d=-12,5; hoje 13,5): com 15 as duas bocas se
   *     interpenetravam — os pilares ficavam a 1,4 m entre centros. Com 12,5
   *     e a boca fechando para 3,6 sobravam 3,7 m entre pilares vizinhos
   *     (hoje 6,24). */

  /* A câmera 3D: a MESMA gramática da batalha — arrastar orbita e inclina,
   * roda dá zoom, toque curto age. Orbita em volta DO HERÓI: no mapa aberto o
   * corpo é a âncora, e deslocar o pivô para longe do próprio personagem é se
   * perder num minimapa. maxDist acompanhou o mapa novo (19/09: 56 para o
   * meio-lado 58 — a mesma proporção de 48 para 50, "afastar até ver quase
   * tudo"; a névoa começa a 1,4·R e não engole o afastamento máximo). */
  var cam = { ang: 0.0, tilt: 0.95, dist: 20,
              minDist: 7, maxDist: 56, minTilt: 0.35, maxTilt: 1.25 };
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
   * pegar o carimbo. Desde 12/09 a praça é de grama e esta textura veste só
   * o pátio da ANTESSALA (30 m): a repetição é FIXA (19/09) — era RAIO_MAPA/2
   * e a lajota da antessala encolhia toda vez que a praça crescia. */
  var texLajotas = null;
  function texturaLajotas() {
    if (texLajotas) return texLajotas;
    var cv = document.createElement('canvas');
    cv.width = 256; cv.height = 256;
    pintaLajotas(cv.getContext('2d'));
    var tex = new THREE.CanvasTexture(cv);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(25, 25);
    if (THREE.sRGBEncoding != null) tex.encoding = THREE.sRGBEncoding;
    texLajotas = tex;
    return tex;
  }
  /* 14/09: o DESENHO das lajotas saiu da textura para uma função que só pinta um canvas
   * 2D de 256 px — sem THREE e sem o Acampamento de pé. É ela que o tabuleiro da praça
   * tática (renderer3d_v2, tema 'praca') usa: a mesma pedra nos dois mapas, sem cópia. */
  function pintaLajotas(g) {
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
  }

  /* A GRAMA DA PRAÇA (12/09, pedido do dono: "troque o chão da praça por
   * grama"). Mesmo truque das lajotas: um tile de 256px em canvas, 4×4 m, que
   * se repete. Fundo verde, manchas mais claras e mais escuras e tufos de
   * folhinhas — tudo de um gerador SEMEADO, para a praça ser a mesma em toda
   * visita. As bordas do tile dão a volta (cada traço é desenhado também do
   * outro lado), senão a emenda aparece a cada 4 m. */
  var texGrama = null;
  function texturaGrama() {
    if (texGrama) return texGrama;
    var cv = document.createElement('canvas');
    cv.width = 256; cv.height = 256;
    pintaGrama(cv.getContext('2d'));
    var tex = new THREE.CanvasTexture(cv);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    if (THREE.sRGBEncoding != null) tex.encoding = THREE.sRGBEncoding;
    texGrama = tex;
    return tex;
  }
  // 14/09: como pintaLajotas — só o canvas 2D, para o tabuleiro da praça tática reusar
  function pintaGrama(g) {
    var semente = 1234567;
    function sorte() { semente = (semente * 1103515245 + 12345) % 2147483648; return semente / 2147483648; }
    function emVolta(desenha) {
      for (var ox = -256; ox <= 256; ox += 256) {
        for (var oy = -256; oy <= 256; oy += 256) desenha(ox, oy);
      }
    }
    g.fillStyle = '#4c7a34';
    g.fillRect(0, 0, 256, 256);
    // manchas grandes e suaves: o gramado não é uma cor chapada
    for (var m = 0; m < 26; m++) {
      var mx = sorte() * 256, my = sorte() * 256, mr = 18 + sorte() * 34;
      var clara = sorte() < 0.5;
      var cor = clara ? 'rgba(120,170,72,0.22)' : 'rgba(34,66,26,0.26)';
      emVolta(function (ox, oy) {
        var gr = g.createRadialGradient(mx + ox, my + oy, 0, mx + ox, my + oy, mr);
        gr.addColorStop(0, cor);
        gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr;
        g.fillRect(mx + ox - mr, my + oy - mr, mr * 2, mr * 2);
      });
    }
    // as folhinhas: traços curtos em tons de verde
    g.lineCap = 'round';
    for (var f = 0; f < 1400; f++) {
      var fx = sorte() * 256, fy = sorte() * 256;
      var ang = -Math.PI / 2 + (sorte() - 0.5) * 1.3, len = 3 + sorte() * 5;
      var tom = sorte();
      g.strokeStyle = tom < 0.33 ? 'rgba(98,148,60,0.9)' : tom < 0.66 ? 'rgba(62,104,40,0.9)' : 'rgba(140,186,86,0.7)';
      g.lineWidth = 1 + sorte() * 0.8;
      var dx = Math.cos(ang) * len, dy = Math.sin(ang) * len;
      emVolta(function (ox, oy) {
        g.beginPath();
        g.moveTo(fx + ox, fy + oy);
        g.lineTo(fx + ox + dx, fy + oy + dy);
        g.stroke();
      });
    }
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
  /* O BRASÃO da placa é o MESMO da ficha: o desenho mora em js/ui/brasao.js
   * (antes havia uma cópia aqui, e as duas já divergiam). Sem o arquivo, a
   * placa fica só com o nome — nunca quebra a praça por causa de um escudo. */
  function desenhaBrasao(g, x, y, tam, cod) {
    var B = (typeof JOGO !== 'undefined') ? JOGO.Brasao : null;
    if (B) B.desenha(g, x, y, tam, cod);
  }

  /* As quatro luzes que um nome pode ter. `borrao` é o raio da sombra
   * colorida; o branco do Mestre é o mais largo de todos de propósito. */
  var BRILHOS = {
    ouro:   { cor: '#ffc83a', texto: '#fff0c0', borrao: 20, fundo: 'rgba(42,30,6,0.92)' },
    prata:  { cor: '#cfd8e3', texto: '#ffffff', borrao: 17, fundo: 'rgba(26,30,36,0.92)' },
    bronze: { cor: '#c9793a', texto: '#ffd9b8', borrao: 15, fundo: 'rgba(38,24,12,0.92)' },
    admin:  { cor: '#ffffff', texto: '#ffffff', borrao: 26, fundo: 'rgba(18,20,26,0.94)' }
  };
  function rotulo(texto, cor, escala, op) {
    /* O BRASÃO na placa da guilda (11/09, dono: "logo tem que ser maior; o
     * retângulo do logo e nome da guilda deve ser maior, onde caiba o logo").
     * O escudo passou a 132 px e a placa CRESCEU para caber nele inteiro: a
     * tela do rótulo vai a 512×176 quando há brasão (sem brasão continua
     * 512×128, do tamanho de sempre). A escala do sprite acompanha a altura
     * da tela, senão a placa sairia esticada. */
    /* O TÍTULO DENTRO DA PLACA (11/09, dono: "esse título deve ficar dentro
     * e abaixo do nome do jogador"). Ele vinha numa placa própria, solta
     * embaixo — duas molduras para uma pessoa só, e a de baixo boiando. Vira
     * a segunda linha desta, em corpo menor e dourado, e a tela cresce o
     * tanto que a linha pede. */
    var temEscudo = !!(op && op.escudo);
    var subtexto = (op && op.subtexto) ? String(op.subtexto) : '';
    var ALT = temEscudo ? 176 : (subtexto ? 168 : 128);
    var ESCUDO_PX = temEscudo ? 132 : 0;
    var cv = document.createElement('canvas');
    cv.width = 512; cv.height = ALT;
    var g = cv.getContext('2d');
    g.font = '600 44px Georgia, serif';
    
    var paddingShield = temEscudo ? ESCUDO_PX + 6 : 0;
    var textW = Math.ceil(g.measureText(texto).width);
    if (subtexto) {
      g.font = 'italic 600 32px Georgia, serif';
      textW = Math.max(textW, Math.ceil(g.measureText(subtexto).width));
      g.font = '600 44px Georgia, serif';
    }
    var larg = Math.min(492, textW + 56 + paddingShield);
    var x0 = (512 - larg) / 2;
    var mY = temEscudo ? 12 : 18;                 // margem de cima e de baixo
    var altPlaca = ALT - mY * 2;

    /* O NOME QUE BRILHA (11/09, pedido do dono): o pódio do ranking POR
     * CLASSE e o admin do sistema não se anunciam com um texto ao lado —
     * o nome deles ACENDE. Ouro, prata e bronze para o 1º, 2º e 3º de
     * qualquer classe; branco, mais forte que os três, para o Mestre do
     * Fundo. O filete da placa vai na mesma cor (a placa de GRUPO tem
     * dourado próprio e fica com o dela — só o texto acende). */
    var bri = op && op.brilho ? BRILHOS[op.brilho] : null;

    if (op && op.placa) {
      var traco = op.traco || (bri ? 7 : 5);
      g.fillStyle = op.fundo || (bri ? bri.fundo : 'rgba(24,18,10,0.88)');
      g.fillRect(x0, mY, larg, altPlaca);
      g.strokeStyle = op.borda || (bri ? bri.cor : '#c9a227');
      g.lineWidth = traco;
      g.strokeRect(x0 + traco / 2, mY + traco / 2, larg - traco, altPlaca - traco);
    }
    
    // o escudo mora DENTRO da moldura agora, encostado na borda esquerda
    if (temEscudo) desenhaBrasao(g, x0 + 10, (ALT - ESCUDO_PX) / 2, ESCUDO_PX, op.escudo);

    g.shadowColor = 'rgba(0,0,0,.85)'; g.shadowBlur = 10;
    g.fillStyle = cor || '#f0ead8';
    if (bri) {
      // o brilho é o MESMO texto escrito três vezes com sombra colorida: é
      // assim que um canvas acende sem passe de pós-processamento
      g.shadowColor = bri.cor;
      g.shadowBlur = bri.borrao;
      g.fillStyle = bri.texto;
    }
    
    var tx = temEscudo ? (x0 + 10 + paddingShield) : 256;
    // com título, o nome sobe para abrir espaço à linha de baixo
    var ty = ALT / 2 + (subtexto ? -2 : 16);
    g.textAlign = temEscudo ? 'left' : 'center';
    g.fillText(texto, tx, ty);
    if (bri) { g.fillText(texto, tx, ty); g.fillText(texto, tx, ty); }
    if (subtexto) {
      g.font = 'italic 600 32px Georgia, serif';
      g.shadowColor = 'rgba(0,0,0,.85)'; g.shadowBlur = 8;
      g.fillStyle = bri ? bri.cor : '#e8c25a';
      g.fillText(subtexto, tx, ty + 42);
    }

    var tex = new THREE.Texture(cv);
    tex.needsUpdate = true;
    if (THREE.sRGBEncoding != null) tex.encoding = THREE.sRGBEncoding;
    var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    var e = escala || 1;
    // a altura do sprite segue a da tela (512 px = 6.4 de mundo): tela mais
    // alta, placa mais alta — nunca esticada
    sp.scale.set(6.4 * e, (ALT / 80) * e, 1);
    return sp;
  }

  /* O BALÃO DE FALA (11/09, pedido do dono: "quando mandar mensagem deve
   * aparecer um balão em cima do personagem"). A frase do chat da praça sobe
   * num balão claro acima de tudo o que o corpo carrega (placa, guilda,
   * coroa) e some sozinha em BALAO_S; frase nova troca a velha. Até 3
   * linhas — o resto vira reticências (a frase inteira fica no chat). */
  var BALAO_S = 6;
  function balaoSprite(texto) {
    var cv = document.createElement('canvas');
    cv.width = 512; cv.height = 256;
    var g = cv.getContext('2d');
    g.font = '600 34px system-ui, "Segoe UI", Roboto, sans-serif';
    var LARG = 440, MAXL = 3;
    var palavras = String(texto || '').replace(/\s+/g, ' ').trim().split(' ');
    var linhas = [], atual = '', cortou = false;
    for (var i = 0; i < palavras.length; i++) {
      var tenta = atual ? atual + ' ' + palavras[i] : palavras[i];
      if (g.measureText(tenta).width <= LARG) { atual = tenta; continue; }
      if (atual) linhas.push(atual);
      atual = palavras[i];
      while (g.measureText(atual).width > LARG && atual.length > 1) {   // palavra sem fim: corta no meio
        var n = atual.length;
        while (n > 1 && g.measureText(atual.slice(0, n)).width > LARG) n--;
        linhas.push(atual.slice(0, n));
        atual = atual.slice(n);
      }
      if (linhas.length >= MAXL) { cortou = true; break; }
    }
    if (!cortou && atual) linhas.push(atual);
    if (linhas.length > MAXL) { linhas.length = MAXL; cortou = true; }
    if (cortou) {
      var ult = linhas[MAXL - 1] || '';
      while (ult && g.measureText(ult + '…').width > LARG) ult = ult.slice(0, -1);
      linhas[MAXL - 1] = ult + '…';
    }
    var passo = 42, h = linhas.length * passo + 30, larg = 0;
    for (var k = 0; k < linhas.length; k++) larg = Math.max(larg, g.measureText(linhas[k]).width);
    larg = Math.min(496, Math.max(110, larg + 52));
    var x0 = (512 - larg) / 2, y0 = 256 - 28 - h, r = 22;
    g.beginPath();
    g.moveTo(x0 + r, y0);
    g.arcTo(x0 + larg, y0, x0 + larg, y0 + h, r);
    g.arcTo(x0 + larg, y0 + h, x0, y0 + h, r);
    g.arcTo(x0, y0 + h, x0, y0, r);
    g.arcTo(x0, y0, x0 + larg, y0, r);
    g.closePath();
    g.fillStyle = 'rgba(250,246,236,0.96)';
    g.strokeStyle = 'rgba(46,36,20,0.9)';
    g.lineWidth = 4;
    g.fill();
    g.stroke();
    // o rabinho, no meio de baixo, apontando para a cabeça (cobre o traço da borda)
    g.beginPath();
    g.moveTo(256 - 17, y0 + h - 3); g.lineTo(256, y0 + h + 24); g.lineTo(256 + 17, y0 + h - 3);
    g.closePath();
    g.fill();
    g.beginPath();
    g.moveTo(256 - 17, y0 + h); g.lineTo(256, y0 + h + 24); g.lineTo(256 + 17, y0 + h);
    g.stroke();
    g.fillStyle = '#1d1a14';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (var j = 0; j < linhas.length; j++) g.fillText(linhas[j], 256, y0 + 15 + passo * (j + 0.5));
    var tex = new THREE.Texture(cv);
    tex.needsUpdate = true;
    if (THREE.sRGBEncoding != null) tex.encoding = THREE.sRGBEncoding;
    var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    sp.scale.set(3.2, 1.6, 1);
    sp.center.set(0.5, 0);         // a ponta de baixo (o rabinho) fica no ponto: o balão cresce para cima
    sp.renderOrder = 5;
    return sp;
  }
  /* o alto do que o corpo carrega: a placa do nome, a da guilda e a coroa */
  function topoDoCorpo(corpo) {
    var topo = (corpo.node.userData.height || 2.1) + 0.2;
    [corpo.plaquinha, corpo.plaquinhaGuilda].forEach(function (s) {
      if (s) topo = Math.max(topo, s.position.y + s.scale.y * 0.5);
    });
    if (corpo.coroaPvp) {
      var bc = corpo.coroaPvp.userData.baseY;
      topo = Math.max(topo, (typeof bc === 'number' ? bc : corpo.coroaPvp.position.y) + 0.45);
    }
    return topo;
  }
  function tiraBalao(corpo) {
    if (!corpo || !corpo.balao) return;
    corpo.node.remove(corpo.balao);
    try { corpo.balao.material.map.dispose(); corpo.balao.material.dispose(); } catch (e) {}
    corpo.balao = null;
  }
  function falaEm(corpo, texto) {
    if (!corpo || !corpo.node || !THREE || !String(texto || '').trim()) return false;
    tiraBalao(corpo);
    var sp = balaoSprite(texto);
    sp.position.y = topoDoCorpo(corpo) + 0.08;
    corpo.node.add(sp);
    corpo.balao = sp;
    corpo.balaoAte = relogio + BALAO_S;
    return true;
  }

  // ------------------------------------------------------------------- a cena
  function montaCena() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0d1512);
    // névoa recalibrada para o mapa grande: no ajuste antigo ela engoliria
    // metade da praça nova antes de o jogador dar dez passos
    scene.fog = new THREE.Fog(0x0d1512, raioAtual() * 1.4, raioAtual() * 3.4);

    var hemi = new THREE.HemisphereLight(0xcfe8d8, 0x1a2420, 0.95);
    scene.add(hemi);
    var sol = new THREE.DirectionalLight(0xffe9c4, 1.05);
    sol.position.set(12, 22, 8);
    scene.add(sol);
    if (campoAtivo) {
      /* 14/09: o Campo é fim de tarde — céu de brasa, luz baixa e quente, para as tochas
       * lerem e o lugar não parecer a praça com outro chão.
       * 19/09 (dono, com foto: "o mapa pvp está muito ruim" — a foto era escura e marrom,
       * os corpos não recortavam): o fim de tarde ficou LEGÍVEL. O céu e a névoa ganharam
       * brasa de verdade (0x3a2118, e a névoa só começa a 1,7 meio-lado: antes engolia os
       * cantos do próprio Campo), a luz de céu subiu para 0,95 num âmbar claro, o sol
       * desceu para o oeste (x negativo, baixo: 14 de altura para 24 de lado) e ficou mais
       * forte, e entrou um CONTRALUZ frio do norte-alto (0x8fb4ff, 0,55) — a câmera nasce
       * ao sul olhando o norte, então a luz de trás acende ombros e cabeça e o herói
       * recorta do chão quente. A mesma tríade (quente de um lado, frio do outro) que a
       * praça já usa sem saber, com a hemisférica verde. */
      scene.background = new THREE.Color(0x3a2118);
      scene.fog = new THREE.Fog(0x3a2118, raioAtual() * 1.7, raioAtual() * 4.2);
      hemi.color.set(0xffd9b0); hemi.groundColor.set(0x4a3128); hemi.intensity = 0.95;
      sol.color.set(0xffb576); sol.intensity = 1.35;
      sol.position.set(-24, 14, 10);
      var contraluz = new THREE.DirectionalLight(0x8fb4ff, 0.55);
      contraluz.position.set(8, 16, -26);
      scene.add(contraluz);
    }

    if (sedeId) {
      // o salão é INTERIOR: fundo quase preto, sem névoa por perto, luz âmbar de lareira
      scene.background = new THREE.Color(0x120d0a);
      scene.fog = new THREE.Fog(0x120d0a, 60, 160);
      hemi.color.set(0xffe2bd); hemi.groundColor.set(0x3a2a20); hemi.intensity = 1.0;
      sol.color.set(0xffd9a8); sol.intensity = 0.85;
      sol.position.set(-6, 20, 12);
    }
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
      new THREE.MeshBasicMaterial({ color: campoAtivo ? 0x2a1710 : 0x121a14 })
    );
    fundo.rotation.x = -Math.PI / 2;
    fundo.position.y = -0.02;
    scene.add(fundo);

    camera = new THREE.PerspectiveCamera(46, 1, 0.1, 300);

    // a antessala é OUTRA cena: pátio murado, porta e saída — sem praça
    if (salaAtual) { montaSala(); return; }
    // o Campo de PvP também (14/09): muros, tochas e o portal de volta — sem praça
    if (campoAtivo) { if (sedeId) montaSedeDentro(); else montaCampo(); return; }

    montaPortais();
    montaBanco();
    montaMercado();
    montaArena();
    montaSede();
    montaForja();
    montaLoteria();
    montaPoco();
    montaEntradaCampo();             // 14/09: o portal vermelho do Campo de PvP (antes do caminho: ganha ramal)
    montaCaminhos();
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
    r.position.y = 5.0;              // 13/09: acima do topo do aro (4,06), não em cima dele
    g.add(r);
    g.position.set(0, 0, -R * 0.72);
    g.lookAt(0, 0, 0);
    g.scale.setScalar(1.3);
    scene.add(g);
    lugares.push({ id: 'porta', tipo: 'porta', nome: 'Para a batalha',
                   pos: new THREE.Vector3(0, 0, -R * 0.72), raio: 4.2, node: g, miolo: miolo });
    /* A SAÍDA: UM PORTAL, NÃO UMA ESCADA (12/09, pedido do dono: "as salas de
     * espera, ao invés de ter uma escada, deve ter um portal de saída").
     * Eram dois degraus de pedra — e degrau é um enfeite, não uma porta: numa
     * sala murada, no fundo de um calabouço, o jogador não lia aquilo como o
     * caminho de volta. Agora é o mesmo arco da porta da batalha, na metade do
     * tamanho e na cor da SAÍDA em vez da cor do tema: lado a lado, a porta do
     * tema leva para dentro e a outra leva para fora — a diferença de cor diz
     * para onde vai sem precisar ler o rótulo.
     * 13/09, dono: "o portal deve ser VERMELHO para identificar a saída, e o
     * nome em cima". O branco-azulado sumia contra os muros e o chão claros;
     * vermelho é a cor de "sair" que todo mundo já lê. O aro também fica
     * vermelho (com brilho próprio, para não virar marrom na sombra). */
    var s = new THREE.Group();
    var corSaida = new THREE.Color(0xe0352b);
    var aroS = new THREE.Mesh(
      new THREE.TorusGeometry(1.7, 0.26, 12, 40),
      new THREE.MeshStandardMaterial({ color: 0x9a2320, emissive: 0x4a0a08, roughness: 0.7 })
    );
    aroS.position.y = 2.1;
    s.add(aroS);
    var mioloS = new THREE.Mesh(
      new THREE.CircleGeometry(1.5, 32),
      new THREE.MeshBasicMaterial({ color: corSaida, transparent: true, opacity: 0.42,
                                    side: THREE.DoubleSide, depthWrite: false })
    );
    mioloS.position.y = 2.1;
    s.add(mioloS);
    var baseS = new THREE.Mesh(
      new THREE.CylinderGeometry(1.9, 2.2, 0.5, 24),
      new THREE.MeshStandardMaterial({ color: 0x4a443c, roughness: 1 })
    );
    baseS.position.y = 0.25;
    s.add(baseS);
    // o rótulo é um sprite de tamanho fixo: perto da câmera (a saída fica
    // do lado do herói) ele enchia a tela — menor, e a saída vai para o LESTE,
    // fora da linha câmera→herói→porta. 13/09: EM CIMA do aro — a 3,6 o
    // sprite (~1 de altura) ficava atrás do arco, cujo topo está em 4,06
    var r2 = rotulo('Sair do calabouço', '#ffd2cb');
    r2.position.y = 4.9;
    r2.scale.multiplyScalar(0.62);
    s.add(r2);
    s.position.set(R * 0.82, 0, R * 0.30);
    // o portal encara o meio do pátio, como o da batalha — e não o eixo fixo
    // que os degraus usavam (uma caixa não tem frente, um arco tem)
    s.lookAt(0, 0, 0);
    s.scale.setScalar(0.78);
    scene.add(s);
    lugares.push({ id: 'saida', tipo: 'saida', nome: 'Sair do calabouço',
                   pos: new THREE.Vector3(R * 0.82, 0, R * 0.30), raio: 3.6,
                   node: s, miolo: mioloS });
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
  // ============================================================ O CAMPO DE PVP (14/09)
  /* A PEDRA DO CAMPO: dois tiles de 256 px em canvas, semeados (o Campo é o mesmo em toda
   * visita), como a grama e as lajotas da praça.
   * 19/09 (dono, com foto: "o mapa pvp está muito ruim" — o chão era um tijolo gigante e
   * escuro): `chao` voltou a ser LAJOTA, a mesma régua da praça (pintaLajotas: 4 lajotas
   * por tile de 4 m, padrão corrido, tom por hash), num tom TERROSO e mais escuro, com
   * rachaduras finas e pó por cima — arena de terra batida sobre pedra velha, não calçada
   * nova. As cores vêm do campo_pvp.js (`chao`): `pedra` é o tom-base das lajotas, `junta`
   * as juntas e as rachaduras, `terra` o pó que mancha. `muro` (4 fiadas de blocos por
   * tile de 2 m) só veste as PRIMITIVAS PROVISÓRIAS — o bloco que segura a vaga até o
   * módulo do dono decodificar no jogo servido. As rachaduras e o pó dão a volta no tile,
   * senão a emenda aparece a cada 4 m. */
  var texCampo = {};
  function texturaCampo(tipo, cores) {
    var chave = tipo + '|' + JSON.stringify(cores || {});
    if (texCampo[chave]) return texCampo[chave];
    var cv = document.createElement('canvas');
    cv.width = cv.height = 256;
    var g = cv.getContext('2d');
    var semente = tipo === 'muro' ? 424242 : 777001;
    function sorte() { semente = (semente * 1103515245 + 12345) % 2147483648; return semente / 2147483648; }
    if (tipo === 'muro') {
      g.fillStyle = '#2b2724';
      g.fillRect(0, 0, 256, 256);
      for (var j = 0; j < 4; j++) {
        for (var i = -1; i < 3; i++) {
          var bx = i * 128 + (j % 2) * 64, by = j * 64;
          var tom = 84 + Math.floor(sorte() * 26);
          g.fillStyle = 'rgb(' + tom + ',' + (tom - 4) + ',' + (tom - 9) + ')';
          g.fillRect(bx + 3, by + 3, 122, 58);
          g.fillStyle = 'rgba(255,255,255,0.08)';        // luz na aresta de cima
          g.fillRect(bx + 3, by + 3, 122, 4);
          g.fillStyle = 'rgba(0,0,0,0.18)';              // sombra na de baixo
          g.fillRect(bx + 3, by + 55, 122, 6);
        }
      }
    } else {
      var c = cores || {};
      var pedra = new THREE.Color(c.pedra || '#5e5248'), terra = new THREE.Color(c.terra || '#4a3a2e');
      var junta = c.junta || '#2a2320';
      g.fillStyle = junta;
      g.fillRect(0, 0, 256, 256);
      // as lajotas: a régua da praça (4 por tile, padrão corrido, tom por hash de índice)
      var NL = 4, lado = 256 / NL, jt = 6;
      for (var jj = 0; jj < NL; jj++) {
        var desloca = (jj % 2) * (lado / 2);
        for (var ii = -1; ii <= NL; ii++) {
          var h = ((ii * 7 + jj * 13 + 5) * 2654435761) % 100;
          var k = 0.80 + (h % 31) / 100;                 // 0,80..1,10 do tom-base
          g.fillStyle = 'rgb(' + Math.round(pedra.r * 255 * k) + ',' + Math.round(pedra.g * 255 * k) + ',' +
                        Math.round(pedra.b * 255 * k) + ')';
          var lx = ii * lado + desloca + jt / 2, ly = jj * lado + jt / 2;
          g.fillRect(lx, ly, lado - jt, lado - jt);
          g.fillStyle = 'rgba(255,236,210,0.07)';         // o fio de luz de cima
          g.fillRect(lx, ly, lado - jt, 3);
          g.fillStyle = 'rgba(0,0,0,0.16)';               // e a sombra de baixo
          g.fillRect(lx, ly + lado - jt - 4, lado - jt, 4);
        }
      }
      // rachaduras finas, em zigue-zague (dão a volta no tile)
      g.strokeStyle = junta;
      g.lineWidth = 1.5;
      g.lineCap = 'round';
      for (var r = 0; r < 14; r++) {
        var rx = sorte() * 256, ry = sorte() * 256, ang = sorte() * Math.PI * 2, segs = 2 + Math.floor(sorte() * 3);
        var pontos = [[rx, ry]];
        for (var s = 0; s < segs; s++) {
          ang += (sorte() - 0.5) * 1.4;
          var len = 6 + sorte() * 12;
          pontos.push([pontos[s][0] + Math.cos(ang) * len, pontos[s][1] + Math.sin(ang) * len]);
        }
        for (var ox = -256; ox <= 256; ox += 256) {
          for (var oy = -256; oy <= 256; oy += 256) {
            g.beginPath();
            for (var q = 0; q < pontos.length; q++) {
              if (q === 0) g.moveTo(pontos[q][0] + ox, pontos[q][1] + oy); else g.lineTo(pontos[q][0] + ox, pontos[q][1] + oy);
            }
            g.stroke();
          }
        }
      }
      // pó e terra por cima (dão a volta no tile)
      var tr = Math.round(terra.r * 255) + ',' + Math.round(terra.g * 255) + ',' + Math.round(terra.b * 255);
      for (var m = 0; m < 40; m++) {
        var sx = sorte() * 256, sy = sorte() * 256, sr = 3 + sorte() * 11, escura = sorte() < 0.5;
        for (var ox2 = -256; ox2 <= 256; ox2 += 256) {
          for (var oy2 = -256; oy2 <= 256; oy2 += 256) {
            g.fillStyle = escura ? 'rgba(0,0,0,0.09)' : 'rgba(' + tr + ',' + (0.12 + sorte() * 0.14).toFixed(2) + ')';
            g.beginPath();
            g.ellipse(sx + ox2, sy + oy2, sr, sr * 0.65, sorte() * 3, 0, Math.PI * 2);
            g.fill();
          }
        }
      }
    }
    var tex = new THREE.CanvasTexture(cv);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    if (THREE.sRGBEncoding != null) tex.encoding = THREE.sRGBEncoding;
    texCampo[chave] = tex;
    return tex;
  }
  /* o uv de uma caixa em METROS (m por tile): o de fábrica vai de 0 a 1 em cada face, e
   * um muro de 8 m esticaria o mesmo desenho de um pilar de 1,6 m. Faces da BoxGeometry:
   * +x, -x, +y, -y, +z, -z, quatro vértices cada. */
  function uvDeCaixa(geo, sx, sy, sz, m) {
    var uv = geo.attributes.uv;
    var dims = [[sz, sy], [sz, sy], [sx, sz], [sx, sz], [sx, sy], [sx, sy]];
    for (var f = 0; f < 6; f++) {
      for (var v = 0; v < 4; v++) {
        var i = f * 4 + v;
        uv.setXY(i, uv.getX(i) * dims[f][0] / m, uv.getY(i) * dims[f][1] / m);
      }
    }
    uv.needsUpdate = true;
  }
  /* O CHÃO DO CAMPO (19/09): o quadrado de lajotas (2 m além do meio-lado, para a borda de
   * ruína assentar em pedra e não no escuro), o CÍRCULO DA ARENA no centro — um disco das
   * mesmas lajotas um tom mais claro, um anel de pedra clara em volta e um anel fino no
   * miolo: a marca do lugar onde se cruza a espada — e o MEIO-FIO de pedra escura correndo
   * por dentro da borda, como o da praça. `chao.arena` no campo_pvp.js é o raio do disco
   * (0 = sem arena). O uv do disco é o do quadrado (mundo/4): as lajotas continuam de um
   * para o outro sem emenda. */
  function chaoDoCampo() {
    var C = campoCfg(), R = C.meioLado, lado = R * 2 + 4;
    var g = new THREE.Group();
    var geo = new THREE.PlaneGeometry(lado, lado);
    var uv = geo.attributes.uv;
    for (var i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * lado / 4, uv.getY(i) * lado / 4);   // 4 m por tile
    var tex = texturaCampo('chao', C.chao);
    var quad = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 1 }));
    quad.rotation.x = -Math.PI / 2;
    g.add(quad);
    var rA = (C.chao && +C.chao.arena > 0) ? +C.chao.arena : 0;
    if (rA > 0) {
      var geoD = new THREE.CircleGeometry(rA, 48), pos = geoD.attributes.position, uvD = geoD.attributes.uv;
      for (var k = 0; k < uvD.count; k++) uvD.setXY(k, (pos.getX(k) + lado / 2) / 4, (pos.getY(k) + lado / 2) / 4);
      var disco = new THREE.Mesh(geoD, new THREE.MeshStandardMaterial({ map: tex, color: 0xcbbaa4, roughness: 1 }));
      disco.rotation.x = -Math.PI / 2;
      disco.position.y = 0.015;
      g.add(disco);
      // pedra clara, mas não branca — e de cor FIXA: com o sol de 1,35 do fim de tarde
      // qualquer material iluminado saía como um anel de giz na foto aérea (0xa0 e 0x6e
      // deram o mesmo branco); a marca no chão é pintura, não pedra que reflete
      var matAnel = new THREE.MeshBasicMaterial({ color: 0x6f6250 });
      var anel = new THREE.Mesh(new THREE.RingGeometry(rA, rA + 0.5, 64), matAnel);
      anel.rotation.x = -Math.PI / 2;
      anel.position.y = 0.03;
      g.add(anel);
      var miolo = new THREE.Mesh(new THREE.RingGeometry(rA * 0.42, rA * 0.42 + 0.22, 48), matAnel);
      miolo.rotation.x = -Math.PI / 2;
      miolo.position.y = 0.03;
      g.add(miolo);
    }
    // o meio-fio: quatro fiadas de pedra escura por dentro da borda de ruína (o passo para
    // a 0,94 do meio-lado; a fiada começa em 0,95 e o corpo encosta nela, não a atravessa)
    // 0x1a, não 0x2e: com o sol e o contraluz do fim de tarde somando ~2,8× a fiada
    // de 0x2e saía cinza-claro na foto aérea, um risco de giz em vez de pedra escura
    var mf = R * 0.96, matMF = new THREE.MeshStandardMaterial({ color: 0x1a1512, roughness: 1 });
    var geoMF = new THREE.BoxGeometry(mf * 2 + 0.6, 0.3, 0.6);
    [[0, -mf, 0], [0, mf, 0], [-mf, 0, Math.PI / 2], [mf, 0, Math.PI / 2]].forEach(function (p) {
      var b = new THREE.Mesh(geoMF, matMF);
      b.position.set(p[0], 0.15, p[1]);
      b.rotation.y = p[2];
      g.add(b);
    });
    g.userData.chaoCampo = 'lajotas';    // a prova confere que o tijolo antigo se foi
    return g;
  }
  /* O ARCO DE PORTAL das cenas novas (o do Campo na praça e o de volta no Campo): o
   * mesmo anel, miolo e base dos portais da praça, com o rótulo em cima do aro (13/09:
   * a 4,9, acima do topo de 4,06). `filme` usa o redemoinho dos portais tingido na cor;
   * `brilhoChao` acende um disco no chão na mesma cor — é o que lê de longe. */
  var texBrilhoVermelho = null, texBrilhoTocha = null;
  function arcoPortal(o) {
    var g = new THREE.Group();
    var aro = new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.26, 12, 40),
      new THREE.MeshStandardMaterial({ color: o.aro, emissive: o.aroBrilho || 0x000000, roughness: 0.85 }));
    aro.position.y = 2.1;
    g.add(aro);
    var tp = o.filme ? texturaPortal() : null;
    var miolo = new THREE.Mesh(new THREE.CircleGeometry(1.5, 32), tp
      ? new THREE.MeshBasicMaterial({ map: tp, color: o.cor, transparent: true, opacity: 0.85,
                                      blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false })
      : new THREE.MeshBasicMaterial({ color: o.cor, transparent: true, opacity: 0.42,
                                      side: THREE.DoubleSide, depthWrite: false }));
    miolo.position.y = 2.1;
    g.add(miolo);
    var base = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 2.2, 0.5, 24),
                              new THREE.MeshStandardMaterial({ color: 0x4a443c, roughness: 1 }));
    base.position.y = 0.25;
    g.add(base);
    if (o.brilhoChao) {
      if (!texBrilhoVermelho) {
        texBrilhoVermelho = fazTexRadial([[0, 'rgba(255,70,50,0.9)'], [0.45, 'rgba(230,40,30,0.35)'], [1, 'rgba(200,20,10,0)']]);
      }
      var disco = new THREE.Mesh(new THREE.CircleGeometry(3.6, 32),
        new THREE.MeshBasicMaterial({ map: texBrilhoVermelho, transparent: true, opacity: 0.8,
                                      blending: THREE.AdditiveBlending, depthWrite: false }));
      disco.rotation.x = -Math.PI / 2;
      disco.position.y = 0.08;
      disco.userData.semCaixa = true;          // é luz no chão, não corpo: a prova de folga não o mede
      // 20/09: a luz do chão SOBREVIVE à vestimenta (veste() varre os filhos do lugar e
      // só o rótulo escapava): sem ela, o portal do dono ficava apagado no gramado
      disco.userData.brilhoChao = true;
      g.add(disco);
    }
    var r = rotulo(o.texto, o.corTexto);
    r.position.y = 4.9;
    if (o.rotuloEsc) r.scale.multiplyScalar(o.rotuloEsc);
    g.add(r);
    return { g: g, miolo: miolo };
  }
  /* A ENTRADA DO CAMPO NA PRAÇA (14/09, "um portal de pedra com brilho VERMELHO perto da
   * Arena"). Nasceu no gramado de dentro do anel, do lado da Arena, porque por fora não
   * havia vão: entre a Arena e o corredor do primeiro portal sobravam 3,6 m (R 50).
   * 19/09 (dono, com foto: "melhore a praça central pois o portal do mapa pvp está no
   * meio... se for necessário aumente o mapa geral para encaixar esse pvp"): virou o
   * SÉTIMO PORTÃO DO ARCO — a oeste do portal 0 (PRACA.campo; desde 22/09 a ARCO_CAMPO,
   * mais que um passo, para os muros das duas fileiras não se encostarem), encarando a
   * Árvore como os outros, no mesmo porte 1,3×, e com corredor murado (plantaCantinhos lê
   * o lugar pelo `portao` e pelo `tema`: os muros do catálogo do Campo, campoCfg().tema —
   * desde 20/09 o lote de PvP do próprio dono). Duas diferenças para um portal de
   * calabouço: o corredor é RETO E ABERTO no fim (sem câmara, sem fundo — o portal de
   * espadas é mais largo que a pista e o caminho entra nele), e não há chefe — o que marca
   * o lugar são duas bandeiras vermelhas na boca (21/09, o dono: os dois braseiros do fim
   * saíram, "tire essas duas luminárias"). O arco continua vermelho e sem parede
   * (entra-se nele); o raio de conversa é 6,4, o de portal aberto, porque com 4,6 o painel
   * ficava mudo atrás do arco. Folgas (22/09, R 58, ang -1,70, Arena de 24 m; medidas no
   * jogo): conversa 6,4 ↔ 6,4 do portal 0 sobra 12,91; ↔ Arena (13) sobra 3,87; caixa do
   * portão ↔ caixa da Arena 4,23; muros da fileira ↔ muros da Estufa 6,25 e ↔ parede da
   * Arena 6,24. As provas cobram a caixa (≥ 1 m) e a conversa (tests/paredes.html) e os
   * muros ↔ Estufa (≥ 5 m, corredores.html); muro ↔ parede da Arena ninguém cobra. */
  function montaEntradaCampo() {
    if (!PRACA.campo) return;
    var pp = pontoDaPraca('campo');
    // 15/09 (foto): o redemoinho tingido lia CLARO sobre a grama e a calçada, quase azul;
    // o disco chapado vermelho (o da saída da antessala) é o que diz "vermelho" de longe
    var a = arcoPortal({ aro: 0x5a5348, aroBrilho: 0x3a0806, cor: 0xe0352b, filme: false, brilhoChao: true,
                         texto: 'Campo de PvP', corTexto: '#ff9a8a' });
    a.g.position.set(pp.x, 0, pp.z);
    a.g.lookAt(0, 0, 0);
    a.g.scale.setScalar(1.3);
    scene.add(a.g);
    /* 20/09, em dois tempos. Primeiro o dono tirou os muros EMPRESTADOS ("o campo pvp
     * não vai ter esses muros, vou fazer um específico para isso... e não será um
     * portal") e ficou o PORTAL DE ESPADAS dele sozinho no gramado (OBRAS.campo veste
     * `praca_portal_pvp`). Depois, com a arte na mão ("coloque os muros em volta desse
     * caminho pro pvp e alguns enfeites no tema"), o corredor VOLTOU — agora com os muros
     * DELE: o tema do portão é o mesmo do Campo (campoCfg().tema, hoje 'pvp'), e é por
     * `portao` + `tema` que plantaCantinhos o reconhece. O corredor do portão é aberto no
     * fim (CORREDOR.portao). O aro de pedra e a base de cilindro são só o provisório de
     * antes de o GLB abrir. */
    lugares.push({ id: 'campo', tipo: 'campo', nome: 'Campo de PvP', portao: true,
                   tema: campoCfg().tema,
                   pos: new THREE.Vector3(pp.x, 0, pp.z), raio: 6.4, node: a.g, miolo: a.miolo });
  }
  /* A CENA DO CAMPO (19/09, reescrita — dono, com foto: "o mapa pvp está muito ruim"). O
   * que havia: uma caixa de tijolo por muro do desenho, quatro caixas compridas de borda,
   * tocha de cilindro e cone — tudo primitiva, escuro e marrom, uma caixa de teste. O
   * dono vai desenhar os muros definitivos um dia; até lá o Campo tem de parecer um lugar
   * do jogo, no nível da praça e dos calabouços. Então:
   *   · cada MURO do desenho vira uma FILEIRA de módulos de muro do dono — o mesmo
   *     muroDaCasa do tabuleiro (renderer3d_v2): estica o módulo à altura pedida e a
   *     MODULO_CAMPO (2,2 m, ≈ uma casa) de largura — com um PILAR do dono em cada ponta;
   *     mureta (alt < 1,6) usa o papel 'baixo'; muro de larg ≈ prof é um pilar só. A
   *     COLISÃO continua sendo a caixa do desenho (`caixas`, foraDaCaixa): a prova conta
   *     por ela, e a pedra do dono é mais fina que a caixa — sobra a folga do corpo.
   *   · a BORDA é um quadrado de ruína: módulos do dono a ~6 m (proporção quase natural,
   *     sem esticão) em cinco vãos por lado, pilar em cada emenda e nos cantos, os quatro
   *     módulos do catálogo alternando (inteiro, brecha, ruína, mato: é ruína, não muralha).
   *     A colisão da borda NÃO é ela: é o clamp de dentroDoMapa (94% do meio-lado), como
   *     sempre foi — a fileira fica 0,2 m ALÉM do meio-lado, com a face de dentro a ~1 m
   *     do passo, e o meio-fio de pedra (chaoDoCampo) sela o vão.
   *   · as TOCHAS são BRASEIROS do kit (K.buildBrazier: tocha de pé, chama, halo que
   *     pulsa) com o disco de luz pintada no chão — luz pintada, sem PointLight, que no
   *     celular custaria a cena inteira.
   *   · ENFEITES do catálogo do dono (campo_pvp.js `enfeites`: por chave ou por papel),
   *     cada um com um sólido pequeno (o de chão não barra); BANDEIRAS VERMELHAS do kit
   *     (K.buildWall do tema 'forge' sem parede: pilar + pano, o único caminho do kit até
   *     o banner_red) na entrada e na saída.
   *   · DESEMPENHO: nenhuma peça entra na cena como malha própria. Tudo o que é vestido vai
   *     para o INSTANCIADOR (instanciaCampo): UMA InstancedMesh por geometria+material, com
   *     a geometria do próprio rawScene ou do kit — os 40 módulos da borda são uma chamada
   *     por módulo diferente, e nada é copiado. MEDIDO (19/09, tests/campo_pvp ?foto=1,
   *     câmera padrão, 1280×800): a praça custa 67 chamadas de desenho (94 vista da
   *     entrada, 0,54-0,86 M de triângulos); o Campo velho custava 69-81; o novo custa 63
   *     (51 rente a um muro) com 176 instâncias em 39 malhas e 1,6 M de triângulos — a
   *     conta que sobra é de vértices, não de chamadas. No celular (JOGO.Mobile.economico)
   *     a borda tem um módulo por vão (com vãos abertos entre eles: ruína) e os enfeites
   *     de chão saem: 59 chamadas, 1,3 M de triângulos.
   *   · SOB DEMANDA: no jogo servido os módulos de muro e o pilar do jardim (jd_) são do
   *     grupo 'calabouco:greenhouse' do manifesto e os da cisterna (cs_) do 'calabouco:cistern' — não descem
   *     no boot. Cada VAGA cuja peça ainda não abriu recebe uma PRIMITIVA (bloco de pedra
   *     com coroamento, pilar afilado, marco baixo) e a chave vai ao Bundle.pede; quando o
   *     Models3D2 avisa (aoChegar), vesteCampo troca a primitiva pela peça e refaz as
   *     instâncias — o padrão das obras da praça (montaConstrucoes). Em casa (file://)
   *     tudo já está aberto e nada disto acontece. */
  var tochasCampo = [];
  var MODULO_CAMPO = 2.2;          // a largura de um módulo de muro do desenho (≈ uma casa)
  var campoObra = null;            // a obra da cena atual: as vagas, o que falta, as instâncias
  var ouveCampo = false;
  /* altura-alvo POR PEÇA dos enfeites (o acervo é prop de tabuleiro: altura natural de
   * 0,1 a 0,7 — sem alvo, a estátua nasceria do tamanho de um vaso) e, sem chave na
   * tabela, por papel */
  var ALVO_CAMPO = {
    jd_estatua: 2.6, jd_coluna_vidro: 2.8, jd_cipo: 2.4, jd_pilar: 3.0, jd_estufa_arvore: 4.2, jd_escada: 2.4,
    jd_tronco: 1.3, jd_vaso: 1.1, jd_redoma: 0.9, jd_canteiro: 1.1, jd_carrinho: 1.3, jd_regador: 0.9,
    jd_cristal_g: 1.0, jd_cristal_p: 0.5, jd_raiz: 0.5, jd_poca: 0.08,
    cs_estandarte: 3.0, cs_luminaria: 2.7, cs_espelho: 2.4, cs_trono: 2.1, cs_fonte: 1.6, cs_poco_lirio: 1.2,
    cs_sal: 1.3, cs_lustre: 0.8, cs_barril: 0.95, cs_aquario: 2.4
  };
  var ALVO_PAPEL = { sotaque_alto: 2.6, sotaque: 1.4, chao: 0.5, borda: 2.4, pilar: 3.0, marco: 2.4 };
  function papelDaChave(tema, chave) {
    var cat = JOGO.CENARIO && JOGO.CENARIO[tema];
    if (!cat) return null;
    var papeis = ['chao', 'sotaque', 'sotaque_alto', 'borda', 'pilar', 'marco', 'alto', 'baixo'];
    for (var i = 0; i < papeis.length; i++) {
      if (Array.isArray(cat[papeis[i]]) && cat[papeis[i]].indexOf(chave) >= 0) return papeis[i];
    }
    return null;
  }
  function chaveDoCampo(tema, papel, semente) {
    var cat = JOGO.CENARIO && JOGO.CENARIO[tema], lista = cat && cat[papel];
    if (!lista || !lista.length) return null;
    return lista[semente % lista.length];
  }
  /* o módulo de muro do dono tem o lado comprido em X ou em Z? Medido uma vez por chave
   * no rawScene (a praça mede o mesmo em eixoLongoEmX): o muroDaCasa estica pelo maior
   * eixo, e um módulo comprido em Z entraria atravessado na fileira. */
  var eixoCampo = {};
  function eixoLongoEmZ(chave) {
    if (eixoCampo[chave] != null) return eixoCampo[chave];
    var m2 = M2(), cena = null;
    try { cena = m2 && m2.rawScene(chave); } catch (e) {}
    if (!cena) return false;
    cena.updateMatrixWorld(true);
    var b = new THREE.Box3().setFromObject(cena);
    var r = (b.max.z - b.min.z) > (b.max.x - b.min.x) * 1.15;
    eixoCampo[chave] = r;
    return r;
  }
  /* uma peça SOLTA do dono (enfeite) num berço: escala pela altura com teto de largura,
   * gira, assenta pelo pé e centra — o plantaTema da praça, sem pôr na cena */
  function bercoDaPeca(chave, altAlvo, teto, rot) {
    var m2 = M2(), cena = null;
    try { cena = m2 && m2.rawScene(chave); } catch (e) {}
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
    no.position.set(-(cx.min.x + cx.max.x) / 2, -cx.min.y, -(cx.min.z + cx.max.z) / 2);
    var berco = new THREE.Group();
    berco.add(no);
    berco.userData.chave = chave;
    return berco;
  }
  /* A PEÇA DE UMA VAGA, já no lugar: null enquanto o modelo não abriu (a chave que falta
   * fica anotada em `v.chave`, para o Bundle.pede). Muro, pilar e borda passam pelo
   * muroDaCasa do tabuleiro — a mesma régua de esticão, pilar que não engorda e corpo da
   * cisterna medido (alto_corpo 'auto'). A borda ganha um teto de PROFUNDIDADE: o módulo
   * 'mato' do jardim é 2× mais fundo que os outros (o mato sai da parede) e, a 6 m de
   * largura, entraria 3,6 m para dentro do passo. */
  function pecaDoCampo(v) {
    var m2 = M2();
    if (!m2 || !m2.rawScene) return null;
    var berco = null;
    if (v.tipo === 'enfeite') {
      berco = bercoDaPeca(v.chave, v.alt, v.teto, v.rot);
      if (!berco) return null;
    } else {
      var Rd = JOGO.Renderer3D2;
      if (!Rd || !Rd.muroDaCasa) return null;
      var chave = chaveDoCampo(v.tema, v.papel, v.semente);
      if (!chave) return null;
      v.chave = chave;
      if (!m2.rawScene(chave)) return null;
      try { berco = Rd.muroDaCasa(v.tema, v.papel, v.semente, v.alt, v.larg); } catch (e) { berco = null; }
      if (!berco) return null;
      berco.rotation.y = v.rot + ((v.papel !== 'pilar' && eixoLongoEmZ(chave)) ? Math.PI / 2 : 0);
      if (v.tetoProf) {
        berco.updateMatrixWorld(true);
        var no = berco.children[0], cb = new THREE.Box3().setFromObject(no);
        var prof = cb.max.z - cb.min.z;
        if (isFinite(prof) && prof > v.tetoProf) { no.scale.z *= v.tetoProf / prof; }
      }
    }
    berco.position.set(v.x, 0, v.z);
    berco.userData.vaga = v.tipo;
    return berco;
  }
  /* A PRIMITIVA PROVISÓRIA da vaga: melhor que a caixa de tijolo de antes — bloco de pedra
   * com coroamento no tom do chão, pilar afilado com capitel, marco baixo para o enfeite.
   * Só aparece no jogo servido, entre o pedido e a chegada do módulo do dono. */
  var matProvCampo = null;
  function provisoriaDoCampo(v) {
    if (!matProvCampo) {
      matProvCampo = {
        muro: new THREE.MeshStandardMaterial({ map: texturaCampo('muro'), roughness: 1 }),
        pedra: new THREE.MeshStandardMaterial({ color: 0x5a5049, roughness: 1 })
      };
    }
    var g = new THREE.Group();
    if (v.papel === 'pilar') {
      var pil = new THREE.Mesh(new THREE.CylinderGeometry(v.larg * 0.38, v.larg * 0.48, v.alt, 8), matProvCampo.pedra);
      pil.position.y = v.alt / 2;
      g.add(pil);
      var cap = new THREE.Mesh(new THREE.BoxGeometry(v.larg, 0.24, v.larg), matProvCampo.pedra);
      cap.position.y = v.alt + 0.12;
      g.add(cap);
    } else if (v.tipo === 'enfeite') {
      var h = Math.min(v.alt || 1, 1.2);
      var marco = new THREE.Mesh(new THREE.BoxGeometry(0.6, h, 0.6), matProvCampo.pedra);
      marco.position.y = h / 2;
      g.add(marco);
    } else {
      var prof = Math.min(v.prof || 1, 0.9);
      var geo = new THREE.BoxGeometry(v.larg, v.alt, prof);
      uvDeCaixa(geo, v.larg, v.alt, prof, 2);
      var corpo = new THREE.Mesh(geo, matProvCampo.muro);
      corpo.position.y = v.alt / 2;
      g.add(corpo);
      var topo = new THREE.Mesh(new THREE.BoxGeometry(v.larg + 0.2, 0.16, prof + 0.2), matProvCampo.pedra);
      topo.position.y = v.alt + 0.08;
      g.add(topo);
    }
    g.position.set(v.x, 0, v.z);
    g.rotation.y = v.rot || 0;
    return g;
  }
  /* O INSTANCIADOR DO CAMPO: recebe os nós prontos (berços com a peça do dono, braseiros e
   * bandeiras do kit, discos de luz) e devolve UM grupo com uma InstancedMesh por par
   * geometria+material — a geometria é a do rawScene ou do kit, compartilhada, nada é
   * copiado (o mergeStatic do tabuleiro copia vértices e, sem índice, triplica a memória:
   * para 120 peças de 15 mil triângulos seriam ~200 MB, que o celular não tem). Sprites (o
   * halo do braseiro) saem soltos, com a transformação de mundo, para continuar pulsando;
   * o marcador de luz do kit (torchLight) não tem quem o acenda aqui e cai. frustumCulled
   * fica desligado: a esfera de uma InstancedMesh é a da geometria na origem, não a das
   * instâncias, e a borda inteira sumiria ao virar a câmera. */
  function instanciaCampo(nos) {
    var baldes = {}, ordem = [], soltos = [];
    nos.forEach(function (no) {
      no.updateMatrixWorld(true);
      no.traverse(function (n) {
        if (n.isSprite) { soltos.push(n); return; }
        if (!n.isMesh || n.isSkinnedMesh || n.isInstancedMesh || !n.geometry || !n.material || Array.isArray(n.material)) return;
        var k = n.geometry.uuid + '|' + n.material.uuid;
        var b = baldes[k];
        if (!b) { b = baldes[k] = { geo: n.geometry, mat: n.material, mats: [], ordemRender: n.renderOrder || 0 }; ordem.push(k); }
        b.mats.push(n.matrixWorld.clone());
      });
    });
    var g = new THREE.Group(), instancias = 0;
    ordem.forEach(function (k) {
      var b = baldes[k];
      var im = new THREE.InstancedMesh(b.geo, b.mat, b.mats.length);
      for (var i = 0; i < b.mats.length; i++) im.setMatrixAt(i, b.mats[i]);
      im.instanceMatrix.needsUpdate = true;
      im.frustumCulled = false;
      im.renderOrder = b.ordemRender;
      im.userData.instancias = b.mats.length;
      g.add(im);
      instancias += b.mats.length;
    });
    var wp = new THREE.Vector3(), wq = new THREE.Quaternion(), ws = new THREE.Vector3();
    soltos.forEach(function (s) {
      s.updateWorldMatrix(true, false);
      s.matrixWorld.decompose(wp, wq, ws);
      var c = s.clone();
      c.position.copy(wp);
      c.quaternion.copy(wq);
      c.scale.copy(ws);
      g.add(c);
    });
    g.userData.malhas = ordem.length;
    g.userData.instancias = instancias;
    return g;
  }
  /* A BANDEIRA VERMELHA do Campo: mastro de madeira escura (3,4 m) com travessa, e o pano
   * pendurado da travessa — um plano de 6 × 10 quadros com uma onda em z (o pano não é
   * uma tábua) e a barra de baixo rasgada em dentes (pela geometria, sem alfa: a malha
   * instanciada não quer material transparente). A cor do pano vem em vértice: vermelho
   * de sangue com a barra de cima mais escura, um losango claro no meio. O pano olha para
   * +z no giro 0 (o sul, a câmera de quem chega). Geometria e materiais são UM por cena
   * (bandeiraCampoGeo/Mat): as quatro bandeiras viram duas InstancedMesh. */
  var bandeiraCampo = null;
  function bandeiraDoCampo(i) {
    if (!bandeiraCampo) {
      var NX = 6, NY = 10, L = 0.9, H = 1.7;
      var geo = new THREE.PlaneGeometry(L, H, NX, NY);
      var pos = geo.attributes.position, cor = new Float32Array(pos.count * 3);
      var vermelho = new THREE.Color(0x9e1e1a), escuro = new THREE.Color(0x4a0c0a), claro = new THREE.Color(0xd8503c);
      for (var v = 0; v < pos.count; v++) {
        var px = pos.getX(v), py = pos.getY(v);
        var u = px / L + 0.5, t = 0.5 - py / H;              // u de 0 a 1, t = 0 em cima
        pos.setZ(v, Math.sin(u * Math.PI * 2 + t * 3) * 0.05 * (0.3 + t));   // a onda cresce para baixo
        // a barra de baixo rasgada: os vértices da última fileira sobem em dentes alternados
        if (t > 0.99) pos.setY(v, py + ((Math.round(u * NX) % 2) ? 0.16 : 0.0));
        var c = vermelho;
        if (t < 0.14) c = escuro;
        else if (Math.abs(u - 0.5) * 2 + Math.abs(t - 0.5) * 2.2 < 0.42) c = claro;
        cor[v * 3] = c.r; cor[v * 3 + 1] = c.g; cor[v * 3 + 2] = c.b;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(cor, 3));
      geo.computeVertexNormals();
      bandeiraCampo = {
        pano: geo,
        matPano: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }),
        mastro: new THREE.CylinderGeometry(0.045, 0.06, 3.4, 7),
        travessa: new THREE.CylinderGeometry(0.03, 0.03, 1.1, 6),
        ponta: new THREE.ConeGeometry(0.09, 0.22, 6),
        matMadeira: new THREE.MeshStandardMaterial({ color: 0x3a2a20, roughness: 1 }),
        matMetal: new THREE.MeshStandardMaterial({ color: 0x8a7a50, roughness: 0.5, metalness: 0.4 })
      };
    }
    var B = bandeiraCampo, g = new THREE.Group();
    var mastro = new THREE.Mesh(B.mastro, B.matMadeira);
    mastro.position.y = 1.7;
    g.add(mastro);
    var travessa = new THREE.Mesh(B.travessa, B.matMadeira);
    travessa.rotation.z = Math.PI / 2;
    travessa.position.set(0, 3.25, 0.02);
    g.add(travessa);
    var ponta = new THREE.Mesh(B.ponta, B.matMetal);
    ponta.position.y = 3.5;
    g.add(ponta);
    var pano = new THREE.Mesh(B.pano, B.matPano);
    pano.position.set(0, 3.22 - 0.85, 0.08);
    g.add(pano);
    g.userData.bandeira = i;
    return g;
  }
  /* UM BRASEIRO COM A LUZ NO CHÃO (19/09, tirado de montaCampo para servir também ao
   * portão do Campo na praça): a tocha de pé do kit (K.buildBrazier: poste, chama e o
   * halo que pulsa) ou, sem kit, o poste com a chama de antes — e um disco de luz PINTADA
   * (sem PointLight, que no celular custaria a cena inteira). Devolve as duas peças
   * soltas, `br` e `luz`, porque o Campo instancia cada uma por geometria. */
  var braseiroLuz = null;
  function braseiroComLuz(tema, i) {
    if (!texBrilhoTocha) {
      texBrilhoTocha = fazTexRadial([[0, 'rgba(255,214,140,1)'], [0.3, 'rgba(255,150,60,0.55)'], [1, 'rgba(255,90,20,0)']]);
    }
    if (!braseiroLuz) {
      braseiroLuz = {
        mat: new THREE.MeshBasicMaterial({ map: texBrilhoTocha, transparent: true, opacity: 0.3,
                                           blending: THREE.AdditiveBlending, depthWrite: false }),
        geo: new THREE.PlaneGeometry(7.5, 7.5),
        matPoste: new THREE.MeshStandardMaterial({ color: 0x2e2620, roughness: 1 })
      };
    }
    var Kt = K(), br = null;
    if (Kt && Kt.isReady && Kt.isReady() && Kt.buildBrazier) {
      try { br = Kt.buildBrazier(tema === 'cistern' ? 'cistern' : 'garden', i); } catch (e) { br = null; }
    }
    if (!br) {
      // sem kit: o poste com a chama de antes
      br = new THREE.Group();
      var poste = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 2.3, 8), braseiroLuz.matPoste);
      poste.position.y = 1.15;
      br.add(poste);
      var chama = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.5, 8), new THREE.MeshBasicMaterial({ color: 0xffc070 }));
      chama.position.y = 2.55;
      br.add(chama);
      var brilho = new THREE.Sprite(new THREE.SpriteMaterial({ map: texBrilhoTocha, transparent: true,
        depthWrite: false, blending: THREE.AdditiveBlending, color: 0xffffff }));
      brilho.scale.setScalar(2.4);
      brilho.position.y = 2.6;
      br.add(brilho);
    }
    var luz = new THREE.Mesh(braseiroLuz.geo, braseiroLuz.mat);
    luz.rotation.x = -Math.PI / 2;
    luz.userData.semCaixa = true;            // é luz no chão, não corpo: a prova de folga não a mede
    return { br: br, luz: luz };
  }
  function refazInstanciasDoCampo(obra) {
    if (obra.instancias) {
      obra.cena.remove(obra.instancias);
      obra.instancias.traverse(function (n) { if (n.isInstancedMesh) { try { n.dispose(); } catch (e) {} } });
    }
    var nos = [];
    obra.vagas.forEach(function (v) { if (v.no) nos.push(v.no); });
    nos = nos.concat(obra.fixos);
    obra.instancias = instanciaCampo(nos);
    obra.cena.add(obra.instancias);
    // os halos dos braseiros voltam a pulsar: são os sprites soltos do grupo instanciado
    tochasCampo.length = 0;
    obra.instancias.children.forEach(function (n, i) {
      if (n.isSprite) tochasCampo.push({ brilho: n, base: n.scale.x, fase: i * 1.7 });
    });
  }
  function agendaCampo(obra) {
    if (obra.voltas > 400) return;           // o relógio virtual do headless queima voltas
    obra.voltas++;
    setTimeout(function () { if (campoObra === obra && scene === obra.cena) vesteCampo(); }, 500);
  }
  /* VESTIR O CAMPO: passa pelas vagas, veste as que já têm peça aberta (a primitiva sai),
   * refaz as instâncias se algo mudou, pede ao Bundle o que falta (uma vez por chave) e
   * fica ouvindo o Models3D2 — a chegada chama de novo. */
  function vesteCampo() {
    var obra = campoObra;
    if (!obra || !scene || obra.cena !== scene) return;
    var m2 = M2();
    if (!m2 || !m2.rawScene) { agendaCampo(obra); return; }
    var mudou = false, faltam = {};
    obra.vagas.forEach(function (v) {
      if (v.no) return;
      var no = pecaDoCampo(v);
      if (!no) {
        if (v.chave) faltam[v.chave] = true;
        if (!v.prov) { v.prov = provisoriaDoCampo(v); obra.provisorios.add(v.prov); }
        return;
      }
      v.no = no;
      if (v.prov) { obra.provisorios.remove(v.prov); v.prov = null; }
      obra.montagem[v.chave] = (obra.montagem[v.chave] || 0) + 1;
      mudou = true;
    });
    if (mudou || !obra.instancias) refazInstanciasDoCampo(obra);
    var chaves = Object.keys(faltam);
    obra.pendentes = chaves.length;
    if (!chaves.length) return;
    var novas = chaves.filter(function (k) { return obra.pedidas.indexOf(k) < 0; });
    if (novas.length) {
      novas.forEach(function (k) { obra.pedidas.push(k); });
      try { if (JOGO.Bundle && JOGO.Bundle.pede) JOGO.Bundle.pede(novas); } catch (eP) {}
    }
    if (!ouveCampo && m2.aoChegar) {
      ouveCampo = true;
      m2.aoChegar(function () { try { vesteCampo(); } catch (eV) {} });
    }
    agendaCampo(obra);
  }
  function montaCampo() {
    var C = campoCfg(), R = C.meioLado, tema = C.tema;
    var eco = !!(JOGO.Mobile && JOGO.Mobile.economico && JOGO.Mobile.economico());
    var obra = campoObra = { cena: scene, vagas: [], fixos: [], provisorios: new THREE.Group(), instancias: null,
                             montagem: {}, pedidas: [], pendentes: 0, voltas: 0, eco: eco, tema: tema,
                             braseiros: 0, bandeiras: 0 };
    scene.add(obra.provisorios);
    function temaDe(i, forcado) {
      if (forcado && (JOGO.CENARIO || {})[forcado]) return forcado;   // 20/09: qualquer catálogo, não só os dois emprestados
      return tema === 'misto' ? ((i % 2) ? 'cistern' : 'garden') : tema;
    }
    function vaga(v) { obra.vagas.push(v); return v; }

    // ---- os muros do desenho: caixa sólida + fileira de módulos + pilar nas pontas
    C.muros.forEach(function (m, i) {
      var larg = +m.larg || 1, prof = +m.prof || 1, alt = +m.alt || 3, rot = +m.rotY || 0;
      var x = +m.x || 0, z = +m.z || 0, tm = temaDe(i, m.tema);
      caixas.push({ x: x, z: z, hx: larg / 2, hz: prof / 2, rot: rot, alt: alt });
      var cs = Math.cos(rot), sn = Math.sin(rot);
      function ponta(lx) { return { x: x + lx * cs, z: z - lx * sn }; }   // rotation.y = rot: +x local → (cos, −sen)
      if (larg <= 2.3 && prof <= 2.3) {         // larg ≈ prof: um pilar só
        vaga({ tipo: 'pilar', muro: i, tema: tm, papel: 'pilar', semente: i, x: x, z: z, rot: rot,
               alt: alt, larg: Math.min(larg, prof), prof: prof });
        return;
      }
      var papel = alt < 1.6 ? 'baixo' : 'alto';
      var n = Math.max(1, Math.round(larg / MODULO_CAMPO)), w = larg / n;
      for (var k = 0; k < n; k++) {
        var p = ponta((k + 0.5) * w - larg / 2);
        vaga({ tipo: 'muro', muro: i, tema: tm, papel: papel, semente: i * 3 + k, x: p.x, z: p.z, rot: rot,
               alt: alt, larg: w * 1.03, prof: prof });
      }
      [-larg / 2, larg / 2].forEach(function (lx, kp) {
        var p = ponta(lx);
        vaga({ tipo: 'pilar', muro: i, tema: tm, papel: 'pilar', semente: i + kp, x: p.x, z: p.z, rot: rot,
               alt: alt + (papel === 'baixo' ? 0.4 : 0.5), larg: Math.min(prof + 0.4, 1.7), prof: prof });
      });
    });

    // ---- a borda de ruína: cinco vãos por lado, pilar em cada emenda e nos cantos
    var B = R + 0.2, altB = (+C.borda.alt > 0.5) ? +C.borda.alt : 2.6, temaBorda = (tema === 'misto') ? 'garden' : tema;
    var VAOS = 5, passo = (2 * B) / VAOS, pilaresBorda = {};
    // a frente do módulo (+z local) encara o centro do Campo
    var lados = [{ ax: 'x', fixo: -B, rot: 0 }, { ax: 'x', fixo: B, rot: Math.PI },
                 { ax: 'z', fixo: B, rot: -Math.PI / 2 }, { ax: 'z', fixo: -B, rot: Math.PI / 2 }];
    lados.forEach(function (L, li) {
      function ponto(t) { return L.ax === 'x' ? { x: t, z: L.fixo } : { x: L.fixo, z: t }; }
      var mpv = eco ? 1 : 2, wB = passo / mpv;
      for (var j = 0; j < VAOS; j++) {
        for (var mm = 0; mm < mpv; mm++) {
          var q = ponto(-B + j * passo + (mm + 0.5) * wB);
          vaga({ tipo: 'borda', tema: temaBorda, papel: 'alto', semente: li * 7 + j * 2 + mm, x: q.x, z: q.z,
                 rot: L.rot, alt: altB, larg: wB * 1.02, prof: 1.6, tetoProf: 2.0 });
        }
      }
      for (var jp = 0; jp <= VAOS; jp++) {
        var qp = ponto(-B + jp * passo), chaveP = qp.x.toFixed(1) + ',' + qp.z.toFixed(1);
        if (pilaresBorda[chaveP]) continue;
        pilaresBorda[chaveP] = true;
        vaga({ tipo: 'bordaPilar', tema: temaBorda, papel: 'pilar', semente: li + jp, x: qp.x, z: qp.z,
               rot: L.rot, alt: altB + 0.7, larg: 1.7, prof: 1.7 });
      }
    });

    // ---- os braseiros (as `tochas` do desenho) e o disco de luz no chão de cada um
    // (19/09: a peça saiu para braseiroComLuz — o portão do Campo na praça usa a mesma)
    C.tochas.forEach(function (t, i) {
      var x = +t.x || 0, z = +t.z || 0;
      var b = braseiroComLuz(tema, i);
      b.br.position.set(x, 0, z);
      b.br.rotation.y = i * 0.7;
      obra.fixos.push(b.br);
      b.luz.position.set(x, 0.04, z);
      obra.fixos.push(b.luz);
      marcaSolido(x, z, 0.45);
      obra.braseiros++;
    });

    // ---- as bandeiras vermelhas (na entrada e na saída, se o desenho não disser onde).
    // Tentei o pano do kit (K.buildWall do tema 'forge' com bannerDir — o único caminho até
    // o banner_red): vem preso a um pilar gordo de 2,4 m sobre uma lajota escura, e na foto
    // lia como cone de trânsito. A bandeira é PRÓPRIA: mastro fino com travessa e um pano
    // vermelho de 0,9 × 1,7 m, ondulado e rasgado embaixo (bandeiraDoCampo) — 2 malhas,
    // instanciadas com as outras.
    var bandeiras = C.bandeiras;
    if (!bandeiras) {
      var sd0 = C.saida, ns0 = C.nasce, r0 = Math.hypot(sd0.x, sd0.z) || 1;
      var ux0 = sd0.x / r0, uz0 = sd0.z / r0;             // da saída para o centro é (−u)
      bandeiras = [
        { x: ns0.x - 3.4, z: ns0.z + 0.6, rot: 0 }, { x: ns0.x + 3.4, z: ns0.z + 0.6, rot: 0 },
        { x: sd0.x - uz0 * 3.3, z: sd0.z + ux0 * 3.3, rot: Math.atan2(-ux0, -uz0) },
        { x: sd0.x + uz0 * 3.3, z: sd0.z - ux0 * 3.3, rot: Math.atan2(-ux0, -uz0) }
      ];
    }
    bandeiras.forEach(function (b, i) {
      var x = +b.x || 0, z = +b.z || 0, rot = +b.rot || 0;
      var no = bandeiraDoCampo(i);
      no.position.set(x, 0, z);
      no.rotation.y = rot;
      obra.fixos.push(no);
      marcaSolido(x, z, 0.35);
      obra.bandeiras++;
    });

    // ---- os enfeites do catálogo do dono
    C.enfeites.forEach(function (e, i) {
      var x = +e.x || 0, z = +e.z || 0, chave = e.chave || null, papel = e.papel || null, tm;
      if (chave) {
        // 20/09: o prefixo diz o catálogo — cs_ cisterna, pv_ o lote do Campo, o resto jardim
        tm = /^cs_/.test(chave) ? 'cistern' : (/^pv_/.test(chave) ? 'pvp' : 'garden');
        papel = papel || papelDaChave(tm, chave) || 'sotaque';
      } else {
        tm = temaDe(i, e.tema);
        chave = chaveDoCampo(tm, papel || 'sotaque', i);
        if (!chave) return;
      }
      if (eco && papel === 'chao') return;      // celular: o enfeite de chão sai
      var alt = (+e.alt > 0) ? +e.alt : (ALVO_CAMPO[chave] || ALVO_PAPEL[papel] || 1.4);
      vaga({ tipo: 'enfeite', tema: tm, papel: papel, chave: chave, x: x, z: z, rot: +e.rot || 0, alt: alt, teto: alt * 1.6 });
      if (papel !== 'chao') marcaSolido(x, z, papel === 'sotaque_alto' ? 0.6 : 0.5);
    });

    vesteCampo();
    var sd = C.saida;
    var s = arcoPortal({ aro: 0x9a2320, aroBrilho: 0x4a0a08, cor: 0xe0352b, brilhoChao: true,
                         texto: 'Voltar à praça', corTexto: '#ffd2cb', rotuloEsc: 0.8 });
    s.g.position.set(sd.x, 0, sd.z);
    if (Math.hypot(sd.x, sd.z) > 0.5) s.g.lookAt(0, 0, 0);
    s.g.scale.setScalar(0.9);
    scene.add(s.g);
    lugares.push({ id: 'campo-saida', tipo: 'campo-saida', nome: 'Voltar à praça',
                   pos: new THREE.Vector3(sd.x, 0, sd.z), raio: 3.8, node: s.g, miolo: s.miolo });
  }
  /* ============================================== A SEDE DA GUILDA POR DENTRO (04/10)
   * O salão usa as MESMAS peças do dono que a guerra de guilda (catálogo sd_* de
   * assets/embedded/cenario-sede.js), mas arrumado como CASA e não como mapa de luta: sem
   * os pilares soltos (nenhuma sd_pilar entra), trono ao fundo, tapete da porta ao trono,
   * mesa do conselho no meio, lareira acesa a oeste, estandartes com a cor e o emblema da
   * guilda, armaduras e cavaletes nas paredes. Cinco pontos de conversa (lugares, como os
   * da praça): BANCO (baú a leste), COFRE (baú ao pé do trono), MURAL (estandarte do canto),
   * GUERRA (a mesa) e SAÍDA (a porta, ao sul).
   * Não passa pelo instanciador do Campo: são ~60 peças, e as PAREDES precisam ficar em
   * quatro grupos soltos — o lado que fica entre a câmera e o herói some (tique), senão a
   * órbita livre da praça olharia para as costas de um muro de 4 m.
   * Cada peça nasce numa primitiva de reserva e veste quando o modelo abre (no file://
   * já vem aberto; servido, pede ao Bundle e tenta de novo, como o Campo). */
  var SEDE_COR = { parede: 0x6a5d52, madeira: 0x5a3d26, pano: 0x8c1f24, metal: 0x8a8f96, ouro: 0xd6a443 };
  function encaixaSede(chave, o) {
    var m2 = M2(), cena = null;
    try { cena = m2 && m2.rawScene && m2.rawScene(chave); } catch (e) {}
    if (!cena) return null;
    var no = cena.clone(true);
    no.updateMatrixWorld(true);
    var cx = new THREE.Box3().setFromObject(no);
    var a = cx.max.y - cx.min.y, l = cx.max.x - cx.min.x, p = cx.max.z - cx.min.z;
    if (!(a > 0.01) || !(l > 0.01) || !(p > 0.01)) return null;
    // `alt` só: escala por igual (com teto de largura). `larg` + `alt`: estica na caixa —
    // é o módulo de parede e a mesa. `prof` é sempre teto, nunca alvo.
    var ky = o.alt ? o.alt / a : o.larg / l, kx = o.larg ? o.larg / l : ky, kz = o.larg ? Math.max(kx, ky) : ky;
    if (!o.larg && o.teto && Math.max(l, p) * ky > o.teto) { kx = ky = kz = o.teto / Math.max(l, p); }
    if (o.prof && p * kz > o.prof) kz = o.prof / p;
    no.scale.set(no.scale.x * kx, no.scale.y * ky, no.scale.z * kz);
    no.updateMatrixWorld(true);
    cx = new THREE.Box3().setFromObject(no);
    no.position.x -= (cx.min.x + cx.max.x) / 2;
    no.position.y -= cx.min.y;
    no.position.z -= (cx.min.z + cx.max.z) / 2;
    return no;
  }
  function reservaSede(p) {
    var parede = /^sd_(parede|porta)/.test(p.chave);
    var w = p.larg || (parede ? 2.5 : 0.9), h = p.alt || 0.6, d = parede ? 0.6 : Math.min(p.prof || 0.9, 1.6);
    var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ color: parede ? SEDE_COR.parede : SEDE_COR.madeira, roughness: 1 }));
    m.position.y = h / 2;
    return m;
  }
  function vesteSede() {
    var o = sedeObra;
    if (!o || !scene || o.cena !== scene) return;
    var faltam = {};
    o.pecas.forEach(function (p) {
      if (p.vestida) return;
      var no = null;
      try { no = encaixaSede(p.chave, p); } catch (e) { no = null; }
      if (!no) { faltam[p.chave] = true; return; }
      if (p.prov) { p.g.remove(p.prov); p.prov = null; }
      p.g.add(no);
      p.vestida = true;
    });
    var chaves = Object.keys(faltam);
    o.pendentes = chaves.length;
    if (!chaves.length) return;
    var novas = chaves.filter(function (k) { return o.pedidas.indexOf(k) < 0; });
    if (novas.length) {
      novas.forEach(function (k) { o.pedidas.push(k); });
      try { if (JOGO.Bundle && JOGO.Bundle.pede) JOGO.Bundle.pede(novas); } catch (eP) {}
    }
    if (o.voltas++ < 400) setTimeout(function () { if (sedeObra === o) vesteSede(); }, 500);
  }
  function montaSedeDentro() {
    var W = SEDE_PAREDE, info = sedeInfo || {};
    var cor = /^#[0-9a-f]{6}$/i.test(info.cor || '') ? info.cor : '#8c1f24';
    var obra = sedeObra = { cena: scene, pecas: [], pedidas: [], pendentes: 0, voltas: 0, lados: {}, pontos: [] };
    ['n', 's', 'o', 'l'].forEach(function (k) { obra.lados[k] = new THREE.Group(); scene.add(obra.lados[k]); });
    if (!texBrilhoTocha) {
      texBrilhoTocha = fazTexRadial([[0, 'rgba(255,214,140,1)'], [0.3, 'rgba(255,150,60,0.55)'], [1, 'rgba(255,90,20,0)']]);
    }
    function halo(pai, x, y, z, esc) {
      var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: texBrilhoTocha, transparent: true,
        depthWrite: false, blending: THREE.AdditiveBlending, color: 0xffffff }));
      sp.scale.setScalar(esc);
      sp.position.set(x, y, z);
      pai.add(sp);
      var t = { brilho: sp, base: esc, fase: tochasCampo.length * 1.7 };
      tochasCampo.push(t);
      return t;
    }
    // uma peça: o berço fica (é ele que o toque acha); dentro, a reserva e depois o modelo
    function peca(chave, x, z, rot, o, pai) {
      var g = new THREE.Group();
      g.position.set(x, 0, z);
      g.rotation.y = rot || 0;
      var p = { chave: chave, g: g, alt: o.alt, larg: o.larg, prof: o.prof, teto: o.teto, vestida: false };
      p.prov = reservaSede(p);
      g.add(p.prov);
      (pai || scene).add(g);
      obra.pecas.push(p);
      if (o.solido) marcaSolido(x, z, o.solido);
      return g;
    }
    function ponto(id, nome, g, x, z, raio, solido, altRotulo) {
      // o letreiro vem um passo para dentro do salão: colado à parede, ela o cortava
      var r = rotulo(nome, '#f0d48a', 0.6);
      if (id === 'sede-saida') r.position.set(x, altRotulo, z + 1.4);    // o da saída fica NA porta, não sobre quem acabou de entrar
      else r.position.set(x * 0.9, altRotulo, z * 0.9);
      scene.add(r);
      var l = { id: id, tipo: id, nome: nome, pos: new THREE.Vector3(x, 0, z), raio: raio, node: g };
      if (solido) l.solido = solido;
      lugares.push(l);
      obra.pontos.push(id);
    }

    // ---- as quatro paredes: 9 módulos por lado, a frente (+z local) para o meio do salão
    var w = (2 * W) / SEDE_MODULOS;
    var lados = [{ k: 'n', ax: 'x', fixo: -W, rot: 0 }, { k: 's', ax: 'x', fixo: W, rot: Math.PI },
                 { k: 'o', ax: 'z', fixo: -W, rot: Math.PI / 2 }, { k: 'l', ax: 'z', fixo: W, rot: -Math.PI / 2 }];
    lados.forEach(function (L) {
      for (var k = 0; k < SEDE_MODULOS; k++) {
        var t = -W + (k + 0.5) * w, x = L.ax === 'x' ? t : L.fixo, z = L.ax === 'x' ? L.fixo : t;
        var meio = k === (SEDE_MODULOS - 1) / 2;
        var chave = (L.k === 's' && meio) ? 'sd_porta'
                  : (k % 2 || meio) ? 'sd_parede_lisa' : (k % 4 ? 'sd_parede_tocha' : 'sd_parede_esteio');
        var g = peca(chave, x, z, L.rot, { larg: w * 1.02, alt: 4, prof: 1.0 }, obra.lados[L.k]);
        // a chama da tocha é do código (a peça do dono traz só o suporte)
        if (chave === 'sd_parede_tocha') halo(g, 0, 2.75, 0.6, 1.5);
      }
    });

    // ---- o tapete, da porta ao trono (pintura no chão: não barra ninguém)
    var tap = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 19), new THREE.MeshStandardMaterial({ color: new THREE.Color(cor).multiplyScalar(0.5), roughness: 1 }));   // meio-tom: sob a luz âmbar a cor cheia estourava em rosa
    tap.rotation.x = -Math.PI / 2;
    tap.position.set(0, 0.02, 0.9);
    scene.add(tap);
    [-1.5, 1.5].forEach(function (dx) {
      var fio = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 19), new THREE.MeshStandardMaterial({ color: SEDE_COR.ouro, roughness: 0.8 }));
      fio.rotation.x = -Math.PI / 2;
      fio.position.set(dx, 0.03, 0.9);
      scene.add(fio);
    });

    // ---- o fundo: trono, o baú do cofre, o troféu e os estandartes da guilda
    var trono = peca('sd_trono', 0, -9.5, 0, { alt: 3.9, teto: 3.6, solido: 1.7 });
    peca('sd_trofeu', -3.4, -9.6, 0, { alt: 1.3, teto: 1.2, solido: 0.6 });
    var Rd = JOGO.Renderer3D2, texPano = null;
    try { texPano = (Rd && Rd.texturaBandeira) ? Rd.texturaBandeira(cor, String(info.emblema || '')) : null; } catch (eB) {}
    var matPano = texPano
      ? new THREE.MeshStandardMaterial({ map: texPano, side: THREE.DoubleSide, alphaTest: 0.5, roughness: 0.95 })
      : new THREE.MeshStandardMaterial({ color: cor, side: THREE.DoubleSide, roughness: 0.95 });
    function estandarte(x, z, rot) {
      var g = peca('sd_estandarte', x, z, rot, { alt: 4.5, teto: 1.9, solido: 0.5 });
      // o pano é do código: pende da travessa do mastro do dono (a 86,6% da altura)
      var pano = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 2.03), matPano);
      pano.position.set(0, 4.5 * 0.866 - 0.04 - 1.015, 0.1);
      g.add(pano);
      return g;
    }
    estandarte(-5.8, -9.9, 0);
    estandarte(5.8, -9.9, 0);
    ponto('sede-cofre', 'Cofre da guilda', peca('sd_bau', 3.3, -9.3, 0, { alt: 1.0, teto: 1.5, solido: 0.8 }), 3.3, -9.3, 2.3, 0.8, 2.0);
    ponto('sede-mural', 'Mural da guilda', estandarte(8.7, -9.7, 0), 8.7, -9.7, 2.3, 0.5, 5.2);
    // 04/10 (dono: "a personalização da guilda deve ser dentro do salão"): o trono abre a ficha de gestão.
    // Vem DEPOIS do cofre na lista: quem está entre os dois fala com o baú, que é o menor (o primeiro no raio vence)
    ponto('sede-trono', 'Trono — a guilda', trono, 0, -9.5, 2.9, 1.7, 4.5);

    // ---- o meio: a mesa do conselho (comprida no eixo da porta) e os bancos corridos
    var mesa = peca('sd_mesa', 0, -1, Math.PI / 2, { larg: 5, alt: 1.2, prof: 2.6 });
    [-1, 1].forEach(function (sx) {
      [-1.3, 1.3].forEach(function (dz) { peca('sd_banco', sx * 1.95, -1 + dz, Math.PI / 2, { larg: 2.3 }); });
    });
    caixas.push({ x: 0, z: -1, hx: 2.3, hz: 2.6, rot: 0, alt: 1.2 });
    ponto('sede-guerra', 'Mesa do conselho', mesa, 0, -1, 4.6, 3.0, 2.2);

    // ---- oeste: a lareira acesa, entre armadura e cavalete
    var lar = peca('sd_lareira', -9.8, -2, Math.PI / 2, { larg: 4.2, alt: 2.6, prof: 1.9 });
    caixas.push({ x: -9.8, z: -2, hx: 1.0, hz: 2.2, rot: 0, alt: 2.6 });
    var fogo = new THREE.Group();
    [[0, 0.62, 0xff8a2a], [-0.3, 0.42, 0xffc24a], [0.3, 0.46, 0xff6a1a]].forEach(function (f) {
      var c = new THREE.Mesh(new THREE.ConeGeometry(0.2, f[1], 7), new THREE.MeshBasicMaterial({ color: f[2] }));
      c.position.set(f[0], 0.3 + f[1] / 2, 0);
      fogo.add(c);
    });
    fogo.position.z = 0.1;
    lar.add(fogo);
    halo(lar, 0, 0.75, 0.45, 2.8).chama = fogo;
    var luzFogo = braseiroComLuz('garden', 0).luz;      // só o disco de luz pintada no chão
    luzFogo.position.set(-8.0, 0.04, -2);
    scene.add(luzFogo);
    peca('sd_armadura', -10.1, -6.8, Math.PI / 2, { alt: 3.2, teto: 1.5, solido: 0.7 });
    peca('sd_rack_armas', -10.1, 2.8, Math.PI / 2, { alt: 2.4, teto: 2.0, solido: 0.8 });
    peca('sd_armadura', -10.1, 6.8, Math.PI / 2, { alt: 3.2, teto: 1.5, solido: 0.7 });

    // ---- leste: o baú do banco, entre armadura e cavalete
    peca('sd_armadura', 10.1, -6.8, -Math.PI / 2, { alt: 3.2, teto: 1.5, solido: 0.7 });
    ponto('sede-banco', 'Banco da guilda', peca('sd_bau', 9.8, -1.8, -Math.PI / 2, { alt: 1.1, teto: 1.7, solido: 0.9 }), 9.8, -1.8, 2.5, 0.9, 2.1);
    peca('sd_bau', 9.9, -3.6, -Math.PI / 2, { alt: 0.8, teto: 1.2, solido: 0.6 });
    peca('sd_rack_armas', 10.1, 2.8, -Math.PI / 2, { alt: 2.4, teto: 2.0, solido: 0.8 });
    peca('sd_armadura', 10.1, 6.8, -Math.PI / 2, { alt: 3.2, teto: 1.5, solido: 0.7 });

    // ---- sul: a porta entre duas estátuas, e a saída
    peca('sd_estatua', -4.2, 9.9, Math.PI, { alt: 1.6, teto: 1.3, solido: 0.6 });
    peca('sd_estatua', 4.2, 9.9, Math.PI, { alt: 1.6, teto: 1.3, solido: 0.6 });
    var sd = SEDE_CFG.saida;
    var soleira = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.6, 1.2),
      new THREE.MeshBasicMaterial({ color: 0xffd28a, transparent: true, opacity: 0.08, depthWrite: false }));
    soleira.position.set(sd.x, 1.3, sd.z + 1.0);
    scene.add(soleira);
    ponto('sede-saida', 'Sair para a praça', soleira, sd.x, sd.z, 1.9, 0, 3.2);

    vesteSede();
  }
  /* O MURO RETANGULAR barra como o círculo barra: o ponto que entrou sai pela face mais
   * próxima (a de menor penetração), e o corpo DESLIZA ao longo dela no passo seguinte.
   * A conta é no referencial do muro (rotation.y = rot leva o x local a (cos, -sen)).
   * `CORPO_NA_CAIXA` é a meia-largura do corpo: sem ela o herói entrava meio corpo na
   * pedra antes de parar. */
  var CORPO_NA_CAIXA = 0.45;
  function foraDaCaixa(p, c, folga) {
    var cs = Math.cos(c.rot), sn = Math.sin(c.rot);
    var dx = p.x - c.x, dz = p.z - c.z;
    var lx = dx * cs - dz * sn, lz = dx * sn + dz * cs;
    var hx = c.hx + folga, hz = c.hz + folga;
    if (Math.abs(lx) >= hx || Math.abs(lz) >= hz) return;
    if (hx - Math.abs(lx) < hz - Math.abs(lz)) lx = (lx >= 0) ? hx : -hx;
    else lz = (lz >= 0) ? hz : -hz;
    p.x = c.x + lx * cs + lz * sn;
    p.z = c.z - lx * sn + lz * cs;
  }
  /* TROCAR DE CENA SEM PERDER NINGUÉM (praça ↔ Campo): diferente da troca de sala, os
   * fantasmas FICAM — descem ao papel (a posição continua andando) e a zona nova decide
   * quem ganha corpo (Hub.defineZona). O herói é remontado por quem chamou. */
  function trocaDeCena() {
    for (var fk in fantasmas) {
      if (fantasmas.hasOwnProperty(fk) && fantasmas[fk].corpo) desmaterializa(fantasmas[fk]);
    }
    lugares.length = 0;
    solidos.length = 0;
    caixas.length = 0;
    tochasCampo.length = 0;
    campoObra = null;                 // 19/09: a obra do Campo é da cena que se vai
    sedeObra = null;
    chefesParados.length = 0;
    chefesFicha.length = 0;
    ultimoPerto = null;
    aoChegar = null;
    heroi = null;
    bicho = null;
    montaCena();
    /* 19/09 (dono: "quando eu entro nele os personagens ficam achatados e quando eu volto
     * pra praça continuam achatados"): montaCena nasce com a câmera em proporção 1:1 e
     * quem a acerta pelo tamanho da tela é ajusta() — o Hub.entrar chama, esta troca não
     * chamava. A imagem quadrada esticada na tela larga era o "achatado", e a volta passava
     * pelo mesmo caminho. */
    ajusta();
  }

  /* Trocar de cena (praça ↔ sala, sala ↔ sala): fantasmas e lugares saem,
   * o herói e o bicho renascem na cena nova pelo caminho de sempre. */
  function refazCena() {
    for (var fk in fantasmas) {
      if (fantasmas.hasOwnProperty(fk) && fantasmas[fk].corpo) scene.remove(fantasmas[fk].corpo.node);
    }
    fantasmas = {};
    lugares.length = 0;
    solidos.length = 0;
    caixas.length = 0;
    tochasCampo.length = 0;
    campoObra = null;
    sedeObra = null;
    chefesParados.length = 0;
    chefesFicha.length = 0;
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
    if (salaAtual || campoAtivo) {         // a antessala e o Campo são quadrados
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
    if (campoAtivo) return chaoDoCampo();   // 14/09: terra e pedra escura
    if (salaAtual) {
      var matSala = new THREE.MeshStandardMaterial({ map: texturaLajotas(), roughness: 1 });
      var quad = new THREE.Mesh(new THREE.PlaneGeometry(raioAtual() * 2, raioAtual() * 2), matSala);
      quad.rotation.x = -Math.PI / 2;
      return quad;
    }
    // 12/09, pedido do dono: "troque o chão da praça por grama" — a antessala segue de lajotas
    var mat = new THREE.MeshStandardMaterial({ map: texturaGrama(), roughness: 1 });
    var forma = new THREE.Shape(), N = 128, pontos = [];
    for (var i = 0; i < N; i++) {
      var a = (i / N) * Math.PI * 2, rr = raioNaDirecao(a);
      var x = Math.cos(a) * rr, y = Math.sin(a) * rr;
      pontos.push(new THREE.Vector3(x, 0, y));
      if (i === 0) forma.moveTo(x, y); else forma.lineTo(x, y);
    }
    forma.closePath();
    var geo = new THREE.ShapeGeometry(forma, 1);
    // o tile de grama se repete a cada 4 m (uv = mundo/4)
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
      // vizinho fica a 18,99 m do outro (19/09, R 58; era 16,37 em R 50),
      // com espaço para o cantinho temático — e os extremos não descem
      // tanto a ponto de a Sede e a Arena os taparem da câmera padrão.
      // 19/09: o padrão do arco (ARCO_A0, ARCO_PASSO, ARCO_R) é o que o dono
      // pediu para manter. O portão do Campo NÃO segue o passo: desde 22/09 ele
      // fica ARCO_CAMPO (0,60) a oeste do portal 0, mais longe que um vizinho.
      var ang = ARCO_A0 + ARCO_PASSO * i;
      var px = Math.sin(ang) * RAIO_MAPA * ARCO_R;
      var pz = -Math.cos(ang) * RAIO_MAPA * ARCO_R;
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
      /* O RAIO DE CONVERSA (12/09): 4,2 cobria o portal pelado, mas a câmara
       * do corredor tem quase 10 m de fundo — 41% do piso dela ficava fora
       * do painel, então o jogador chegava ao lado do chefe e o portal ficava
       * mudo. Portal ABERTO (que tem câmara) passa a 6,4; o fechado, que é
       * só o disco com o X, fica nos 4,2. O teto é 9,5 (metade dos 18,99 m
       * entre vizinhos do arco; era 8,18 em R 50): com 6,4 não há como dois
       * portais disputarem o mesmo passo. */
      lugares.push({ id: dg.id, tipo: 'portal', nome: dg.name || dg.id,
                     tema: dg.theme || null, fechado: fechado,
                     pos: new THREE.Vector3(px, 0, pz), raio: fechado ? 4.2 : 6.4,
                     node: g, miolo: miolo });
    }
  }

  /* O MAPA DA PRAÇA EM QUARTEIRÕES (13/09, dono: "o poço ficou bem no meio,
   * deve ficar ao lado da arena, entre a arena e a forja; organize forja,
   * mercadinho, barraquinha, banco e sede — pode sugerir um layout melhor").
   *
   * Antes a Arena e a Sede ficavam nas pontas e o resto se espremia numa rua
   * de barracas colada no sul, com o Banco no meio dela e o Poço solto no
   * gramado. Agora a praça lê como uma bússola em volta da Árvore-Mundo:
   *   · NORTE — os portais (o arco de sempre);
   *   · OESTE, o quarteirão da BATALHA — na ponta oeste do arco o portão do
   *     Campo de PvP (19/09) e, descendo, Arena, o Poço ao lado dela e a Forja
   *     (lutar, descer, forjar);
   *   · LESTE, o quarteirão do OURO E DA GUILDA — Sede, Banco e Mercadinho;
   *   · SUL — a entrada: a avenida onde o herói nasce termina na Barraquinha
   *     da Sorte, de frente para a Árvore.
   * Cada lugar mora num anel (ang: 0 = norte, + = leste; r em metros), e as
   * folgas entre as caixas MEDIDAS das obras ficam em 4 m ou mais — conferido
   * numa conta à parte antes de plantar. `frente` é quanto antes do CENTRO
   * da obra o caminho de pedra para: pequeno o bastante para a calçada entrar
   * por baixo da base (13/09, dono: "a calçada deve ir até as lojinhas e
   * portais, não terminar antes") — a obra cobre a ponta. Na Arena, só até
   * debaixo da muralha (a arena de terra fica limpa); no Poço, até a borda
   * de pedra. */
  /* 19/09 (R 50 → 58, o portão do Campo no arco): o LESTE e o SUL só
   * escalaram com o mapa (r × 1,16); o quarteirão OESTE desceu para o canto
   * sudoeste — a Arena em -2,16 / 48 e a Forja em -2,85 / 51 — porque foi o
   * que a busca em grade (scratchpad/varre2.js) achou de maior folga mínima:
   * mais compacto (Arena 44, Forja 47) derrubava Arena↔Poço para 2,4 m. As
   * folgas entre caixas medidas ficam em 5,7 m ou mais (Arena↔Poço 5,71,
   * Poço↔Forja 5,66, Forja↔Barraquinha 6,03); a caixa da Arena fica a 2,05 m
   * do meio-fio no canto e a da Forja a 3,25 — se a arte de uma delas trocar
   * por outra mais larga, medir de novo antes de plantar. */
  /* 22/09 (dono, com foto: "aumente o tamanho da arena e coloque a estrada chegando até
   * ela"). A Arena "de 24 m" media 17,3: a escala saía da caixa JÁ GIRADA (ver `reto` em
   * montaObra), e a calçada, que parava a 9,8 do centro, ficava 1,15 m antes da muralha.
   * Agora ela tem os 24 m de verdade (10,8 de altura) e desceu meio passo para o sul,
   * porque o portão do Campo também desceu (ARCO_CAMPO). Folgas medidas em
   * scratchpad/oeste.js, a Arena como o disco de 12 m que ela é: portão do Campo 5,07 ·
   * Poço 4,35 · borda do mapa 4,33 · pista do anel 9,37; conversa Arena (13) ↔ Campo
   * (6,4) sobra 3,87. A calçada agora entra pelo arco da Arena, que encara a Árvore, e
   * para a 7,2 do centro — no fim da passagem, antes da areia. */
  var PRACA = {
    arena:   { ang: -2.20, r: 48.5, frente: 7.2 },   // era (-2,16; 48) → (-39,2; 28,5), canto SO
    // o poço: a caixa medida abraça a armação de madeira, a base de pedra
    // tem só ~5 m — a 3,3 do centro a calçada parava na grama (foto do dono)
    poco:    { ang: -2.62, r: 39.5, frente: 2.0 },   // era (-2,40; 34) → (-19,7; 34,3)
    forja:   { ang: -2.85, r: 51.0, frente: 2.0 },   // era (-2,80; 38) → (-14,7; 48,9)
    loteria: { ang: Math.PI, r: 46.5, frente: 1.2 }, // 40 × 1,16
    mercado: { ang: 2.80, r: 44.0, frente: 2.0 },    // 38 × 1,16
    banco:   { ang: 2.30, r: 40.5, frente: 2.5 },    // 35 × 1,16
    sede:    { ang: 1.78, r: 42.0, frente: 3.0 },    // 36 × 1,16
    // 19/09: o portão do Campo de PvP é o SÉTIMO DENTE do arco dos portais, a oeste do
    // portal 0, no mesmo raio (0,75·R = 43,5) — o mesmo porte (montaEntradaCampo e
    // plantaCantinhos). Era o gramado de dentro do anel (-1,42; 16,6), "no meio" da
    // praça, ao lado da Árvore (foto do dono). 22/09: de um passo (ang -1,54 → (-43,5;
    // -1,3)) para ARCO_CAMPO, ang -1,70 → (-43,1; 5,6), longe dos muros da Estufa.
    campo:   { ang: ARCO_A0 - ARCO_CAMPO, r: ARCO_R * RAIO_MAPA, frente: 1.0 }
  };
  function pontoDaPraca(id) {
    var p = PRACA[id];
    return { x: Math.sin(p.ang) * p.r, z: -Math.cos(p.ang) * p.r };
  }

  /* O MERCADINHO: a barraca fecha o triângulo do sul — Banco a sudeste,
   * Arena a sudoeste, Mercadinho no MEIO-SUL, atrás de onde o herói nasce.
   * (A primeira posição escolhida espelhava o banco... em cima da ARENA, e
   * os dois letreiros viraram um borrão — a foto do Daniel pegou.) */
  function montaMercado() {
    // a tenda saiu do meio-sul: ali ela nascia DENTRO da câmera inicial
    // (que fica às costas do herói) e o toldo tomava a primeira tela
    var pp = pontoDaPraca('mercado'), px = pp.x, pz = pp.z;   // o quarteirão (13/09, PRACA)
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
    var pp = pontoDaPraca('banco'), px = pp.x, pz = pp.z;   // o quarteirão (13/09, PRACA)
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
    var pp = pontoDaPraca('arena'), px = pp.x, pz = pp.z;   // o quarteirão (13/09, PRACA)
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
    // o raio acompanha o coliseu de 24 m: 13 do centro = um passo da parede (a parede
    // é 11,76; o coliseu só passou a ter os 24 m de fato em 22/09 — antes media 17,3)
    lugares.push({ id: 'arena', tipo: 'arena', nome: 'Arena',
                   pos: new THREE.Vector3(px, 0, pz), raio: 13.0, node: g });
  }

  /* A FORJA (30/08): a barraca do ferreiro ganhou endereço na praça — o
   * jogador chega, põe a peça e a pedra na bancada e bate. Enquanto a arte
   * da barraca não chega, mesa + tocha + barril seguram o lugar (o mesmo
   * contrato dos outros: a sonda veste com `praca_forja` quando existir). */
  function montaForja() {
    var pp = pontoDaPraca('forja'), px = pp.x, pz = pp.z;   // o quarteirão (13/09, PRACA)
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
    var pp = pontoDaPraca('loteria'), px = pp.x, pz = pp.z;   // o quarteirão (13/09, PRACA)
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

  /* O POÇO SEM FUNDO (13/09): a torre infinita saiu da Arena e ganhou corpo
   * — a arte do dono (mapa principal/poco.glb → praca_poco). Mora no
   * quarteirão da batalha, entre a Arena e a Forja (a primeira casa, a leste
   * da Árvore, ficou "bem no meio" na foto do dono). Até o GLB abrir, uma boca de pedra
   * com o fundo escuro segura o lugar e o clique, como as outras obras. */
  function montaPoco() {
    var pp = pontoDaPraca('poco'), px = pp.x, pz = pp.z;   // ao lado da Arena (13/09, PRACA)
    var g = new THREE.Group();
    var borda = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.4, 0.9, 24, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x6d655a, roughness: 1, side: THREE.DoubleSide }));
    borda.position.y = 0.45;
    g.add(borda);
    var fundo = new THREE.Mesh(new THREE.CircleGeometry(2.2, 24),
                               new THREE.MeshBasicMaterial({ color: 0x07060c }));
    fundo.rotation.x = -Math.PI / 2;
    fundo.position.y = 0.3;
    g.add(fundo);
    var r = rotulo('Poço sem Fundo', '#b9a8ff');
    r.position.y = 3.4;
    g.add(r);
    g.position.set(px, 0, pz);
    scene.add(g);
    lugares.push({ id: 'poco', tipo: 'poco', nome: 'Poço sem Fundo',
                   pos: new THREE.Vector3(px, 0, pz), raio: 6.0, node: g });
  }

  /* OS CAMINHOS DE PEDRA (13/09, "capriche" do dono no mapa novo): a praça
   * redonda em volta da Árvore-Mundo, um ANEL de avenida (r 25,5) que passa
   * na frente de todos os quarteirões, quatro avenidas ligando a praça ao
   * anel — norte (os portais), oeste (o portão do Campo, desde 19/09; antes
   * era a Arena), a Sede e a do sul, onde o herói nasce e que segue até a
   * Barraquinha — e um RAMAL curto do anel até cada construção e cada
   * portal. A primeira versão (uma avenida por lugar, 13
   * raios saindo da Árvore) virou uma estrela mecânica na foto aérea; o anel
   * lê como cidade. Sem caminho, o gramado era um tapete com prédios soltos.
   *
   * A malha é montada JÁ no chão do mundo (nada de girar plano), com uv =
   * mundo/4: todas as peças mostram a MESMA pedra no mesmo ponto, então onde
   * duas avenidas se cruzam (e no encontro com o círculo) não há costura nem
   * briga de profundidade — o pixel é idêntico. Duas malhas só: a pedra e o
   * meio-fio escuro por baixo, um pouco mais largo, que desenha a borda.
   * O clique no chão testa só `chao`, e o raio atravessa os caminhos. */
  /* 20/09: O ANEL ACOMPANHOU O MAPA (22 → 25,5, × 1,16). Ficou para trás quando a
   * praça foi de 50 para 58 ("aumente o mapa geral para encaixar esse pvp"): a
   * avenida circular encolhia em relação à praça e não passava mais na frente de
   * nada — a boca dos corredores abria 5,57 m por fora da pista, no gramado, e o
   * herói, que nasce a 0,35·R = 20,3 m, nascia EM CIMA do meio-fio de dentro
   * (22 - 1,63 = 20,37: 7 cm). Com 25,5 a pista corre de 23,87 a 27,13: o herói
   * nasce 3,57 m antes dela, na avenida do sul, e a boca de cada um dos sete
   * corredores fica 2,07 m por fora da pista — o ramal cobre o vão. O MIOLO não
   * cresce: é a copa da Árvore (28 m), que não cresceu. Medido em
   * scratchpad/confere_anel.js; as faces de dentro das obras ficam de 8,38
   * (Sede) a 18,87 m (Forja) da pista. */
  var MIOLO_RAIO = 12, ANEL_RAIO = 25.5, CAMINHO_MEIA = 1.35, MEIO_FIO = 0.28;
  /* A PEDRA DOS CAMINHOS: lajota clara e quente (arenito), própria — a
   * cinza da antessala, no meio da grama, virou uma estrela quase preta na
   * primeira foto aérea. Mesmo gerador determinístico, tile de 4 m. */
  var texCaminho = null;
  function texturaCaminho() {
    if (texCaminho) return texCaminho;
    var cv = document.createElement('canvas');
    cv.width = 256; cv.height = 256;
    var g = cv.getContext('2d');
    g.fillStyle = '#8a7a63';                       // a junta, terra batida
    g.fillRect(0, 0, 256, 256);
    var NL = 5, lado = 256 / NL, junta = 4;
    for (var jj = 0; jj < NL; jj++) {
      var desloca = (jj % 2) * (lado / 2);
      for (var ii = -1; ii <= NL; ii++) {
        var h = ((ii * 11 + jj * 17 + 3) * 2654435761) % 100;
        var t = h % 22;
        var r = 196 + t - 11, gg = 180 + t - 11, b = 150 + t - 11;   // arenito 185..207
        g.fillStyle = 'rgb(' + r + ',' + gg + ',' + b + ')';
        var x = ii * lado + desloca + junta / 2, y = jj * lado + junta / 2;
        g.fillRect(x, y, lado - junta, lado - junta);
        g.fillStyle = 'rgba(255,255,255,0.10)';      // luz na borda de cima
        g.fillRect(x, y, lado - junta, 3);
        g.fillStyle = 'rgba(60,40,20,0.10)';         // sombra na de baixo
        g.fillRect(x, y + lado - junta - 3, lado - junta, 3);
      }
    }
    var tex = new THREE.CanvasTexture(cv);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    if (THREE.sRGBEncoding != null) tex.encoding = THREE.sRGBEncoding;
    texCaminho = tex;
    return tex;
  }
  function montaCaminhos() {
    if (!scene || salaAtual || campoAtivo) return;
    caminhosVias = [];
    function acumulador() { return { pos: [], uv: [], idx: [] }; }
    var pedra = acumulador(), junta = acumulador();
    function vertice(acc, x, y, z) {
      acc.pos.push(x, y, z);
      acc.uv.push(x / 4, -z / 4);
      return acc.pos.length / 3 - 1;
    }
    function faixa(acc, ax, az, bx, bz, meia, y) {
      var L = Math.hypot(bx - ax, bz - az);
      if (L < 0.01) return;
      var dx = (bx - ax) / L, dz = (bz - az) / L, nx = -dz * meia, nz = dx * meia;
      var a = vertice(acc, ax + nx, y, az + nz), b = vertice(acc, ax - nx, y, az - nz);
      var c = vertice(acc, bx - nx, y, bz - nz), d = vertice(acc, bx + nx, y, bz + nz);
      acc.idx.push(a, b, c, a, c, d);
    }
    function disco(acc, raio, y) {
      var N = 64, meio = vertice(acc, 0, y, 0), primeiro = acc.pos.length / 3;
      for (var i = 0; i < N; i++) {
        var a = (i / N) * Math.PI * 2;
        vertice(acc, Math.cos(a) * raio, y, Math.sin(a) * raio);
      }
      for (var k = 0; k < N; k++) acc.idx.push(meio, primeiro + k, primeiro + (k + 1) % N);
    }
    function anel(acc, raio, meia, y) {
      var N = 128, primeiro = acc.pos.length / 3;
      for (var i = 0; i < N; i++) {
        var a = (i / N) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
        vertice(acc, c * (raio - meia), y, sn * (raio - meia));
        vertice(acc, c * (raio + meia), y, sn * (raio + meia));
      }
      for (var k = 0; k < N; k++) {
        var a0 = primeiro + 2 * k, a1 = primeiro + 2 * ((k + 1) % N);
        acc.idx.push(a0, a0 + 1, a1 + 1, a0, a1 + 1, a1);
      }
    }
    // uma via radial (do raio `de` ao `ate`, no ângulo do mapa) nas duas malhas
    function via(ang, de, ate) {
      if (ate <= de + 0.5) return;
      var ux = Math.sin(ang), uz = -Math.cos(ang);
      faixa(junta, ux * de, uz * de, ux * ate, uz * ate, CAMINHO_MEIA + MEIO_FIO, 0.03);
      faixa(pedra, ux * de, uz * de, ux * ate, uz * ate, CAMINHO_MEIA, 0.05);
      n++;
      caminhosVias.push({ ang: ang, de: de, ate: ate });   // 14/09: a prova mede a folga dos lugares
    }
    function malha(acc, mat) {
      var geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(acc.pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(acc.uv, 2));
      var n = [];
      for (var i = 0; i < acc.pos.length / 3; i++) n.push(0, 1, 0);
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
      /* a ordem dos vértices montada acima deixa a face virada para BAIXO; com
       * DoubleSide o three inverte a normal e a pedra acendia pela cor de chão
       * da HemisphereLight — quase preta (a 2ª foto aérea pegou). Inverte cada
       * triângulo e fica só a face de cima. */
      for (var t = 0; t < acc.idx.length; t += 3) {
        var tmp = acc.idx[t + 1]; acc.idx[t + 1] = acc.idx[t + 2]; acc.idx[t + 2] = tmp;
      }
      geo.setIndex(acc.idx);
      var m = new THREE.Mesh(geo, mat);
      m.userData.caminho = true;
      scene.add(m);
      return m;
    }
    // o meio-fio embaixo (0,03) e a pedra em cima (0,05): o polygonOffset
    // segura as duas acima da grama mesmo com a câmera longe
    var n = 0;
    disco(junta, MIOLO_RAIO + MEIO_FIO, 0.03);
    disco(pedra, MIOLO_RAIO, 0.05);
    anel(junta, ANEL_RAIO, CAMINHO_MEIA + MEIO_FIO, 0.03);
    anel(pedra, ANEL_RAIO, CAMINHO_MEIA, 0.05);
    // as quatro avenidas da praça ao anel (a do sul segue até a Barraquinha)
    via(0, MIOLO_RAIO - 1, ANEL_RAIO);
    lugares.forEach(function (lg) {
      var r = Math.hypot(lg.pos.x, lg.pos.z);
      if (r < 1) return;
      var ang = Math.atan2(lg.pos.x, -lg.pos.z);
      if (lg.tipo === 'portal') {
        // 13/09: até o pé do portal — no aberto a calçada corre o corredor
        // inteiro pelo meio (a pista tem 8,4 m); no fechado entra sob o disco
        via(ang, ANEL_RAIO, r - 1.0);
        return;
      }
      var cfg = PRACA[lg.id];
      if (!cfg) return;
      /* 19/09: o Campo virou o portão da ponta oeste do arco, e a AVENIDA OESTE é a dele —
       * sai da praça da Árvore, cruza o anel, entra pela boca do corredor e termina sob a
       * base do arco (a bússola: N portais, O Campo, L Sede, S Barraquinha). A Arena saiu
       * das avenidas e ganhou RAMAL do anel, como o Poço e a Forja — senão seriam cinco
       * raios saindo da Árvore, a estrela mecânica da primeira versão. */
      var avenida = lg.id === 'sede' || lg.id === 'loteria' || lg.id === 'campo';
      via(ang, avenida ? MIOLO_RAIO - 1 : ANEL_RAIO, r - cfg.frente);
    });
    malha(junta, new THREE.MeshStandardMaterial({ color: 0x5c5040, roughness: 1,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    malha(pedra, new THREE.MeshStandardMaterial({ map: texturaCaminho(), roughness: 1,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    caminhosFeitos = n;
  }
  var caminhosFeitos = 0, caminhosVias = [];

  /* A SEDE DAS GUILDAS (25/08): o estandarte a leste. O lugar existe ANTES
   * da casa própria — a casa 3D de cada guilda vem com a fase do lobby;
   * hoje a porta abre a ficha da guilda. */
  function montaSede() {
    // afastada do extremo leste do arco: a fortaleza tapava o portal do
    // Coração Partido na câmera padrão (mesma coluna de visada)
    var pp = pontoDaPraca('sede'), px = pp.x, pz = pp.z;   // o quarteirão (13/09, PRACA)
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
      // é a segunda silhueta do mapa, atrás só da Árvore-Mundo.
      // 22/09 ("aumente o tamanho da arena"): 24 m de diâmetro DE VERDADE (`reto`; antes
      // saía 17,3 × 7,8) e 10,8 de altura — o alvo sobe para a largura mandar. A muralha
      // desce até o chão no disco inteiro (medido: a base chega a 100% do raio em toda
      // volta), então a parede é quase o raio todo, e não os 72% de quem tem telhado
      arena:   { chave: 'praca_arena',   alvoAlt: 11, teto: 24, reto: true, parede: 0.98 },
      sede:    { chave: 'praca_sede',    alvoAlt: 9.5, teto: 14 },
      // a barraca do ferreiro veste quando a arte chegar (embute_praca)
      forja:   { chave: 'praca_forja',   alvoAlt: 6.0, teto: 10 },
      // a tenda da sorte (03/09): a arte do dono veste as primitivas
      loteria: { chave: 'praca_loteria', alvoAlt: 5.5, teto: 9 },
      // o Poço (13/09): a arte é baixa e larga (altura = 46% da largura) —
      // a boca de 7,9 m se lê de longe sem virar prédio
      poco:    { chave: 'praca_poco',    alvoAlt: 3.6, teto: 8 },
      // 20/09: o PORTAL DE ESPADAS do Campo de PvP (lote do dono). Alto como um portal
      // de calabouço (o herói tem 2,05 m e passa por baixo) e largo o bastante para o
      // leque de lâminas caber sem o teto morder a altura. 22/09: `reto`, porque o
      // portão desceu para ang -1,70 e, medido girado, sairia 6% menor que o de antes
      campo:   { chave: 'praca_portal_pvp', alvoAlt: 6.0, teto: 9.5, reto: true }
    };
    /* 22/09: MEDIR RETO (`reto`). A caixa do three é alinhada aos eixos do MUNDO e, sem
     * `precise`, é a caixa do modelo girada e reencaixada: medida depois do giro, uma obra
     * que encara a Árvore em diagonal incha até 1,41× — e o `teto` cortava a escala por essa
     * caixa inchada. Era assim que a Arena "de 24 m" media 17,3 (ela mora a 124° e incha
     * 1,39×), e mudar uma obra de lugar mudava o tamanho dela. Com `reto`, a escala sai do
     * modelo ainda sem giro e da caixa dos VÉRTICES: o porte não depende de onde a obra mora.
     * As outras seguem na medida antiga — trocá-las agora mexeria no porte de todas. */
    function montaObra(chave, alvoAlt, teto, rotY, reto) {
      var cena = null;
      try { cena = m2.rawScene(chave); } catch (e) {}
      if (!cena) return null;
      var no = cena.clone(true);
      var cx, alt, larg;
      function mede() {
        no.updateMatrixWorld(true);
        cx = new THREE.Box3().setFromObject(no, !!reto);
        alt = cx.max.y - cx.min.y;
        larg = Math.max(cx.max.x - cx.min.x, cx.max.z - cx.min.z);
      }
      if (reto) mede();
      // a ROTAÇÃO entra ANTES do centramento: centrar primeiro e girar depois
      // deslocaria o centro junto — o mesmo tombo de eixo de sempre
      no.rotation.y = rotY || 0;
      if (!reto) mede();
      if (!isFinite(alt) || alt < 0.01) return null;
      var k = alvoAlt / alt;
      if (isFinite(larg) && larg > 0.01 && larg * k > teto) k = teto / larg;
      no.scale.multiplyScalar(k);
      no.updateMatrixWorld(true);
      cx = new THREE.Box3().setFromObject(no, !!reto);
      no.position.y -= cx.min.y;                        // assenta pelo pé
      no.position.x -= (cx.min.x + cx.max.x) / 2;       // e centra na casa
      no.position.z -= (cx.min.z + cx.max.z) / 2;
      // o RAIO no chão sai da caixa já escalada: é ele que vira parede (a obra `reto`
      // usa a largura dela, não a da caixa girada)
      var meia = reto ? larg * k / 2 : Math.max(cx.max.x - cx.min.x, cx.max.z - cx.min.z) / 2;
      return { no: no, alt: cx.max.y - cx.min.y, raio: meia };
    }

    /* 13/09: a sonda só espera a ÁRVORE abrir; uma obra cujo GLB ainda não
     * decodificou (no jogo servido o pacote base desce seis de cada vez)
     * ficava nas primitivas PARA SEMPRE — a foto aérea do mapa novo pegou a
     * Barraquinha e o Poço assim. Agora ela pede o modelo e tenta de novo. */
    var cenaDasObras = scene, pendentes = [];
    function veste(lg) {
      var obra = OBRAS[lg.tipo];
      var giro = Math.atan2(-lg.pos.x, -lg.pos.z);
      /* 20/09: o PORTÃO do Campo é o único lugar cujo nó já vem GIRADO (o arco provisório
       * usa lookAt para encarar a Árvore). A obra traz o giro dela dentro, então o nó
       * volta ao zero — senão o portal do dono saía girado duas vezes. */
      if (lg.tipo === 'campo') lg.node.rotation.set(0, 0, 0);
      // o prédio ENCARA o centro da praça, como os portais
      var feito = montaObra(obra.chave, obra.alvoAlt, obra.teto, giro, obra.reto);
      if (!feito) return false;
      /* fora os volumes provisórios; o RÓTULO fica e sobe para o teto. E a LUZ DO CHÃO
       * (20/09) fica: é ela que diz "entrada" de longe, e quem a punha era o arco
       * provisório que acaba de sair. */
      var rot = null, brilho = null;
      for (var c = lg.node.children.length - 1; c >= 0; c--) {
        var filho = lg.node.children[c];
        if (filho.isSprite) { rot = filho; continue; }
        if (filho.userData && filho.userData.brilhoChao) { brilho = filho; continue; }
        lg.node.remove(filho);
      }
      lg.node.add(feito.no);
      if (rot) rot.position.y = feito.alt + 1.4;
      /* O VÃO ACESO (20/09): o portal do dono vem com o vão VAZIO — o prompt pediu assim,
       * porque é o jogo que acende o vermelho ali. O disco nasce no meio do arco, na
       * altura do peito de quem passa, virado para a mesma frente da obra, e entra na
       * respiração dos portais (o laço do quadro pulsa `lg.miolo`). */
      if (lg.tipo === 'campo') {
        /* medido no modelo do dono: a viga come o terço de cima, e o vão livre vai do chão
         * a 73% da altura, com 36% da largura. O disco fica no meio dessa abertura (36% da
         * altura) e com folga nas laterais (raio de 24% = 2,9 m de diâmetro num vão de 3,4). */
        var vao = new THREE.Mesh(new THREE.CircleGeometry(feito.alt * 0.24, 32),
          new THREE.MeshBasicMaterial({ color: 0xe0352b, transparent: true, opacity: 0.42,
                                        side: THREE.DoubleSide, depthWrite: false }));
        vao.position.y = feito.alt * 0.36;
        vao.rotation.y = giro;
        vao.userData.semCaixa = true;
        lg.node.add(vao);
        lg.miolo = vao;
        if (brilho) brilho.position.y = 0.08;
      }
      /* A PAREDE (11/09, dono: "tirando a árvore central, o personagem passa
       * pelas barracas, arena, banco — isso não pode acontecer"). Só o
       * tronco da Árvore-Mundo era sólido; o resto era cenário atravessável.
       * Agora cada construção ganha um raio sólido MEDIDO do modelo: 72% da
       * meia-caixa, porque a caixa abraça telhado e toldo, que ficam por
       * cima da cabeça e não são parede. E nunca maior que o raio de
       * conversa menos uma folga — o painel do lugar abre por proximidade, e
       * uma parede além dele deixaria o prédio mudo. */
      // 20/09: no PORTÃO do Campo não — entra-se nele (é uma porta, não um prédio), e a
      // prova cobra `campo.solido` zerado
      // (a `parede` da obra troca os 72%: a Arena não tem telhado, a muralha é o disco todo)
      if (lg.tipo !== 'campo') lg.solido = Math.max(1.0, Math.min(feito.raio * (obra.parede || 0.72), (lg.raio || 3) - 1.2));
      return true;
    }
    for (var i = 0; i < lugares.length; i++) {
      if (OBRAS[lugares[i].tipo] && !veste(lugares[i])) pendentes.push(lugares[i]);
    }
    if (pendentes.length) {
      try {
        if (JOGO.Bundle && JOGO.Bundle.pede) {
          JOGO.Bundle.pede(pendentes.map(function (lg) { return OBRAS[lg.tipo].chave; }));
        }
      } catch (eP) {}
      var voltasObras = 0;
      (function deNovo() {
        // 400 voltas pelo mesmo motivo das sondas: o relógio virtual do headless
        if (!pendentes.length || ++voltasObras > 400) return;
        setTimeout(function () {
          if (scene !== cenaDasObras) return;      // a cena mudou: a nova monta as dela
          pendentes = pendentes.filter(function (lg) { return !veste(lg); });
          deNovo();
        }, 500);
      })();
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
    /* OS ENFEITES COM ENDEREÇO (10/09): a BANCADA DO MERCADO (carrinho e
     * canteiro encostados no Mercadinho), a ESCADA apoiada na Sede, o TRONCO
     * e o REGADOR na Forja. Cada peça veste o prédio ao lado dela.
     *
     * 11/09 (dono: "nesse outro lado do mapa tem uns itens aleatórios, tire
     * eles — futuramente vou fazer itens para enfeitar a praça principal").
     * Saíram as seis árvores-estufa do anel e os vasos ao pé delas, e as duas
     * redomas da Árvore-Mundo: eram enfeite de preencher, do catálogo do
     * JARDIM, espalhados por uma praça que não é jardim. Ficam só as peças
     * ENCOSTADAS nas construções, que existem para vestir o prédio ao lado —
     * essas têm endereço e motivo. */
    /* 13/09: o endereço é NO REFERENCIAL DO PRÉDIO — `lado` corre de través
     * (positivo = à direita de quem olha o prédio do centro da praça) e
     * `fundo` vai para trás dele (negativo = para a frente, rumo à Árvore).
     * Com o mapa em quarteirões os prédios encaram o centro por ângulos
     * diferentes; um deslocamento fixo em x/z jogava o carrinho no vizinho. */
    function aoLadoDe(id, lado, fundo) {
      for (var j = 0; j < lugares.length; j++) if (lugares[j].id === id) {
        var p = lugares[j].pos, r = Math.hypot(p.x, p.z) || 1;
        var ux = p.x / r, uz = p.z / r;             // do centro para o prédio
        return { x: p.x + ux * fundo - uz * lado, z: p.z + uz * fundo + ux * lado };
      }
      return null;
    }
    // a bancada do Mercadinho fica na frente, do lado do Banco (o lado da
    // Barraquinha é o mais apertado), fora do caminho de pedra
    var pM = aoLadoDe('mercado', -4.4, -6.6);
    if (pM) { planta('jd_carrinho', 1, pM.x, pM.z, 0.6); }
    var pM2 = aoLadoDe('mercado', -6.2, -5.2);
    if (pM2) planta('jd_canteiro', 1, pM2.x, pM2.z, 1.9);
    var pS = aoLadoDe('sede', 5.9, 2.1);
    if (pS) planta('jd_escada', 1, pS.x, pS.z, 2.4);
    var pF = aoLadoDe('forja', 4.2, -6.0);
    if (pF) planta('jd_tronco', 1, pF.x, pF.z, 0.9);
    var pF2 = aoLadoDe('forja', 5.6, -4.6);
    if (pF2) planta('jd_regador', 1, pF2.x, pF2.z, 2.2);

    /* O SENTIDO DO MURO (12/09, dono: "os muros devem ser na outra posição,
     * dando continuidade, igual se fosse parede"). As peças de muro vinham
     * ATRAVESSADAS no corredor, como dentes de pente, porque a rotação era
     * escolhida no escuro: cada peça tem o comprimento num eixo diferente
     * (umas em X, outras em Z) e um ângulo fixo acerta metade e erra a outra.
     * Agora se MEDE a peça e se calcula o ângulo que põe o lado COMPRIDO na
     * direção pedida — aí um muro encosta no outro e a parede corre. */
    function eixoLongoEmX(chave) {
      var cena = null;
      try { cena = m2.rawScene(chave); } catch (e) { return true; }
      if (!cena) return true;
      var no = cena.clone(true);
      no.updateMatrixWorld(true);
      var b = new THREE.Box3().setFromObject(no);
      return (b.max.x - b.min.x) >= (b.max.z - b.min.z);
    }
    /* O ângulo que deita a peça na direção (wx, wz). Rotação em Y leva o +X
     * local para (cos, -sen) e o +Z local para (sen, cos) — daí os dois
     * casos. */
    function anguloDoMuro(chave, wx, wz) {
      return eixoLongoEmX(chave) ? Math.atan2(-wz, wx) : Math.atan2(wx, wz);
    }

    /* Planta UMA peça de cenário no chão da praça: escala pela altura
     * (com teto de largura), assenta pelo pé e centra no ponto pedido. */
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
    /* OS MÓDULOS QUE CABEM NA FILEIRA (20/09). No corredor da praça a peça é escalada
     * INTEIRA (plantaTema: escala pela altura, com teto de largura), e não esticada como
     * no tabuleiro (muroDaCasa). Com isso um módulo MURETA — o `pv_muro_alto` do dono é
     * 2× mais largo que alto — sairia com 2,25 m, mais baixo que o herói de 2,05 e ao
     * lado de vizinhos de 3,4 m; e um módulo FUNDO — o muro rachado espalha os escombros
     * por 3,6 m — comeria metade da pista e engoliria os enfeites encostados no muro.
     * Então a fileira do portão usa só quem chega ao porte dentro do teto e sem afundar.
     * As peças de fora não se perdem: no Campo o esticão dá conta das duas. */
    function murosDoPorte(lista, altAlvo, teto, fundura) {
      return (lista || []).filter(function (ch) {
        var cena = null;
        try { cena = m2.rawScene(ch); } catch (e) { return false; }
        if (!cena) return false;
        cena.updateMatrixWorld(true);
        var b = new THREE.Box3().setFromObject(cena);
        var a = b.max.y - b.min.y;
        var l = Math.max(b.max.x - b.min.x, b.max.z - b.min.z);
        var f = Math.min(b.max.x - b.min.x, b.max.z - b.min.z);
        if (!(a > 0.01) || !(l > 0.01)) return false;
        var k = altAlvo / a;
        return l * k <= teto + 0.01 && f * k <= fundura + 0.01;
      });
    }

    /* O CORREDOR DO PORTAL (12/09, pedido do dono: "os portais estão muito
     * feios e mal organizados; coloque muros e faça um corredor, e nesse
     * corredor ter alguns itens do mapa, e no fim de cada corredor o portal,
     * e ao lado dele o Boss parado como se fosse um NPC, só com o idle
     * dele").
     *
     * O que havia antes era um ARCO de peças atrás do portal — enfeite
     * espalhado, sem leitura. Agora cada portal aberto é o FIM de um
     * corredor: dois muros correndo na direção do centro da praça, o fundo
     * fechado atrás do portal, peças do próprio calabouço dentro, e o chefe
     * daquele Fecho parado ao lado da boca, respirando o idle.
     *
     * A geometria é toda em coordenadas do corredor: `u` aponta do centro da
     * praça para o portal (o eixo do corredor) e `t` corre de través. `d` é
     * a distância ao longo de `u` a partir do PORTAL — negativo é em direção
     * à praça, positivo é atrás dele. Assim o mesmo código serve a qualquer
     * portal do arco sem nenhuma conta de ângulo espalhada.
     *
     * Os muros são SÓLIDOS (a parede das construções, 11/09): entram em
     * `solidos` com o raio medido, e é isso que faz o corredor ser corredor
     * e não desenho no chão. A boca fica aberta — por ela se entra.
     *
     * Só portal ABERTO ganha corredor, e só com o catálogo do tema na mão
     * ("no caso atual somente os dois liberados... conforme for liberado
     * vamos fazendo nos outros"). */
    var COR_COMP = CORREDOR.comp;   // da boca até o portal
    var COR_FUNDO = CORREDOR.fundo; // o quanto o fundo passa atrás do portal
    var COR_LARG = CORREDOR.larg;   // meia-largura do corredor: a pista tem 8,4 m
    var COR_PASSO = 3.4;      // de muro em muro (peças de ~4,4 m: sobram sobrepostas)
    var COR_ALT = 3.4;        // altura do muro, o porte da batalha
    /* A CÂMARA DO PORTAL (12/09, dono: "esse boss está sobrepondo o muro").
     * O chefe não cabia ao lado do portal num corredor de 8,4 m: os dois
     * chefes abertos medem 2,64 m de largura (meia-largura 1,32) e os que
     * vêm depois chegam a 4,9 m — MEDIDOS, não estimados; o `userData.radius`
     * do models3d_v2 é limitado a 1,2 e não descreve o corpo visual de um
     * chefe. Então o fim do corredor ABRE numa saleta: do `CAM_DE` para
     * dentro os muros vão para `CAM_LARG`, o fundo recuou para 6,2 e o chefe
     * fica atrás do portal, num canto que sobra. */
    var CAM_DE = CORREDOR.camDe;    // onde o corredor começa a abrir
    var CAM_LARG = CORREDOR.camLarg; // meia-largura da câmara
    var CHEFE_D = CORREDOR.chefeD;  // o chefe atrás do portal (d positivo = fundo)
    var CHEFE_FOLGA = CORREDOR.chefeFolga;

    cantinhoFeito = {};
    chefeFeito = {};
    cantinhoCena = scene;
    plantaCantinhos = function () {
    if (!scene || scene !== cantinhoCena) return;
    lugares.forEach(function (lg, li) {
      // 19/09: o PORTÃO do Campo (tipo 'campo', com tema e `portao`) ganha corredor também
      // — desde 20/09 o dele é RETO E ABERTO no fim, com os muros do lote de PvP do dono
      var portao = lg.tipo === 'campo' && !!lg.portao;
      if ((lg.tipo !== 'portal' && !portao) || !lg.tema || lg.fechado) return;
      if (cantinhoFeito[lg.id]) return;
      var catT = JOGO.CENARIO && JOGO.CENARIO[lg.tema];
      if (!catT) return;
      // SOB DEMANDA: no jogo servido as peças do calabouço descem DEPOIS da
      // praça (pré-busca). Planta só com todas na mão — meio corredor não —
      // e o aviso do Models3D2 (aoChegar) chama de novo quando chegarem.
      var faltam = pecasDoCorredor(catT).filter(function (ch) { return !m2.rawScene(ch); });
      if (faltam.length) {
        // 19/09: o portão do Campo veste o catálogo do Campo, que só desce com o Fecho
        // daquele tema aberto (pré-busca); se um dia ele estiver fechado, o portão pede
        // as peças por conta própria — como a cena do Campo já faz
        if (portao) { try { if (JOGO.Bundle && JOGO.Bundle.pede) JOGO.Bundle.pede(faltam); } catch (eP) {} }
        return;
      }
      cantinhoFeito[lg.id] = true;

      var px2 = lg.pos.x, pz2 = lg.pos.z;
      var r0 = Math.max(0.01, Math.hypot(px2, pz2));
      var ux = px2 / r0, uz = pz2 / r0;      // radial: da praça para o portal
      var tx = -uz, tz = ux;                 // de través
      // o sentido de cada muro sai MEDIDO da peça (anguloDoMuro), peça por
      // peça: o catálogo mistura muros compridos em X e em Z
      // ponto do corredor → ponto do mundo
      function pt(d, lado) {
        return { x: px2 + ux * d + tx * lado, z: pz2 + uz * d + tz * lado };
      }
      function pega(lista, k) { return (lista && lista.length) ? lista[(li + k) % lista.length] : null; }

      // ---- OS DOIS MUROS, da boca até o fundo
      // a meia-largura do muro naquele ponto: corredor até CAM_DE, câmara
      // depois dele — e uma peça DIAGONAL fecha o degrau entre as duas
      function largEm(d) { return d < CAM_DE ? COR_LARG : CAM_LARG; }
      /* 20/09: NO PORTÃO a fileira é reta e curta — começa 1 m antes e para a 6,5 m do
       * meio do arco (CORREDOR.portao), sem câmara: a largura é a do corredor do começo
       * ao fim, e a peneira `murosDoPorte` tira os módulos que não servem à escala
       * inteira. Sem lista peneirada (catálogo emprestado, tudo mureta), volta o catálogo
       * cru — corredor baixo é melhor que corredor nenhum. */
      var P = portao ? CORREDOR.portao : null;
      var dIni = P ? -P.comp : -COR_COMP;
      var dFim = P ? P.fim : COR_FUNDO;
      var tetoMuro = P ? P.teto : 4.6;
      var listaAlto = P ? murosDoPorte(catT.alto, COR_ALT, P.teto, P.fundura) : catT.alto;
      if (P && !listaAlto.length) listaAlto = catT.alto;
      var k = 0;
      for (var d = dIni; d <= dFim + 0.01; d += COR_PASSO, k++) {
        var chave = pega(listaAlto, k);
        if (!chave) continue;
        var angLado = anguloDoMuro(chave, ux, uz);
        var lg2 = P ? COR_LARG : largEm(d);
        [lg2, -lg2].forEach(function (lado) {
          var q = pt(d, lado);
          var no = plantaTema(chave, COR_ALT, tetoMuro, q.x, q.z, angLado);
          if (no) marcaSolido(q.x, q.z, CORREDOR.muroR, lg.id);
        });
      }
      // O DEGRAU: sem ele a câmara abriria com um vão aberto de cada lado,
      // que é por onde o jogador escaparia do corredor. Uma peça atravessada
      // em cada lado fecha os 2,4 m do alargamento.
      var chaveDeg = P ? null : pega(catT.alto, 1);
      if (chaveDeg) {
        var angDeg = anguloDoMuro(chaveDeg, tx, tz);
        [1, -1].forEach(function (sinal) {
          var meio = sinal * (COR_LARG + CAM_LARG) / 2;
          var q = pt(CAM_DE, meio);
          // o teto de largura é o mesmo das fileiras (4,6): com 3,0 a peça
          // cedia a escala e saía 1 m mais baixa que os muros ao lado dela
          if (plantaTema(chaveDeg, COR_ALT, 4.6, q.x, q.z, angDeg)) marcaSolido(q.x, q.z, 1.5, lg.id);
        });
      }
      // ---- O FUNDO, atrás do portal: três peças fechando a saída (o portão não tem —
      // atrás dele fica o arco de espadas, e o caminho acaba entrando nele)
      (P ? [] : [-4.4, -1.5, 1.5, 4.4]).forEach(function (lado, kf) {
        var chaveF = pega(catT.alto, kf + 1);
        if (!chaveF) return;
        var q = pt(COR_FUNDO, lado);
        var angF = anguloDoMuro(chaveF, tx, tz);
        if (plantaTema(chaveF, COR_ALT, 4.6, q.x, q.z, angF)) marcaSolido(q.x, q.z, CORREDOR.muroR, lg.id);
      });
      // ---- OS PILARES na boca do corredor: a entrada tem de se ler de longe
      var pilar = pega(catT.pilar, 0);
      if (pilar) {
        var angP = anguloDoMuro(pilar, ux, uz);
        var lb = CORREDOR.bocaLarg;
        [lb, -lb].forEach(function (lado) {
          var q = pt(dIni - 0.6, lado);
          if (plantaTema(pilar, 3.8, 2.2, q.x, q.z, angP)) marcaSolido(q.x, q.z, 1.2, lg.id);
        });
      }
      // ---- AS PEÇAS DENTRO: encostadas nos muros, nunca no meio da pista
      /* 20/09, o dono: "alguns enfeites no tema". No PORTÃO as vagas são outras: o
       * catálogo de PvP não tem `sotaque_alto`, o fim do corredor é aberto e a boca é das
       * bandeiras. Ficam SEIS barreiras do lote (sacos de areia, caixote de armas,
       * cavalo-de-frisa e tonel, que o `pega` reveza), aos pares, encostadas nos dois
       * muros — nada no meio da pista, que é por onde se anda. */
      var dentro = P
        ? [[-11.8, 3.2, 'sotaque'], [-11.8, -3.2, 'sotaque'],
           [-9.4, 3.2, 'sotaque'], [-9.4, -3.2, 'sotaque'],
           [-7.0, 3.2, 'sotaque'], [-7.0, -3.2, 'sotaque']]
        : [[-11.5, 3.0, 'sotaque'], [-7.0, -3.0, 'sotaque_alto'],
           [-4.6, 3.1, 'sotaque'], [-12.5, -3.1, 'sotaque_alto']];
      dentro.forEach(function (it, ki) {
        var chaveI = pega(catT[it[2]], ki);
        if (!chaveI) return;
        var q = pt(it[0], it[1]);
        var altI = it[2] === 'sotaque_alto' ? 2.6 : 1.5;
        if (plantaTema(chaveI, altI, 2.4, q.x, q.z, ki * 1.4)) marcaSolido(q.x, q.z, 0.8, lg.id);
      });
      // o CHÃO do corredor: peças rasas na pista, que não empurram ninguém
      [[-9.0, 0], [-5.0, 1.4], [-1.6, -1.6]].forEach(function (c, kc) {
        var chaoP = pega(catT.chao, kc);
        if (!chaoP) return;
        var q = pt(c[0], c[1]);
        plantaTema(chaoP, 0.55, 2.2, q.x, q.z, kc * 0.9);
      });
      /* ---- O PORTÃO DO CAMPO não tem chefe, e desde 21/09 também não tem braseiro: eram
       * DOIS, do kit, no fim da fileira ("no mapa principal no portal pvp quero que tire
       * essas duas luminárias"). Com o portal de espadas aceso no vão e o brilho no chão,
       * o fogo emprestado do jardim só sujava o fim do caminho. Ficam as DUAS BANDEIRAS
       * VERMELHAS na boca, por dentro dos pilares (bandeiraDoCampo, t ±3, o pano
       * encarando quem chega): é o que diz "luta entre jogadores" à distância. */
      if (portao) {
        [3.0, -3.0].forEach(function (lado, kb) {
          var q = pt(dIni + 0.3, lado);
          var bd = bandeiraDoCampo(kb);
          bd.position.set(q.x, 0, q.z);
          bd.rotation.y = Math.atan2(-ux, -uz);
          scene.add(bd);
          marcaSolido(q.x, q.z, 0.35, lg.id);
        });
      }

    });
    /* O CHEFE tem guarda PRÓPRIA (12/09): o modelo dele desce depois das
     * peças de cenário, e o `M.unit` não devolve null quando falta — devolve
     * o esqueletinho genérico. Era esse esqueleto que aparecia no lugar da
     * Jardineira. Agora se confere o modelo ANTES, e o portal que ainda não
     * tem o seu chefe fica sem chefe até a próxima leva. */
    lugares.forEach(function (lg) {
      if (lg.tipo !== 'portal' || lg.fechado || chefeFeito[lg.id]) return;
      if (poeChefeDoPortal(lg, CHEFE_D, CAM_LARG, CHEFE_FOLGA)) chefeFeito[lg.id] = true;
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
  var cantinhoFeito = {}, chefeFeito = {}, cantinhoCena = null, ouveModelos = false;
  var plantaCantinhos = function () {};
  /* A pré-busca dos calabouços abertos (JOGO.Bundle.preBusca) só liga com o
   * Acampamento PRONTO: construções e enfeites plantados. Liga uma vez só. */
  function talvezPreBusca() {
    if (!construcoesPlantadas || !enfeitesPlantados) return;
    try { if (JOGO.Bundle && JOGO.Bundle.preBusca) JOGO.Bundle.preBusca(); } catch (eB) {}
  }
  /* Os papéis do catálogo que um corredor de portal veste. Uma lista só para quem planta
   * (plantaCantinhos) e para a vitrine: se as duas divergissem, a pré-busca deixaria
   * fechada uma peça que o corredor espera, e ele nunca plantaria. */
  var PAPEIS_DO_CORREDOR = ['alto', 'pilar', 'sotaque_alto', 'sotaque', 'chao'];
  function pecasDoCorredor(catT) {
    var fora = [];
    PAPEIS_DO_CORREDOR.forEach(function (papel) { fora = fora.concat(catT[papel] || []); });
    return fora;
  }
  /* A VITRINE (22/09, dono: "a aba do meu jogo no chrome consome 2.6gb"): as chaves de
   * modelo que a PRAÇA mostra — as peças do corredor de cada portal aberto, o chefe atrás
   * dele e o catálogo inteiro do Campo de PvP (o portão e a cena do Campo vestem o mesmo).
   * A pré-busca (JOGO.Bundle.preBusca) baixa os calabouços abertos inteiros, mas só ABRE
   * em segundo plano o que está aqui: modelo aberto guarda as texturas descompactadas
   * (~12 MB cada, contra ~1 MB baixado), e monstro comum só serve lá dentro — quem o abre
   * é o gancho da descida. MEDIDO numa conta nova, na praça, com a pré-busca terminada:
   * abrindo tudo, 213 modelos e 2,34 GB de textura; só a vitrine, 142 e 1,57 GB — os
   * 0,77 GB de diferença eram monstros, peças fora do corredor e coroas.
   * Sai dos DADOS, não dos `lugares`: estes trocam com a cena (no Campo não há portal), e
   * a vitrine tem de ser a da praça de onde quer que a pré-busca pergunte. */
  Hub.vitrine = function () {
    var D = JOGO.DATA || {}, cat = JOGO.CENARIO || {}, m2 = M2(), fora = [];
    var ds = D.dungeons || [];
    (Array.isArray(ds) ? ds : Object.keys(ds).map(function (k) { return ds[k]; })).forEach(function (dg) {
      if (!dg || !dg.id || dg.id === 'poco') return;
      if (D.portalFechado && D.portalFechado(dg.id)) return;
      if (dg.theme && cat[dg.theme]) fora = fora.concat(pecasDoCorredor(cat[dg.theme]));
      var chefe = chefeDoCalabouco(dg.id);
      if (!chefe) return;
      fora.push(chefe);          // o poeChefeDoPortal confere rawScene(id do chefe)…
      try {                      // …e o corpo sai do lookFor
        var lk = (m2 && m2.lookFor) ? m2.lookFor(chefe) : null;
        if (lk && lk.model) fora.push(lk.model);
      } catch (e) {}
    });
    var tc = campoCfg().tema;
    (tc === 'misto' ? ['garden', 'cistern'] : [tc]).forEach(function (t) {
      var c = t && cat[t];
      if (!c) return;
      for (var papel in c) {
        if (Object.prototype.hasOwnProperty.call(c, papel) && Array.isArray(c[papel])) fora = fora.concat(c[papel]);
      }
    });
    return fora;
  };

  // ------------------------------------------------------------------ o herói
  function montaHeroi(classId) {
    var m2 = M2();
    if (!m2) return;
    var node = null;
    try { node = m2.unit(classId || 'sumo', { classId: classId || 'sumo' }); } catch (e) {}
    if (!node) return;
    var nasce = campoAtivo ? campoCfg().nasce : null;       // 14/09: no Campo, onde o desenho manda
    node.position.set(nasce ? (+nasce.x || 0) : 0, 0, nasce ? (+nasce.z || 0) : raioAtual() * 0.35);
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
      apagaHalo(corpo.coroaPvp);
      // a textura do bilhete é do cache (texturaCoroa): só a geometria e o material saem
      try { corpo.coroaPvp.geometry.dispose(); corpo.coroaPvp.material.dispose(); } catch (e2) {}
    }
    coroa.position.y = e.base3d;
    coroa.userData.baseY = e.base3d;
    coroa.userData.fase = Math.random() * 9;
    coroa.userData.gira3d = true;
    acendeCoroa(coroa, e.tier, e.tam);
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
    if (velho.aura) acendeAura(heroi, true, velho.auraCor);
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
  /* O PORTE DO BICHO (11/09, pedido do dono: "os pets vão ficando um pouco
   * maior de acordo com o nível de estrela"). Cada estrela engorda o corpo
   * em 12% — ★3 é um terço maior que o filhote recém-adotado. É a mesma
   * escala que a batalha usa (renderer3d_v2), e ela entra pelo `opts.scale`
   * do models3d_v2, ANTES de medir a caixa: altura e raio saem certos. */
  var PET_ESC_ESTRELA = 0.12;
  function escalaDoPet(petId) {
    var P = JOGO.Progress;
    var est = 0;
    try { est = (P && P.petStars) ? P.petStars(petId) : 0; } catch (e) {}
    return 1 + PET_ESC_ESTRELA * est;
  }
  function montaBicho(petId) {
    if (bicho) { scene.remove(bicho.node); bicho = null; }
    if (!petId || !heroi) return;
    var m2 = M2();
    if (!m2) return;
    var node = null;
    try { node = m2.unit(petId, { kind: 'pet', scale: escalaDoPet(petId) }); } catch (e) {}
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
    bicho = { node: node, alvo: null, andando: false, petId: petId, semCorrida: semCorrida,
              esc: escalaDoPet(petId) };
    try { node.userData.play('idle', { fade: 0 }); } catch (e) {}
  }
  /* O bicho segue o que a ficha diz: vestiu/soltou pet no inventário, o corpo
   * da praça troca sozinho (chamado ao entrar e a cada reavaliação do teto). */
  function sincronizaBicho() {
    if (!heroi) return;
    var pid = petDoAvatar(heroi.classId);
    // a ESTRELA também remonta: ganhou carta, o bicho cresce sem sair da praça
    var esc = pid ? escalaDoPet(pid) : 0;
    if ((bicho ? bicho.petId : null) !== pid || (bicho && bicho.esc !== esc)) montaBicho(pid);
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
  function penduraEm(corpo, nome, titulo, brasaTier, guilda, grupo, brilho) {
    if (!corpo || !THREE) return;
    // 05/10, os idiomas: o título viaja e é guardado em português (é chave); na plaquinha vai o do idioma de quem olha
    if (titulo && JOGO.UI && JOGO.UI.titExibe) titulo = JOGO.UI.titExibe(titulo);
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
      apagaHalo(corpo.coroaPvp);
      try { corpo.coroaPvp.material.dispose(); } catch (e) {}
      corpo.coroaPvp = null;
    }
    corpo.coroaEspera = null;
    if (!nome) return;
    var alto = (corpo.node.userData.height || 2.1);
    var temGuilda = !!(guilda && guilda.nome);
    // o pódio e o Mestre acendem o nome; a placa de GRUPO mantém a moldura
    // dourada dela (o grupo é informação de agora, e não pode sumir)
    var sp = grupo
      ? rotulo((grupo === 'lider' ? '♛ ' : '◆ ') + nome, '#ffe7a6', 0.42,
               { placa: true, borda: '#ffcf3f', traco: 9, fundo: 'rgba(44,32,8,0.92)',
                 brilho: brilho || null, subtexto: titulo || '' })
      : rotulo(nome, '#f0ead8', 0.42,
               { placa: true, brilho: brilho || null, subtexto: titulo || '' });
    sp.position.y = alto + 0.5;
    corpo.node.add(sp);
    corpo.plaquinha = sp;
    /* A PILHA (11/09). As alturas eram números soltos (0.5, 0.52, 0.34) que
     * batiam quando a placa do nome tinha uma altura só. Agora ela cresce
     * com o título dentro, e a da guilda cresce com o brasão: cada peça é
     * empilhada sobre o TOPO da anterior, medido de verdade (`scale.y` de um
     * sprite É a altura dele no mundo). Nada de constante para desacertar. */
    var topoPilha = sp.position.y + sp.scale.y / 2;
    // A PLACA DA GUILDA: emblema + nome, acima do nome do personagem — a
    // bandeira que o corpo carrega ("com seu logo da guild e nome da guild
    // em cima"). Placa própria, um degrau menor que a do nome.
    if (temGuilda) {
      var gtx = guilda.nome;
      var codEscudo = null;
      if (guilda.emblema && guilda.emblema.indexOf('shield|') === 0) {
        codEscudo = guilda.emblema;
      } else {
        gtx = (guilda.emblema || '⚑') + ' ' + guilda.nome;
      }
      /* A PLACA VESTE O BRASÃO (11/09): fundo e filete saem das cores do
       * escudo (JOGO.Brasao.coresDaPlaca), que espreme a luz do fundo numa
       * faixa escura e força contraste na borda — é o que impede que um
       * brasão todo preto vire uma placa preta sem nome legível. Sem o
       * módulo do brasão, a placa marrom-dourada de sempre. */
      var Bp = (typeof JOGO !== 'undefined') ? JOGO.Brasao : null;
      var cp = (Bp && Bp.coresDaPlaca && codEscudo) ? Bp.coresDaPlaca(codEscudo)
                                 : { fundo: null, borda: '#8a6f2e', texto: '#ffd98a' };
      // com brasão a placa vem maior: o escudo de 132 px mora dentro dela
      var escG = codEscudo ? 0.34 : 0.30;
      var sg = rotulo(gtx, cp.texto, escG,
                      { placa: true, fundo: cp.fundo, borda: cp.borda,
                        traco: codEscudo ? 6 : 5, escudo: codEscudo });
      sg.position.y = topoPilha + sg.scale.y / 2 + 0.05;
      topoPilha = sg.position.y + sg.scale.y / 2;
      corpo.node.add(sg);
      corpo.plaquinhaGuilda = sg;
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
        // a folga cresce com a coroa: uma Coroa X não pode sentar na placa
        var baseK3 = topoPilha + 0.10 + tamK * 0.22;
        coroa.position.y = baseK3;
        coroa.userData.baseY = baseK3;
        coroa.userData.fase = Math.random() * 9;
        coroa.userData.gira3d = true;
        acendeCoroa(coroa, brasaTier, tamK);
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
          var baseK = topoPilha + 0.10 + tamK * 0.55;
          bilhete.position.y = baseK;
          bilhete.userData.baseY = baseK;
          bilhete.userData.fase = Math.random() * 9;
          acendeCoroa(bilhete, brasaTier, tamK);
          corpo.node.add(bilhete);
          corpo.coroaPvp = bilhete;
        }
        // 11/09: no jogo servido a coroa 3D pode não ter descido ainda — o
        // bilhete segura o lugar e vira a 3D quando ela abrir (esperaCoroa)
        corpo.coroaEspera = { nivel: brasaTier.nivel, tam: tamK, tier: brasaTier,
                              base3d: topoPilha + 0.10 + tamK * 0.22 };
        esperaCoroa(brasaTier.nivel);
      }
    }
  }

  /* O BRILHO DA COROA (11/09, pedido do dono: "ranking 5 pra cima começa a
   * ter um brilho crescente até o nível máximo"). Um halo ADITIVO atrás da
   * coroa — dois sprites, um miolo e uma auréola larga — com força e cor
   * vindas do degrau (JOGO.Brasa.TIERS: `brilho` 0→1, `cor`). Fica dentro do
   * berço da coroa, então sobe, desce e gira junto sem contabilidade extra;
   * sprite sempre encara a câmera, o giro do modelo não o afeta.
   * Abaixo da Coroa V não existe halo nenhum — o degrau baixo tem de ser
   * apagado para o alto significar alguma coisa. */
  var texHalo = null;
  function haloDaCoroa(tier, tam) {
    if (!THREE || !tier) return null;
    var forca = tier.brilho || 0;
    if (forca <= 0) return null;
    if (!texHalo) {
      texHalo = fazTexRadial([[0, 'rgba(255,255,255,0.95)'], [0.30, 'rgba(255,255,255,0.42)'],
                              [0.62, 'rgba(255,255,255,0.12)'], [1, 'rgba(255,255,255,0)']]);
    }
    var cor = new THREE.Color(tier.cor || '#ffd36a');
    var g = new THREE.Group();
    // a AURÉOLA: larga e fraca, é ela que se vê de longe
    var largo = new THREE.Sprite(new THREE.SpriteMaterial({ map: texHalo, color: cor,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      opacity: 0.16 + 0.30 * forca }));
    var rLargo = tam * (1.9 + 1.5 * forca);
    largo.scale.set(rLargo, rLargo, 1);
    g.add(largo);
    // o MIOLO: pequeno e forte, dá o ponto de luz que o bloom pega
    var miolo = new THREE.Sprite(new THREE.SpriteMaterial({ map: texHalo, color: cor,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      opacity: 0.22 + 0.45 * forca }));
    var rMiolo = tam * (0.9 + 0.5 * forca);
    miolo.scale.set(rMiolo, rMiolo, 1);
    g.add(miolo);
    g.position.y = tam * 0.45;
    g.userData.forca = forca;
    g.userData.baseOp = [largo.material.opacity, miolo.material.opacity];
    return g;
  }
  /* Pendura o halo no berço de uma coroa já montada (3D ou bilhete). */
  function acendeCoroa(coroa, tier, tam) {
    if (!coroa || !tier) return;
    var halo = haloDaCoroa(tier, tam);
    if (!halo) return;
    // o bilhete PNG já vem com scale = tam; sem desfazer isso o halo levaria
    // o tamanho ao quadrado (a coroa 3D é um berço em escala 1 e não mexe)
    var k = (coroa.scale && coroa.scale.x) ? 1 / coroa.scale.x : 1;
    if (k !== 1) { halo.scale.setScalar(k); halo.position.y *= k; }
    coroa.add(halo);
    coroa.userData.halo = halo;
  }
  /* O halo é o único material NOVO por corpo (a coroa 3D compartilha os do
   * template e o bilhete usa textura de cache): quem tira a coroa o descarta. */
  function apagaHalo(coroa) {
    var hl = coroa && coroa.userData && coroa.userData.halo;
    if (!hl) return;
    for (var i = 0; i < hl.children.length; i++) {
      try { hl.children[i].material.dispose(); } catch (e) {}
    }
    coroa.remove(hl);
    coroa.userData.halo = null;
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
    // 11/09: o fator era 0.72 e a coroa lia como um ponto a três passos de
    // distância — agora o `tam` do degrau É o diâmetro dela (e o `tam` de
    // brasa.js subiu um terço junto). Aro, não torre: a normalização segue
    // pela LARGURA.
    no.scale.multiplyScalar(tam / larg);
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
    // o herói nunca leva marca de grupo (ela é do PARCEIRO); leva o brilho
    penduraEm(heroi, nome, titulo, brasaTier, guilda, null,
              brilhoDoNome(nome, souOMestre()));
  }
  /* O BRILHO DE UM NOME: o Mestre do Fundo primeiro (branco, e ele não
   * disputa pódio com ninguém), depois a medalha do RANKING DE XP (12/09: o
   * top 1, 2 e 3 do site, casado pelo NOME — o ranking não publica id). O
   * mapa vem da HUD, que é quem lê o ranking; aqui só se consulta. */
  var medalhasNome = {};            // nome em minúsculas -> 'ouro' | 'prata' | 'bronze'
  function souOMestre() {
    try { return !!(JOGO.GM && JOGO.GM.ativo && JOGO.GM.ativo()); } catch (e) { return false; }
  }
  function brilhoDoNome(nome, ehMestre) {
    if (ehMestre) return 'admin';
    var k = String(nome == null ? '' : nome).trim().toLowerCase();
    return (k && medalhasNome[k]) || null;
  }
  /* A HUD avisa quando o pódio muda (o ranking respondeu, entrou gente na
   * praça): as placas de todo mundo se repintam com a medalha nova. */
  Hub.medalhas = function (mapa) {
    medalhasNome = mapa || {};
    if (!scene) return false;
    pendura(nomeJogador, tituloJogador, brasaDoHeroi, guildaDoHeroi);
    for (var id in fantasmas) {
      if (!fantasmas.hasOwnProperty(id)) continue;
      var reg = fantasmas[id];
      if (!reg.corpo) continue;
      var pf = reg.perfil || {};
      penduraEm(reg.corpo, pf.nome || '?', pf.titulo || '', reg.tierF || null, reg.guildaF || null,
                marcasGrupo[id] || null, brilhoDoNome(pf.nome, pf.mestre === true));
      anelDoGrupo(reg.corpo, !!marcasGrupo[id]);
    }
    return true;
  };

  // -------------------------------------------------------------- a caminhada
  /* UM passo de caminhada para QUALQUER corpo (herói ou fantasma): mesmo
   * limiar de chegada, mesma velocidade, mesma virada. Devolve true no
   * quadro em que o corpo chega. */
  /* Empurra um ponto para FORA das construções sólidas. É o mesmo gesto do
   * tronco: o corpo desliza contornando a parede em vez de travar nela, e o
   * alvo segue o mesmo — o próximo passo tenta um pouco mais adiante na
   * tangente. Vale para o herói E para os fantasmas: o passo é um só. */
  function empurraDosSolidos(p, folga) {
    function fora(cx, cz, r) {
      var ex = p.x - cx, ez = p.z - cz;
      var d = Math.hypot(ex, ez);
      if (d >= r) return;
      if (d < 0.001) { p.x = cx + r; p.z = cz; return; }   // no miolo: sai por leste
      var k = r / d;
      p.x = cx + ex * k;
      p.z = cz + ez * k;
    }
    for (var i = 0; i < lugares.length; i++) {
      var lg = lugares[i];
      if (lg.solido) fora(lg.pos.x, lg.pos.z, lg.solido + (folga || 0));
    }
    for (var j = 0; j < solidos.length; j++) {
      fora(solidos[j].x, solidos[j].z, solidos[j].r + (folga || 0));
    }
    // 14/09: os muros retangulares do Campo
    for (var q = 0; q < caixas.length; q++) foraDaCaixa(p, caixas[q], CORPO_NA_CAIXA + (folga || 0));
    return p;
  }

  /* O CHEFE PARADO (12/09, dono: "ao lado dele o Boss parado como se fosse
   * um NPC, mas sem ação, só com o idle dele parado para enfeitar"). É o
   * corpo de batalha do chefe daquele Fecho, no porte de chefe, plantado no
   * fim do corredor e tocando `idle` — sem alvo, sem toque, sem painel. O
   * mixer dele entra no laço junto com o do herói; sem isso o chefe seria
   * uma estátua de verdade, congelada no primeiro quadro. */
  var chefesParados = [];
  /* a ficha de cada chefe plantado, para a prova conferir que o corpo dele
   * NÃO entra no muro (o defeito de 12/09) sem precisar de olho */
  var chefesFicha = [];
  function chefeDoCalabouco(dungeonId) {
    var D = JOGO.DATA && JOGO.DATA.monsters;
    if (!D) return null;
    for (var id in D) {
      if (!D.hasOwnProperty(id)) continue;
      if (D[id] && D[id].boss && D[id].dungeonId === dungeonId) return id;
    }
    return null;
  }
  /* Onde o chefe cabe. `d` é a distância atrás do portal, `largCamara` a
   * meia-largura da saleta e `folga` o que se deixa entre o corpo dele e a
   * face do muro. A largura do corpo é MEDIDA depois de o modelo nascer e
   * girar — a caixa do three já vem alinhada ao mundo, então a extensão dele
   * na direção de través sai da projeção da caixa nesse eixo (|tx|·sx +
   * |tz|·sz)/2, que é o teto certo para um AABB. A posição em `t` é a que
   * deixa o corpo ENCOSTADO no muro por dentro, sem atravessar; se nem assim
   * couber, ele vai para o eixo, atrás do portal — feio, mas nunca dentro
   * da parede. */
  function poeChefeDoPortal(lg, d, largCamara, folga) {
    var m2 = M2();
    if (!m2 || !scene) return null;
    var bossId = chefeDoCalabouco(lg.id);
    if (!bossId) return null;
    /* O MODELO DE VERDADE OU NENHUM. `M.unit` cai no esqueletinho genérico
     * (MONSTER_FALLBACK) quando o GLB do chefe ainda não desceu — e um
     * esqueleto no lugar da Jardineira é pior que portal pelado. Confere-se
     * o modelo aqui: sem ele, pede ao Bundle e volta null, que a próxima
     * leva (Models3D2.aoChegar) tenta de novo. */
    var pronto = false;
    try { pronto = !!(m2.rawScene && m2.rawScene(bossId)); } catch (e0) { pronto = false; }
    if (!pronto) {
      try { if (JOGO.Bundle && JOGO.Bundle.pede) JOGO.Bundle.pede([bossId]); } catch (eB) {}
      return null;
    }
    var def = JOGO.DATA.monsters[bossId];
    var no = null;
    try {
      no = m2.unit(bossId, { boss: true, kind: 'monster', element: (def && def.element) || 'neutro' });
    } catch (e) { no = null; }
    if (!no) return null;
    var r0 = Math.max(0.01, Math.hypot(lg.pos.x, lg.pos.z));
    var ux = lg.pos.x / r0, uz = lg.pos.z / r0;
    var tx = -uz, tz = ux;
    no.rotation.y = Math.atan2(-ux, -uz);      // de frente para quem chega

    /* A LARGURA DO CORPO, MEDIDA (12/09). Duas armadilhas atravessadas aqui:
     *   · `Box3.setFromObject` num SkinnedMesh devolve a caixa da pose de
     *     BIND — nestes corpos do Meshy dá 3 cm, e foi o que fez a primeira
     *     versão plantar o chefe dentro do muro;
     *   · `userData.radius` não serve nem como teto: sai de uma caixa de
     *     T-pose e vem limitado a 1,2 (models3d_v2), então devolve o mesmo
     *     número para um chefe de 2,6 m e um de 4,9 m de largura.
     * O jeito certo é o que o próprio módulo usa para enquadrar retrato:
     * `portraitFraming(no, true).box`, por trás do qual está `measurePose`
     * com `boneTransform` — medida DEPOIS do skinning. E o corpo tem de
     * estar POSADO antes: idle + um passo de mixer, senão mede-se o repouso.
     * Sem a API (módulo antigo), cai-se num valor largo o bastante para não
     * raspar. */
    try { no.userData.play('idle', { fade: 0 }); } catch (ep) {}
    try { if (no.userData.mixer) no.userData.mixer.update(0.42); } catch (ep2) {}
    no.updateMatrixWorld(true);
    var meiaT = 1.9;
    try {
      var enq = m2.portraitFraming ? m2.portraitFraming(no, true) : null;
      if (enq && enq.box && !enq.box.isEmpty()) {
        var sz = enq.box.max.clone().sub(enq.box.min);
        // a caixa vem em MUNDO e o corpo ainda não girou para o corredor:
        // o lado maior no chão é o que pode raspar o muro
        meiaT = Math.max(0.8, Math.max(sz.x, sz.z) / 2);
      }
    } catch (eM) {}
    var limite = largCamara - 0.35 - (folga || 0.4);           // a face interna do muro
    var raioCh = Math.max(1.0, meiaT * 0.75);
    var t = limite - meiaT;
    /* O CHEFE NUNCA VAI PARA O EIXO DA PISTA (21/09). A linha de 12/09 dizia
     * "corpo largo demais: vai para o eixo" (t = 0) e nunca tinha disparado:
     * o corpo mais largo do acervo media 4,9 m, e 4,4 − 2,45 ainda cabia de
     * lado. O Coração Partido, que entrou com o lote do último portal, é o
     * maior bicho do jogo — com ele o desvio disparou, o chefe parou em cima
     * da pista e o corredor daquele portal deixou de ser caminhável:
     * `tests/corredores.html` cobra que a pista esteja livre da boca ao fundo,
     * e é por ela que se anda até falar com o portal.
     * Agora quem cede é a PAREDE, não a pista: o corpo fica sempre de lado, a
     * pelo menos o raio sólido dele mais 0,75 m do eixo. Um chefe muito largo
     * encosta no muro da câmara (e, no limite, atravessa um palmo dele) — é
     * feio de perto e correto de jogar; o contrário travava o caminho. */
    if (t < raioCh + 0.75) t = raioCh + 0.75;
    var px = lg.pos.x + ux * d + tx * t;
    var pz = lg.pos.z + uz * d + tz * t;
    no.position.set(px, 0, pz);
    scene.add(no);
    chefesParados.push(no);
    // o corpo do chefe barra o passo como o muro barra
    marcaSolido(px, pz, raioCh, lg.id);
    chefesFicha.push({ portal: lg.id, chefe: bossId, x: px, z: pz,
                       d: d, t: t, meiaT: meiaT, limite: limite });
    return no;
  }

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
    if (!salaAtual && !campoAtivo && dTr < TRONCO_RAIO && dTr > 0.01) {
      var kTr = TRONCO_RAIO / dTr;
      p.x *= kTr; p.z *= kTr;
    }
    empurraDosSolidos(p, 0);
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

  /* ONDE SE PARA ao clicar num lugar: no centro, se ele não tem parede
   * (portal, porta); na calçada, se tem — o lado de cá do prédio, medido a
   * partir de onde o corpo está agora. O painel abre por PROXIMIDADE (o
   * `raio`, sempre maior que a parede), então parar fora basta. */
  function paradaDo(l) {
    if (!l.solido || !heroi) return l.pos;
    var hp = heroi.node.position;
    var ex = hp.x - l.pos.x, ez = hp.z - l.pos.z;
    var d = Math.hypot(ex, ez);
    if (d < 0.001) return new THREE.Vector3(l.pos.x + l.solido + 0.6, 0, l.pos.z);
    var k = (l.solido + 0.6) / d;
    return new THREE.Vector3(l.pos.x + ex * k, 0, l.pos.z + ez * k);
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
    // 11/09: o balão de fala some sozinho (o último segundo esmaece)
    var somaBalao = function (corpoB) {
      if (!corpoB || !corpoB.balao) return;
      var resta = corpoB.balaoAte - relogio;
      if (resta <= 0) { tiraBalao(corpoB); return; }
      corpoB.balao.material.opacity = Math.min(1, resta);
    };
    somaBalao(heroi);
    for (var fb in fantasmas) {
      if (fantasmas.hasOwnProperty(fb)) somaBalao(fantasmas[fb].corpo);
    }
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
        // o halo respira: quanto mais alto o degrau, mais fundo o pulso
        var hl = m.userData.halo;
        if (hl) {
          var pulso = 1 + Math.sin(relogio * 2.3 + (m.userData.fase || 0)) * (0.10 + 0.16 * hl.userData.forca);
          for (var hi = 0; hi < hl.children.length; hi++) {
            hl.children[hi].material.opacity = hl.userData.baseOp[hi] * pulso;
          }
        }
      };
      viraCoroa(heroi);
      for (var fk2 in fantasmas) {
        if (fantasmas.hasOwnProperty(fk2)) viraCoroa(fantasmas[fk2].corpo);
      }
      /* A AURA: a branca do Colecionador respira como sempre (o anel gira, as labaredas sobem); as da
       * loja têm cada uma a sua animação (AURA_FORMA). "Menos movimento" das Configurações põe o relógio
       * delas a um terço; a do vizinho distante não se desenha nem se anima. */
      var calmo = false;
      try { calmo = document.documentElement.classList.contains('menos-movimento'); } catch (eCalmo) {}
      relogioAura += Math.max(0, dt) * (calmo ? 0.3 : 1);   // o primeiro quadro do laço pode vir com dt negativo
      var pulsaAura = function (corpoA, vizinho) {
        if (!corpoA || !corpoA.aura) return;
        var gA = corpoA.aura;
        if (gA.userData.anima) {
          if (vizinho && heroi) {
            var ddx = corpoA.node.position.x - heroi.node.position.x, ddz = corpoA.node.position.z - heroi.node.position.z;
            var longe = gA.userData.leve ? AURA_LONGE * 0.6 : AURA_LONGE;
            gA.visible = (ddx * ddx + ddz * ddz) <= longe * longe;
            if (!gA.visible) return;
          }
          gA.userData.anima(relogioAura, corpoA);
          return;
        }
        for (var ai = 0; ai < gA.children.length; ai++) {
          var ch = gA.children[ai];
          if (ch.isSprite) {
            var f2 = (relogio * 0.45 + (ch.userData.fase || 0)) % 1.0;
            ch.position.y = 0.7 + f2 * 1.0;
            ch.material.opacity = Math.min(1, 0.34 * (ch.userData.forca || 1)) * (1 - f2);
          } else {
            ch.material.opacity = Math.min(1, (0.28 + Math.sin(relogio * 2.1) * 0.09) * (ch.userData.forca || 1));
            ch.rotation.z = relogio * 0.35;
          }
        }
      };
      pulsaAura(heroi, false);
      for (var fk2b in fantasmas) {
        if (fantasmas.hasOwnProperty(fk2b)) pulsaAura(fantasmas[fk2b].corpo, true);
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

    // 14/09: as tochas do Campo tremem — o brilho pulsa (19/09: é o halo do braseiro do
    // kit, solto do grupo instanciado; a chama, instanciada, fica parada)
    for (var tq = 0; tq < tochasCampo.length; tq++) {
      var tc = tochasCampo[tq];
      var osc = Math.sin(relogio * 9.0 + tc.fase) * 0.5 + Math.sin(relogio * 13.7 + tc.fase * 2.1) * 0.5;
      tc.brilho.scale.setScalar((tc.base || 2.4) * (1 + osc * 0.12));
      if (tc.chama) tc.chama.scale.set(1, 1 + osc * 0.18, 1);
    }

    if (heroi) {
      var chegou = andaCorpo(heroi, dt);
      if (chegou && aoChegar) { var f = aoChegar; aoChegar = null; f(); }
      try { if (heroi.node.userData.mixer) heroi.node.userData.mixer.update(dt); } catch (e) {}
      segueDono(dt);                 // o bicho atrás do ombro do dono
      // os chefes parados no fim dos corredores respiram (só o idle)
      for (var ci = 0; ci < chefesParados.length; ci++) {
        try {
          var mx = chefesParados[ci].userData.mixer;
          if (mx) mx.update(dt);
        } catch (eC) {}
      }

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

    // 04/10: na sede, o lado de parede que ficou entre a câmera e o salão some
    if (sedeObra && sedeObra.cena === scene && camera) {
      var cpS = camera.position, wS = SEDE_PAREDE - 0.6, lS = sedeObra.lados;
      lS.n.visible = cpS.z > -wS; lS.s.visible = cpS.z < wS;
      lS.o.visible = cpS.x > -wS; lS.l.visible = cpS.x < wS;
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

    // antes de tudo, os FANTASMAS: tocar num jogador é o gesto social (a HUD
    // abre o painel dele). 11/09: o toque vale no ALVO DE TOQUE do corpo
    // (poeAlvoToque), nas plaquinhas e na coroa — e, com dois na mesma linha,
    // ganha o mais perto da câmera
    if (Hub.aoTocarFantasma) {
      var melhorF = null, distF = Infinity;
      for (var fk3 in fantasmas) {
        if (!fantasmas.hasOwnProperty(fk3)) continue;
        var cF = fantasmas[fk3].corpo;
        if (!cF) continue;                       // sem corpo, sem toque
        if (!naZona(fantasmas[fk3])) continue;   // 14/09: nem de outra zona
        var hitsF = raycaster.intersectObjects(alvosDeToque(cF), true);
        if (hitsF && hitsF.length && hitsF[0].distance < distF) { distF = hitsF[0].distance; melhorF = fk3; }
      }
      if (melhorF !== null) {
        try { Hub.aoTocarFantasma(melhorF); } catch (e) {}
        return;
      }
    }

    // primeiro os LUGARES (clicar no portal anda até ele)…
    for (var i = 0; i < lugares.length; i++) {
      var hits = raycaster.intersectObject(lugares[i].node, true);
      if (hits && hits.length) {
        var l = lugares[i];
        andarAte(paradaDo(l), function () { if (Hub.aoAproximar) Hub.aoAproximar(l); });
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
      if (!salaAtual && !campoAtivo && dT < TRONCO_RAIO + 0.4) {
        var kT = (TRONCO_RAIO + 0.4) / Math.max(0.01, dT);
        p.x *= kT; p.z *= kT;
      }
      // clicar EM CIMA de um prédio: o destino vem para a calçada dele,
      // senão o corpo ficaria dando voltas na parede sem nunca chegar
      empurraDosSolidos(p, 0.4);
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
  /* 14/09: o que o tabuleiro da praça tática (renderer3d_v2, tema 'praca') pega daqui
   * para ser a MESMA praça: o desenho das lajotas e da grama (só canvas 2D — valem com o
   * Acampamento fechado) e a cor de cada Fecho no miolo do portal. */
  Hub.pintaLajotas = pintaLajotas;
  Hub.pintaGrama = pintaGrama;
  Hub.corDoTema = corDoTema;

  Hub.entrar = function (cont, classId, opts) {
    THREE = window.THREE;
    if (!THREE) return false;
    container = cont;
    // A ANTESSALA (03/09): a cena é a da praça ou a de UMA sala do calabouço;
    // trocar de sala (ou voltar à praça) refaz a cena inteira
    var salaNova = (opts && opts.sala) ? chaveSala(opts.sala) : null;
    var trocouSala = salaNova !== salaAtual;
    /* 14/09: O CAMPO DE PVP é outra cena, como a antessala. `opts.campo` (true/false)
     * troca; uma sala tira do Campo; sem nada, a cena fica onde está — a HUD reentra a
     * cada repintura e não pode tirar o jogador do Campo sem querer. */
    var campoNovo = (opts && opts.sala) ? false
                  : (opts && typeof opts.campo === 'boolean') ? opts.campo : campoAtivo;
    var trocouCampo = campoNovo !== campoAtivo;
    var jaTinha = !!renderer;
    salaAtual = salaNova;
    salaCfg = (opts && opts.sala) || null;
    campoAtivo = campoNovo;
    if (!campoAtivo) { aparenciaCampo = null; sedeId = null; sedeInfo = null; }
    else if (opts && opts.aparencia) aparenciaCampo = opts.aparencia;
    if (trocouSala || trocouCampo) zonaAtual = zonaDaCena();
    // o corpo de SEMPRE é o do avatar; no Campo, o da aparência escolhida (o 1º herói)
    if (classId) classeAvatar = classId;
    var corpoDe = (campoAtivo && aparenciaCampo) ? aparenciaCampo : (classId || classeAvatar);
    if (!renderer) {
      canvas = document.createElement('canvas');
      canvas.className = 'hub-canvas';
      container.appendChild(canvas);
      renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
      // 04/10: a qualidade das Configurações (JOGO.Mobile.grafico) desenha menos pixels no aparelho fraco
      var gq = (JOGO.Mobile && JOGO.Mobile.grafico) ? JOGO.Mobile.grafico() : null;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5) * ((gq && gq.escala) || 1));
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
    else if (jaTinha && trocouCampo) trocaDeCena();
    if (!heroi) montaHeroi(corpoDe);
    else if (corpoDe && heroi.classId !== corpoDe) {
      // trocou de herói entre visitas: o corpo acompanha
      scene.remove(heroi.node); heroi = null; montaHeroi(corpoDe);
    }
    if (heroi) heroi.classId = corpoDe;
    if (jaTinha && trocouCampo && !trocouSala) { Hub.defineZona(zonaAtual); avisaZona(); }
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
  /* AS AURAS DA LOJA. Em 04/10 nasceram como o anel e as labaredas do Colecionador TINGIDOS com a cor do
   * elemento — e o dono cobrou: "cada aura deve ser diferente... não só mudar a cor, e deve ter efeitos
   * mais chamativos". Agora cada uma é um EFEITO PRÓPRIO, que se reconhece pela forma e pelo movimento:
   *   fogo   (Brasa) — labaredas que sobem dos pés, fagulhas que estalam e um clarão quente que pulsa;
   *   agua   (Maré)  — anéis que se abrem no chão como onda e gotas que orbitam e caem;
   *   terra  (Raiz)  — folhas e pétalas girando devagar e brotos que nascem do chão e recolhem;
   *   ar     (Vento) — fitas de ar em espiral subindo em volta do corpo e um rastro ao andar;
   *   neutra (Lousa) — lascas de pedra em órbita lenta, runas e um círculo rúnico de luz pálida.
   * Nenhuma arte nova: as formas saem do atlas de partículas que o jogo já carrega (JOGO.FX_ATLAS, 16
   * quadros de 128 px) e de geometria de meia dúzia de triângulos. O CUSTO é contado em chamadas de
   * desenho: cada aura são 2 ou 3 (a antiga eram 5), porque as partículas de um tipo vão todas num só
   * THREE.Points / numa só malha, movidas na CPU. Quem tem a aura comprada E o Traje do Colecionador
   * veste a comprada. Sem `cor` (ou com uma que esta versão não conhece) fica a branca de sempre. */
  var AURA_COR = { fogo: 0xff6a2a, agua: 0x3aa0ff, terra: 0x6fcf4a, ar: 0xbfefff, neutra: 0xe0b860,
                   mestre: 0x8a0d14 };      // 04/10: a Chama do Mestre, só da conta do Mestre
  var AURA_LONGE = 26;               // m: além disto a aura do vizinho não se desenha (nem se anima)
  var AURA_K_PONTO = 2.36;           // PointsMaterial mede em "metros / tan(fov/2)": 1 / tan(23°)
  var relogioAura = 0;               // anda mais devagar com "Menos movimento" ligado
  var texAtlasAura = null, quadrosAura = {}, matsAura = {};
  /* no celular e na qualidade 'baixa' a aura leva METADE das partículas (e o vizinho some mais cedo) */
  function auraLeve() {
    try {
      var M = JOGO.Mobile;
      if (!M) return false;
      return (M.qualidade && M.qualidade() === 'baixa') || !!(M.celular && M.celular());
    } catch (e) { return false; }
  }
  /* um QUADRO do atlas como textura: todos os quadros dividem a mesma imagem (o clone do three reparte a
   * fonte, a GPU guarda uma só). Sem o atlas na página (prova antiga), cai no borrão radial da aura branca. */
  function quadroAura(i) {
    if (quadrosAura[i]) return quadrosAura[i];
    var A = JOGO.FX_ATLAS;
    if (!A || !A.png) return texAuraChama;
    if (!texAtlasAura) {
      var img = new Image();
      texAtlasAura = new THREE.Texture(img);
      texAtlasAura.minFilter = texAtlasAura.magFilter = THREE.LinearFilter;
      texAtlasAura.generateMipmaps = false;
      img.onload = function () {
        texAtlasAura.userData.pronta = true;
        for (var k in quadrosAura) if (quadrosAura.hasOwnProperty(k)) quadrosAura[k].needsUpdate = true;
      };
      img.src = A.png;
    }
    var t = texAtlasAura.clone();
    var col = i % A.cols, lin = Math.floor(i / A.cols);
    // um fio de folga na borda: com filtro linear o quadro vizinho vazava na beirada
    t.repeat.set(1 / A.cols - 0.01, 1 / A.rows - 0.01);
    t.offset.set(col / A.cols + 0.005, 1 - (lin + 1) / A.rows + 0.005);
    if (texAtlasAura.userData.pronta) t.needsUpdate = true;
    quadrosAura[i] = t;
    return t;
  }
  /* os materiais são UM por tipo de peça, repartidos por todos os corpos: vinte auras de Brasa na praça
   * não criam vinte programas nem vinte estados de GPU */
  function matAura(chave, faz) {
    if (!matsAura[chave]) matsAura[chave] = faz();
    return matsAura[chave];
  }
  /* PONTOS: n partículas do mesmo quadro numa chamada só. A cor (com alfa) é por partícula. */
  function pontosAura(n, quadro, metros, chave) {
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 4), 4));
    var mat = matAura('p:' + chave, function () {
      return new THREE.PointsMaterial({ map: quadroAura(quadro), size: metros * AURA_K_PONTO, sizeAttenuation: true,
        transparent: true, depthWrite: false, vertexColors: true, alphaTest: 0.02 });
    });
    var p = new THREE.Points(geo, mat);
    p.frustumCulled = false;           // as posições mudam todo quadro: a caixa nunca estaria certa
    p.userData.n = n;
    return p;
  }
  function poePonto(p, i, x, y, z, r, g, b, a) {
    var P = p.geometry.attributes.position.array, C = p.geometry.attributes.color.array;
    P[i * 3] = x; P[i * 3 + 1] = y; P[i * 3 + 2] = z;
    C[i * 4] = r; C[i * 4 + 1] = g; C[i * 4 + 2] = b; C[i * 4 + 3] = a;
  }
  function sujaPontos(p) {
    p.geometry.attributes.position.needsUpdate = true;
    p.geometry.attributes.color.needsUpdate = true;
  }
  /* PLACAS NO CHÃO: n quadrados deitados numa malha só (os anéis da Maré, o clarão da Brasa, o círculo
   * da Lousa). Cada um muda de raio, giro e alfa por quadro. */
  function placasAura(n, quadro, chave) {
    var geo = new THREE.BufferGeometry();
    var uv = new Float32Array(n * 8), idx = [];
    for (var i = 0; i < n; i++) {
      uv.set([0, 0, 1, 0, 1, 1, 0, 1], i * 8);
      idx.push(i * 4, i * 4 + 2, i * 4 + 1, i * 4, i * 4 + 3, i * 4 + 2);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 12), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 16), 4));
    geo.setIndex(idx);
    var mat = matAura('c:' + chave, function () {
      return new THREE.MeshBasicMaterial({ map: (quadro && quadro.isTexture) ? quadro : quadroAura(quadro), transparent: true, depthWrite: false,
        vertexColors: true,
        // só a face de cima: o three desenha o transparente de dois lados em DUAS passadas (a medida de
        // 04/10 deu 16 chamadas a mais em vinte auras por causa disso) e ninguém vê o chão por baixo
        // as pedras do caminho ficam a 0,05 e puxam a profundidade para a frente (polygonOffset −2):
        // sem ir além delas, a aura de quem pisa no caminho sumia debaixo da calçada
        polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    });
    var m = new THREE.Mesh(geo, mat);
    m.frustumCulled = false;
    m.userData.n = n;
    return m;
  }
  function poePlaca(m, i, raio, giro, y, r, g, b, a) {
    var P = m.geometry.attributes.position.array, C = m.geometry.attributes.color.array;
    var c = Math.cos(giro) * raio, s = Math.sin(giro) * raio;
    // os quatro cantos do quadrado girado em volta do eixo do corpo
    var X = [-c + s, c + s, c - s, -c - s], Z = [-s - c, s - c, s + c, -s + c];
    for (var k = 0; k < 4; k++) {
      var o = (i * 4 + k);
      P[o * 3] = X[k]; P[o * 3 + 1] = y; P[o * 3 + 2] = Z[k];
      C[o * 4] = r; C[o * 4 + 1] = g; C[o * 4 + 2] = b; C[o * 4 + 3] = a;
    }
  }
  function sujaPlacas(m) {
    m.geometry.attributes.position.needsUpdate = true;
    m.geometry.attributes.color.needsUpdate = true;
  }
  function fracao(x) { return x - Math.floor(x); }
  /* o CÍRCULO RÚNICO da Lousa, riscado em código (128 px): dois aros e oito runas de traço grosso entre
   * eles. O "círculo de runas" do atlas tem o traço fino demais — deitado no chão, a 10 m, não se via. */
  var texRunasAura = null, texSombraMestre = null;
  function runasAura() {
    if (texRunasAura) return texRunasAura;
    var cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    var c = cv.getContext('2d');
    c.strokeStyle = '#fff'; c.lineCap = 'round'; c.lineJoin = 'round';
    c.lineWidth = 4; c.beginPath(); c.arc(64, 64, 59, 0, Math.PI * 2); c.stroke();
    c.lineWidth = 2.5; c.beginPath(); c.arc(64, 64, 40, 0, Math.PI * 2); c.stroke();
    // cada runa é um risco em pé com um ou dois galhos — oito desenhos diferentes, de um número só
    c.lineWidth = 3;
    for (var i = 0; i < 8; i++) {
      c.save();
      c.translate(64, 64); c.rotate(i * Math.PI / 4); c.translate(0, -49.5);
      c.beginPath(); c.moveTo(0, -6); c.lineTo(0, 6);
      var d = (i % 2) ? 4 : -4;
      c.moveTo(0, -6 + (i % 3) * 3); c.lineTo(d, -2 + (i % 3) * 3);
      if (i % 3 !== 1) { c.moveTo(0, 5 - (i % 4)); c.lineTo(-d, 1 - (i % 4)); }
      if (i % 4 === 0) { c.moveTo(-4, 0); c.lineTo(4, 0); }
      c.stroke();
      c.restore();
    }
    texRunasAura = new THREE.CanvasTexture(cv);
    return texRunasAura;
  }

  /* cada montador devolve { pecas: {nome: objeto}, anima: function (t, corpo) } e pendura as peças em g */
  var AURA_FORMA = {
    /* A CHAMA DO MESTRE (04/10, o dono: "quero uma aura preta com vermelho escuro e chamas, especial para o gm,
     * capriche! que combine com a skin dele" — o Cavaleiro Negro). Só a conta do Mestre a tem (loja.AURAS_MESTRE).
     * É a maior das auras, e a única ESCURA: uma coluna de labaredas PRETAS por fora (a mistura é a normal, não a
     * aditiva: preto aditivo não existe) com um miolo de fogo carmesim por dentro, o chão tomado por um selo de
     * runas vermelho-sangue que gira em dois sentidos sobre uma mancha de sombra, lâminas negras em órbita na
     * altura dos ombros e brasas vermelhas que sobem em espiral. */
    mestre: function (g, leve) {
      var nN = leve ? 8 : 16, nV = leve ? 5 : 9, nB = leve ? 7 : 14, nL = leve ? 2 : 4;
      // a mancha é PRETA de verdade: textura própria, mistura normal (o clarão do atlas é luz, e preto de luz não existe)
      if (!texSombraMestre) {
        texSombraMestre = fazTexRadial([[0, 'rgba(255,255,255,0.96)'], [0.55, 'rgba(255,255,255,0.8)'],
          [0.85, 'rgba(255,255,255,0.3)'], [1, 'rgba(255,255,255,0)']]);
      }
      // um disco deitado, simples (a placa de cor por vértice multiplicava a textura e a mancha não aparecia)
      var sombra = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), matAura('sombra-mestre', function () {
        return new THREE.MeshBasicMaterial({ map: texSombraMestre, color: 0x000000, transparent: true, opacity: 0.62,
          depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
      }));
      sombra.rotation.x = -Math.PI / 2;
      sombra.position.y = 0.088;         // acima da calçada (0,05–0,08)
      sombra.frustumCulled = false;
      sombra.userData.n = 1;
      var selo = placasAura(2, runasAura(), 'circulo');
      function linguas(n) {
        var geo = new THREE.BufferGeometry(), idx = [];
        for (var q = 0; q < n; q++) {
          var o4 = q * 4;
          idx.push(o4, o4 + 2, o4 + 1, o4 + 1, o4 + 2, o4 + 3, o4, o4 + 1, o4 + 2, o4 + 1, o4 + 3, o4 + 2);
        }
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 12), 3));
        geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 16), 4));
        geo.setIndex(idx);
        var m = new THREE.Mesh(geo, matAura('labareda', function () {
          return new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false });
        }));
        m.frustumCulled = false;
        m.userData.n = n;
        return m;
      }
      // uma língua: pé, dois lados e a ponta; `cores` = [pé, barriga, ponta] em rgb
      function poeLingua(m, i, a, raio, alt, larg, bal, vira, cores, alfa) {
        var P = m.geometry.attributes.position.array, C = m.geometry.attributes.color.array;
        var rx = Math.cos(a), rz = Math.sin(a);
        var dx = -rz * Math.cos(vira) + rx * Math.sin(vira), dz = rx * Math.cos(vira) + rz * Math.sin(vira);
        var cx = rx * raio, cz = rz * raio, o = i * 12, k = i * 16;
        P[o] = cx; P[o + 1] = 0.06; P[o + 2] = cz;
        P[o + 3] = cx - dx * larg; P[o + 4] = alt * 0.3; P[o + 5] = cz - dz * larg;
        P[o + 6] = cx + dx * larg; P[o + 7] = alt * 0.3; P[o + 8] = cz + dz * larg;
        P[o + 9] = cx * 0.78 + dx * bal; P[o + 10] = alt; P[o + 11] = cz * 0.78 + dz * bal;
        C[k] = cores[0][0]; C[k + 1] = cores[0][1]; C[k + 2] = cores[0][2]; C[k + 3] = alfa;
        C[k + 4] = cores[1][0]; C[k + 5] = cores[1][1]; C[k + 6] = cores[1][2]; C[k + 7] = alfa;
        C[k + 8] = cores[1][0]; C[k + 9] = cores[1][1]; C[k + 10] = cores[1][2]; C[k + 11] = alfa;
        C[k + 12] = cores[2][0]; C[k + 13] = cores[2][1]; C[k + 14] = cores[2][2]; C[k + 15] = alfa * (cores === PRETO ? 0.85 : 0.35);
      }
      var negras = linguas(nN), rubras = linguas(nV);
      var brasas = pontosAura(nB, 5, 0.5, 'fagulha');
      var laminas = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.2, 0), matAura('lamina-mestre', function () {
        return new THREE.MeshPhongMaterial({ color: 0x050506, flatShading: true, shininess: 90, specular: 0x8a1016, emissive: 0x000000 });
      }), nL);
      laminas.frustumCulled = false;
      laminas.userData.n = nL;
      // a ordem importa: a sombra e o selo no chão; o negro alto primeiro e o fogo rubro, mais baixo, desenhado POR CIMA —
      // com o negro por último ele tapava o miolo e a aura virava um borrão escuro (medido na foto de 04/10)
      g.add(sombra); g.add(selo); g.add(negras); g.add(rubras); g.add(laminas); g.add(brasas);
      var PRETO = [[0.2, 0.005, 0.01], [0.015, 0, 0], [0, 0, 0]];
      var RUBRO = [[1, 0.36, 0.14], [0.72, 0.05, 0.06], [0.22, 0, 0.01]];
      var aux = new THREE.Object3D();
      return { pecas: { sombra: sombra, selo: selo, rubras: rubras, negras: negras, laminas: laminas, brasas: brasas },
               anima: function (t) {
        var pulso = Math.pow(0.5 + 0.5 * Math.sin(t * 2.1), 2), treme = 0.5 + 0.5 * Math.sin(t * 11.3);
        // a mancha de sombra respira; o selo de fora gira devagar, o de dentro ao contrário e acende no pulso
var ds = 5.4 + pulso * 0.5; sombra.scale.set(ds, ds, 1);
        poePlaca(selo, 0, 2.25, t * 0.22, 0.095, 1, 0.08, 0.08, 0.95);
        poePlaca(selo, 1, 1.28 + pulso * 0.14, -t * 0.5, 0.1, 1, 0.16 + treme * 0.1, 0.1, 0.45 + pulso * 0.55);
        sujaPlacas(selo);
        var i, f, a;
        for (i = 0; i < nV; i++) {            // o miolo: fogo carmesim, mais baixo e mais rápido
          f = fracao(t * 1.25 + i * 0.57);
          a = i * (Math.PI * 2 / nV) - t * 0.35;
          poeLingua(rubras, i, a, 0.97, 0.45 + 1.15 * Math.pow(f, 0.7), 0.27 * (1 - f * 0.5),
                    Math.sin(t * 7.1 + i * 1.9) * 0.12 * (0.4 + f), (i % 2) ? 0.7 : -0.7, RUBRO, 1 - f * f * f);
        }
        for (i = 0; i < nN; i++) {            // a casca: labaredas pretas, altas, que passam da cabeça
          f = fracao(t * 0.8 + i * 0.61);
          a = i * (Math.PI * 2 / nN) + t * 0.2;
          poeLingua(negras, i, a, 1.12, 0.9 + 2.3 * Math.pow(f, 0.65), 0.42 * (1 - f * 0.4),
                    Math.sin(t * 5.2 + i * 2.3) * 0.2 * (0.4 + f), (i % 2) ? 0.85 : -0.85, PRETO, 1 - f * f * f * f);
        }
        rubras.geometry.attributes.position.needsUpdate = true; rubras.geometry.attributes.color.needsUpdate = true;
        negras.geometry.attributes.position.needsUpdate = true; negras.geometry.attributes.color.needsUpdate = true;
        for (i = 0; i < nL; i++) {            // lâminas negras: finas, compridas, de ponta para baixo, em órbita
          a = -t * 0.9 + i * (Math.PI * 2 / nL);
          aux.position.set(Math.cos(a) * 1.42, 1.75 + Math.sin(t * 1.3 + i * 1.7) * 0.16, Math.sin(a) * 1.42);
          aux.rotation.set(0, -a, 0.22);
          aux.scale.set(0.42, 3.1, 0.2);
          aux.updateMatrix();
          laminas.setMatrixAt(i, aux.matrix);
        }
        laminas.instanceMatrix.needsUpdate = true;
        for (i = 0; i < nB; i++) {            // brasas vermelhas em espiral, subindo e piscando
          f = fracao(t * 0.55 + i * 0.317);
          a = i * 2.4 + t * 1.6 + f * 3.5;
          var rb = 1.15 - f * 0.55;
          var pisca = (Math.floor(t * 12 + i * 5) % 4) ? 1 : 0.35;
          poePonto(brasas, i, Math.cos(a) * rb, 0.3 + f * 3.3, Math.sin(a) * rb, 1, 0.12 + (1 - f) * 0.2, 0.06,
                   Math.min(1, (1 - f) * 1.6) * pisca);
        }
        sujaPontos(brasas);
      } };
    },
    /* BRASA — o que se lê de longe é a COLUNA de fogo: labaredas grandes nascendo nos pés e afinando
     * para cima, fagulhas pequenas que sobem depressa aos trancos, e o chão que acende e apaga. */
    fogo: function (g, leve) {
      var nL = leve ? 6 : 12, nF = leve ? 4 : 8;
      var clarao = placasAura(1, 14, 'clarao');
      /* a LABAREDA é geometria, não partícula: a "brasa rasgada" do atlas (primeira tentativa, 04/10) virava
       * uma poeira laranja que ninguém lia como fogo. Cada língua é uma pipa de quatro vértices em pé —
       * pé amarelo, barriga laranja, ponta vermelha que some —, e todas vão numa malha só. */
      var geo = new THREE.BufferGeometry(), idx = [];
      for (var q = 0; q < nL; q++) {
        var o4 = q * 4;                 // pé, esquerda, direita, ponta — e o avesso, na mesma chamada
        idx.push(o4, o4 + 2, o4 + 1, o4 + 1, o4 + 2, o4 + 3, o4, o4 + 1, o4 + 2, o4 + 1, o4 + 3, o4 + 2);
      }
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nL * 12), 3));
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(nL * 16), 4));
      geo.setIndex(idx);
      var labaredas = new THREE.Mesh(geo, matAura('labareda', function () {
        return new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false });
      }));
      labaredas.frustumCulled = false;
      labaredas.userData.n = nL;
      var fagulhas = pontosAura(nF, 5, 0.42, 'fagulha');
      g.add(clarao); g.add(labaredas); g.add(fagulhas);
      return { pecas: { clarao: clarao, labaredas: labaredas, fagulhas: fagulhas }, anima: function (t) {
        var pulso = 0.5 + 0.5 * Math.sin(t * 5.2), treme = 0.5 + 0.5 * Math.sin(t * 13.7);
        poePlaca(clarao, 0, 1.75 + pulso * 0.3, t * 0.3, 0.09, 1, 0.42 + treme * 0.1, 0.1, 0.6 + pulso * 0.4);
        sujaPlacas(clarao);
        var P = geo.attributes.position.array, C = geo.attributes.color.array, i, f, a;
        for (i = 0; i < nL; i++) {
          f = fracao(t * 1.0 + i * 0.61);                 // cada língua cresce do chão e some no alto
          a = i * (Math.PI * 2 / nL) + t * 0.25;
          var rx = Math.cos(a), rz = Math.sin(a), raio = 0.98;      // por FORA do corpo mais largo (0,9 m)
          // metade das línguas vira 45° para um lado, metade para o outro: de qualquer ângulo há chama de frente
          var fi = (i % 2) ? 0.8 : -0.8;
          var dx = -rz * Math.cos(fi) + rx * Math.sin(fi), dz = rx * Math.cos(fi) + rz * Math.sin(fi);
          var alt = 0.55 + 1.5 * Math.pow(f, 0.7), larg = 0.36 * (1 - f * 0.45);
          var bal = Math.sin(t * 6.3 + i * 2.1) * 0.14 * (0.4 + f);      // a ponta dança
          var cx = rx * raio, cz = rz * raio, o = i * 12, k = i * 16;
          var alfa = 1 - f * f * f;
          P[o] = cx; P[o + 1] = 0.06; P[o + 2] = cz;
          P[o + 3] = cx - dx * larg; P[o + 4] = alt * 0.32; P[o + 5] = cz - dz * larg;
          P[o + 6] = cx + dx * larg; P[o + 7] = alt * 0.32; P[o + 8] = cz + dz * larg;
          P[o + 9] = cx * 0.82 + dx * bal; P[o + 10] = alt; P[o + 11] = cz * 0.82 + dz * bal;
          C[k] = 1; C[k + 1] = 0.9; C[k + 2] = 0.35; C[k + 3] = alfa;
          C[k + 4] = 1; C[k + 5] = 0.42; C[k + 6] = 0.05; C[k + 7] = alfa;
          C[k + 8] = 1; C[k + 9] = 0.42; C[k + 10] = 0.05; C[k + 11] = alfa;
          C[k + 12] = 0.9; C[k + 13] = 0.1; C[k + 14] = 0.02; C[k + 15] = alfa * 0.5;
        }
        geo.attributes.position.needsUpdate = true;
        geo.attributes.color.needsUpdate = true;
        for (i = 0; i < nF; i++) {
          f = fracao(t * 1.15 + i * 0.37);
          a = i * 1.7 + Math.floor(t * 1.15 + i * 0.37) * 2.3;      // cada volta sai de outro canto
          // o ESTALO: a fagulha salta de lado aos trancos e pisca
          var tranco = (Math.floor(t * 9 + i * 3) % 2) ? 0.09 : -0.09;
          var pisca = (Math.floor(t * 14 + i * 5) % 3) ? 1 : 0.3;
          poePonto(fagulhas, i, Math.cos(a) * 1.1 + tranco, 0.6 + f * 2.7, Math.sin(a) * 1.1 - tranco,
                   1, 0.86, 0.25, Math.min(1, (1 - f) * 1.4) * pisca);
        }
        sujaPontos(fagulhas);
      } };
    },
    /* MARÉ — tudo acontece DEITADO: anéis que nascem pequenos nos pés e se abrem até sumir, um atrás do
     * outro, como pedra na água; por cima, gotas que dão a volta no corpo e despencam. */
    agua: function (g, leve) {
      var nA = leve ? 2 : 3, nG = leve ? 4 : 8;
      var ondas = placasAura(nA, 9, 'onda');
      var gotas = pontosAura(nG, 0, 0.4, 'gota');
      g.add(ondas); g.add(gotas);
      return { pecas: { ondas: ondas, gotas: gotas }, anima: function (t) {
        var i, f;
        for (i = 0; i < nA; i++) {
          f = fracao(t * 0.42 + i / nA);
          poePlaca(ondas, i, 0.6 + f * 1.9, i * 1.1, 0.08 + i * 0.004, 0.25, 0.68, 1, Math.min(1, Math.pow(1 - f, 1.2) * 1.25));
        }
        sujaPlacas(ondas);
        for (i = 0; i < nG; i++) {
          f = fracao(t * 0.3 + i / nG);
          var a = t * 1.5 + i * (Math.PI * 2 / nG);
          var y, alfa = 0.95;
          if (f < 0.72) y = 1.7 + Math.sin(t * 2.2 + i * 1.3) * 0.15;      // orbita boiando
          else {                                                            // e cai, cada vez mais depressa
            var q = (f - 0.72) / 0.28;
            y = 1.7 * (1 - q * q) + 0.1;
            alfa = q > 0.85 ? (1 - q) / 0.15 : 0.95;
          }
          poePonto(gotas, i, Math.cos(a) * 1.1, y, Math.sin(a) * 1.1, 0.55, 0.88, 1, alfa);
        }
        sujaPontos(gotas);
      } };
    },
    /* RAIZ — a única com coisa SÓLIDA: folhas e pétalas (losangos de dois triângulos) rodando devagar,
     * cada uma virando no próprio eixo, e brotos que furam o chão, ficam um instante e recolhem. */
    terra: function (g, leve) {
      var nF = leve ? 6 : 12, nB = leve ? 3 : 6;
      var geo = new THREE.BufferGeometry(), idx = [];
      for (var q = 0; q < nF; q++) idx.push(q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3);
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nF * 12), 3));
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(nF * 12), 3));
      geo.setIndex(idx);
      var folhas = new THREE.Mesh(geo, matAura('folha', function () {
        return new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
      }));
      folhas.frustumCulled = false;
      folhas.userData.n = nF;
      var brotos = new THREE.InstancedMesh(new THREE.ConeGeometry(0.12, 0.95, 5),
        matAura('broto', function () { return new THREE.MeshLambertMaterial({ color: 0x7a5230 /* madeira: verde sobre a grama da praça sumia */ }); }), nB);
      brotos.frustumCulled = false;
      brotos.userData.n = nB;
      g.add(folhas); g.add(brotos);
      var aux = new THREE.Object3D();
      return { pecas: { folhas: folhas, brotos: brotos }, anima: function (t) {
        var P = geo.attributes.position.array, C = geo.attributes.color.array, i, k;
        for (i = 0; i < nF; i++) {
          var a = t * 0.55 + i * (Math.PI * 2 / nF);
          var raio = 1.15 + Math.sin(i * 2.7) * 0.16;
          var cx = Math.cos(a) * raio, cz = Math.sin(a) * raio;
          var cy = 0.7 + (i % 4) * 0.42 + Math.sin(t * 0.9 + i * 1.9) * 0.18;
          // a folha é um losango: o eixo comprido segue a órbita, o curto gira em volta dele (o "virar")
          var gira = t * 1.6 + i * 1.1, comp = 0.3, larg = 0.15;
          var tx = -Math.sin(a), tz = Math.cos(a);                       // tangente da órbita
          var nx = Math.cos(a) * Math.cos(gira), ny = Math.sin(gira), nz = Math.sin(a) * Math.cos(gira);
          var V = [[cx + tx * comp, cy + 0.05, cz + tz * comp], [cx + nx * larg, cy + ny * larg, cz + nz * larg],
                   [cx - tx * comp, cy - 0.05, cz - tz * comp], [cx - nx * larg, cy - ny * larg, cz - nz * larg]];
          // de lado para a luz ela escurece: é o que faz o giro se ler sem iluminação de verdade
          var luz = 0.62 + 0.38 * Math.abs(Math.sin(gira));
          var petala = (i % 3) === 2;
          var cr = petala ? 1.0 : 0.2, cg = petala ? 0.45 : 0.62, cb = petala ? 0.68 : 0.12;
          for (k = 0; k < 4; k++) {
            var o = (i * 4 + k) * 3;
            P[o] = V[k][0]; P[o + 1] = V[k][1]; P[o + 2] = V[k][2];
            var ponta = (k % 2) ? 1 : 0.8;                               // a nervura: as pontas mais escuras
            C[o] = cr * luz * ponta; C[o + 1] = cg * luz * ponta; C[o + 2] = cb * luz * ponta;
          }
        }
        geo.attributes.position.needsUpdate = true;
        geo.attributes.color.needsUpdate = true;
        for (i = 0; i < nB; i++) {
          var f = fracao(t * 0.22 + i / nB), ciclo = Math.floor(t * 0.22 + i / nB);
          // nasce (30%), fica (30%), recolhe (25%) e descansa: a cada ciclo num canto novo do chão
          var alt = f < 0.3 ? f / 0.3 : (f < 0.6 ? 1 : (f < 0.85 ? 1 - (f - 0.6) / 0.25 : 0));
          alt = alt * alt * (3 - 2 * alt);
          var ab = i * (Math.PI * 2 / nB) + ciclo * 1.9, rb = 1.0 + ((i * 7 + ciclo * 3) % 5) * 0.1;
          aux.position.set(Math.cos(ab) * rb, 0.47 * alt, Math.sin(ab) * rb);
          aux.rotation.set(Math.sin(ab) * 0.28, 0, -Math.cos(ab) * 0.28);     // inclina para fora, como raiz
          aux.scale.set(0.6 + alt * 0.4, Math.max(0.001, alt), 0.6 + alt * 0.4);
          aux.updateMatrix();
          brotos.setMatrixAt(i, aux.matrix);
        }
        brotos.instanceMatrix.needsUpdate = true;
      } };
    },
    /* VENTO — a forma é a ESPIRAL: fitas compridas enroladas no corpo dos pés à cabeça, girando (a hélice
     * que gira parece subir), com um trecho mais claro correndo por dentro; andando, o ar fica para trás. */
    ar: function (g, leve) {
      var nFitas = leve ? 2 : 3, seg = leve ? 14 : 22, nR = leve ? 3 : 6;
      var nV = nFitas * (seg + 1) * 2;
      var pos = new Float32Array(nV * 3), cor = new Float32Array(nV * 4), idx = [], v = 0;
      for (var fi = 0; fi < nFitas; fi++) {
        var base = v;
        for (var s = 0; s <= seg; s++) {
          var u = s / seg, a = u * Math.PI * 3.2 + fi * (Math.PI * 2 / nFitas);
          var raio = 0.98 + u * 0.3, y = 0.15 + u * 2.35, meia = 0.12 * Math.sin(Math.PI * u) + 0.015;
          pos.set([Math.cos(a) * raio, y - meia, Math.sin(a) * raio], v * 3); v++;
          pos.set([Math.cos(a) * raio, y + meia, Math.sin(a) * raio], v * 3); v++;
          if (s < seg) {
            var b = base + s * 2;
            // a fita se vê dos dois lados; em vez de DoubleSide (que no transparente custa duas passadas
            // de desenho) cada trecho leva os triângulos também ao avesso, na mesma chamada
            idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2, b, b + 2, b + 1, b + 1, b + 2, b + 3);
          }
        }
      }
      var geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(cor, 4));
      geo.setIndex(idx);
      var fitas = new THREE.Mesh(geo, matAura('fita', function () {
        return new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false });
      }));
      fitas.frustumCulled = false;
      fitas.userData.n = nFitas;
      var rastro = pontosAura(nR, 6, 0.8, 'rastro');
      rastro.visible = false;
      g.add(fitas); g.add(rastro);
      var forcaRastro = 0, tAntes = null;
      return { pecas: { fitas: fitas, rastro: rastro }, anima: function (t, corpo) {
        fitas.rotation.y = -t * 2.6;
        var k = 0;
        for (var fi2 = 0; fi2 < nFitas; fi2++) {
          for (var s2 = 0; s2 <= seg; s2++) {
            var u2 = s2 / seg;
            // a rajada: uma faixa clara que corre da base ao topo da fita
            var raj = 0.5 + 0.5 * Math.sin((u2 - t * 0.9 - fi2 * 0.33) * Math.PI * 2);
            var alfa = Math.min(1, Math.sin(Math.PI * u2) * (0.45 + 0.6 * raj) * 1.3);
            for (var w = 0; w < 2; w++) {
              cor[k * 4] = 0.86 + raj * 0.14; cor[k * 4 + 1] = 0.97; cor[k * 4 + 2] = 1; cor[k * 4 + 3] = alfa;
              k++;
            }
          }
        }
        geo.attributes.color.needsUpdate = true;
        // o RASTRO só existe andando; parado ele se apaga em meio segundo e deixa de ser desenhado
        var dt = tAntes === null ? 0 : Math.max(0, Math.min(0.1, t - tAntes));
        tAntes = t;
        forcaRastro += ((corpo && corpo.andando ? 1 : 0) - forcaRastro) * Math.min(1, dt * 5);
        rastro.visible = forcaRastro > 0.03;
        if (rastro.visible) {
          for (var i = 0; i < nR; i++) {
            var f = fracao(t * 1.3 + i / nR);
            // o corpo olha para +Z: o ar fica em −Z, abrindo e subindo um pouco
            poePonto(rastro, i, Math.sin(i * 2.4 + t * 3) * (0.1 + f * 0.25), 0.55 + (i % 3) * 0.35 + f * 0.2,
                     -0.9 - f * 2.0, 0.92, 0.98, 1, (1 - f) * 0.7 * forcaRastro);
          }
          sujaPontos(rastro);
        }
      } };
    },
    /* LOUSA — a mais LENTA e a mais pesada: lascas de pedra facetada flutuando em órbita, um círculo de
     * runas deitado no chão que gira ao contrário, e tudo acende junto num pulso pálido e demorado. */
    neutra: function (g, leve) {
      var nL = leve ? 3 : 6, nR = leve ? 2 : 4;
      var nC = leve ? 1 : 2;
      var circulo = placasAura(nC, runasAura(), 'circulo');
      var geoL = new THREE.OctahedronGeometry(0.2, 0);
      var lascas = new THREE.InstancedMesh(geoL, matAura('lasca', function () {
        return new THREE.MeshPhongMaterial({ color: 0x6b7180, flatShading: true, shininess: 8, emissive: 0x14151a });
      }), nL);
      lascas.frustumCulled = false;
      lascas.userData.n = nL;
      var runas = pontosAura(nR, 12, 0.75, 'runa');
      g.add(circulo); g.add(lascas); g.add(runas);
      var aux = new THREE.Object3D();
      return { pecas: { circulo: circulo, lascas: lascas, runas: runas }, anima: function (t) {
        var pulso = Math.pow(0.5 + 0.5 * Math.sin(t * 1.5), 2);            // sobe devagar, demora apagado
        poePlaca(circulo, 0, 1.85, -t * 0.25, 0.09, 1, 0.93, 0.62, 0.7 + pulso * 0.3);
        if (nC > 1) poePlaca(circulo, 1, 1.05 + pulso * 0.12, t * 0.4, 0.096, 1, 0.97, 0.8, 0.3 + pulso * 0.7);   // o de dentro gira ao contrário
        sujaPlacas(circulo);
        var i, a;
        for (i = 0; i < nL; i++) {
          a = t * 0.45 + i * (Math.PI * 2 / nL);
          aux.position.set(Math.cos(a) * 1.2, 0.9 + (i % 3) * 0.45 + Math.sin(t * 0.8 + i * 2.1) * 0.12, Math.sin(a) * 1.2);
          aux.rotation.set(t * 0.5 + i, t * 0.35 + i * 2, i * 1.3);
          // lasca, não bola: cada uma esticada num eixo, de tamanho diferente
          var e = 0.75 + (i % 3) * 0.25;
          aux.scale.set(0.55 * e, 1.5 * e, 0.8 * e);
          aux.updateMatrix();
          lascas.setMatrixAt(i, aux.matrix);
        }
        lascas.instanceMatrix.needsUpdate = true;
        for (i = 0; i < nR; i++) {
          a = -t * 0.3 + i * (Math.PI * 2 / nR) + 0.4;
          poePonto(runas, i, Math.cos(a) * 1.05, 1.5 + (i % 2) * 0.7 + Math.sin(t * 0.7 + i * 1.7) * 0.12, Math.sin(a) * 1.05,
                   1, 0.86, 0.4, 0.45 + pulso * 0.55);
        }
        sujaPontos(runas);
      } };
    }
  };
  /* tira a aura do corpo e solta a geometria (ela é de cada corpo; os materiais são repartidos e ficam) */
  function apagaAura(corpo) {
    if (!corpo.aura) return;
    corpo.node.remove(corpo.aura);
    if (corpo.aura.userData.forma) {
      corpo.aura.traverse(function (o) { if (o.geometry && o.geometry.dispose) o.geometry.dispose(); });
    }
    corpo.aura = null;
  }
  function acendeAura(corpo, liga, cor) {
    if (!corpo || !THREE) return;
    cor = (typeof cor === 'string' && AURA_COR.hasOwnProperty(cor)) ? cor : null;
    if (!liga) {
      apagaAura(corpo);
      corpo.auraCor = null;
      return;
    }
    if (corpo.aura && (corpo.auraCor || null) === cor) return;
    apagaAura(corpo);                                                    // trocou de aura: refaz
    if (!texAuraDisco) {
      texAuraDisco = fazTexRadial([[0, 'rgba(255,255,255,0)'],
        [0.55, 'rgba(255,255,255,0.5)'], [0.75, 'rgba(255,255,255,0.16)'],
        [1, 'rgba(255,255,255,0)']]);
      texAuraChama = fazTexRadial([[0, 'rgba(255,255,255,0.85)'],
        [0.5, 'rgba(255,250,240,0.25)'], [1, 'rgba(255,255,255,0)']]);
    }
    var g = new THREE.Group();
    if (cor) {
      var leve = auraLeve();
      var forma = AURA_FORMA[cor](g, leve);
      g.userData.forma = cor;
      g.userData.leve = leve;
      g.userData.pecas = forma.pecas;
      g.userData.anima = forma.anima;
      forma.anima(relogioAura, corpo);       // já nasce no lugar: o primeiro quadro não mostra tudo na origem
      corpo.node.add(g);
      corpo.aura = g;
      corpo.auraCor = cor;
      return;
    }
    // a BRANCA do Colecionador, como sempre foi: um anel no chão e três labaredas macias, aditivas
    var disco = new THREE.Mesh(
      new THREE.PlaneGeometry(2.2, 2.2),
      new THREE.MeshBasicMaterial({ map: texAuraDisco, transparent: true, opacity: 0.34,
        depthWrite: false, blending: THREE.AdditiveBlending, color: 0xffffff }));
    disco.rotation.x = -Math.PI / 2;
    disco.position.y = 0.05;
    disco.userData.forca = 1;
    g.add(disco);
    for (var f = 0; f < 3; f++) {
      var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: texAuraChama,
        transparent: true, opacity: 0.32, depthWrite: false,
        blending: THREE.AdditiveBlending, color: 0xffffff }));
      sp.scale.set(0.5, 1.05, 1);
      sp.position.set(Math.cos(f * 2.1) * 0.35, 0.9, Math.sin(f * 2.1) * 0.35);
      sp.userData.fase = f * 0.33;
      sp.userData.forca = 1;
      g.add(sp);
    }
    corpo.node.add(g);
    corpo.aura = g;
    corpo.auraCor = cor;
  }
  /* o que a aura de um corpo É, para as provas: a forma, as peças (tipo de objeto e quantas partículas)
   * e quantas chamadas de desenho ela custa agora */
  function retratoAura(corpo) {
    if (!corpo || !corpo.aura) return { acesa: false, cor: (corpo && corpo.auraCor) || null };
    var u = corpo.aura.userData, pecas = {}, chamadas = 0, particulas = 0;
    var pose = 0;                      // muda a cada quadro animado: a prova cobra que a aura se MEXE
    if (u.pecas) {
      for (var k in u.pecas) {
        if (!u.pecas.hasOwnProperty(k)) continue;
        var o = u.pecas[k];
        pecas[k] = { tipo: o.isPoints ? 'pontos' : (o.isInstancedMesh ? 'instancias' : 'malha'), n: o.userData.n || 1 };
        particulas += o.userData.n || 1;
        if (o.visible) chamadas++;
        var arr = o.isInstancedMesh ? o.instanceMatrix.array : o.geometry.attributes.position.array;
        for (var q = 0; q < arr.length; q += 3) pose += Math.abs(arr[q]) * (1 + (q % 7));
        pose += o.rotation.y;
      }
    } else chamadas = corpo.aura.children.length;
    return { acesa: true, cor: corpo.auraCor || null, forma: u.forma || 'branca', leve: !!u.leve, pecas: pecas,
             particulas: particulas, pose: +pose.toFixed(4), t: +relogioAura.toFixed(4), chamadas: corpo.aura.visible ? chamadas : 0, visivel: corpo.aura.visible };
  }
  Hub.aura = function (liga, cor) {
    auraDoHeroi = !!liga;              // 14/09: a troca de cena (Campo) remonta o herói e religa
    auraCorDoHeroi = liga ? (cor || null) : null;
    acendeAura(heroi, !!liga, auraCorDoHeroi);
    return !!heroi;
  };
  Hub._auraDoHeroi = function () {     // só as provas: a aura acesa no herói e a cor dela
    return retratoAura(heroi);
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
  /* O CÍRCULO VERMELHO DO GRUPO (12/09, pedido do dono: "quando estiver na
   * praça, o jogador que estiver no grupo deve ter um círculo vermelho
   * embaixo dos pés, para destacar que aquele está no seu grupo"). Um anel
   * chato no chão, preso ao corpo (anda com ele), vermelho e meio
   * transparente para não esconder o chão. A placa já dizia "grupo" no nome;
   * de longe, no meio de vinte corpos, o que se enxerga é o chão aceso.
   * A geometria e o material são UM só para todos os corpos. */
  var geoAnelGrupo = null, matAnelGrupo = null;
  function anelDoGrupo(corpo, ligado) {
    if (!corpo || !corpo.node || !THREE) return;
    if (!ligado) {
      if (corpo.anelGrupo) { corpo.node.remove(corpo.anelGrupo); corpo.anelGrupo = null; }
      return;
    }
    if (corpo.anelGrupo) return;
    if (!geoAnelGrupo) {
      geoAnelGrupo = new THREE.RingGeometry(0.78, 1.02, 48);
      matAnelGrupo = new THREE.MeshBasicMaterial({ color: 0xe23b35, transparent: true, opacity: 0.78,
                                                   side: THREE.DoubleSide, depthWrite: false });
    }
    var anel = new THREE.Mesh(geoAnelGrupo, matAnelGrupo);
    anel.rotation.x = -Math.PI / 2;
    anel.position.y = 0.04;
    anel.renderOrder = 2;
    anel.name = 'anel-grupo';
    corpo.node.add(anel);
    corpo.anelGrupo = anel;
  }
  Hub._anelDoGrupo = function (id) {
    var reg = fantasmas[id];
    return !!(reg && reg.corpo && reg.corpo.anelGrupo);
  };

  Hub.marcaGrupo = function (id, papel) {
    if (!id) return false;
    if (papel === 'lider' || papel === 'membro') marcasGrupo[id] = papel;
    else delete marcasGrupo[id];
    var reg = fantasmas[id];
    if (reg && reg.corpo) {
      var pf = reg.perfil || {};
      penduraEm(reg.corpo, pf.nome || '?', pf.titulo || '', reg.tierF || null, reg.guildaF || null,
                marcasGrupo[id] || null, brilhoDoNome(pf.nome, pf.mestre === true));
      anelDoGrupo(reg.corpo, !!marcasGrupo[id]);
    }
    return true;
  };
  Hub._marcaGrupo = function (id) { return marcasGrupo[id] || null; };   // provas
  /* a parede aplicada a um ponto, para a prova medir sem depender de quadro
   * (rAF não roda em aba escondida, e a parede tem de ser testável assim) */
  Hub._empurra = function (x, z, folga) {
    var p = { x: x, z: z };
    empurraDosSolidos(p, folga || 0);
    return p;
  };
  /* os sólidos avulsos (muros do corredor, pilares, chefes), para a prova */
  Hub._solidos = function () { return solidos.map(function (c) { return { x: c.x, z: c.z, r: c.r, dono: c.dono || null }; }); };
  Hub._chefesParados = function () { return chefesParados.length; };
  /* a ficha dos chefes plantados: onde estão e quanto medem de través */
  Hub._chefesFicha = function () { return chefesFicha.slice(); };
  /* as medidas do corredor, para a prova não repetir número */
  Hub._corredorMedidas = function () {
    var f = {};
    for (var k in CORREDOR) if (CORREDOR.hasOwnProperty(k)) f[k] = CORREDOR[k];
    f.arcoCampo = ARCO_CAMPO;     // 22/09: do portal 0 ao portão do Campo, em radianos
    return f;
  };
  /* quais portais já ganharam corredor (a prova e a depuração perguntam) */
  Hub._corredores = function () { return Object.keys(cantinhoFeito); };
  /* os lugares da praça, para as provas medirem parede e raio de conversa */
  Hub._lugares = function () {
    return lugares.map(function (l) {
      return { id: l.id, tipo: l.tipo, x: l.pos.x, z: l.pos.z,
               tema: l.tema || null, fechado: !!l.fechado, portao: !!l.portao,   // 19/09: o portão do Campo tem corredor
               raio: l.raio || 0, solido: l.solido || 0 };
    });
  };
  /* ================================================== O CAMPO DE PVP — A API (14/09)
   * Hub.entraCampo({aparencia})  a praça (ou nada) vira o Campo; o herói nasce no `nasce`
   *                              do campo_pvp.js com o corpo da classe `aparencia` (o 1º
   *                              herói escolhido); sem ela, o avatar de sempre. Já no
   *                              Campo, só troca a aparência. → true
   * Hub.saiCampo()               volta à praça, à frente do portão do Campo (na pista do
   *                              corredor dele, fora do raio de conversa — o painel não
   *                              reabre sozinho), com o corpo do avatar. → false se não
   *                              estava no Campo
   * Hub.naCampo()                → boolean
   * Hub.defineZona('praca'|'campo')  quem ganha corpo e toque: só fantasma com
   *                              `perfil.zona` igual (sem zona = 'praca'), até o teto de
   *                              20, pelos mais perto. entraCampo/saiCampo já chamam.
   * Hub.fantasmaZona(id, zona)   um fantasma que já está na lista mudou de zona
   * Hub.aoTrocarZona(zona, pos)  gancho opcional: a cena trocou (a Rede pode anunciar)
   * Os lugares chegam à HUD pelo aoAproximar de sempre: {id:'campo', tipo:'campo'} na praça
   * e {id:'campo-saida', tipo:'campo-saida'} no Campo. Hub.entrar(…, {campo: true|false})
   * também troca (a HUD que reentra sem opts não tira ninguém do Campo). */
  function avisaZona() {
    ultimoPerto = null;
    if (Hub.aoAproximar) { try { Hub.aoAproximar(null); } catch (e) {} }
    if (Hub.aoTrocarZona) {
      try {
        Hub.aoTrocarZona(zonaAtual, heroi ? { x: heroi.node.position.x, z: heroi.node.position.z } : null);
      } catch (e2) {}
    }
  }
  function remontaNoLugar(classId, x, z) {
    montaHeroi(classId || 'sumo');
    if (!heroi) return;
    heroi.classId = classId || 'sumo';
    if (x != null && z != null) heroi.node.position.set(x, 0, z);
    if (auraDoHeroi) acendeAura(heroi, true, auraCorDoHeroi);
    sincronizaBicho();
  }
  Hub.entraCampo = function (opts) {
    var ap = (opts && opts.aparencia) || null;
    if (sedeId) { sedeId = null; sedeInfo = null; campoAtivo = false; }    // da sede direto ao Campo: é troca de cena
    if (campoAtivo) {
      if (ap && ap !== aparenciaCampo) {
        aparenciaCampo = ap;
        if (heroi && scene) {
          var p = heroi.node.position.clone();
          scene.remove(heroi.node);
          heroi = null;
          remontaNoLugar(ap, p.x, p.z);
        }
      }
      return true;
    }
    if (heroi && heroi.classId) classeAvatar = heroi.classId;
    aparenciaCampo = ap;
    campoAtivo = true;
    salaAtual = null;
    salaCfg = null;
    zonaAtual = 'campo';
    if (!renderer || !THREE) return true;        // monta na próxima Hub.entrar
    trocaDeCena();
    remontaNoLugar(aparenciaCampo || classeAvatar);
    Hub.defineZona('campo');
    avisaZona();
    return true;
  };
  Hub.saiCampo = function () {
    if (!campoAtivo || sedeId) return false;
    return voltaAPraca('campo');
  };
  /* A SEDE POR DENTRO — A API (04/10)
   * Hub.entraSede({id, nome, cor, emblema})  a praça vira o salão da guilda `id`; o herói
   *                              nasce à frente da porta com o corpo de sempre. A zona
   *                              vira 'sede:<id>' (só letras, números, _ e -). Quem decide
   *                              se o jogador É da guilda é a HUD (e o relé confere a zona).
   * Hub.saiSede()                volta à praça, à frente da Sede das Guildas → false se não estava
   * Hub.naSede()                 → o id da guilda, ou null
   * Lugares: sede-trono, sede-banco, sede-cofre, sede-mural, sede-guerra e sede-saida (aoAproximar). */
  Hub.entraSede = function (g) {
    var id = (g && g.id != null) ? String(g.id).replace(/[^\w-]/g, '').slice(0, 40) : '';
    if (!id) return false;
    var info = { id: id, nome: g.nome || '', cor: g.cor || null, emblema: g.emblema || '' };
    if (sedeId === id) { sedeInfo = info; return true; }
    if (heroi && heroi.classId && !campoAtivo) classeAvatar = heroi.classId;
    sedeId = id;
    sedeInfo = info;
    campoAtivo = true;
    aparenciaCampo = null;
    salaAtual = null;
    salaCfg = null;
    zonaAtual = zonaDaCena();
    if (!renderer || !THREE) return true;        // monta na próxima Hub.entrar
    trocaDeCena();
    remontaNoLugar(classeAvatar);
    Hub.defineZona(zonaAtual);
    avisaZona();
    return true;
  };
  Hub.saiSede = function () {
    if (!sedeId) return false;
    return voltaAPraca('sede');
  };
  Hub.naSede = function () { return sedeId; };
  Hub._sedeMontagem = function () {
    var o = sedeObra;
    if (!o || o.cena !== scene) return null;
    var porChave = {}, vestidas = 0;
    o.pecas.forEach(function (p) { porChave[p.chave] = (porChave[p.chave] || 0) + 1; if (p.vestida) vestidas++; });
    return { pecas: o.pecas.length, vestidas: vestidas, pendentes: o.pendentes, porChave: porChave,
             pilares: porChave.sd_pilar || 0, pontos: o.pontos.slice(), pedidas: o.pedidas.slice(),
             paredes: { n: o.lados.n.visible, s: o.lados.s.visible, o: o.lados.o.visible, l: o.lados.l.visible } };
  };
  // a volta à praça, do Campo ou da sede: à frente do lugar de onde se entrou (`tipo`)
  function voltaAPraca(tipo) {
    campoAtivo = false;
    aparenciaCampo = null;
    sedeId = null;
    sedeInfo = null;
    zonaAtual = 'praca';
    if (!renderer || !THREE) return true;
    trocaDeCena();
    /* PELO EIXO, rumo à boca (19/09). Até 15/09 o passo era DE TRAVÉS (raio+1,2 no sentido
     * do arco), porque a entrada morava no gramado da Árvore e à frente dela a câmera de
     * órbita nascia dentro da copa. Agora o portão tem corredor: de través por 7,6 m o
     * herói cairia do lado de FORA do muro da câmara (meia-largura 5,2, sólido até 7,1).
     * Então ele reaparece 7,6 m à frente do arco, no meio da pista do corredor, de costas
     * para ele — fora do raio de conversa (6,4): o painel da entrada não reabre sozinho. */
    var x = null, z = null;
    for (var i = 0; i < lugares.length; i++) {
      var lg = lugares[i];
      if (lg.tipo !== tipo) continue;
      var r0 = Math.hypot(lg.pos.x, lg.pos.z) || 1, d = lg.raio + 1.2;
      var p = empurraDosSolidos({ x: lg.pos.x - lg.pos.x / r0 * d, z: lg.pos.z - lg.pos.z / r0 * d }, 0.4);
      x = p.x;
      z = p.z;
    }
    remontaNoLugar(classeAvatar, x, z);
    Hub.defineZona('praca');
    avisaZona();
    return true;
  }
  Hub.naCampo = function () { return campoAtivo && !sedeId; };
  Hub.zona = function () { return zonaAtual; };
  Hub.aoTrocarZona = null;
  Hub.defineZona = function (z) {
    zonaAtual = normZona(z);
    if (!scene) return zonaAtual;
    var hp = heroi ? heroi.node.position : null, lista = [];
    for (var id in fantasmas) {
      if (!fantasmas.hasOwnProperty(id)) continue;
      var reg = fantasmas[id];
      if (!naZona(reg)) { if (reg.corpo) desmaterializa(reg); continue; }
      var fx = reg.corpo ? reg.corpo.node.position.x : reg.x;
      var fz = reg.corpo ? reg.corpo.node.position.z : reg.z;
      lista.push({ id: id, dist: hp ? Math.hypot(fx - hp.x, fz - hp.z) : 0, temCorpo: !!reg.corpo });
    }
    // a zona nova se enche de uma vez (é troca de cena, não passeio): até o teto
    var dz = Hub._escolheCorpos(lista, Hub.TETO_FANTASMAS, MARGEM_TROCA, Hub.TETO_FANTASMAS);
    for (var s = 0; s < dz.sai.length; s++) desmaterializa(fantasmas[dz.sai[s]]);
    /* 15/09 (a prova pegou 24): a histerese do _escolheCorpos segura quem já tem corpo
     * até 2 m além do corte, e enchendo de uma vez os de dentro passavam do teto. Só entra
     * quem cabe nas vagas LIVRES (os mais perto primeiro); a avaliação de 1,2 s troca o
     * resto aos poucos, como sempre. */
    var livres = Hub.TETO_FANTASMAS - Hub._corposAtivos();
    for (var e = 0; e < dz.entra.length && e < livres; e++) materializa(fantasmas[dz.entra[e]]);
    return zonaAtual;
  };
  Hub.fantasmaZona = function (id, zona) {
    var reg = fantasmas[id];
    if (!reg) return false;
    reg.perfil = reg.perfil || {};
    reg.perfil.zona = zona || 'praca';
    if (!naZona(reg)) { if (reg.corpo) desmaterializa(reg); }
    else if (!reg.corpo && Hub._corposAtivos() < Hub.TETO_FANTASMAS) materializa(reg);
    return !!reg.corpo;
  };
  // provas
  Hub._fantasmaVisivel = function (id) { var r = fantasmas[id]; return !!(r && r.corpo && r.corpo.node.parent); };
  Hub._caixas = function () {
    return caixas.map(function (c) { return { x: c.x, z: c.z, hx: c.hx, hz: c.hz, rot: c.rot, alt: c.alt }; });
  };
  Hub._corpoNaCaixa = CORPO_NA_CAIXA;
  /* 19/09: o relatório da obra do Campo, para a prova contar — como o tabuleiro conta por
   * R.ultimaMontagem: as instâncias apagam os berços, então se conta pelas VAGAS. Por
   * muro do desenho: quantos módulos e pilares a fileira tem e quantos já vestiram (e
   * com que chave); a borda; os enfeites; braseiros e bandeiras; o que foi pedido ao
   * Bundle e o que ainda falta; as instâncias vivas; e o chão (lajotas, não o tijolo). */
  Hub._campoMontagem = function () {
    var o = campoObra;
    if (!o || o.cena !== scene) return null;
    var porMuro = [], borda = { modulos: 0, pilares: 0, vestidos: 0 }, enf = { vagas: 0, vestidos: 0, chaves: {} };
    o.vagas.forEach(function (v) {
      if (v.muro != null) {
        var pm = porMuro[v.muro] = porMuro[v.muro] || { modulos: 0, pilares: 0, vestidos: 0, chaves: {}, papeis: {} };
        if (v.papel === 'pilar') pm.pilares++; else pm.modulos++;
        pm.papeis[v.papel] = (pm.papeis[v.papel] || 0) + 1;
        if (v.no) { pm.vestidos++; pm.chaves[v.chave] = (pm.chaves[v.chave] || 0) + 1; }
      } else if (v.tipo === 'borda' || v.tipo === 'bordaPilar') {
        if (v.papel === 'pilar') borda.pilares++; else borda.modulos++;
        if (v.no) borda.vestidos++;
      } else if (v.tipo === 'enfeite') {
        enf.vagas++;
        if (v.no) { enf.vestidos++; enf.chaves[v.chave] = (enf.chaves[v.chave] || 0) + 1; }
      }
    });
    return {
      tema: o.tema, eco: o.eco, porMuro: porMuro, borda: borda, enfeites: enf,
      montagem: o.montagem, pedidas: o.pedidas.slice(), pendentes: o.pendentes,
      provisorios: o.provisorios.children.length, braseiros: o.braseiros, bandeiras: o.bandeiras,
      instancias: o.instancias ? { malhas: o.instancias.userData.malhas, total: o.instancias.userData.instancias,
                                   sprites: o.instancias.children.filter(function (n) { return n.isSprite; }).length } : null,
      chao: (chao && chao.userData && chao.userData.chaoCampo) || null
    };
  };
  Hub._caminhos = function () {
    return { miolo: MIOLO_RAIO + MEIO_FIO, anel: ANEL_RAIO, meia: CAMINHO_MEIA + MEIO_FIO, vias: caminhosVias.slice() };
  };
  /* a caixa (mundo) do nó de um lugar: a prova confere que a entrada do Campo não
   * encosta em obra nenhuma. 22/09: pelos VÉRTICES (`precise`) — a caixa rápida é a do
   * modelo girada e reencaixada, e a Arena de 24 m, que mora em diagonal, media 33,5 */
  Hub._caixaDoLugar = function (id) {
    for (var i = 0; i < lugares.length; i++) {
      if (lugares[i].id !== id || !THREE) continue;
      var b = new THREE.Box3();
      lugares[i].node.updateMatrixWorld(true);
      lugares[i].node.traverse(function (n) {
        // sem o rótulo (sprite no alto) e sem a luz pintada no chão
        if (n.isMesh && n.geometry && !(n.userData && n.userData.semCaixa)) b.expandByObject(n, true);
      });
      if (b.isEmpty()) return null;
      return { x0: b.min.x, x1: b.max.x, y0: b.min.y, y1: b.max.y, z0: b.min.z, z1: b.max.z };
    }
    return null;
  };
  // um ponto do mundo na tela (coordenadas da página) — a prova toca onde algo estaria
  Hub._projeta = function (x, y, z) {
    if (!camera || !canvas || !THREE) return null;
    var v = new THREE.Vector3(x, y, z).project(camera);
    var r = canvas.getBoundingClientRect();
    return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height };
  };

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
    // quem escondeu a coroa na ficha não a usa aqui: a vontade viaja no resumo
    if (perfil && perfil.resumo && typeof perfil.resumo.brasa === 'number' &&
        JOGO.Brasa && JOGO.Brasa.coroaDe) {
      // a mesma régua do herói (04/10): sem partida é a Coroa I; só a coroa escondida não aparece
      tierF = JOGO.Brasa.coroaDe(perfil.resumo.brasa, perfil.resumo.partidas, false,
                                 perfil.resumo.coroaOculta === true);
    }
    // a GUILDA do fantasma já viaja dentro do resumo do perfil (a Rede não
    // precisou mudar) — a placa dele nasce igual à do herói
    var guildaF = (perfil && perfil.resumo && perfil.resumo.guilda) || null;
    reg.tierF = tierF;
    reg.guildaF = guildaF;
    penduraEm(corpo, (perfil && perfil.nome) || '?', (perfil && perfil.titulo) || '', tierF, guildaF,
              marcasGrupo[reg.id] || null,
              brilhoDoNome(perfil && perfil.nome, perfil && perfil.mestre === true));
    // a vaidade é pública: a branca do Colecionador (perfil.aura) ou a comprada (perfil.auraCor, 04/10)
    if (perfil && (perfil.aura || perfil.auraCor)) acendeAura(corpo, true, perfil.auraCor);
    anelDoGrupo(corpo, !!marcasGrupo[reg.id]);           // 12/09: quem é do meu grupo, no chão
    esperaCorpo(corpo, classe);           // fusão: o corpo próprio vem vindo
    poeAlvoToque(corpo);                  // 11/09: o corpo inteiro recebe o toque, não só o nome
    return true;
  }

  /* O ALVO DE TOQUE (11/09, "clico em cima e não aparece esse menu" — só o
   * NOME abria). O corpo é um SkinnedMesh do Meshy: o three r147 descarta o
   * raio pela esfera da pose de REPOUSO da malha, que não fica onde o corpo
   * em pé aparece, e o clique no corpo passava direto. Um cilindro invisível
   * da altura do corpo recebe o toque — e poupa o teste triângulo a triângulo
   * da malha animada. Geometria e material são UM só para todos os corpos. */
  var geoToque = null, matToque = null;
  function poeAlvoToque(corpo) {
    if (!corpo || !THREE) return;
    if (!geoToque) {
      geoToque = new THREE.CylinderGeometry(0.55, 0.55, 1, 10);
      matToque = new THREE.MeshBasicMaterial({ visible: false });
    }
    var alto = corpo.node.userData.height || 2.1;
    var m = new THREE.Mesh(geoToque, matToque);
    m.scale.y = alto;
    m.position.y = alto / 2;
    corpo.node.add(m);
    corpo.alvoToque = m;
  }
  function alvosDeToque(corpo) {
    return [corpo.alvoToque, corpo.plaquinha, corpo.plaquinhaTitulo, corpo.plaquinhaGuilda, corpo.coroaPvp]
      .filter(Boolean);
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
      // 14/09: quem está na OUTRA zona não conta para o teto e não fica com corpo
      if (!naZona(reg)) { if (reg.corpo) desmaterializa(reg); continue; }
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
    // 14/09: só quem é da minha zona (praça/Campo) ganha corpo
    if (naZona(reg) && Hub._corposAtivos() < Hub.TETO_FANTASMAS) materializa(reg);
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
  /* 11/09: o BALÃO DE FALA — `id` da Rede (um fantasma com corpo) ou null
   * (eu). False quando não há corpo à vista (acima do teto, noutra sala). */
  Hub.fala = function (id, texto) {
    var corpo = id ? (fantasmas[id] && fantasmas[id].corpo) : heroi;
    return falaEm(corpo, texto);
  };
  Hub._balao = function (id) {                   // provas: o balão de um corpo, ou null
    var c = id ? (fantasmas[id] && fantasmas[id].corpo) : heroi;
    if (!c || !c.balao) return null;
    return { y: c.balao.position.y, topo: topoDoCorpo(c), opacidade: c.balao.material.opacity,
             resta: c.balaoAte - relogio };
  };
  Hub.salaAtual = function () { return salaAtual; };
  Hub._corposAtivos = function () {              // painel de teste e provas
    var n = 0;
    for (var k in fantasmas) {
      if (fantasmas.hasOwnProperty(k) && fantasmas[k].corpo) n++;
    }
    return n;
  };
  /* o modelo que o corpo de um fantasma veste (provas) */
  Hub._auraFantasma = function (id) {   // só as provas (tests/aura_praca.html): a aura acesa num vizinho e a cor
    var r = fantasmas[id];
    return (r && r.corpo) ? retratoAura(r.corpo) : null;
  };
  Hub._corpoFantasma = function (id) {
    var r = fantasmas[id], u = r && r.corpo && r.corpo.node.userData;
    return (u && u.look && u.look.model) || null;
  };

  /* onde o CORPO (a meia altura) ou o NOME de um fantasma aparece na tela, em
   * coordenadas da página — para a prova tocar nele de verdade (provas) */
  Hub._naTela = function (id, parte) {
    var reg = fantasmas[id], c = reg && reg.corpo;
    if (!c || !camera || !canvas || !THREE) return null;
    var v = new THREE.Vector3();
    if (parte === 'nome' && c.plaquinha) c.plaquinha.getWorldPosition(v);
    else { c.node.getWorldPosition(v); v.y += (c.node.userData.height || 2.1) * 0.45; }
    v.project(camera);
    var r = canvas.getBoundingClientRect();
    return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height };
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
    // 13/09: `livre` só para a foto aérea do mapa (prova_praca ?livre=1) — o
    // jogador segue preso aos limites da órbita
    if (o.livre) {
      if (o.dist != null) cam.dist = o.dist;
      if (o.tilt != null) cam.tilt = o.tilt;
    } else {
      if (o.dist != null) cam.dist = Math.max(cam.minDist, Math.min(cam.maxDist, o.dist));
      if (o.tilt != null) cam.tilt = Math.max(cam.minTilt, Math.min(cam.maxTilt, o.tilt));
    }
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
      campo: campoAtivo && !sedeId,       // 14/09: o Campo de PvP
      sede: sedeId,                       // 04/10: a sede da guilda por dentro (o id), ou null
      zona: zonaAtual,
      aparencia: aparenciaCampo,
      avatar: classeAvatar,
      // 19/09: 1 = a câmera bate com a tela (o achatado do Campo era isto fora de 1)
      aspecto: (camera && container) ? +(camera.aspect / ((container.clientWidth || 800) / (container.clientHeight || 500))).toFixed(3) : null,
      caminhos: caminhosFeitos,           // 13/09: avenidas de pedra plantadas
      // 19/09: o custo do último quadro (chamadas de desenho e triângulos) — a prova do
      // Campo cobra que ele não custe muito mais que a praça vazia
      desenho: renderer ? { calls: renderer.info.render.calls, tris: renderer.info.render.triangles } : null,
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
