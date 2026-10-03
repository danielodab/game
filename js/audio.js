// Som — o jogo deixa de ser mudo (dono: camada de audio).
var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

/* COMO ESTA CAMADA PENSA
 * ======================
 *
 * O jogo ja emite 53 tipos de evento e ninguem os escutava para som. Esta
 * camada entra no mesmo bombeamento que o renderizador e o FX usam
 * (`pumpEvents` em js/main.js), entao ela nao inventa gancho nenhum: escuta o
 * que ja acontece.
 *
 * NAO SAO 171 SONS PARA 171 FEITICOS. O `FX.familiaDe(fxKey)` ja reduz qualquer
 * feitico a uma de 21 familias, e e ESSE mesmo despacho que uso aqui. A
 * consequencia importa: som e efeito visual nunca podem discordar sobre o que
 * um feitico e, porque leem a mesma funcao.
 *
 * TRES REGRAS QUE VIERAM DE COMO O JOGO SE COMPORTA
 * -------------------------------------------------
 * 1. VARIANTE. Um ataque em area acerta seis unidades e dispara seis eventos de
 *    dano no MESMO quadro. Com um arquivo so isso vira metralhadora. Cada papel
 *    tem 2 a 4 variantes e o sorteio nunca repete a de tras.
 *
 * 2. ESTRANGULAMENTO. Ainda com variantes, seis sons no mesmo quadro viram
 *    lama e estouram o pico. Cada papel tem um tempo minimo entre disparos, e
 *    quem chega dentro da janela e simplesmente descartado — nao enfileirado,
 *    porque som atrasado de um golpe que ja passou e pior que som nenhum.
 *
 * 3. NUNCA LEVANTAR EXCECAO. Isto roda dentro do laco principal, para todo
 *    evento. Um erro aqui congelaria o jogo inteiro por causa de um bipe. Tudo
 *    que pode falhar esta dentro de `try`, e a camada inteira vira silencio
 *    se o navegador nao colaborar.
 *
 * A TRAVA DE AUTOPLAY
 * -------------------
 * Navegador nenhum deixa tocar audio antes do usuario tocar na pagina. Isso NAO
 * e erro e nao adianta insistir: a camada nasce armada e destrava no primeiro
 * toque, clique ou tecla. Antes disso ela engole os pedidos em silencio.
 */
