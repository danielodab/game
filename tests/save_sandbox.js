/* ============================================================================
   SOTERRA 2.0 — tests/save_sandbox.js
   Blindagem do save do jogador para QUALQUER página de teste.

   POR QUE ISTO EXISTE
   As páginas de teste precisam de um progresso de mentira para ter o que
   mostrar/exercitar, e a forma natural de conseguir isso — `Progress.reset()`,
   `addXp`, `addItem`, `Game.startRun` — grava direto em
   `localStorage['soterra-save-v2']`. Resultado: abrir uma página de teste
   APAGA o jogo do usuário. Já aconteceu duas vezes:
     · `tests/ui_screens.html` (achado B4 do QA de Integração);
     · `tests/chief_play.html`, que reproduziu o estrago depois (o save do
       usuário virou "sumô nv12 fogo + curandeiro nv12 água" — exatamente a
       semente daquela página).

   COMO USAR — uma linha, ANTES de qualquer outro <script>:
       <script src="save_sandbox.js"></script>
   (caminho relativo à página; de `tests/` é só o nome do arquivo)

   O QUE ELE FAZ
   As chaves do SOTERRA passam a viver em MEMÓRIA. O disco não é tocado nem
   uma vez — nem para semear, nem depois, nem se a interface salvar sozinha
   minutos após a suíte terminar. Snapshot-e-restaura-no-fim NÃO resolveria:
   as páginas continuam vivas (captura headless, cliques, rAF) e voltariam a
   gravar depois da restauração.

   O save real entra na sombra só para LEITURA, então `Progress.load()` enxerga
   o mundo normal antes da semente sobrescrever — o teste continua realista.

   VERIFICAÇÃO
   `JOGO.SaveSandbox.check()` devolve {ok, disco, memoria}: `ok:false` significa
   que alguma coisa furou a blindagem e escreveu no disco de verdade. Vale uma
   checagem na sua suíte.
   ========================================================================== */
var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

(function () {
  'use strict';

  var KEYS = ['soterra-save-v2', 'soterra-save-v1'];
  var shadow = {};          // o "disco" de mentira
  var disco0 = {};          // o que havia no disco de verdade ao instalar
  var on = false;
  var raw = { get: null, set: null, remove: null };

  function isMine(k) { return KEYS.indexOf(String(k)) >= 0; }

  try {
    if (typeof window !== 'undefined' && window.localStorage &&
        window.Storage && Storage.prototype && Storage.prototype.setItem) {

      var _set = Storage.prototype.setItem;
      var _get = Storage.prototype.getItem;
      var _rm  = Storage.prototype.removeItem;

      raw.get = function (k) { try { return _get.call(window.localStorage, k); } catch (e) { return null; } };
      raw.set = function (k, v) { try { _set.call(window.localStorage, k, v); } catch (e) { /* cheio */ } };
      raw.remove = function (k) { try { _rm.call(window.localStorage, k); } catch (e) { /* nada */ } };

      for (var i = 0; i < KEYS.length; i++) {
        var v0 = raw.get(KEYS[i]);
        disco0[KEYS[i]] = v0;
        shadow[KEYS[i]] = v0;              // a sombra começa igual ao real
      }

      Storage.prototype.setItem = function (k, v) {
        if (isMine(k)) { shadow[k] = String(v); return; }
        return _set.apply(this, arguments);
      };
      Storage.prototype.getItem = function (k) {
        if (isMine(k)) { var v = shadow[k]; return v === undefined ? null : v; }
        return _get.apply(this, arguments);
      };
      Storage.prototype.removeItem = function (k) {
        if (isMine(k)) { shadow[k] = null; return; }
        return _rm.apply(this, arguments);
      };

      on = true;
    }
  } catch (e) { /* sem storage: não há o que proteger */ }

  JOGO.SaveSandbox = {
    active: on,
    keys: KEYS.slice(),

    /* O disco continua exatamente como estava? */
    check: function () {
      if (!on) return { ok: true, active: false, disco: null, memoria: null, nota: 'sem localStorage' };
      var ok = true, disco = {}, memoria = {};
      for (var i = 0; i < KEYS.length; i++) {
        var k = KEYS[i];
        var d = raw.get(k);
        disco[k] = d === null ? null : d.length;
        memoria[k] = shadow[k] == null ? null : shadow[k].length;
        if (d !== disco0[k]) ok = false;
      }
      return { ok: ok, active: true, disco: disco, memoria: memoria };
    },

    /* Conteúdo real do disco (para conferência), sem passar pela sombra. */
    realSave: function (key) { return on ? raw.get(key || KEYS[0]) : null; },

    /* Tamanho do save real ao instalar — útil para a mensagem do teste. */
    original: function (key) { return disco0[key || KEYS[0]]; },

    /* Emergência: devolve ao disco o que havia quando esta página abriu.
       Só faz sentido se algo já tiver furado a blindagem. */
    restore: function () {
      if (!on) return false;
      for (var i = 0; i < KEYS.length; i++) {
        var k = KEYS[i];
        raw.remove(k);
        if (disco0[k] !== null && disco0[k] !== undefined) raw.set(k, disco0[k]);
      }
      return true;
    }
  };
})();
