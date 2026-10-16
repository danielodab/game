/* SOTERRA — COMPARTILHAR (15/10): a fusão e o fim da sala viram uma imagem que o jogador posta.
 *
 * O dono: "tem chance de ser viral?" — o jogo tem um ativo que um leigo repete ("junta dois heróis e
 * vira um monstro novo") e nenhum caminho para ele sair do jogo. Aqui: um CARTÃO (canvas 1080×1080,
 * o retrato, o nome da forma, uma linha e o rodapé com o endereço) e o jeito de mandá-lo para fora:
 *
 *   no aplicativo   @capacitor/filesystem grava o PNG na pasta de cache e @capacitor/share abre a
 *                   folha nativa (WhatsApp, Instagram, salvar…); as pontes sobem na primeira chamada,
 *                   como no notificacoes.js
 *   no navegador    navigator.share com o arquivo (o Chrome do Android, o Safari); sem isso, baixa
 *                   o PNG e copia o texto com o link
 *
 * O retrato vem de quem chama (JOGO.Portraits3D ou o Art): este módulo só compõe e manda. Puro no que
 * dá: `C.cartao(opts)` devolve o canvas, testável sem janela com um canvas de mentira. */
(function (raiz) {
  'use strict';
  var JOGO = raiz.JOGO = raiz.JOGO || {};
  var C = JOGO.Compartilhar = JOGO.Compartilhar || {};

  C.LADO = 1080;
  C.SITE = 'https://soterra.viidoo.io';
  C.SERIF = 'Georgia, "Times New Roman", serif';   // o --ui-serif do css/style.css
  C.SANS = 'system-ui, sans-serif';

  function texto(v) { return typeof v === 'string' ? v : (v == null ? '' : String(v)); }
  function nativo() {
    try { var Cp = raiz.Capacitor; return !!(Cp && typeof Cp.isNativePlatform === 'function' && Cp.isNativePlatform()); }
    catch (e) { return false; }
  }

  /* O CARTÃO. opts: { retrato (canvas|img|null), titulo, sub, linha, rodape, cor ('#rrggbb' do elemento),
   * cor2 (o segundo elemento da fusão), canvasFabrica (as provas: () => canvas de mentira) } */
  C.cartao = function (opts) {
    opts = opts || {};
    var L = C.LADO;
    var c = opts.canvasFabrica ? opts.canvasFabrica(L, L) : document.createElement('canvas');
    c.width = L; c.height = L;
    var g = c.getContext('2d');
    var cor = opts.cor || '#c8b6ff', cor2 = opts.cor2 || cor;
    // o fundo: o breu do jogo com a cor do elemento subindo de baixo
    var fundo = g.createLinearGradient(0, 0, 0, L);
    fundo.addColorStop(0, '#0d1117'); fundo.addColorStop(0.55, '#141a22'); fundo.addColorStop(1, '#1a1410');
    g.fillStyle = fundo; g.fillRect(0, 0, L, L);
    var halo = g.createRadialGradient(L / 2, L * 0.46, L * 0.05, L / 2, L * 0.46, L * 0.5);
    halo.addColorStop(0, cor + 'aa'); halo.addColorStop(0.5, cor2 + '33'); halo.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = halo; g.fillRect(0, 0, L, L);
    // o retrato: centrado, com a moldura fina na cor do elemento
    var r = opts.retrato;
    var rw = r && (r.width || r.naturalWidth), rh = r && (r.height || r.naturalHeight);
    if (r && rw && rh) {
      var alvo = L * 0.56, esc = Math.min(alvo / rw, alvo / rh);
      var w = rw * esc, h = rh * esc, x = (L - w) / 2, y = L * 0.14 + (alvo - h) / 2;
      g.save();
      g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowBlur = 40; g.shadowOffsetY = 18;
      try { g.drawImage(r, x, y, w, h); } catch (e) {}
      g.restore();
      g.strokeStyle = cor; g.lineWidth = 6; g.globalAlpha = 0.85;
      g.strokeRect(x - 10, y - 10, w + 20, h + 20);
      g.strokeStyle = cor2; g.lineWidth = 2; g.globalAlpha = 0.9;
      g.strokeRect(x - 22, y - 22, w + 44, h + 44);
      g.globalAlpha = 1;
    }
    g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    // o título (o nome da forma), em serifa dourada com contorno escuro
    var tit = texto(opts.titulo);
    if (tit) {
      var tam = tit.length > 22 ? 64 : (tit.length > 14 ? 76 : 88);
      g.font = 'bold ' + tam + 'px ' + C.SERIF;
      g.lineWidth = 10; g.strokeStyle = 'rgba(0,0,0,0.75)'; g.lineJoin = 'round';
      g.strokeText(tit, L / 2, L * 0.82);
      g.fillStyle = '#ffc44d'; g.fillText(tit, L / 2, L * 0.82);
    }
    var sub = texto(opts.sub);
    if (sub) {
      g.font = '38px ' + C.SANS; g.fillStyle = '#e8eef4';
      g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,0.7)'; g.strokeText(sub, L / 2, L * 0.875); g.fillText(sub, L / 2, L * 0.875);
    }
    var linha = texto(opts.linha);
    if (linha) { g.font = '32px ' + C.SANS; g.fillStyle = '#b8c4d0'; g.fillText(linha, L / 2, L * 0.92); }
    // o selo do jogo e o endereço (o rodapé é o que vira clique)
    g.font = 'bold 34px ' + C.SERIF; g.fillStyle = '#ffc44d'; g.textAlign = 'left';
    g.fillText('SOTERRA', L * 0.06, L * 0.08);
    g.font = '26px ' + C.SANS; g.fillStyle = '#9fb0c0';
    g.fillText('Ecos do Mundo Enterrado', L * 0.06, L * 0.115);
    g.textAlign = 'right'; g.font = '30px ' + C.SANS; g.fillStyle = '#e8eef4';
    g.fillText(texto(opts.rodape || C.SITE.replace(/^https?:\/\//, '')), L * 0.94, L * 0.975);
    return c;
  };

  // ------------------------------------------------------------- as pontes do aplicativo
  function carrega(src) {
    return new Promise(function (resolve) {
      var s = document.createElement('script');
      s.src = src; s.onload = s.onerror = function () { resolve(); };
      document.head.appendChild(s);
    });
  }
  var ponteP = null;
  function plugins() {
    try {
      var S = raiz.capacitorShare, F = raiz.capacitorFilesystemPluginCapacitor;
      return { share: S && S.Share, fs: F && F.Filesystem };
    } catch (e) { return { share: null, fs: null }; }
  }
  function ponte() {
    var p = plugins();
    if ((p.share && p.fs) || !nativo()) return Promise.resolve(!!(p.share && p.fs));
    if (ponteP) return ponteP;
    var url = (typeof raiz.__url === 'function') ? raiz.__url : function (f) { return f; };
    ponteP = (raiz.capacitorExports ? Promise.resolve() : carrega(url('vendor/capacitor/capacitor.js')))
      .then(function () { return carrega(url('vendor/capacitor/share.js')); })
      .then(function () { return carrega(url('vendor/capacitor/filesystem.js')); })
      .then(function () { var q = plugins(); return !!(q.share && q.fs); });
    ponteP.then(function (tem) { if (!tem) ponteP = null; });
    return ponteP;
  }

  function dataUrl(canvas) { try { return canvas.toDataURL('image/png'); } catch (e) { return null; } }
  function blobDe(canvas) {
    return new Promise(function (resolve) {
      try { canvas.toBlob(function (b) { resolve(b || null); }, 'image/png'); } catch (e) { resolve(null); }
    });
  }
  function baixa(canvas, nome) {
    var u = dataUrl(canvas);
    if (!u) return false;
    try {
      var a = document.createElement('a');
      a.href = u; a.download = nome || 'soterra.png';
      document.body.appendChild(a); a.click(); a.parentNode.removeChild(a);
      return true;
    } catch (e) { return false; }
  }
  function copia(txt) {
    try { if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(txt).then(function () { return true; }, function () { return false; }); }
    catch (e) {}
    return Promise.resolve(false);
  }

  /* MANDA: o cartão para fora. Devolve Promise<'app'|'web'|'baixou'|'nada'>. */
  C.manda = function (canvas, o) {
    o = o || {};
    var titulo = texto(o.titulo || 'SOTERRA'), txt = texto(o.texto), nome = o.nome || 'soterra.png';
    if (nativo()) {
      return ponte().then(function (tem) {
        var p = plugins();
        if (!tem || !p.fs || !p.share) return baixa(canvas, nome) ? 'baixou' : 'nada';
        var u = dataUrl(canvas);
        if (!u) return 'nada';
        return p.fs.writeFile({ path: nome, data: u.split(',')[1], directory: 'CACHE' })
          .then(function (r) { return p.share.share({ title: titulo, text: txt, files: [r.uri], dialogTitle: titulo }); })
          .then(function () { return 'app'; }, function () { return 'nada'; });
      });
    }
    return blobDe(canvas).then(function (b) {
      if (b && navigator.share && navigator.canShare) {
        var f = null;
        try { f = new File([b], nome, { type: 'image/png' }); } catch (e) { f = null; }
        if (f && navigator.canShare({ files: [f] })) {
          return navigator.share({ title: titulo, text: txt, files: [f] }).then(function () { return 'web'; }, function () { return 'nada'; });
        }
      }
      var ok = baixa(canvas, nome);
      return copia(txt).then(function () { return ok ? 'baixou' : 'nada'; });
    });
  };
  C.noApp = nativo;
})(typeof window !== 'undefined' ? window : globalThis);