(function () {
  'use strict';

  var Audio = {};
  JOGO.Audio = Audio;

  var ctx = null;            // AudioContext, criado tarde
  var mestre = null;         // ganho mestre
  var bancos = {};           // papel -> [AudioBuffer]
  var ultima = {};           // papel -> indice da ultima variante tocada
  var quando = {};           // papel -> instante do ultimo disparo
  var destravado = false;
  var pronto = false;
  var CHAVE = 'soterra-som';

  // ------------------------------------------------------------ preferencias
  // Chave propria, separada de `soterra-save-v2`: volume nao e progresso, e
  // misturar os dois faria um save corrompido levar o som junto.
  var pref = { vol: 0.7, mudo: false };

  function lePref() {
    try {
      var cru = window.localStorage && window.localStorage.getItem(CHAVE);
      if (cru) {
        var o = JSON.parse(cru);
        if (typeof o.vol === 'number') pref.vol = Math.max(0, Math.min(1, o.vol));
        if (typeof o.mudo === 'boolean') pref.mudo = o.mudo;
      }
    } catch (e) {}
  }
  function gravaPref() {
    try {
      if (window.localStorage) window.localStorage.setItem(CHAVE, JSON.stringify(pref));
    } catch (e) {}
  }

  // ---------------------------------------------------- tempo minimo por papel
  // Passo e o unico que pode repetir rapido — os outros sao gestos, e gesto
  // repetido em 50 ms nao existe no jogo, so no bug.
  var ESPERA = {
    passo: 90, dano: 70, impacto: 70, golpe: 80, magia: 110,
    fogo: 110, cura: 140, botao: 40, morte: 200, rugido: 400,
    teleporte: 150, tesouro: 120, confirma: 90, vitoria: 1500, derrota: 1500
  };
  var ESPERA_PADRAO = 80;

  // ------------------------------------------------------------ decodificacao
  function paraBytes(b64) {
    var bin = window.atob(b64), n = bin.length, arr = new Uint8Array(n);
    for (var i = 0; i < n; i++) arr[i] = bin.charCodeAt(i);
    return arr.buffer;
  }

  /* Decodifica o kit inteiro uma vez.
   *
   * Roda depois do destravamento e nao antes: criar um AudioContext antes do
   * gesto do usuario o deixa em estado `suspended`, e ha navegador que conta
   * isso contra a pagina. Como o kit todo da menos de 1 MB, decodificar tudo de
   * uma vez custa pouco e evita o primeiro golpe sair mudo. */
  function carrega(feito) {
    var fonte = JOGO.SONS || {};
    var papeis = Object.keys(fonte);
    if (!papeis.length) { pronto = true; if (feito) feito(); return; }
    var faltam = 0, contados = false;

    papeis.forEach(function (papel) {
      bancos[papel] = [];
      fonte[papel].forEach(function (par, i) {
        faltam++;
        var ab;
        try { ab = paraBytes(par[1]); } catch (e) { faltam--; return; }
        try {
          ctx.decodeAudioData(ab, function (buf) {
            bancos[papel][i] = buf;
            if (--faltam === 0 && contados) { pronto = true; if (feito) feito(); }
          }, function () {
            if (--faltam === 0 && contados) { pronto = true; if (feito) feito(); }
          });
        } catch (e) { faltam--; }
      });
    });
    contados = true;
    if (faltam === 0) { pronto = true; if (feito) feito(); }
  }

  // ----------------------------------------------------------------- destrava
  function destrava() {
    if (destravado) return;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { destravado = true; return; }        // sem WebAudio: silencio, sem erro
    try {
      ctx = new AC();
      mestre = ctx.createGain();
      mestre.gain.value = pref.mudo ? 0 : pref.vol;
      mestre.connect(ctx.destination);
      if (ctx.state === 'suspended') ctx.resume();
      destravado = true;
      carrega(null);
    } catch (e) { destravado = true; }
  }

  function arma() {
    var f = function () { destrava(); };
    ['pointerdown', 'touchstart', 'keydown', 'mousedown'].forEach(function (n) {
      window.addEventListener(n, f, { once: false, passive: true });
    });
  }

  // -------------------------------------------------------------------- tocar
  /* `rate` e `gain` sao o que transforma 27 arquivos em muito mais som: o mesmo
   * golpe a 1,3x de velocidade e 40% de volume le como um golpe que ERROU, e
   * nao precisei de um arquivo de swoosh para isso. */
  Audio.play = function (papel, opts) {
    try {
      if (!pronto || !ctx || pref.mudo) return false;
      var banco = bancos[papel];
      if (!banco || !banco.length) return false;
      opts = opts || {};

      var agora = ctx.currentTime * 1000;
      var espera = (opts.espera != null) ? opts.espera
                 : (ESPERA[papel] != null ? ESPERA[papel] : ESPERA_PADRAO);
      if (quando[papel] != null && agora - quando[papel] < espera) return false;
      quando[papel] = agora;

      // sorteia sem repetir a de tras
      var vivos = [];
      for (var i = 0; i < banco.length; i++) if (banco[i]) vivos.push(i);
      if (!vivos.length) return false;
      var idx = vivos[(Math.random() * vivos.length) | 0];
      if (vivos.length > 1 && idx === ultima[papel]) {
        idx = vivos[(vivos.indexOf(idx) + 1) % vivos.length];
      }
      ultima[papel] = idx;

      var src = ctx.createBufferSource();
      src.buffer = banco[idx];
      src.playbackRate.value = opts.rate || 1;
      var g = ctx.createGain();
      g.gain.value = (opts.gain != null ? opts.gain : 1);
      src.connect(g); g.connect(mestre);
      src.start(ctx.currentTime + (opts.delay || 0));
      return true;
    } catch (e) { return false; }
  };

  // --------------------------------------------------------------- as famílias
  // Familia do FX -> papel de som. As 21 familias cabem em cinco gestos: cortar,
  // estourar, conjurar, curar e sumir. Mais que isso seria variedade que o
  // jogador nao distingue no meio de uma briga.
  var POR_FAMILIA = {
    corte: 'golpe', investida: 'golpe', gancho: 'golpe',
    meteoro: 'fogo', estouro: 'fogo', anel: 'fogo', terremoto: 'fogo',
    bola: 'magia', feixe: 'magia', flecha: 'magia', cone: 'magia',
    cruz: 'magia', onda: 'magia', chuva: 'magia', maldicao: 'magia',
    invocacao: 'magia',
    cura: 'cura', aura: 'cura',
    piscar: 'teleporte',
    escudo: 'impacto', armadilha: 'confirma'
  };

  function papelDoFeitico(fxKey, elemento) {
    var fam = 'bola';
    try {
      if (JOGO.FX && JOGO.FX.familiaDe) fam = JOGO.FX.familiaDe(fxKey);
    } catch (e) {}
    var papel = POR_FAMILIA[fam] || 'magia';
    // O ELEMENTO manda quando o gesto e de projetil: uma bola de FOGO tem de
    // soar como fogo, nao como conjuracao generica. Num corte ou numa cura o
    // gesto vence o elemento — cortar com agua ainda e cortar.
    if (papel === 'magia' && elemento === 'fogo') papel = 'fogo';
    return papel;
  }

  // ------------------------------------------------------------------ eventos
  var PASSO_MS = 150;   // acompanha o ritmo de caminhada do renderizador

  Audio.handleEvent = function (ev) {
    try {
      if (!ev || !ev.type) return;
      switch (ev.type) {

        case 'cast':
          Audio.play(papelDoFeitico(ev.fxKey, ev.element));
          break;

        case 'damage':
          // dano 0 e ABSORVIDO: soa como pancada em escudo, nao como carne
          if (!ev.amount) Audio.play('impacto', { gain: 0.5, rate: 1.15 });
          else Audio.play('dano', { gain: 0.85 });
          break;

        case 'heal':   Audio.play('cura'); break;
        case 'death':  Audio.play('morte'); break;

        case 'move':
          // um passo por casa andada, espaçados no tempo. Sem isso a unidade
          // atravessa cinco casas com um `tec` so, que le como teletransporte.
          var n = (ev.path && ev.path.length) || 0;
          for (var i = 0; i < Math.min(n, 8); i++) {
            Audio.play('passo', { delay: i * PASSO_MS / 1000, espera: 0,
                                  gain: 0.5, rate: 0.94 + Math.random() * 0.12 });
          }
          break;

        // ERRAR TEM SOM PROPRIO, e sem arquivo novo: o mesmo golpe acelerado e
        // abafado le como lamina passando perto.
        case 'dodgeOk': Audio.play('golpe', { gain: 0.4, rate: 1.35 }); break;

        case 'teleport': Audio.play('teleporte'); break;
        case 'summon':   Audio.play('magia', { rate: 0.9 }); break;
        case 'fusion':   Audio.play('rugido'); Audio.play('fogo', { gain: 0.6, delay: 0.12 }); break;

        case 'wallRaised':    Audio.play('impacto', { rate: 0.8 }); break;
        case 'trapSet':       Audio.play('confirma', { gain: 0.6 }); break;
        case 'trapTriggered': Audio.play('fogo', { gain: 0.8 }); break;
        case 'shield':        Audio.play('impacto', { gain: 0.55, rate: 1.25 }); break;
        case 'pushed':        Audio.play('impacto', { gain: 0.6 }); break;
        case 'poison':        Audio.play('dano', { gain: 0.4, rate: 0.85 }); break;

        // 02/10: o chão do Poço, com os sons que já existem — o aviso é um
        // zumbido baixo de magia, o disparo tem a voz de quem fere
        case 'perigoAviso':   Audio.play('magia', { gain: 0.45, rate: 0.7 }); break;
        case 'perigoDispara':
          if (ev.tipo === 'jato') Audio.play('fogo', { gain: 0.8, rate: ev.elemento === 'fogo' ? 1 : 1.2 });
          else if (ev.tipo === 'rachado') Audio.play('impacto', { gain: 0.9, rate: 0.7 });
          else Audio.play('golpe', { gain: 0.8, rate: 1.3 });
          break;
        case 'perigoRuna':    Audio.play('magia', { gain: 0.5, rate: 1.35 }); break;
        case 'couracaCaiu':   Audio.play('impacto', { gain: 0.9, rate: 0.6 }); break;
        case 'ventania':      Audio.play('golpe', { gain: 0.6, rate: 0.75 }); break;

        case 'battleEnd':
          Audio.play(ev.winner === 'player' ? 'vitoria' : 'derrota');
          break;

        default: break;
      }
    } catch (e) { /* som nunca derruba o laco */ }
  };

  // ---------------------------------------------------------------- interface
  Audio.botao   = function () { Audio.play('botao', { gain: 0.5 }); };
  Audio.confirma = function () { Audio.play('confirma', { gain: 0.6 }); };

  Audio.setVolume = function (v) {
    pref.vol = Math.max(0, Math.min(1, v));
    pref.mudo = false;
    if (mestre) mestre.gain.value = pref.vol;
    gravaPref();
  };
  Audio.getVolume = function () { return pref.vol; };
  Audio.setMudo = function (on) {
    pref.mudo = !!on;
    if (mestre) mestre.gain.value = pref.mudo ? 0 : pref.vol;
    gravaPref();
  };
  Audio.isMudo = function () { return pref.mudo; };
  Audio.isPronto = function () { return pronto; };
  Audio.papeis = function () { return Object.keys(bancos); };

  /* Exposto para o teste conferir COBERTURA, e de proposito devolve o mapa cru
   * em vez de `papelDoFeitico`. `papelDoFeitico` sempre devolve alguma coisa
   * (cai em 'magia' quando nao conhece a familia), entao um teste feito em cima
   * dele passaria com a tabela vazia — estaria conferindo a si mesmo. Com a
   * lista de chaves o teste ve o que foi REALMENTE mapeado, e uma familia nova
   * que aparecer no FX acusa aqui em vez de sair calada. */
  Audio.familiasMapeadas = function () { return Object.keys(POR_FAMILIA); };

  // usado pela pagina de audicao: forca o destravamento sem esperar gesto
  Audio.init = function (feito) {
    lePref();
    destrava();
    if (pronto && feito) feito();
    else if (feito) { var t = setInterval(function () {
      if (pronto) { clearInterval(t); feito(); }
    }, 60); }
  };

  lePref();
  if (typeof window !== 'undefined' && window.addEventListener) arma();
})();
