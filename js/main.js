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

  window.addEventListener('DOMContentLoaded', function () {
    var canvas = document.getElementById('game-canvas');
    var rendererOk = true;
    try {
      if (JOGO.Renderer && JOGO.Renderer.init) JOGO.Renderer.init(canvas);
    } catch (e) {
      rendererOk = false;
      showFatal('<div><h2 style="color:#ffd98a;font-family:Georgia,serif;margin-bottom:12px">SOTERRA precisa de WebGL</h2>' +
        'Seu navegador ou placa de vídeo não conseguiu iniciar o modo 3D.<br>' +
        'Tente atualizar o navegador, habilitar aceleração de hardware nas configurações, ou usar Chrome/Edge/Firefox recentes.</div>');
    }
    if (rendererOk) {
      try { if (JOGO.UI && JOGO.UI.init) JOGO.UI.init(); } catch (e) { console.error('UI.init falhou:', e); }
      try { if (JOGO.Game && JOGO.Game.init) JOGO.Game.init(); } catch (e) { console.error('Game.init falhou:', e); }
      requestAnimationFrame(frame);
    }
  });
})();
