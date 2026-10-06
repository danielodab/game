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
  // 06/10: `mus` é o volume da MÚSICA (0 a 1, o que a régua das Configurações mostra) e `musOn` a chave
  // dela — sem escolha gravada (undefined) vale o padrão do aparelho, `padraoMus()` lá embaixo.
  var pref = { vol: 0.7, mudo: false, mus: 0.4, musOn: undefined };

  function lePref() {
    try {
      var cru = window.localStorage && window.localStorage.getItem(CHAVE);
      if (cru) {
        var o = JSON.parse(cru);
        if (typeof o.vol === 'number') pref.vol = Math.max(0, Math.min(1, o.vol));
        if (typeof o.mudo === 'boolean') pref.mudo = o.mudo;
        if (typeof o.mus === 'number') pref.mus = Math.max(0, Math.min(1, o.mus));
        if (typeof o.musOn === 'boolean') pref.musOn = o.musOn;
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
    var f = function () {
      destrava();
      // o contexto que o navegador deixou dormindo (criado antes de o toque valer) acorda no toque seguinte
      try { if (ctx && ctx.state === 'suspended' && !foraApp) ctx.resume(); } catch (e) {}
      // a música começa (ou tenta de novo, se o navegador recusou) NO toque — nunca num relógio
      if (retoque) { retoque = false; acertaMusica(); }
    };
    // 06/10: com o dedo, o toque só "vale" para o navegador quando TERMINA — daí o pointerup e o touchend
    ['pointerdown', 'touchstart', 'keydown', 'mousedown', 'pointerup', 'touchend'].forEach(function (n) {
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
      if (ev.type === 'turnStart' || ev.type === 'battleStart') eventoMusica(ev.type);
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
        // 03/10: os espinhos do muro do Minotauro — o golpe seco e agudo, com o som que já existe
        case 'muroFere':      Audio.play('golpe', { gain: 0.75, rate: 1.45 }); break;
        case 'trapSet':       Audio.play('confirma', { gain: 0.6 }); break;
        case 'trapTriggered': Audio.play('fogo', { gain: 0.8 }); break;
        case 'shield':        Audio.play('impacto', { gain: 0.55, rate: 1.25 }); break;
        // 03/10: a correnteza e a rajada do Santuário levam várias unidades de uma vez (ev.causa) —
        // o som delas é um só, o do evento da regra, e não um baque por unidade
        case 'pushed':        if (!ev.causa) Audio.play('impacto', { gain: 0.6 }); break;
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

        // 03/10: o Santuário dos Elementos, com os sons que já existem — o braseiro que acende é fogo,
        // o que apaga é um chiado baixo; o pilar é pedra pesada; a correnteza e a rajada só soam
        // quando levam alguém; o aviso da troca é o mesmo zumbido do aviso do Poço
        case 'santuarioBraseiro':
          if (ev.aceso) Audio.play('fogo', { gain: 0.75 });
          else Audio.play('magia', { gain: 0.45, rate: 0.6 });
          break;
        case 'santuarioPilares':
          if ((ev.sobem || []).length || (ev.descem || []).length) Audio.play('impacto', { gain: 0.85, rate: 0.62 });
          break;
        case 'santuarioAviso':    Audio.play('magia', { gain: 0.4, rate: 0.7 }); break;
        case 'santuarioMare':     if ((ev.movidos || []).length) Audio.play('magia', { gain: 0.5, rate: 1.25 }); break;
        case 'santuarioRajada':   if ((ev.movidos || []).length) Audio.play('golpe', { gain: 0.55, rate: 0.7 }); break;

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
    acertaMusica(true);              // mexer no volume tira o mudo — e o mudo calava a música também
  };
  Audio.getVolume = function () { return pref.vol; };
  Audio.setMudo = function (on) {
    pref.mudo = !!on;
    if (mestre) mestre.gain.value = pref.mudo ? 0 : pref.vol;
    gravaPref();
    acertaMusica(true);              // o mudo cala os DOIS: efeitos e música
  };
  Audio.isMudo = function () { return pref.mudo; };
  /* O aplicativo em segundo plano (o js/mobile.js chama; a web nunca): o motor de som dorme e acorda.
   * Suspender o contexto cala o que estava tocando e não mexe no volume nem no mudo do jogador. */
  Audio.pausa = function (on) {
    foraApp = !!on;                  // 06/10: a música para junto — tocar com o app minimizado é defeito grave
    acertaMusica(true);
    if (!ctx) return;
    try { if (on) ctx.suspend(); else ctx.resume(); } catch (e) {}
  };
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

  // ==================================================================== MÚSICA
  /* 06/10, o dono: "preciso que tenha algumas músicas de ação (só sonoro de fundo nas lutas) e uma
   * para a praça, mas bem de leve... uma música free." As faixas são CC0 (docs/CREDITOS.md) e moram
   * em assets/musica/, em Ogg Vorbis com um MP3 de reserva para o navegador que não toca Ogg.
   *
   * COMO ELA SE COMPORTA
   *   · CANAL PRÓPRIO. O volume dela (`pref.mus`) não é o dos efeitos (`pref.vol`): cada um tem a sua
   *     régua nas Configurações, e a música tem a chave "sem música". O mudo (o 🔊 da batalha e a
   *     chave "Som do jogo") cala os dois.
   *   · BEM DE LEVE. A régua em 100% dá METADE do ganho cheio (TETO_MUS), e o padrão é 40% dela: a
   *     luta toca a 0,20 e a praça a 0,15, contra 0,7 dos efeitos. As faixas foram gravadas todas na
   *     mesma altura média (tools/musica_converte.py), então o número vale igual para qualquer uma.
   *   · POR STREAMING. Um <audio> por faixa, nunca um AudioBuffer: três minutos decodificados são
   *     ~60 MB, e o celular já caiu por memória. O arquivo só é pedido na PRIMEIRA vez em que a faixa
   *     vai tocar — nada no boot, nada na pré-busca — e o laço é o `loop` do próprio elemento.
   *   · SERVIDO (http/https), o elemento entra no AudioContext e o volume é um ganho: é o único jeito
   *     de abaixar o som no iPhone, onde `elemento.volume` não obedece. Por file:// o navegador trata
   *     o arquivo como de outra origem e essa ponte só entrega silêncio — lá o volume é o do elemento.
   *   · QUEM MANDA É A TELA (js/ui/hud.js chama `musica.tela(nome)` em toda troca): batalha toca a
   *     faixa de luta — a de chefe se a sala tem chefe —, qualquer outra tela toca a da praça. Ficha
   *     e menu não são tela: não trocam nada. A troca é um fade de FADE_MS, e quem desce a zero é
   *     PAUSADO: depois do fade nunca há duas tocando. Na preparação a faixa da luta já entra, mais
   *     baixa (NIVEL_PREP), e sobe no primeiro turno.
   *   · SEGUNDO PLANO: a aba escondida (visibilitychange) e o aplicativo minimizado (Audio.pausa, do
   *     js/mobile.js) PAUSAM na hora; ao voltar, a faixa retoma de onde parou.
   *   · FALHOU, CALOU. Erro de rede ou de decodificação marca a faixa e ela não é pedida de novo
   *     nesta página; `play()` recusado espera o próximo toque. Não há relógio de nova tentativa.
   *   · ECONOMIA DE DADOS (Save-Data, 2G, ou telefone na qualidade 'baixa' — o mesmo
   *     `economiaDeDados()` da pré-busca): a música começa DESLIGADA, até a pessoa ligar a chave. */
  var Mus = {};
  Audio.musica = Mus;

  var PASTA_MUS = 'assets/musica/';
  // `ganho` é o acerto fino de cada faixa por cima do volume do jogador. A da praça volta de onde
  // parou; as de luta recomeçam do início a cada batalha (`novaLuta`).
  var FAIXAS = {
    'praca':  { arq: 'praca-bards-tale',          ganho: 0.75 },
    'luta-1': { arq: 'luta-heartfelt-battle',     ganho: 1 },
    'luta-2': { arq: 'luta-heavy-battle-2',       ganho: 1 },
    'chefe':  { arq: 'chefe-heavy-boss-battle-1', ganho: 1 }
  };
  var DA_CENA = { praca: ['praca'], luta: ['luta-1', 'luta-2'], chefe: ['chefe'] };
  var TETO_MUS = 0.5;        // a régua em 100% = metade do ganho cheio
  var FADE_MS = 1300;
  var PASSO_MUS = 50;        // o degrau do fade, em ms
  var NIVEL_PREP = 0.55;     // a faixa da luta durante a preparação

  var canais = {};           // id da faixa -> { id, el, no, vol, alvo, ritmo, falhou }
  var cenaQuer = null;       // 'praca' | 'luta' | 'chefe' — o que a tela pede (null: nenhuma tela ainda)
  var nivelCena = 1;
  var vezLuta = -1;          // alterna as faixas de luta, uma por batalha (a primeira é a luta-1)
  var novaLuta = false;      // a batalha acabou de começar: a faixa dela parte do início
  var foraApp = false, foraDoc = false;
  var retoque = true;        // o próximo toque tem de (re)tentar a música
  var passoT = null, passoEm = 0;
  var extMus;                // '.ogg' | '.mp3' | null (este navegador não toca nenhum dos dois)

  function padraoMus() {
    try { if (JOGO.Bundle && JOGO.Bundle.economiaDeDados && JOGO.Bundle.economiaDeDados()) return false; } catch (e) {}
    return true;
  }
  function musLigada() { return (typeof pref.musOn === 'boolean') ? pref.musOn : padraoMus(); }
  function musicaPode() {
    return destravado && !foraApp && !foraDoc && !pref.mudo && pref.mus > 0 && musLigada();
  }
  function extensao() {
    if (extMus !== undefined) return extMus;
    extMus = null;
    try {
      var a = document.createElement('audio');
      if (a.canPlayType && a.canPlayType('audio/ogg; codecs="vorbis"')) extMus = '.ogg';
      else if (a.canPlayType && a.canPlayType('audio/mpeg')) extMus = '.mp3';
    } catch (e) {}
    return extMus;
  }

  /* A sala é de chefe? Chefe de calabouço e o chefe do Poço têm `boss` na unidade; o Colosso tem
   * `colosso` na ficha; o Eco Primordial é o `state.eco`; no Santuário é a sala do Altar. */
  function batalhaDeChefe() {
    try {
      var G = JOGO.Game, st = G && G.state;
      if (!st) return false;
      if (st.eco) return true;
      var fichas = (JOGO.DATA && JOGO.DATA.monsters) || {}, us = st.units || [];
      for (var i = 0; i < us.length; i++) {
        var u = us[i];
        if (!u || u.side !== 'enemy') continue;
        if (u.boss || (u.defId && fichas[u.defId] && fichas[u.defId].colosso)) return true;
      }
      if (st.santuario && G.salaInfo) { var s = G.salaInfo(); if (s && s.regra === 'altar') return true; }
    } catch (e) {}
    return false;
  }
  function emPreparacao() {
    try { var st = JOGO.Game && JOGO.Game.state; return !!(st && st.phase === 'placing'); } catch (e) { return false; }
  }

  function poe(c, v) {
    c.vol = v;
    try { if (c.no) c.no.gain.value = v; else c.el.volume = Math.max(0, Math.min(1, v)); } catch (e) {}
  }
  function falha(c) {
    c.falhou = true; c.alvo = 0;
    poe(c, 0);
    try { c.el.pause(); } catch (e) {}
    acertaMusica(false);             // a outra faixa do mesmo papel, se houver; senão, silêncio
  }
  /* O canal da faixa, criado na primeira vez — é AQUI que o arquivo é pedido. */
  function canal(id) {
    if (canais[id]) return canais[id];
    var ext = extensao();
    if (!ext || !FAIXAS[id]) return null;
    var el = document.createElement('audio');
    var c = { id: id, el: el, no: null, vol: 0, alvo: 0, ritmo: 1, falhou: false };
    el.loop = true;
    el.preload = 'auto';
    var servido = false;
    try { servido = /^https?:$/.test(window.location.protocol); } catch (e0) {}
    if (ctx && servido && ctx.createMediaElementSource) {
      try {
        var fonte = ctx.createMediaElementSource(el);
        var g = ctx.createGain();
        g.gain.value = 0;
        fonte.connect(g); g.connect(ctx.destination);   // direto na saída: o `mestre` é o volume dos efeitos
        c.no = g;
      } catch (e1) { c.no = null; }
    }
    poe(c, 0);
    el.addEventListener('error', function () { falha(c); });
    canais[id] = c;
    el.src = PASTA_MUS + FAIXAS[id].arq + ext;
    return c;
  }
  function toca(c) {
    try {
      if (!c.el.paused) return;
      var p = c.el.play();
      // recusado (a trava de autoplay): fica para o próximo toque, sem relógio de nova tentativa
      if (p && p.then) p.then(null, function () { retoque = true; });
    } catch (e) { retoque = true; }
  }
  function agoraMus() { try { return Date.now(); } catch (e) { return 0; } }
  /* O fade anda pelo RELÓGIO, não pela contagem de degraus: com a página engasgada (celular fraco,
   * aba pesada) o setInterval de 50 ms atrasa, e contar degraus esticava 1,3 s para 10 s — com as
   * duas faixas tocando juntas esse tempo todo. Degrau atrasado anda o tanto que o tempo passou. */
  function mira(c, alvo, jaJa) {
    c.alvo = alvo;
    if (jaJa) { poe(c, alvo); return; }
    c.ritmo = Math.max(Math.abs(alvo - c.vol), 0.0001) / FADE_MS;       // volume por milissegundo
    if (passoT == null && c.vol !== alvo) {
      passoEm = agoraMus();
      try { passoT = setInterval(passo, PASSO_MUS); } catch (e) { passoT = null; poe(c, alvo); }
    }
  }
  function passo() {
    var falta = false;
    try {
      var t = agoraMus(), dt = t - passoEm;
      passoEm = t;
      if (!(dt > 0)) dt = PASSO_MUS;                  // sem relógio (ou dois degraus no mesmo instante)
      if (dt > FADE_MS) dt = FADE_MS;
      for (var id in canais) {
        var c = canais[id], d = c.alvo - c.vol, degrau = c.ritmo * dt;
        if (d !== 0) {
          if (Math.abs(d) <= degrau) poe(c, c.alvo);
          else { poe(c, c.vol + (d > 0 ? degrau : -degrau)); falta = true; }
        }
        // desceu a zero: PAUSA — depois do fade nunca ficam duas tocando
        if (c.vol === 0 && c.alvo === 0 && !c.el.paused) { try { c.el.pause(); } catch (e0) {} }
      }
    } catch (e) {}
    if (!falta && passoT != null) { try { clearInterval(passoT); } catch (e1) {} passoT = null; }
  }
  function faixaDaCena(cena) {
    var l = DA_CENA[cena];
    if (!l) return null;
    for (var i = 0; i < l.length; i++) {              // a da vez; se ela falhou, a outra do mesmo papel
      var id = l[(Math.max(vezLuta, 0) + i) % l.length];
      if (!canais[id] || !canais[id].falhou) return id;
    }
    return null;
  }
  /* O ÚNICO lugar que decide o que toca. `jaJa`: sem fade (o jogador mexeu na régua, no mudo, ou o
   * jogo saiu da frente) — troca de tela é que tem fade. */
  function acertaMusica(jaJa) {
    try {
      var id, quer = (cenaQuer && musicaPode()) ? faixaDaCena(cenaQuer) : null;
      if (!quer) {
        // sem música (mudo, desligada, segundo plano, sem toque ainda): cala na hora, sem pedir nada
        for (id in canais) { canais[id].alvo = 0; poe(canais[id], 0); try { canais[id].el.pause(); } catch (e0) {} }
        return;
      }
      for (id in canais) if (id !== quer && (canais[id].alvo !== 0 || canais[id].vol !== 0)) mira(canais[id], 0, false);
      var c = canal(quer);
      if (!c || c.falhou) return;
      if (novaLuta && cenaQuer !== 'praca') {
        novaLuta = false;
        if (c.el.paused) { try { c.el.currentTime = 0; } catch (e2) {} }
      }
      toca(c);
      mira(c, pref.mus * TETO_MUS * FAIXAS[quer].ganho * nivelCena, !!jaJa && c.vol > 0);
    } catch (e) { /* música nunca derruba nada */ }
  }
  function eventoMusica(tipo) {
    try {
      if (cenaQuer !== 'luta' && cenaQuer !== 'chefe') return;
      // battleStart: o estado já existe com certeza — confere do zero. No meio da luta a faixa de
      // chefe FICA até a batalha acabar: o chefe morrer antes dos lacaios não troca a música.
      var cena = ((tipo === 'turnStart' && cenaQuer === 'chefe') || batalhaDeChefe()) ? 'chefe' : 'luta';
      var nivel = (tipo === 'turnStart') ? 1 : nivelCena;   // o primeiro turno: acabou a preparação
      if (cena === cenaQuer && nivel === nivelCena) return;
      if (cena !== cenaQuer) novaLuta = true;
      cenaQuer = cena; nivelCena = nivel;
      acertaMusica(false);
    } catch (e) {}
  }

  /* A tela mudou (js/ui/hud.js, UI.showScreen). Só a batalha tem música de luta. */
  Mus.tela = function (nome) {
    try {
      var antes = cenaQuer;
      if (nome === 'battle') {
        var nova = (antes !== 'luta' && antes !== 'chefe');
        if (nova) { vezLuta++; novaLuta = true; }                    // batalha nova: a outra faixa
        cenaQuer = ((!nova && antes === 'chefe') || batalhaDeChefe()) ? 'chefe' : 'luta';
        nivelCena = emPreparacao() ? NIVEL_PREP : 1;
      } else { cenaQuer = 'praca'; nivelCena = 1; }
      acertaMusica(false);
    } catch (e) {}
  };
  Mus.setVolume = function (v) {
    pref.mus = Math.max(0, Math.min(1, Number(v) || 0));
    gravaPref();
    acertaMusica(true);
  };
  Mus.getVolume = function () { return pref.mus; };
  Mus.setLigada = function (on) {
    pref.musOn = !!on;
    gravaPref();
    acertaMusica(true);
  };
  Mus.isLigada = function () { return musLigada(); };
  Mus.padraoLigada = padraoMus;
  /* Para as provas: o que a camada pediu e o que está soando. */
  Mus.estado = function () {
    var o = { cena: cenaQuer, nivel: nivelCena, ligada: musLigada(), volume: pref.mus, fora: foraApp || foraDoc,
              fade: passoT != null, canais: {} };
    for (var id in canais) {
      var c = canais[id], parado = true, tempo = 0;
      try { parado = !!c.el.paused; tempo = c.el.currentTime || 0; } catch (e) {}
      o.canais[id] = { vol: c.vol, alvo: c.alvo, tocando: !parado, falhou: c.falhou, ponte: !!c.no, tempo: tempo };
    }
    return o;
  };

  // a aba escondida para a música (na web o resto do som segue como sempre: só o aplicativo o suspende)
  function olhaDoc(ev) {
    try {
      foraDoc = (ev && ev.type === 'pagehide') ? true : !!document.hidden;
      acertaMusica(true);
    } catch (e) {}
  }
  try {
    if (typeof document !== 'undefined' && document.addEventListener) document.addEventListener('visibilitychange', olhaDoc);
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('pagehide', olhaDoc);
      window.addEventListener('pageshow', olhaDoc);
    }
  } catch (e) {}

  lePref();
  if (typeof window !== 'undefined' && window.addEventListener) arma();
})();
