// Ponto de entrada — loop principal e bombeamento de eventos (dono: orquestrador).
var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

(function () {
  var lastTime = 0;

  function pumpEvents() {
    var engine = JOGO.Engine;
    if (!engine || !engine.events) return;
    while (engine.events.length > 0) {
      var ev = engine.events.shift();
      if (JOGO.Renderer && JOGO.Renderer.handleEvent) JOGO.Renderer.handleEvent(ev);
      if (JOGO.FX && JOGO.FX.handleEvent) JOGO.FX.handleEvent(ev);
      // O SOM entra na mesma fila que o desenho, e de proposito: assim ele
      // escuta o jogo em vez de precisar de gancho proprio espalhado pelo
      // engine. `JOGO.Audio` engole tudo em silencio ate o usuario tocar na
      // pagina (trava de autoplay) e nunca levanta excecao — um bipe nao pode
      // derrubar o laco principal.
      if (JOGO.Audio && JOGO.Audio.handleEvent) JOGO.Audio.handleEvent(ev);
      if (JOGO.UI && JOGO.UI.handleEvent) JOGO.UI.handleEvent(ev);
      if (JOGO.Game && JOGO.Game.handleEvent) JOGO.Game.handleEvent(ev);
    }
  }

  function frame(time) {
    var dt = Math.min((time - lastTime) / 1000, 0.1);
    lastTime = time;
    pumpEvents();
    if (JOGO.Game && JOGO.Game.update) JOGO.Game.update(dt);
    if (JOGO.UI && JOGO.UI.update) JOGO.UI.update(dt);
    if (JOGO.Renderer && JOGO.Renderer.render) JOGO.Renderer.render(dt);
    pumpEvents();
    requestAnimationFrame(frame);
  }

  // WebGL indisponível não pode derrubar a cadeia de init (lacuna L1 do QA)
  function showFatal(msg) {
    var root = document.getElementById('ui-root') || document.body;
    var el = document.createElement('div');
    el.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;' +
      'background:#0b0d10;color:#e8e0d0;font:16px/1.6 "Segoe UI",sans-serif;text-align:center;padding:40px;z-index:99';
    el.innerHTML = msg;
    root.appendChild(el);
  }

  // Servido (http:// ou dentro do APK), este arquivo entra por injeção DEPOIS
  // que os 21 MB de modelo chegaram — e nessa hora o `DOMContentLoaded` já
  // passou faz tempo. Escutar um evento que já aconteceu deixa a tela preta
  // para sempre. Então: se o documento já está de pé, começa agora.
  function quandoPronto(fn) {
    if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  // A MARCA DE ABERTURA (10/09): o index.html guarda em sessionStorage onde a
  // abertura está (window.__boot, no <script id="boot-seguro">). Cada passo
  // daqui se anota ANTES de rodar — se um deles travar a página, a próxima
  // abertura da aba diz qual foi —, e o fim avisa que os passos acabaram (a
  // marca some quando a #carga também já saiu da frente). Sem o index.html
  // (páginas de teste que carregam este arquivo), __boot não existe e nada muda.
  function marca(nome) {
    try { if (window.__boot && window.__boot.passo) window.__boot.passo(nome); } catch (e) {}
  }
  function terminou() {
    try { if (window.__boot && window.__boot.fim) window.__boot.fim(); } catch (e) {}
  }

  quandoPronto(function () {
    var canvas = document.getElementById('game-canvas');
    var rendererOk = true;
    marca('Renderer.init');
    try {
      if (JOGO.Renderer && JOGO.Renderer.init) JOGO.Renderer.init(canvas);
    } catch (e) {
      rendererOk = false;
      showFatal('<div><h2 style="color:#ffd98a;font-family:Georgia,serif;margin-bottom:12px">SOTERRA precisa de WebGL</h2>' +
        'Seu navegador ou placa de vídeo não conseguiu iniciar o modo 3D.<br>' +
        'Tente atualizar o navegador, habilitar aceleração de hardware nas configurações, ou usar Chrome/Edge/Firefox recentes.</div>');
    }
    if (rendererOk) {
      marca('UI.init');
      try { if (JOGO.UI && JOGO.UI.init) JOGO.UI.init(); } catch (e) { console.error('UI.init falhou:', e); }
      marca('Game.init');
      try { if (JOGO.Game && JOGO.Game.init) JOGO.Game.init(); } catch (e) { console.error('Game.init falhou:', e); }
      // A NUVEM (10/09): com sessão do site, o save do cartório entra (e sobe) daqui
      marca('Nuvem.iniciar');
      try { if (JOGO.Nuvem && JOGO.Nuvem.iniciar) JOGO.Nuvem.iniciar(); } catch (e) { console.error('Nuvem.iniciar falhou:', e); }
      // OS EVENTOS DO MUNDO (10/09): a agenda lê o cache, busca o que o Mestre ligou e repete a cada 10 min
      marca('Agenda.iniciar');
      try { if (JOGO.Agenda && JOGO.Agenda.iniciar) JOGO.Agenda.iniciar(); } catch (e) { console.error('Agenda.iniciar falhou:', e); }
      requestAnimationFrame(frame);
    }
    // os passos acabaram (com ou sem WebGL: a tela do erro também é o fim)
    marca('a primeira tela');
    terminou();
  });
})();
