var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

// ============================================================================
// JOGO.Art — arte procedural 2D, estilo DOFUS 1.29. Dono: Designer Arte.
//
// Tudo é desenhado em canvas offscreen e devolvido como <canvas>; o Renderer
// converte com PIXI.Texture.from(canvas). Todo resultado é CACHEADO por chave.
//
// ---------------------------------------------------------------------------
// API pública
//   Art.unit(defId, opts)        -> canvas   opts: {element|elements, dir, scale}
//   Art.tile(theme, variant)     -> canvas   losango de chão (M.tileW × M.tileH+alt)
//   Art.obstacleHigh(theme, v)   -> canvas   bloqueia passagem E visão
//   Art.obstacleLow(theme, v)    -> canvas   bloqueia passagem, não a visão
//   Art.prop(theme, key)         -> canvas   decoração sem colisão
//   Art.portrait(defId, opts)    -> canvas   retrato quadrado (busto, de frente)
//   Art.spellIcon(spellOrKey, s) -> canvas
//   Art.itemIcon(itemId, s)      -> canvas
//   Art.petIcon(petId, s)        -> canvas
//   Art.tileEventIcon(kind, s)   -> canvas
//   Art.slotIcon(slot, s)        -> canvas   espaço VAZIO (punho/passo/casca/lume)
//   Art.slotKey/slotName/slotColor(slot)     ids v2.2 (aceita os antigos)
//   Art.stoneIcon(stoneId, s)    -> canvas   pedra de forja (ADENDO v2.1)
//   Art.cardIcon(classId, w, h)  -> canvas   carta de classe (= Art.classCard)
//   Art.starIcon(filled, s)      -> canvas   estrela cheia/vazia da coleção
//   Art.rarityColor(rarity)      -> '#hex'
//   Art.elementColor(element)    -> '#hex'
//   Art.texture(key)             -> canvas   ('unit:sumo:fogo:0', 'tile:estufa:1', …)
//   Art.metrics / Art.setRes(n) / Art.clearCache() / Art.stats()
//
// ---------------------------------------------------------------------------
// CONVENÇÕES PARA O RENDERER (importante)
//   • Todo canvas traz `__res` (supersampling) e `__anchor` = [ax, ay] em 0..1.
//     No Pixi:  sp.anchor.set(cv.__anchor[0], cv.__anchor[1]);
//               sp.scale.set(1 / cv.__res);
//     Assim o sprite fica no tamanho de tela correto e ancorado no ponto certo.
//   • Unidade: âncora nos PÉS (0.5, 0.88) — posicione no centro da célula.
//   • Losango de chão: âncora (0.5, 0.5) do TOPO do losango (tileW × tileH).
//     Obstáculos/props: âncora na base (0.5, 1 - baseInset), alinhada ao centro
//     da célula; o canvas já reserva a altura acima.
//   • dir: 0=SE (frente-direita) · 1=SW (frente-esquerda) · 2=NW (costas-esq.)
//          3=NE (costas-direita). 1 e 2 são espelhos de 0 e 3.
//
// Estilo: cores chapadas (2–3 tons por forma), contorno escuro derivado da
// própria cor, silhueta forte, zero gradiente realista. Legibilidade em tela
// de celular vem antes de detalhe.
// ============================================================================

(function () {
  'use strict';

  var A = {};
  var TAU = Math.PI * 2;

  // ------------------------------------------------------------------ métricas
  var RES = 2;
  var M = {
    tileW: 128, tileH: 64,
    unitW: 160, unitH: 200,
    anchorX: 0.5, anchorY: 0.88,
    // px de tela por unidade de arte. O herói tem ~106 unidades ⇒ ~168 px de
    // altura num quadro de 200: o boneco PREENCHE o quadro, com margem mínima.
    artUnit: 1.58,
    res: RES,
    spriteScale: 1 / RES
  };
  A.metrics = M;

  // ------------------------------------------------------------------- cores
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function hx(c) {
    if (c.charAt(0) !== '#') c = '#' + c;
    if (c.length === 4) c = '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3];
    return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
  }
  function toHex(r, g, b) {
    var o = '#', v = [r, g, b], i, x;
    for (i = 0; i < 3; i++) { x = clamp(Math.round(v[i]), 0, 255); o += (x < 16 ? '0' : '') + x.toString(16); }
    return o;
  }
  function rgba(c, a) { var v = hx(c); return 'rgba(' + v[0] + ',' + v[1] + ',' + v[2] + ',' + a + ')'; }
  // sh(c, k): k>0 clareia, k<0 escurece
  function sh(c, k) {
    var v = hx(c), i, o = [];
    for (i = 0; i < 3; i++) o[i] = k > 0 ? v[i] + (255 - v[i]) * k : v[i] * (1 + k);
    return toHex(o[0], o[1], o[2]);
  }
  function mx(c1, c2, k) {
    var a = hx(c1), b = hx(c2), i, o = [];
    for (i = 0; i < 3; i++) o[i] = a[i] + (b[i] - a[i]) * k;
    return toHex(o[0], o[1], o[2]);
  }
  // satura mantendo o brilho (cores chapadas vibrantes, cara de desenho)
  function vivid(c, k) {
    var v = hx(c), m = (v[0] + v[1] + v[2]) / 3, i, o = [];
    for (i = 0; i < 3; i++) o[i] = m + (v[i] - m) * (1 + k);
    return toHex(o[0], o[1], o[2]);
  }
  // CONTORNO (revisão v4): o Dofus não usa preto pesado. O contorno é a própria
  // cor de preenchimento, mais escura e DESSATURADA — some onde a forma já se
  // separa por cor e nunca "suja" o desenho.
  function lineOf(c) { return vivid(sh(c, -0.42), -0.28); }
  // SOMBRA QUENTE: `sh(c,-k)` puxa para o preto e DESSATURA — foi o que deixava
  // a pele com cara de verde-acinzentado. Carne sombreia para o terracota, não
  // para o cinza. Toda sombra de pele passa por aqui.
  var WARM = '#a2532a';
  function wsh(c, k) { return mx(c, WARM, k); }
  function whi(c, k) { return mx(c, '#fff0d2', k); }
  A.sh = sh; A.mx = mx; A.rgba = rgba; A.lineOf = lineOf; A.wsh = wsh;

  var ELEM = {
    neutro: { c: '#d8dee4', deep: '#8b93a0', glow: '#f4f8ff', name: 'Neutro' },
    fogo:   { c: '#ff8c3a', deep: '#c3341a', glow: '#ffd98a', name: 'Fogo' },
    agua:   { c: '#57c8ec', deep: '#1f6bb0', glow: '#b9f2ff', name: 'Água' },
    terra:  { c: '#9bd06a', deep: '#5c7a2a', glow: '#e2f0a8', name: 'Terra' },
    ar:     { c: '#c8b6ff', deep: '#7a63c8', glow: '#f0eaff', name: 'Ar' }
  };
  function elemInfo(e) {
    var d = (JOGO.DATA && JOGO.DATA.elementInfo && JOGO.DATA.elementInfo[e]) || null;
    var base = ELEM[e] || ELEM.neutro;
    if (d && d.color && d.color !== base.c) {
      return { c: d.color, deep: sh(d.color, -0.42), glow: sh(d.color, 0.5), name: d.name || base.name };
    }
    return base;
  }
  A.elementColor = function (e) { return elemInfo(e).c; };

  // 4 raridades. `lendario` (o Traje do Coração, troféu do jogo) é BRANCO-BRASA:
  // um creme quase branco com halo laranja — não é "mais um dourado", é a única
  // peça que parece estar acesa por dentro.
  var RARITY = { comum: '#9aa4ae', raro: '#54a8e8', epico: '#ffc44d', lendario: '#ffe9a8',
                 common: '#9aa4ae', rare: '#54a8e8', epic: '#ffc44d', legendary: '#ffe9a8' };
  // halo por raridade: só a lendária tem cor de halo diferente da borda, que é
  // o que dá o efeito de brasa (núcleo claro, auréola quente)
  var RARITY_GLOW = { lendario: '#ff7a2f', legendary: '#ff7a2f' };
  // quanto a peça "acende": intensidade do brilho e nº de pedrinhas
  var RARITY_RANK = { comum: 0, raro: 1, epico: 2, lendario: 3,
                      common: 0, rare: 1, epic: 2, legendary: 3 };
  A.rarityColor = function (r) { return RARITY[r] || RARITY.comum; };
  A.rarityGlow = function (r) { return RARITY_GLOW[r] || A.rarityColor(r); };
  A.rarityRank = function (r) { return RARITY_RANK[r] == null ? 0 : RARITY_RANK[r]; };
  A.rarityIds = function () { return ['comum', 'raro', 'epico', 'lendario']; };

  // ------------------------------------------------------- canvas / contexto
  function mkCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * RES));
    c.height = Math.max(1, Math.round(h * RES));
    c.__res = RES; c.__w = w; c.__h = h;
    c.__anchor = [0.5, 0.5];
    var g = c.getContext('2d');
    g.imageSmoothingEnabled = true;
    if ('imageSmoothingQuality' in g) g.imageSmoothingQuality = 'high';
    return c;
  }

  var _lw = 2;              // espessura de contorno em unidades de arte (por desenho)
  var LW = 2.1;             // espessura-base em px de TELA (traço fino e colorido)
  function setScale(k) { _lw = LW * RES / k; }

  // ------------------------------------------------------------ construtores
  // Cada builder devolve uma função(ctx) que monta o path, com .c (centro) e
  // .r (raio aprox.) para o sombreamento chapado saber onde cortar.
  function tag(f, cx, cy, r) { f.c = [cx, cy]; f.r = r; return f; }

  function Pel(x, y, rx, ry, rot) {
    return tag(function (ctx) {
      ctx.beginPath(); ctx.ellipse(x, y, Math.abs(rx), Math.abs(ry), rot || 0, 0, TAU);
    }, x, y, Math.max(Math.abs(rx), Math.abs(ry)));
  }
  function Prr(cx, cy, w, h, r) {
    var x = cx - w / 2, y = cy - h / 2;
    r = Math.min(r == null ? 4 : r, w / 2, h / 2);
    return tag(function (ctx) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
    }, cx, cy, Math.max(w, h) / 2);
  }
  function Ppoly(pts) {
    var i, mnx = 1e9, mny = 1e9, mxx = -1e9, mxy = -1e9;
    for (i = 0; i < pts.length; i += 2) {
      if (pts[i] < mnx) mnx = pts[i]; if (pts[i] > mxx) mxx = pts[i];
      if (pts[i + 1] < mny) mny = pts[i + 1]; if (pts[i + 1] > mxy) mxy = pts[i + 1];
    }
    return tag(function (ctx) {
      ctx.beginPath(); ctx.moveTo(pts[0], pts[1]);
      for (var j = 2; j < pts.length; j += 2) ctx.lineTo(pts[j], pts[j + 1]);
      ctx.closePath();
    }, (mnx + mxx) / 2, (mny + mxy) / 2, Math.max(mxx - mnx, mxy - mny) / 2);
  }
  // curva fechada suave passando pelos pontos médios (orgânico, sem bicos)
  function Pblob(pts) {
    var n = pts.length / 2, i, mnx = 1e9, mny = 1e9, mxx = -1e9, mxy = -1e9;
    for (i = 0; i < pts.length; i += 2) {
      if (pts[i] < mnx) mnx = pts[i]; if (pts[i] > mxx) mxx = pts[i];
      if (pts[i + 1] < mny) mny = pts[i + 1]; if (pts[i + 1] > mxy) mxy = pts[i + 1];
    }
    return tag(function (ctx) {
      var j, x1, y1, k;
      ctx.beginPath();
      var x0 = pts[(n - 1) * 2], y0 = pts[(n - 1) * 2 + 1];
      ctx.moveTo((x0 + pts[0]) / 2, (y0 + pts[1]) / 2);
      for (j = 0; j < n; j++) {
        x1 = pts[j * 2]; y1 = pts[j * 2 + 1];
        k = ((j + 1) % n) * 2;
        ctx.quadraticCurveTo(x1, y1, (x1 + pts[k]) / 2, (y1 + pts[k + 1]) / 2);
      }
      ctx.closePath();
    }, (mnx + mxx) / 2, (mny + mxy) / 2, Math.max(mxx - mnx, mxy - mny) / 2);
  }
  // cápsula com tangentes externas — membros, dedos, cabos
  function Pcap(x1, y1, r1, x2, y2, r2) {
    var dx = x2 - x1, dy = y2 - y1;
    var d = Math.sqrt(dx * dx + dy * dy) || 0.0001;
    var a = Math.atan2(dy, dx);
    var t = Math.acos(clamp((r1 - r2) / d, -1, 1));
    return tag(function (ctx) {
      ctx.beginPath();
      ctx.arc(x1, y1, r1, a + t, a - t + TAU, false);
      ctx.arc(x2, y2, r2, a - t, a + t, false);
      ctx.closePath();
    }, (x1 + x2) / 2, (y1 + y2) / 2, Math.max(r1, r2) + d / 2);
  }
  // losango isométrico (célula)
  function Pdiamond(cx, cy, w, h) {
    return Ppoly([cx, cy - h / 2, cx + w / 2, cy, cx, cy + h / 2, cx - w / 2, cy]);
  }
  A.Pel = Pel; A.Prr = Prr; A.Ppoly = Ppoly; A.Pblob = Pblob; A.Pcap = Pcap;

  // -------------------------------------------------------------------- part
  // A peça central do estilo: preenche chapado, corta um segundo tom no lado
  // oposto à luz (fixa em cima-à-esquerda) e fecha com contorno escuro.
  var LIGHT = 0.62;
  // MODO SILHUETA (revisão v4): com `NO_LINE` ligado, nenhuma peça desenha o
  // próprio contorno. O corpo é pintado só com preenchimento e sombreado, e o
  // contorno é extraído depois do ALFA COMPOSTO — assim a linha aparece só no
  // perímetro externo do personagem e some no meio do corpo. É o que tira o
  // efeito "boneco montado de salsichas".
  // Peças que PRECISAM de linha própria (olhos, boca, fivelas) pedem
  // explicitamente `{keepLine: true}`.
  var NO_LINE = false;
  function part(ctx, P, col, o) {
    o = o || {};
    ctx.save();
    P(ctx);
    ctx.fillStyle = col;
    ctx.fill();
    if (!o.flat) {
      var c = o.c || P.c || [0, 0];
      var r = (o.r || P.r || 22) * 3.2;
      ctx.save(); ctx.clip();
      ctx.translate(c[0] + (o.sx || 0), c[1] + (o.sy || 0));
      ctx.rotate(o.rot == null ? LIGHT : o.rot);
      ctx.fillStyle = o.dark || sh(col, -(o.k == null ? 0.24 : o.k));
      ctx.fillRect(0, -r, r, r * 2);
      ctx.restore();
      if (o.hi) {
        var rr = (o.r || P.r || 22);
        ctx.save(); ctx.clip();
        ctx.fillStyle = o.lite || sh(col, o.hi === true ? 0.26 : o.hi);
        ctx.beginPath();
        ctx.ellipse(c[0] - rr * 0.36, c[1] - rr * 0.46, rr * 0.44, rr * 0.3, -0.5, 0, TAU);
        ctx.fill();
        ctx.restore();
      }
    }
    if (!o.noline && (!NO_LINE || o.keepLine)) {
      P(ctx);
      ctx.strokeStyle = o.line || lineOf(col);
      ctx.lineWidth = (o.lw == null ? 1 : o.lw) * _lw;
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- NANQUIM
  // TRAÇO DE ESPESSURA VARIÁVEL (revisão v5, pela referência do Dofus).
  // `stroke()` com lineWidth dá linha uniforme — é o que deixava o boneco com
  // cara de marionete. Aqui a linha é uma FORMA PREENCHIDA: nasce fina, engrossa
  // no meio e afina na outra ponta, como pincel de nanquim.
  // Usada tanto para reforçar a silhueta quanto para as linhas internas
  // (curva do peitoral, dobra da barriga, vinco do cotovelo, prega do pano).
  function catmull(pts, t) {
    var n = pts.length / 2;
    if (n < 2) return [pts[0] || 0, pts[1] || 0, 1, 0];
    var seg = Math.min(Math.floor(t * (n - 1)), n - 2);
    var lt = t * (n - 1) - seg;
    function P(i) {
      var j = Math.max(0, Math.min(n - 1, i));
      return [pts[j * 2], pts[j * 2 + 1]];
    }
    var p0 = P(seg - 1), p1 = P(seg), p2 = P(seg + 1), p3 = P(seg + 2);
    var t2 = lt * lt, t3 = t2 * lt, i;
    var out = [0, 0], d = [0, 0];
    for (i = 0; i < 2; i++) {
      out[i] = 0.5 * ((2 * p1[i]) + (-p0[i] + p2[i]) * lt +
               (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * t2 +
               (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * t3);
      d[i] = 0.5 * ((-p0[i] + p2[i]) +
             2 * (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * lt +
             3 * (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * t2);
    }
    return [out[0], out[1], d[0], d[1]];
  }
  // PERFIL DE PESO (revisão v6): a linha não pode ser um fuso simétrico — isso
  // é o que ainda deixava o traço com cara de gerado. Aqui a barriga do traço
  // fica DESLOCADA (parâmetro `taper` numérico = onde engrossa, 0..1), a
  // variação é assimétrica e uma segunda onda lenta engrossa/afina ao longo do
  // caminho, como pincel apoiando e aliviando. Traços LONGOS ficam vivos.
  //   taper: 'start' | 'end' | número 0..1 (posição do ponto mais grosso)
  //          | undefined = 0.42 (levemente antes do meio, como no nanquim)
  function inkStroke(ctx, pts, wMax, col, taper) {
    var n = 40, i, t, s, len, nx, ny, w, u, b;
    var L = [], Rt = [];
    b = (typeof taper === 'number') ? clamp(taper, 0.06, 0.94) : 0.42;
    for (i = 0; i <= n; i++) {
      t = i / n;
      s = catmull(pts, t);
      len = Math.sqrt(s[2] * s[2] + s[3] * s[3]) || 1;
      nx = -s[3] / len; ny = s[2] / len;
      if (taper === 'start') w = wMax * Math.pow(t, 0.5);
      else if (taper === 'end') w = wMax * Math.pow(1 - t, 0.5);
      else {
        // dois ramos com expoentes diferentes: sobe rápido, alivia devagar
        u = t < b ? t / b : (1 - t) / (1 - b);
        w = wMax * Math.pow(Math.sin(u * Math.PI * 0.5), t < b ? 0.55 : 0.85);
      }
      // segunda onda: o pincel apoia e alivia ao longo do caminho
      w *= 0.82 + 0.24 * Math.sin(t * Math.PI * 1.7 + 0.7);
      w = Math.max(w, wMax * 0.045);
      L.push(s[0] + nx * w, s[1] + ny * w);
      Rt.push(s[0] - nx * w, s[1] - ny * w);
    }
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(L[0], L[1]);
    for (i = 1; i <= n; i++) ctx.lineTo(L[i * 2], L[i * 2 + 1]);
    for (i = n; i >= 0; i--) ctx.lineTo(Rt[i * 2], Rt[i * 2 + 1]);
    ctx.closePath();
    ctx.fillStyle = col;
    ctx.fill();
    ctx.restore();
  }
  A.inkStroke = inkStroke;

  // Extrai o contorno externo do que já foi pintado: tinge a silhueta e a
  // carimba em volta em N direções, por baixo do desenho colorido.
  function outlineComposite(dst, src, col, px) {
    var tmp = document.createElement('canvas');
    tmp.width = src.width; tmp.height = src.height;
    var t = tmp.getContext('2d');
    t.drawImage(src, 0, 0);
    t.globalCompositeOperation = 'source-in';
    t.fillStyle = col;
    t.fillRect(0, 0, tmp.width, tmp.height);
    var i, a, n = 14;
    for (i = 0; i < n; i++) {
      a = i / n * TAU;
      dst.drawImage(tmp, Math.cos(a) * px, Math.sin(a) * px);
    }
    dst.drawImage(src, 0, 0);
  }
  // forma chapada sem contorno (sombras internas, panos de fundo)
  function flat(ctx, P, col) { ctx.save(); P(ctx); ctx.fillStyle = col; ctx.fill(); ctx.restore(); }
  // traço solto (cordas, tiras, linhas de expressão)
  function stroke(ctx, pts, col, w, curve) {
    ctx.save();
    ctx.beginPath(); ctx.moveTo(pts[0], pts[1]);
    if (curve && pts.length >= 6) {
      for (var i = 2; i < pts.length - 3; i += 4) {
        ctx.quadraticCurveTo(pts[i], pts[i + 1], pts[i + 2], pts[i + 3]);
      }
    } else {
      for (var j = 2; j < pts.length; j += 2) ctx.lineTo(pts[j], pts[j + 1]);
    }
    ctx.strokeStyle = col; ctx.lineWidth = (w == null ? 1 : w) * _lw;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.stroke(); ctx.restore();
  }
  function glow(ctx, x, y, r, col, a) {
    var g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgba(col, a == null ? 0.85 : a));
    g.addColorStop(0.45, rgba(col, (a == null ? 0.85 : a) * 0.35));
    g.addColorStop(1, rgba(col, 0));
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    ctx.restore();
  }
  A.part = part; A.flat = flat; A.stroke = stroke;

  // ------------------------------------------------------- ruído determinístico
  function hash(s) {
    var h = 2166136261, i;
    s = String(s);
    for (i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 16777619) >>> 0; }
    return h >>> 0;
  }
  function rng(seed) {
    var s = (typeof seed === 'string' ? hash(seed) : seed) >>> 0;
    return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }
  A.hash = hash;

  // ==========================================================================
  // PALETAS DE CLASSE
  // Puxa DATA.classes[id].palette quando existir; senão usa o padrão daqui.
  // O elemento tinge a cor principal sem destruir a identidade da classe.
  // ==========================================================================
  // PALETA (revisão v4): sóbria e HARMÔNICA, como a referência do Dofus —
  // verde-oliva, laranja-queimado, creme e couro. Duas cores dominantes
  // (`main` + `cloth`) e UMA de destaque (`accent`). Nada de saturação de
  // desenho infantil.
  var DEF_PAL = {
    // Sumô: pele CREME BRONZEADA quente (a cor de carne do desenho, não bege
    // acinzentado), mawashi de lona índigo-escura (o único frio da figura, para
    // a pele saltar) e cordão/nó em ouro velho.
    sumo:       { main: '#c9553c', dark: '#33241c', accent: '#f0b855', skin: '#f2c48f', hair: '#2c1e16', cloth: '#3d4a70' },
    arqueiro:   { main: '#6f8f4a', dark: '#2c3a24', accent: '#dcc98a', skin: '#e8c7a0', hair: '#c9a55e', cloth: '#4a5c33' },
    bruxo:      { main: '#6b5a86', dark: '#26203a', accent: '#b9a2e0', skin: '#cfae90', hair: '#ded6c6', cloth: '#3b3055' },
    espadachim: { main: '#4a7288', dark: '#1e2a34', accent: '#bcd8e0', skin: '#dfb98a', hair: '#26323c', cloth: '#33495c' },
    curandeira: { main: '#d9b56a', dark: '#6b4a2f', accent: '#f3e3bc', skin: '#f0cdaa', hair: '#c9663c', cloth: '#c98a96' },
    invocador:  { main: '#4e8a80', dark: '#20342f', accent: '#bfe0cf', skin: '#c9b596', hair: '#2b3a35', cloth: '#3a5a52' },
    _:          { main: '#8a8f96', dark: '#2a2f36', accent: '#dfe0d8', skin: '#dcbb9a', hair: '#3a2f24', cloth: '#4a5048' }
  };

  function classPal(id, els) {
    var C = (JOGO.DATA && JOGO.DATA.classes && JOGO.DATA.classes[id]) || null;
    var b = DEF_PAL[id] || DEF_PAL._;
    var p = {
      main: (C && C.palette && C.palette.primary) || b.main,
      dark: (C && C.palette && C.palette.secondary) || b.dark,
      accent: (C && C.palette && C.palette.accent) || b.accent,
      skin: b.skin, hair: b.hair, cloth: b.cloth,
      metal: '#c2cbd6', leather: '#8a5a34', wood: '#9a6b3f'
    };
    els = els || ['neutro'];
    var e0 = els[0] || 'neutro';
    var i0 = elemInfo(e0);
    p.el = i0; p.elId = e0;
    if (e0 !== 'neutro') {
      p.main = vivid(mx(p.main, i0.c, 0.46), 0.10);
      p.accent = mx(p.accent, i0.glow, 0.55);
      p.cloth = mx(p.cloth, i0.deep, 0.40);
      p.metal = mx(p.metal, i0.c, 0.18);
    }
    var e1 = els[1] || null;
    if (e1) {
      var i1 = elemInfo(e1);
      p.el2 = i1; p.el2Id = e1;
      if (e1 !== 'neutro') {
        p.accent2 = i1.glow;
        p.cloth = mx(p.cloth, i1.deep, 0.30);
        p.wood = mx(p.wood, i1.c, 0.22);
      }
    }
    p.line = lineOf(p.main);
    return p;
  }

  // ==========================================================================
  // FORMAS ELEMENTAIS reutilizáveis (chama, gota, lasca, pena)
  // ==========================================================================
  function Pflame(x, y, w, h, lean) {
    lean = lean || 0;
    return tag(function (ctx) {
      ctx.beginPath();
      ctx.moveTo(x - w, y);
      ctx.quadraticCurveTo(x - w * 0.98, y - h * 0.52, x - w * 0.2 + lean * h * 0.4, y - h * 0.7);
      ctx.quadraticCurveTo(x + lean * h * 0.8 - w * 0.05, y - h * 0.92, x + lean * h, y - h);
      ctx.quadraticCurveTo(x + lean * h * 0.4 + w * 0.62, y - h * 0.66, x + w, y - h * 0.3);
      ctx.quadraticCurveTo(x + w * 1.04, y + h * 0.08, x, y + h * 0.1);
      ctx.quadraticCurveTo(x - w * 1.04, y + h * 0.08, x - w, y);
      ctx.closePath();
    }, x, y - h * 0.42, Math.max(w, h * 0.55));
  }
  function Pdrop(x, y, r) {
    return tag(function (ctx) {
      ctx.beginPath();
      ctx.moveTo(x, y - r * 1.85);
      ctx.quadraticCurveTo(x + r * 0.98, y - r * 0.35, x + r * 0.9, y + r * 0.15);
      ctx.quadraticCurveTo(x + r * 0.8, y + r, x, y + r);
      ctx.quadraticCurveTo(x - r * 0.8, y + r, x - r * 0.9, y + r * 0.15);
      ctx.quadraticCurveTo(x - r * 0.98, y - r * 0.35, x, y - r * 1.85);
      ctx.closePath();
    }, x, y - r * 0.2, r * 1.2);
  }
  function Pshard(x, y, r, seed) {
    var rd = rng(seed || 7), n = 5, pts = [], i, a, rr;
    for (i = 0; i < n; i++) {
      a = i / n * TAU - 0.4;
      rr = r * (0.66 + rd() * 0.5);
      pts.push(x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.86);
    }
    return Ppoly(pts);
  }
  function Pfeather(x, y, len, ang) {
    var c = Math.cos(ang), s = Math.sin(ang), w = len * 0.26;
    return tag(function (ctx) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + c * len * 0.4 - s * w, y + s * len * 0.4 + c * w,
                           x + c * len, y + s * len);
      ctx.quadraticCurveTo(x + c * len * 0.45 + s * w, y + s * len * 0.45 - c * w, x, y);
      ctx.closePath();
    }, x + c * len * 0.5, y + s * len * 0.5, len * 0.55);
  }
  function Pswirl(x, y, r, turns) {
    return tag(function (ctx) {
      var i, a, rr, n = 26;
      ctx.beginPath();
      for (i = 0; i <= n; i++) {
        a = i / n * TAU * (turns || 1.1);
        rr = r * (0.2 + 0.8 * i / n);
        if (i === 0) ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.62);
        else ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.62);
      }
    }, x, y, r);
  }
  function Pstar(x, y, r, n, inner) {
    var pts = [], i, a, rr;
    n = n || 4; inner = inner == null ? 0.4 : inner;
    for (i = 0; i < n * 2; i++) {
      a = i / (n * 2) * TAU - Math.PI / 2;
      rr = (i % 2 ? r * inner : r);
      pts.push(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    return Ppoly(pts);
  }

  // --------------------------------------------------- decoração por elemento
  // Atrás do corpo: aura/silhueta que reforça a leitura à distância.
  function elemBack(ctx, An, cfg) {
    var e = cfg.pal.elId, p = cfg.pal, i = p.el;
    if (!e || e === 'neutro') { if (!cfg.pal.el2Id || cfg.pal.el2Id === 'neutro') return; }
    var hx0 = An.head[0], hy = An.head[1], hr = An.head[2];
    var cy = An.chest[1];
    if (e === 'fogo') {
      part(ctx, Pflame(-hr * 1.7, cy + 6, 7, 26, 0.22), sh(i.c, -0.12), { k: 0.18, line: lineOf(i.deep) });
      part(ctx, Pflame(hr * 1.85, cy - 4, 6, 20, -0.2), sh(i.c, -0.05), { k: 0.18, line: lineOf(i.deep) });
      part(ctx, Pflame(0, hy - hr * 1.15, 5, 15, 0.1), i.glow, { k: 0.16, line: lineOf(i.c) });
    } else if (e === 'agua') {
      part(ctx, Pel(0, An.hipY + 8, An.wide * 1.15, 8), rgba(i.c, 0.55), { flat: true, noline: true });
      stroke(ctx, [-An.wide * 1.2, An.hipY + 6, 0, An.hipY - 2, An.wide * 1.2, An.hipY + 6], rgba(i.glow, 0.8), 1.1, true);
      part(ctx, Pdrop(-hr * 1.9, cy - 6, 4.2), i.c, { k: 0.2, hi: true, line: lineOf(i.deep) });
      part(ctx, Pdrop(hr * 2.0, cy + 8, 3.4), i.glow, { k: 0.2, line: lineOf(i.deep) });
    } else if (e === 'terra') {
      part(ctx, Pshard(-hr * 2.0, cy - 2, 7, 'ta'), mx(i.deep, '#6b5a3a', 0.5), { k: 0.28 });
      part(ctx, Pshard(hr * 2.1, cy + 12, 5.5, 'tb'), mx(i.deep, '#6b5a3a', 0.35), { k: 0.28 });
      part(ctx, Pshard(hr * 1.5, hy - hr * 0.8, 4, 'tc'), i.c, { k: 0.24 });
    } else if (e === 'ar') {
      ctx.save();
      ctx.strokeStyle = rgba(i.glow, 0.75); ctx.lineWidth = _lw * 0.9; ctx.lineCap = 'round';
      Pswirl(-hr * 1.6, cy - 4, 13, 1.05)(ctx); ctx.stroke();
      Pswirl(hr * 1.9, cy + 14, 9, 0.9)(ctx); ctx.stroke();
      ctx.restore();
      part(ctx, Pfeather(hr * 1.4, hy - hr * 0.6, 11, -0.9), i.c, { k: 0.2, line: lineOf(i.deep) });
    }
    // segundo elemento (fusões): eco no lado oposto
    var e2 = p.el2Id;
    if (e2 && e2 !== 'neutro' && e2 !== e) {
      var j = p.el2;
      if (e2 === 'fogo') part(ctx, Pflame(hr * 2.1, cy + 10, 6, 21, -0.24), j.c, { k: 0.18, line: lineOf(j.deep) });
      else if (e2 === 'agua') part(ctx, Pdrop(hr * 2.2, cy - 2, 4.6), j.c, { k: 0.2, hi: true, line: lineOf(j.deep) });
      else if (e2 === 'terra') part(ctx, Pshard(hr * 2.2, cy + 6, 6.4, 'f2'), mx(j.deep, '#6b5a3a', 0.4), { k: 0.26 });
      else if (e2 === 'ar') {
        ctx.save(); ctx.strokeStyle = rgba(j.glow, 0.8); ctx.lineWidth = _lw * 0.9;
        Pswirl(hr * 2.1, cy + 2, 11, 1.0)(ctx); ctx.stroke(); ctx.restore();
      }
    }
  }
  // Na frente: brilho nos olhos/arma e faíscas curtas — pouco, só o tempero.
  function elemFront(ctx, An, cfg) {
    var p = cfg.pal, e = p.elId, i = p.el;
    if (!e || e === 'neutro') return;
    var s = An.shN;
    if (e === 'fogo') {
      part(ctx, Pflame(s[0] + 2, s[1] - 3, 4, 12, -0.15), i.glow, { k: 0.14, line: lineOf(i.c) });
    } else if (e === 'agua') {
      part(ctx, Pel(s[0] + 1, s[1] - 1, 5.4, 3.2, -0.4), rgba(i.glow, 0.9), { k: 0.16, line: lineOf(i.deep) });
    } else if (e === 'terra') {
      part(ctx, Pshard(s[0] + 1, s[1] - 2, 5.6, 'sh'), mx(i.c, '#8a7a52', 0.4), { k: 0.26 });
    } else if (e === 'ar') {
      part(ctx, Pfeather(s[0] - 1, s[1] - 3, 10, -0.35), i.glow, { k: 0.18, line: lineOf(i.deep) });
    }
  }

  // ==========================================================================
  // ACESSÓRIOS — vocabulário compartilhado. Qualquer peça funciona em qualquer
  // corpo, o que permite gerar as 15 fusões por composição.
  // ==========================================================================
  var ACC = {};

  // ---------------------------------------------------------------- cabeça
  // Cada peça tem duas metades: `behind` (atrás do crânio) e `front` (sobre
  // ele). O ROSTO é sempre desenhado por último, então nada o encobre — o erro
  // clássico de "herói sem cara" não acontece por construção.
  ACC.head = {
    // Sumô — cabelo colado e coque samurai
    // Sumô — touca de cabelo BAIXA (deixa a testa e o rosto livres) e um coque
    // alto e gordo, que é o que se enxerga de longe.
    // Sumô (revisão v5, pela referência): GORRO verde com pompom laranja e uma
    // TRANÇA longa caindo pelo ombro. A trança balança com a pose.
    capBraid: {
      behind: function (ctx, An, cfg) {
        var h = An.head, r = h[2], p = cfg.pal, ink = An.ink, i;
        // trança: 4 gomos descendo pelo ombro do lado da câmera
        var f = flapOf(cfg);
        var bx = h[0] + r * (cfg.back ? 0.1 : 0.95), by = h[1] + r * 0.6;
        for (i = 0; i < 5; i++) {
          var t = i / 4;
          var x = bx + r * 0.5 * t - f.x * 0.35 * t;
          var y = by + r * (0.7 + i * 0.78) - f.y * 0.3 * t;
          part(ctx, Pel(x, y, r * (0.34 - t * 0.11), r * (0.3 - t * 0.09), 0.3 + i * 0.1),
               i % 2 ? sh(p.hair, 0.1) : p.hair, { k: 0.24, lw: W_MID });
        }
        part(ctx, Pel(bx + r * 0.5, by + r * 3.9, r * 0.2, r * 0.16), p.accent, { k: 0.2, lw: W_IN });
      },
      front: function (ctx, An, cfg) {
        var h = An.head, r = h[2], p = cfg.pal, ink = An.ink;
        var cap = mx(p.cloth, '#5e6b38', 0.35);
        // gorro colado, cobrindo o alto da cabeça
        part(ctx, tag(function (g) {
          g.beginPath();
          g.moveTo(h[0] - r * 1.04, h[1] - r * 0.26);
          g.quadraticCurveTo(h[0] - r * 1.0, h[1] - r * 1.24, h[0] + r * 0.04, h[1] - r * 1.3);
          g.quadraticCurveTo(h[0] + r * 1.04, h[1] - r * 1.2, h[0] + r * 1.06, h[1] - r * 0.22);
          g.quadraticCurveTo(h[0] + r * 0.5, h[1] - r * 0.56, h[0] + r * 0.02, h[1] - r * 0.54);
          g.quadraticCurveTo(h[0] - r * 0.56, h[1] - r * 0.56, h[0] - r * 1.04, h[1] - r * 0.26);
          g.closePath();
        }, h[0], h[1] - r * 0.8, r), cap, { k: 0.24, hi: 0.16, lw: W_MID });
        // barra do gorro + pregas em nanquim
        inkStroke(ctx, [h[0] - r * 1.0, h[1] - r * 0.34, h[0], h[1] - r * 0.62,
                        h[0] + r * 1.02, h[1] - r * 0.3], 1.5, ink);
        inkStroke(ctx, [h[0] - r * 0.5, h[1] - r * 1.18, h[0] - r * 0.34, h[1] - r * 0.66], 1.0, ink);
        inkStroke(ctx, [h[0] + r * 0.42, h[1] - r * 1.2, h[0] + r * 0.3, h[1] - r * 0.68], 1.0, ink);
        // POMPOM laranja
        part(ctx, Pel(h[0] + r * 0.16, h[1] - r * 1.5, r * 0.34, r * 0.32), p.accent,
             { k: 0.26, hi: 0.3, lw: W_MID });
        // franja saindo por baixo do gorro
        part(ctx, Ppoly([h[0] - r * 0.9, h[1] - r * 0.36, h[0] - r * 0.62, h[1] - r * 0.02,
                         h[0] - r * 0.44, h[1] - r * 0.44]), p.hair, { k: 0.2, lw: W_IN });
      }
    },
    topknot: {
      front: function (ctx, An, cfg) {
        var h = An.head, r = h[2], p = cfg.pal;
        part(ctx, tag(function (g) {
          g.beginPath();
          g.moveTo(h[0] - r * 1.02, h[1] - r * 0.42);
          g.quadraticCurveTo(h[0] - r * 0.94, h[1] - r * 1.1, h[0] + r * 0.06, h[1] - r * 1.12);
          g.quadraticCurveTo(h[0] + r * 1.02, h[1] - r * 1.06, h[0] + r * 1.04, h[1] - r * 0.4);
          g.quadraticCurveTo(h[0] + r * 0.72, h[1] - r * 0.74, h[0] + r * 0.08, h[1] - r * 0.7);
          g.quadraticCurveTo(h[0] - r * 0.62, h[1] - r * 0.72, h[0] - r * 1.02, h[1] - r * 0.42);
          g.closePath();
        }, h[0], h[1] - r * 0.8, r), p.hair, { k: 0.34, hi: 0.16, lw: W_OUT });
        // costeletas curtas
        part(ctx, Ppoly([h[0] - r * 1.0, h[1] - r * 0.5, h[0] - r * 0.86, h[1] + r * 0.16,
                         h[0] - r * 0.66, h[1] - r * 0.54]), sh(p.hair, -0.1), { k: 0.2, lw: W_MID });
        part(ctx, Ppoly([h[0] + r * 1.02, h[1] - r * 0.48, h[0] + r * 0.88, h[1] + r * 0.14,
                         h[0] + r * 0.68, h[1] - r * 0.52]), sh(p.hair, -0.1), { k: 0.2, lw: W_MID });
        // coque
        part(ctx, Pcap(h[0] + r * 0.04, h[1] - r * 1.04, r * 0.2, h[0] + r * 0.3, h[1] - r * 1.42, r * 0.14),
             sh(p.hair, -0.12), { k: 0.24, lw: W_MID });
        part(ctx, Pel(h[0] + r * 0.34, h[1] - r * 1.52, r * 0.34, r * 0.28, -0.3), sh(p.hair, 0.14),
             { k: 0.3, hi: 0.2, lw: W_OUT });
        // HACHIMAKI: bandana na testa com duas pontas caídas atrás
        var bc = mx(p.cloth, '#e8dcc0', 0.3);
        clothTail(ctx, h[0] - r * 0.92, h[1] - r * 0.42, r * 1.5, 2.55, r * 0.2, sh(bc, -0.12), cfg, 0.55);
        clothTail(ctx, h[0] - r * 0.9, h[1] - r * 0.26, r * 1.1, 2.3, r * 0.16, bc, cfg, 0.4);
        part(ctx, tag(function (g) {
          g.beginPath();
          g.moveTo(h[0] - r * 1.04, h[1] - r * 0.34);
          g.quadraticCurveTo(h[0], h[1] - r * 0.74, h[0] + r * 1.06, h[1] - r * 0.32);
          g.quadraticCurveTo(h[0] + r * 1.06, h[1] - r * 0.06, h[0] + r * 1.02, h[1] - r * 0.02);
          g.quadraticCurveTo(h[0], h[1] - r * 0.44, h[0] - r * 1.0, h[1] - r * 0.04);
          g.closePath();
        }, h[0], h[1] - r * 0.36, r), bc, { k: 0.26, hi: 0.2, lw: W_MID });
        part(ctx, Pel(h[0] + r * 0.2, h[1] - r * 0.42, r * 0.2, r * 0.16), p.accent,
             { k: 0.2, lw: W_IN, keepLine: true });
      }
    },
    // Elfo — capuz curto que emoldura o rosto e deixa as orelhas de fora
    hood: {
      behind: function (ctx, An, cfg) {
        var h = An.head, r = h[2], p = cfg.pal, c = mx(p.main, p.dark, 0.3);
        part(ctx, Pblob([h[0] - r * 1.3, h[1] + r * 0.5, h[0] - r * 1.26, h[1] - r * 0.5,
                         h[0] - r * 0.4, h[1] - r * 1.34, h[0] + r * 0.66, h[1] - r * 1.22,
                         h[0] + r * 1.3, h[1] - r * 0.4, h[0] + r * 1.24, h[1] + r * 0.52]), c, { k: 0.26 });
        part(ctx, Ppoly([h[0] - r * 1.2, h[1] + r * 0.1, h[0] - r * 2.0, h[1] + r * 0.9,
                         h[0] - r * 0.7, h[1] + r * 0.8]), sh(c, -0.18), { k: 0.2 });
      },
      front: function (ctx, An, cfg) {
        var h = An.head, r = h[2], p = cfg.pal, c = mx(p.main, p.dark, 0.3);
        // só a testa: uma aba baixa, o rosto fica livre
        part(ctx, tag(function (g) {
          g.beginPath();
          g.moveTo(h[0] - r * 1.12, h[1] - r * 0.14);
          g.quadraticCurveTo(h[0] - r * 0.2, h[1] - r * 1.3, h[0] + r * 1.12, h[1] - r * 0.2);
          g.quadraticCurveTo(h[0] + r * 0.9, h[1] - r * 0.62, h[0] + r * 0.1, h[1] - r * 0.72);
          g.quadraticCurveTo(h[0] - r * 0.8, h[1] - r * 0.66, h[0] - r * 1.12, h[1] - r * 0.14);
          g.closePath();
        }, h[0], h[1] - r * 0.7, r), sh(c, 0.08), { k: 0.24 });
        part(ctx, Pel(h[0] + r * 0.34, h[1] - r * 0.86, r * 0.2, r * 0.2), p.accent, { k: 0.18, lw: 0.75 });
      }
    },
    // Bruxo — chapéu pontudo, aba larga acima dos olhos
    wizhat: {
      front: function (ctx, An, cfg) {
        var h = An.head, r = h[2], p = cfg.pal;
        var bx = h[0], by = h[1] - r * 0.62;
        var c = mx(p.main, p.dark, 0.24), c2 = sh(c, -0.18);
        part(ctx, tag(function (g) {
          g.beginPath();
          g.moveTo(bx - r * 1.0, by + r * 0.1);
          g.quadraticCurveTo(bx - r * 0.72, by - r * 1.5, bx + r * 0.3, by - r * 2.3);
          g.quadraticCurveTo(bx + r * 1.45, by - r * 2.86, bx + r * 1.92, by - r * 2.1);
          g.quadraticCurveTo(bx + r * 1.1, by - r * 1.98, bx + r * 0.84, by - r * 1.36);
          g.quadraticCurveTo(bx + r * 0.58, by - r * 0.56, bx + r * 0.98, by + r * 0.1);
          g.closePath();
        }, bx, by - r, r * 1.6), c, { k: 0.26 });
        part(ctx, Pel(bx + r * 0.05, by + r * 0.16, r * 1.78, r * 0.46), c2, { k: 0.2, hi: 0.2 });
        part(ctx, Ppoly([bx - r * 1.0, by - r * 0.02, bx + r * 1.0, by - r * 0.02,
                         bx + r * 0.9, by - r * 0.4, bx - r * 0.94, by - r * 0.4]), p.dark, { k: 0.2, lw: 0.85 });
        part(ctx, Pstar(bx + r * 0.46, by - r * 0.2, r * 0.28, 4, 0.42), p.accent, { k: 0.2, lw: 0.8 });
      }
    },
    // Espadachim — cabelo espetado + bandana na testa
    bandana: {
      behind: function (ctx, An, cfg) {
        var h = An.head, r = h[2], p = cfg.pal;
        part(ctx, Pblob([h[0] - r * 1.06, h[1] - r * 0.2, h[0] - r * 0.7, h[1] - r * 1.16,
                         h[0] + r * 0.12, h[1] - r * 1.36, h[0] + r * 0.9, h[1] - r * 1.0,
                         h[0] + r * 1.06, h[1] - r * 0.16]), p.hair, { k: 0.28 });
        part(ctx, Ppoly([h[0] - r * 0.94, h[1] - r * 0.76, h[0] - r * 1.72, h[1] - r * 1.16,
                         h[0] - r * 0.5, h[1] - r * 1.16]), p.hair, { k: 0.28, lw: 0.9 });
        part(ctx, Ppoly([h[0] + r * 0.14, h[1] - r * 1.2, h[0] + r * 0.3, h[1] - r * 1.94,
                         h[0] + r * 0.74, h[1] - r * 1.06]), p.hair, { k: 0.28, lw: 0.9 });
        part(ctx, Pblob([h[0] - r * 1.0, h[1] - r * 0.5, h[0] - r * 2.1, h[1] - r * 0.74,
                         h[0] - r * 2.6, h[1] - r * 0.12, h[0] - r * 1.7, h[1] - r * 0.14]),
             sh(p.main, -0.12), { k: 0.22 });
      },
      front: function (ctx, An, cfg) {
        var h = An.head, r = h[2], p = cfg.pal;
        part(ctx, tag(function (g) {
          g.beginPath();
          g.moveTo(h[0] - r * 1.08, h[1] - r * 0.36);
          g.quadraticCurveTo(h[0], h[1] - r * 0.62, h[0] + r * 1.08, h[1] - r * 0.46);
          g.lineTo(h[0] + r * 1.04, h[1] - r * 0.78);
          g.quadraticCurveTo(h[0], h[1] - r * 0.94, h[0] - r * 1.06, h[1] - r * 0.68);
          g.closePath();
        }, h[0], h[1] - r * 0.6, r), vivid(p.main, 0.14), { k: 0.24 });
      }
    },
    // Curandeira — cabelão com chiquinhas; a franja NÃO cobre os olhos
    buns: {
      behind: function (ctx, An, cfg) {
        var h = An.head, r = h[2], p = cfg.pal;
        part(ctx, Pblob([h[0] - r * 1.16, h[1] + r * 0.5, h[0] - r * 1.2, h[1] - r * 0.7,
                         h[0] - r * 0.4, h[1] - r * 1.22, h[0] + r * 0.5, h[1] - r * 1.18,
                         h[0] + r * 1.2, h[1] - r * 0.6, h[0] + r * 1.18, h[1] + r * 0.54]), p.hair, { k: 0.26 });
        part(ctx, Pel(h[0] - r * 1.3, h[1] + r * 0.2, r * 0.44, r * 0.52), p.hair, { k: 0.26, hi: 0.2 });
        part(ctx, Pel(h[0] + r * 1.34, h[1] + r * 0.12, r * 0.46, r * 0.54), p.hair, { k: 0.26, hi: 0.2 });
      },
      front: function (ctx, An, cfg) {
        var h = An.head, r = h[2], p = cfg.pal;
        part(ctx, tag(function (g) {
          g.beginPath();
          g.moveTo(h[0] - r * 1.04, h[1] - r * 0.22);
          g.quadraticCurveTo(h[0] - r * 0.9, h[1] - r * 1.1, h[0] + r * 0.06, h[1] - r * 1.1);
          g.quadraticCurveTo(h[0] + r * 1.0, h[1] - r * 1.06, h[0] + r * 1.04, h[1] - r * 0.2);
          g.quadraticCurveTo(h[0] + r * 0.62, h[1] - r * 0.52, h[0] + r * 0.2, h[1] - r * 0.42);
          g.quadraticCurveTo(h[0] - r * 0.5, h[1] - r * 0.36, h[0] - r * 1.04, h[1] - r * 0.22);
          g.closePath();
        }, h[0], h[1] - r * 0.66, r), sh(p.hair, 0.1), { k: 0.24 });
        var fx = h[0] + r * 0.96, fy = h[1] - r * 0.78, i;
        for (i = 0; i < 5; i++) {
          var a = i / 5 * TAU;
          part(ctx, Pel(fx + Math.cos(a) * r * 0.2, fy + Math.sin(a) * r * 0.2, r * 0.17, r * 0.17),
               p.accent, { k: 0.18, lw: 0.75 });
        }
        part(ctx, Pel(fx, fy, r * 0.12, r * 0.12), '#ffe27a', { k: 0.2, lw: 0.7 });
      }
    },
    // Invocador — máscara chifruda de madeira (esconde o rosto de propósito)
    mask: {
      hideFace: true,
      behind: function (ctx, An, cfg) {
        var h = An.head, r = h[2], p = cfg.pal, c = mx(p.dark, p.main, 0.4);
        part(ctx, Pblob([h[0] - r * 1.24, h[1] + r * 0.4, h[0] - r * 1.14, h[1] - r * 0.8,
                         h[0] + r * 0.1, h[1] - r * 1.3, h[0] + r * 1.18, h[1] - r * 0.76,
                         h[0] + r * 1.24, h[1] + r * 0.44]), c, { k: 0.24 });
      },
      front: function (ctx, An, cfg) {
        var h = An.head, r = h[2], p = cfg.pal;
        var mkC = mx(p.wood, p.accent, 0.18);
        part(ctx, Pcap(h[0] - r * 0.86, h[1] - r * 0.68, r * 0.2, h[0] - r * 1.44, h[1] - r * 1.52, r * 0.07),
             p.wood, { k: 0.3, lw: 0.9 });
        part(ctx, Pcap(h[0] + r * 0.9, h[1] - r * 0.62, r * 0.2, h[0] + r * 1.5, h[1] - r * 1.46, r * 0.07),
             p.wood, { k: 0.3, lw: 0.9 });
        part(ctx, Pblob([h[0] - r * 0.88, h[1] - r * 0.56, h[0] + r * 0.2, h[1] - r * 0.82,
                         h[0] + r * 0.98, h[1] - r * 0.44, h[0] + r * 0.86, h[1] + r * 0.62,
                         h[0] + r * 0.12, h[1] + r * 0.98, h[0] - r * 0.78, h[1] + r * 0.52]),
             mkC, { k: 0.24, hi: 0.18 });
        glow(ctx, h[0] - r * 0.26, h[1] - r * 0.08, r * 0.66, p.accent, 0.55);
        glow(ctx, h[0] + r * 0.5, h[1] - r * 0.06, r * 0.6, p.accent, 0.55);
        part(ctx, Ppoly([h[0] - r * 0.6, h[1] - r * 0.22, h[0] - r * 0.02, h[1] - r * 0.34,
                         h[0] - r * 0.04, h[1] + r * 0.04, h[0] - r * 0.62, h[1] + r * 0.1]),
             sh(p.accent, 0.4), { flat: true, lw: 0.75, line: sh(p.accent, -0.3) });
        part(ctx, Ppoly([h[0] + r * 0.26, h[1] - r * 0.34, h[0] + r * 0.76, h[1] - r * 0.2,
                         h[0] + r * 0.74, h[1] + r * 0.1, h[0] + r * 0.24, h[1] + r * 0.02]),
             sh(p.accent, 0.4), { flat: true, lw: 0.75, line: sh(p.accent, -0.3) });
        stroke(ctx, [h[0] - r * 0.5, h[1] + r * 0.5, h[0] + r * 0.02, h[1] + r * 0.58,
                     h[0] + r * 0.5, h[1] + r * 0.44], sh(p.wood, -0.42), 1, true);
      }
    }
  };

  // -------------------------------------------------------- costas / atrás
  ACC.back = {
    quiver: function (ctx, An, cfg) {
      var p = cfg.pal, b = An.backC, i;
      part(ctx, Prr(b[0] - An.wide * 0.5, b[1] + 2, 11, 30, 5), p.leather, { k: 0.28, rot: LIGHT });
      for (i = 0; i < 3; i++) {
        var ax = b[0] - An.wide * 0.5 - 3 + i * 3.4, ay = b[1] - 14 - i * 1.5;
        stroke(ctx, [ax, ay + 6, ax - 2 - i, ay - 8], sh(p.wood, -0.2), 0.8);
        part(ctx, Ppoly([ax - 2 - i, ay - 8, ax - 6 - i, ay - 12, ax + 1 - i, ay - 11]),
             i === 1 ? p.accent : p.main, { k: 0.22, lw: 0.7 });
      }
    },
    cape: function (ctx, An, cfg) {
      var p = cfg.pal, c = mx(p.main, p.dark, 0.44);
      var y0 = An.shF[1] - 3, y1 = An.hipY + An.h * 0.30, w = An.wide * 1.28;
      part(ctx, tag(function (g) {
        g.beginPath();
        g.moveTo(-w * 0.72, y0);
        g.quadraticCurveTo(-w * 1.24, y0 + (y1 - y0) * 0.55, -w * 0.95, y1);
        g.quadraticCurveTo(-w * 0.3, y1 + 6, 0, y1 + 2);
        g.quadraticCurveTo(w * 0.55, y1 + 6, w * 0.98, y1 - 3);
        g.quadraticCurveTo(w * 1.2, y0 + (y1 - y0) * 0.4, w * 0.68, y0);
        g.closePath();
      }, 0, (y0 + y1) / 2, w), c, { k: 0.22, rot: LIGHT });
      stroke(ctx, [-w * 0.5, y0 + 8, -w * 0.62, (y0 + y1) / 2, -w * 0.5, y1 - 4], sh(c, -0.18), 0.9, true);
      stroke(ctx, [w * 0.42, y0 + 10, w * 0.58, (y0 + y1) / 2, w * 0.46, y1 - 6], sh(c, -0.18), 0.9, true);
    },
    scarf: function (ctx, An, cfg) {
      var p = cfg.pal, c = vivid(p.main, 0.16);
      var x0 = An.shF[0] + 2, y0 = An.shF[1] - 1;
      part(ctx, tag(function (g) {
        g.beginPath();
        g.moveTo(x0, y0);
        g.quadraticCurveTo(x0 - An.wide * 1.5, y0 - 6, x0 - An.wide * 2.3, y0 + 12);
        g.quadraticCurveTo(x0 - An.wide * 1.9, y0 + 6, x0 - An.wide * 1.5, y0 + 14);
        g.quadraticCurveTo(x0 - An.wide * 0.8, y0 + 16, x0, y0 + 9);
        g.closePath();
      }, x0 - An.wide, y0 + 6, An.wide * 1.6), c, { k: 0.24, rot: LIGHT });
      part(ctx, Pel(An.neck[0], An.neck[1] + 1, An.wide * 0.42, 4.6), sh(c, -0.06), { k: 0.2 });
    },
    totem: function (ctx, An, cfg) {
      var p = cfg.pal, b = An.backC, x = b[0] - An.wide * 0.42, i;
      var top = An.head[1] - An.head[2] * 0.4, bot = An.hipY + 10;
      var cols = [p.wood, mx(p.wood, p.main, 0.5), mx(p.wood, p.accent, 0.3)];
      for (i = 0; i < 3; i++) {
        var yy = top + (bot - top) * (i / 3 + 0.16), hgt = (bot - top) / 3.2;
        part(ctx, Prr(x, yy, 17 - i * 1.2, hgt, 3), cols[i], { k: 0.28, rot: LIGHT });
        // carinha entalhada
        part(ctx, Pel(x - 3.4, yy - 1, 1.9, 1.5), p.accent, { k: 0.1, lw: 0.6 });
        part(ctx, Pel(x + 3.2, yy - 1, 1.9, 1.5), p.accent, { k: 0.1, lw: 0.6 });
        stroke(ctx, [x - 3.6, yy + 4, x, yy + 5.4, x + 3.6, yy + 4], sh(cols[i], -0.4), 0.8, true);
      }
      // asas do topo
      part(ctx, Ppoly([x - 8, top + 3, x - 15, top - 2, x - 8, top + 8]), mx(p.wood, p.dark, 0.3), { k: 0.26, lw: 0.8 });
      part(ctx, Ppoly([x + 8, top + 3, x + 15, top - 2, x + 8, top + 8]), mx(p.wood, p.dark, 0.3), { k: 0.26, lw: 0.8 });
    }
  };

  // ------------------------------------------------------------------ armas
  // Todas desenhadas a partir da mão (hx,hy) informada pelo corpo.
  ACC.weapon = {
    fists: function () {},
    bow: function (ctx, An, cfg, hx0, hy0) {
      var p = cfg.pal, R = 33;
      var cx = hx0 + 7, cy = hy0 - 2;
      ctx.save();
      ctx.translate(cx, cy); ctx.rotate(-0.16);
      part(ctx, tag(function (g) {
        g.beginPath();
        g.moveTo(0, -R);
        g.quadraticCurveTo(16, -R * 0.52, 16, 0);
        g.quadraticCurveTo(16, R * 0.52, 0, R);
        g.quadraticCurveTo(10.6, R * 0.5, 10.6, 0);
        g.quadraticCurveTo(10.6, -R * 0.5, 0, -R);
        g.closePath();
      }, 10, 0, R), mx(p.wood, p.main, 0.34), { k: 0.26 });
      // corda + flecha encaixada
      stroke(ctx, [0, -R, -1.5, 0, 0, R], rgba('#f4ecd8', 0.92), 0.75, true);
      stroke(ctx, [-14, 0, 12, 0], sh(p.wood, -0.24), 0.7);
      part(ctx, Ppoly([-14, 0, -19, -3.4, -18, 0, -19, 3.4]), p.accent, { k: 0.18, lw: 0.7 });
      part(ctx, Ppoly([12, 0, 8, -2.6, 8, 2.6]), sh(p.metal, -0.1), { k: 0.18, lw: 0.7 });
      part(ctx, Pel(14, 0, 3.4, 5.6), p.accent, { k: 0.2, lw: 0.8 });
      ctx.restore();
    },
    staff: function (ctx, An, cfg, hx0, hy0) {
      var p = cfg.pal;
      var topY = An.head[1] - An.head[2] * 2.5;
      var botY = 2;
      var tx = hx0 + 4, bx = hx0 - 3;
      part(ctx, Pcap(tx, topY + 8, 2.5, bx, botY, 2.1), p.wood, { k: 0.28 });
      // nós na madeira
      stroke(ctx, [tx - 1, topY + 24, bx + 1.5, botY - 22], sh(p.wood, -0.28), 0.55);
      // cristal
      part(ctx, Ppoly([tx, topY - 9, tx + 6.5, topY + 1, tx + 3.4, topY + 10,
                       tx - 3.4, topY + 10, tx - 6.5, topY + 1]), p.accent, { k: 0.2, hi: true });
      glow(ctx, tx, topY + 1, 15, p.accent, 0.5);
      part(ctx, Pel(tx, topY + 11, 4.4, 2.6), mx(p.metal, p.main, 0.3), { k: 0.24, lw: 0.8 });
    },
    sword: function (ctx, An, cfg, hx0, hy0) {
      var p = cfg.pal;
      ctx.save();
      ctx.translate(hx0, hy0); ctx.rotate(0.42);
      part(ctx, Ppoly([-1.6, 2, 1.6, 2, 2.2, -34, 0, -41, -2.2, -34]), mx(p.metal, p.accent, 0.28), { k: 0.2, hi: true });
      stroke(ctx, [0, -3, 0, -33], sh(p.metal, 0.4), 0.5);
      part(ctx, Prr(0, 3.4, 13, 3.4, 1.6), mx(p.main, p.dark, 0.3), { k: 0.24 });
      part(ctx, Prr(0, 9, 3.4, 9, 1.6), p.leather, { k: 0.26 });
      part(ctx, Pel(0, 14.4, 2.6, 2.6), p.accent, { k: 0.2, lw: 0.8 });
      ctx.restore();
    },
    wand: function (ctx, An, cfg, hx0, hy0) {
      var p = cfg.pal;
      var topY = hy0 - 30, tx = hx0 + 3;
      part(ctx, Pcap(tx, topY + 6, 1.9, hx0 - 1, hy0 + 12, 1.7), p.wood, { k: 0.28 });
      // bulbo em flor
      var i;
      for (i = 0; i < 5; i++) {
        var a = i / 5 * TAU - 0.4;
        part(ctx, Pel(tx + Math.cos(a) * 4.4, topY + Math.sin(a) * 4.4, 3.4, 3.0), p.main, { k: 0.2, lw: 0.8, hi: true });
      }
      part(ctx, Pel(tx, topY, 3.4, 3.4), p.accent, { k: 0.18, lw: 0.8 });
      glow(ctx, tx, topY, 13, p.accent, 0.5);
    },
    tome: function (ctx, An, cfg, hx0, hy0) {
      var p = cfg.pal;
      var x = hx0 + 3, y = hy0 - 2;
      ctx.save(); ctx.translate(x, y); ctx.rotate(0.16);
      part(ctx, Ppoly([-13, 2, -1, -2.4, -1, 8, -13, 12]), mx(p.main, p.dark, 0.4), { k: 0.24 });
      part(ctx, Ppoly([1, -2.4, 13, 2, 13, 12, 1, 8]), mx(p.main, p.dark, 0.28), { k: 0.24 });
      part(ctx, Ppoly([-12, 1.4, -1, -2.6, -1, 5.4, -12, 9]), '#f2e6c8', { k: 0.14, lw: 0.7 });
      part(ctx, Ppoly([1, -2.6, 12, 1.4, 12, 9, 1, 5.4]), '#e8dab8', { k: 0.14, lw: 0.7 });
      stroke(ctx, [-9, 2.4, -3, 0.6], sh('#c8b48a', -0.2), 0.5);
      stroke(ctx, [-9, 5.2, -3, 3.4], sh('#c8b48a', -0.2), 0.5);
      part(ctx, Pstar(0, -6, 4.2, 4, 0.36), p.accent, { k: 0.16, lw: 0.7 });
      glow(ctx, 0, -6, 12, p.accent, 0.45);
      ctx.restore();
    }
  };
  // versão "guardada" da arma (fusões: a arma do corpo dominante fica às costas)
  function drawStowed(ctx, An, cfg, kind) {
    var p = cfg.pal, b = An.backC;
    var x = b[0] - An.wide * 0.62, y = b[1];
    ctx.save(); ctx.translate(x, y); ctx.rotate(0.42); ctx.scale(0.82, 0.82);
    if (kind === 'bow') {
      part(ctx, tag(function (g) {
        g.beginPath(); g.moveTo(0, -22);
        g.quadraticCurveTo(-11, -11, -11, 0); g.quadraticCurveTo(-11, 11, 0, 22);
        g.quadraticCurveTo(-7, 11, -7, 0); g.quadraticCurveTo(-7, -11, 0, -22);
        g.closePath();
      }, -6, 0, 22), mx(p.wood, p.dark, 0.3), { k: 0.26, lw: 0.8 });
    } else if (kind === 'sword') {
      part(ctx, Ppoly([-1.4, 0, 1.4, 0, 1.8, -26, 0, -31, -1.8, -26]), sh(p.metal, -0.24), { k: 0.2, lw: 0.8 });
      part(ctx, Prr(0, 2.4, 10, 2.8, 1.4), mx(p.dark, p.main, 0.3), { k: 0.24, lw: 0.8 });
    } else if (kind === 'staff' || kind === 'wand') {
      part(ctx, Pcap(0, -24, 1.8, 0, 20, 1.6), sh(p.wood, -0.2), { k: 0.26, lw: 0.8 });
      part(ctx, Pel(0, -26, 3.4, 3.4), sh(p.accent, -0.2), { k: 0.2, lw: 0.7 });
    } else if (kind === 'tome') {
      part(ctx, Prr(0, 0, 15, 19, 2), mx(p.main, p.dark, 0.42), { k: 0.24, lw: 0.8 });
      part(ctx, Prr(4, 0, 4, 17, 1), '#e8dab8', { k: 0.16, lw: 0.6 });
    }
    ctx.restore();
  }

  // ==========================================================================
  // VESTUÁRIO EM CAMADAS (revisão v4)
  // A referência do Dofus carrega o personagem pela ROUPA, não pelo corpo:
  // bandana com pontas caídas, faixa com nó e pontas soltas, enfaixamento de
  // antebraço e canela, bainha dobrada, cinto com bolsinhas. Cada classe usa de
  // 3 a 5 destas peças.
  //
  // `cfg.flap` vem da pose: as pontas de pano ATRASAM em relação ao corpo, então
  // balançam sozinhas ao andar e ao atacar. É barato e é o que dá vida.
  // ==========================================================================
  function flapOf(cfg) { return (cfg && cfg.flap) || { x: 0, y: 0 }; }

  // ponta de tecido: uma fita que sai da silhueta e chicoteia com o movimento
  function clothTail(ctx, x, y, len, ang, w, col, cfg, lag) {
    var f = flapOf(cfg);
    var k = lag == null ? 1 : lag;
    var tx = x + Math.cos(ang) * len - f.x * k;
    var ty = y + Math.sin(ang) * len - f.y * k * 0.5;
    var mx1 = x + Math.cos(ang) * len * 0.5 - f.x * k * 0.35;
    var my1 = y + Math.sin(ang) * len * 0.5 + w * 0.6 - f.y * k * 0.2;
    part(ctx, tag(function (g) {
      g.beginPath();
      g.moveTo(x, y - w * 0.5);
      g.quadraticCurveTo(mx1, my1 - w * 0.5, tx, ty);
      g.quadraticCurveTo(mx1, my1 + w * 0.7, x, y + w * 0.5);
      g.closePath();
    }, (x + tx) / 2, (y + ty) / 2, len * 0.5), col, { k: 0.28, hi: 0.12, lw: W_MID });
  }

  // enfaixamento (antebraço, canela): 3 voltas de tira sobre o membro
  function wraps(ctx, a, k0, k1, col, n) {
    var A0 = a[k0], A1 = a[k1], i, t, x, y;
    n = n || 3;
    for (i = 0; i < n; i++) {
      t = 0.34 + i * (0.52 / n);
      x = A0[0] + (A1[0] - A0[0]) * t;
      y = A0[1] + (A1[1] - A0[1]) * t;
      part(ctx, Pel(x, y, a.r1 * 1.32, a.r1 * 0.52, Math.atan2(A1[1] - A0[1], A1[0] - A0[0])),
           i % 2 ? col : sh(col, 0.1), { k: 0.24, lw: W_IN * 1.3 });
    }
  }

  // ------------------------------------------------------------------ torso
  ACC.torso = {
    // cinta de sumô: faixa GROSSA na cintura + franja curta, para as pernas
    // continuarem visíveis andando (a franja comprida escondia a passada).
    // corda cerimonial cruzando o peito, com amuletos pendurados
    chestRope: function (ctx, An, cfg) {
      var p = cfg.pal, i;
      var x0 = An.shF[0] + An.wide * 0.16, y0 = An.shF[1] + An.headR * 0.3;
      var x1 = An.hipC[0] + An.wide * 0.72, y1 = An.hipY - An.headR * 0.2;
      var rope = mx(p.accent, '#c9b184', 0.5);
      part(ctx, Pcap(x0, y0, An.headR * 0.16, x1, y1, An.headR * 0.14), rope,
           { k: 0.26, hi: 0.2, lw: W_MID });
      for (i = 0; i < 3; i++) {
        var t = 0.3 + i * 0.22;
        var cx2 = x0 + (x1 - x0) * t, cy2 = y0 + (y1 - y0) * t;
        part(ctx, Ppoly([cx2 - An.headR * 0.14, cy2, cx2, cy2 + An.headR * 0.42,
                         cx2 + An.headR * 0.14, cy2]), i % 2 ? p.accent : sh(p.cloth, 0.2),
             { k: 0.22, lw: W_IN * 1.2 });
      }
    },
    // pano curto pendurado no quadril, com bainha dobrada
    // TANGA verde com barra laranja e pregas — a peça de baixo da referência
    hipCloth: function (ctx, An, cfg) {
      var p = cfg.pal, w = An.wide * 1.02, y = An.hipY + An.headR * 0.1;
      var c = mx(p.cloth, '#5e6b38', 0.3), ink = An.ink;
      var bot = y + An.headR * 1.05;    // curta: as pernas precisam aparecer andando
      part(ctx, tag(function (g) {
        g.beginPath();
        g.moveTo(-w * 0.9, y);
        g.quadraticCurveTo(-w * 1.06, bot - 4, -w * 0.92, bot);
        g.quadraticCurveTo(0, bot + An.headR * 0.42, w * 0.92, bot);
        g.quadraticCurveTo(w * 1.06, bot - 4, w * 0.9, y);
        g.closePath();
      }, 0, (y + bot) / 2, w), c, { k: 0.24, hi: 0.12, lw: W_MID, rot: LIGHT });
      // BARRA LARANJA na bainha
      part(ctx, tag(function (g) {
        g.beginPath();
        g.moveTo(-w * 0.92, bot - An.headR * 0.26);
        g.quadraticCurveTo(0, bot + An.headR * 0.16, w * 0.92, bot - An.headR * 0.26);
        g.quadraticCurveTo(0, bot + An.headR * 0.44, -w * 0.92, bot - An.headR * 0.26);
        g.closePath();
      }, 0, bot, w), p.accent, { k: 0.24, hi: 0.2, lw: W_IN });
      // pregas do pano em nanquim
      inkStroke(ctx, [-w * 0.4, y + 3, -w * 0.5, bot - An.headR * 0.4], 1.1, ink);
      inkStroke(ctx, [w * 0.34, y + 3, w * 0.44, bot - An.headR * 0.4], 1.1, ink);
      inkStroke(ctx, [0, y + 5, w * 0.02, bot - An.headR * 0.4], 0.9, ink);
    },
    // CINTO largo de couro com fivela retangular
    beltBuckle: function (ctx, An, cfg) {
      var p = cfg.pal, y = An.hipY + An.headR * 0.02, w = An.wide * 1.06;
      var hgt = An.headR * 0.46, ink = An.ink;
      var leather = mx(p.leather, '#6b4426', 0.3);
      part(ctx, tag(function (g) {
        g.beginPath();
        g.moveTo(-w, y - hgt * 0.7);
        g.quadraticCurveTo(0, y - hgt * 1.5, w, y - hgt * 0.7);
        g.quadraticCurveTo(w * 1.04, y + hgt * 0.6, w * 0.94, y + hgt);
        g.quadraticCurveTo(0, y + hgt * 1.8, -w * 0.94, y + hgt);
        g.quadraticCurveTo(-w * 1.04, y + hgt * 0.6, -w, y - hgt * 0.7);
        g.closePath();
      }, 0, y, w), leather, { k: 0.26, hi: 0.14, lw: W_MID, rot: LIGHT });
      // fivela retangular
      part(ctx, Prr(An.wide * 0.1, y + hgt * 0.1, An.headR * 0.86, An.headR * 0.62, 2),
           mx(p.accent, '#c9a24a', 0.4), { k: 0.24, hi: 0.3, lw: W_IN, keepLine: true });
      part(ctx, Prr(An.wide * 0.1, y + hgt * 0.1, An.headR * 0.5, An.headR * 0.3, 1),
           sh(leather, -0.2), { flat: true, noline: true });
      inkStroke(ctx, [-w * 0.92, y + hgt * 0.5, 0, y + hgt * 1.1, w * 0.92, y + hgt * 0.5], 1.3, ink);
    },
    mawashi: function (ctx, An, cfg) {
      var p = cfg.pal, y = An.hipY + 5, w = An.wide * 0.96, i;
      var hgt = An.headR * 0.42;
      // faixa que ABRAÇA o quadril (curva), não uma barra chapada atravessada
      part(ctx, tag(function (g) {
        g.beginPath();
        g.moveTo(-w, y - hgt * 0.6);
        g.quadraticCurveTo(0, y - hgt * 1.7, w, y - hgt * 0.6);
        g.quadraticCurveTo(w * 1.04, y + hgt * 0.5, w * 0.88, y + hgt * 1.0);
        g.quadraticCurveTo(0, y + hgt * 1.9, -w * 0.88, y + hgt * 1.0);
        g.quadraticCurveTo(-w * 1.04, y + hgt * 0.5, -w, y - hgt * 0.6);
        g.closePath();
      }, 0, y, w), p.cloth, { k: 0.32, hi: 0.2, lw: W_OUT, rot: LIGHT });
      for (i = -1; i <= 1; i++) {                      // franja curta
        part(ctx, Prr(i * w * 0.44, y + hgt * 2.3, w * 0.18, hgt * 1.7, 1.5),
             sh(p.cloth, i ? -0.16 : 0.08), { k: 0.28, lw: W_MID });
      }
      // PONTAS SOLTAS da faixa: saem da silhueta e chicoteiam com o movimento
      clothTail(ctx, -w * 0.9, y + hgt * 0.5, An.headR * 1.15, 1.9, An.headR * 0.3,
                sh(p.cloth, -0.1), cfg, 0.5);
      clothTail(ctx, -w * 0.82, y + hgt * 1.0, An.headR * 0.85, 1.65, An.headR * 0.24,
                sh(p.cloth, 0.14), cfg, 0.35);
      // nó cerimonial — o adereço-assinatura do lutador
      part(ctx, Pel(0, y - hgt * 0.1, w * 0.22, hgt * 0.86), p.accent, { k: 0.26, hi: 0.34, lw: W_MID });
      part(ctx, Pel(0, y - hgt * 0.1, w * 0.08, hgt * 0.34), sh(p.accent, -0.3), { flat: true, noline: true });
      stroke(ctx, [-w * 0.13, y - hgt * 0.5, -w * 0.06, y + hgt * 0.6], sh(p.cloth, -0.3), W_IN * 1.3);
      stroke(ctx, [w * 0.14, y - hgt * 0.5, w * 0.07, y + hgt * 0.6], sh(p.cloth, -0.3), W_IN * 1.3);
    },
    baldric: function (ctx, An, cfg) {
      var p = cfg.pal;
      var x0 = An.shF[0] + 1, y0 = An.shF[1] + 2, x1 = An.hipC[0] + An.wide * 0.5, y1 = An.hipY - 1;
      part(ctx, Pcap(x0, y0, 3.4, x1, y1, 3.0), p.leather, { k: 0.28, rot: LIGHT });
      part(ctx, Prr((x0 + x1) / 2, (y0 + y1) / 2, 6, 5, 1.4), p.accent, { k: 0.22, lw: 0.8 });
      part(ctx, tag(function (g) {
        g.beginPath();
        g.moveTo(-An.wide * 0.92, An.hipY - 3); g.quadraticCurveTo(0, An.hipY + 3, An.wide * 0.92, An.hipY - 3);
        g.lineTo(An.wide * 0.88, An.hipY - 8); g.quadraticCurveTo(0, An.hipY - 3, -An.wide * 0.88, An.hipY - 8);
        g.closePath();
      }, 0, An.hipY - 3, An.wide), p.leather, { k: 0.24 });
    },
    robe: function (ctx, An, cfg) {
      var p = cfg.pal, c = mx(p.main, p.dark, 0.2);
      var y0 = An.chest[1] + 2, y1 = An.hipY + An.h * 0.30, w = An.wide;
      part(ctx, tag(function (g) {
        g.beginPath();
        g.moveTo(-w * 0.5, y0); g.lineTo(w * 0.5, y0);
        g.quadraticCurveTo(w * 0.75, (y0 + y1) / 2, w * 0.66, y1);
        g.quadraticCurveTo(0, y1 + 5, -w * 0.66, y1);
        g.quadraticCurveTo(-w * 0.75, (y0 + y1) / 2, -w * 0.5, y0);
        g.closePath();
      }, 0, (y0 + y1) / 2, w), c, { k: 0.22, rot: LIGHT });
      stroke(ctx, [0, y0 + 2, 2, (y0 + y1) / 2, 0, y1 - 2], sh(c, -0.24), 0.9, true);
      part(ctx, Pel(0, y0 + 1, w * 0.2, 3), p.accent, { k: 0.2, lw: 0.8 });
    },
    sash: function (ctx, An, cfg) {
      var p = cfg.pal, y = An.hipY - 2, w = An.wide;
      part(ctx, tag(function (g) {
        g.beginPath();
        g.moveTo(-w * 0.9, y - 5); g.quadraticCurveTo(0, y - 1, w * 0.9, y - 6);
        g.lineTo(w * 0.86, y + 3); g.quadraticCurveTo(0, y + 8, -w * 0.86, y + 2);
        g.closePath();
      }, 0, y, w), vivid(p.main, 0.2), { k: 0.24 });
      part(ctx, Pblob([w * 0.5, y, w * 0.95, y + 6, w * 0.72, y + 18, w * 0.4, y + 8]),
           vivid(p.main, 0.1), { k: 0.24, lw: 0.85 });
    },
    apron: function (ctx, An, cfg) {
      var p = cfg.pal, y0 = An.chest[1] + 3, y1 = An.hipY + An.h * 0.22, w = An.wide * 0.86;
      part(ctx, tag(function (g) {
        g.beginPath();
        g.moveTo(-w * 0.44, y0); g.lineTo(w * 0.44, y0);
        g.quadraticCurveTo(w * 0.8, (y0 + y1) / 2, w * 0.72, y1);
        g.quadraticCurveTo(0, y1 + 4, -w * 0.72, y1);
        g.quadraticCurveTo(-w * 0.8, (y0 + y1) / 2, -w * 0.44, y0);
        g.closePath();
      }, 0, (y0 + y1) / 2, w), '#f4ead6', { k: 0.16, rot: LIGHT });
      part(ctx, Prr(0, (y0 + y1) / 2 + 3, w * 0.5, 8, 2), sh('#f4ead6', -0.1), { k: 0.14, lw: 0.8 });
      part(ctx, Pel(0, y0 + 1, w * 0.24, 3), p.accent, { k: 0.2, lw: 0.8 });
    },
    tabard: function (ctx, An, cfg) {
      var p = cfg.pal, y0 = An.chest[1] - 2, y1 = An.hipY + An.h * 0.20, w = An.wide * 0.62, i;
      part(ctx, Ppoly([-w * 0.5, y0, w * 0.5, y0, w * 0.62, y1, 0, y1 + 4, -w * 0.62, y1]),
           mx(p.cloth, p.main, 0.4), { k: 0.24, rot: LIGHT });
      for (i = 0; i < 3; i++) {
        part(ctx, Pstar(0, y0 + 8 + i * 11, 2.8, 4, 0.34), p.accent, { k: 0.16, lw: 0.6 });
      }
    }
  };

  // ==========================================================================
  // CORPO — peças compartilhadas (braços, pernas, mãos, pés, rosto)
  //
  // PROPORÇÃO (reescrita v3): cartoon exagerado de ~3 CABEÇAS de altura, do
  // jeito do Dofus 1.29 — cabeça grande, tronco compacto, pernas curtas e
  // grossas, MÃOS E PÉS GRANDES. É o exagero que dá carisma e legibilidade em
  // 96 px de tela. Nada de proporção realista.
  //
  // TRAÇO: peso variável. `LW_OUT` (silhueta externa) é bem mais grosso que
  // `LW_IN` (detalhe interno) — é o que faz o desenho "fechar" longe da tela.
  // SOMBRA: três tons CHAPADOS bem separados (base · sombra · luz), sem
  // degradê. `part(..., {k, hi})` corta os três com borda dura.
  // ==========================================================================
  var W_OUT = 1.3;    // multiplicador de contorno da silhueta
  var W_MID = 0.95;   // peças internas grandes (braços, pernas)
  var W_IN  = 0.65;   // detalhe fino

  function drawArm(ctx, a, col, ink) {
    part(ctx, Pcap(a.sh[0], a.sh[1], a.r0, a.el[0], a.el[1], a.r1), col, { k: 0.3, hi: 0.16, lw: W_MID });
    part(ctx, Pcap(a.el[0], a.el[1], a.r1, a.hd[0], a.hd[1], a.r1 * 0.94), col, { k: 0.3, hi: 0.14, lw: W_MID });
    // vinco do cotovelo: traço anatômico de nanquim, não contorno de peça
    if (ink) {
      var dx = a.hd[0] - a.el[0], dy = a.hd[1] - a.el[1];
      var L = Math.sqrt(dx * dx + dy * dy) || 1;
      var nx = -dy / L, ny = dx / L;
      inkStroke(ctx, [a.el[0] - nx * a.r1 * 0.8, a.el[1] - ny * a.r1 * 0.8,
                      a.el[0] + nx * a.r1 * 0.2, a.el[1] + ny * a.r1 * 0.2], a.r1 * 0.3, ink);
    }
  }
  // mão GRANDE, tipo luva de desenho — com o corte do polegar para ler o gesto
  function drawHand(ctx, a, col, open) {
    part(ctx, Pel(a.hd[0], a.hd[1], a.hr, a.hr * 0.96), col, { k: 0.28, hi: 0.24, lw: W_MID });
    if (open) {
      stroke(ctx, [a.hd[0] - a.hr * 0.5, a.hd[1] - a.hr * 0.1,
                   a.hd[0] + a.hr * 0.1, a.hd[1] - a.hr * 0.45], sh(col, -0.4), W_IN);
    } else {
      stroke(ctx, [a.hd[0] - a.hr * 0.62, a.hd[1] - a.hr * 0.16,
                   a.hd[0] + a.hr * 0.5, a.hd[1] - a.hr * 0.3], sh(col, -0.42), W_IN);
      stroke(ctx, [a.hd[0] - a.hr * 0.5, a.hd[1] + a.hr * 0.3,
                   a.hd[0] + a.hr * 0.44, a.hd[1] + a.hr * 0.2], sh(col, -0.34), W_IN * 0.8);
    }
  }
  function drawLeg(ctx, l, col, footCol) {
    part(ctx, Pcap(l.hip[0], l.hip[1], l.r0, l.knee[0], l.knee[1], l.r1), col, { k: 0.3, hi: 0.14, lw: W_MID });
    part(ctx, Pcap(l.knee[0], l.knee[1], l.r1, l.ank[0], l.ank[1], l.r1 * 0.9), col, { k: 0.3, hi: 0.12, lw: W_MID });
    if (l.foot) {
      // pé grande e chato: a base larga é o que "planta" o boneco no chão
      part(ctx, tag(function (g) {
        var f = l.foot, w = f[2], hgt = f[3], d = l.footDir == null ? 1 : l.footDir;
        g.beginPath();
        g.moveTo(f[0] - d * w * 0.42, f[1] - hgt);
        g.quadraticCurveTo(f[0] + d * w * 0.72, f[1] - hgt * 1.25, f[0] + d * w * 0.7, f[1] - hgt * 0.16);
        g.quadraticCurveTo(f[0] + d * w * 0.4, f[1] + hgt * 0.42, f[0] - d * w * 0.2, f[1] + hgt * 0.36);
        g.quadraticCurveTo(f[0] - d * w * 0.56, f[1] + hgt * 0.2, f[0] - d * w * 0.42, f[1] - hgt);
        g.closePath();
      }, l.foot[0], l.foot[1] - l.foot[3] * 0.3, l.foot[2] * 0.6), footCol,
        { k: 0.32, hi: 0.16, lw: W_MID });
    }
  }
  // olho de desenho: branco grande, íris colorida, pupila e brilho — o que faz
  // o jogador achar o personagem simpático.
  function eye(ctx, x, y, rx, ry, col, look, iris) {
    look = look == null ? 0.26 : look;
    part(ctx, Pel(x, y, rx, ry), '#fdfaf2', { k: 0.06, lw: W_IN * 1.1, line: '#3a2a33', keepLine: true });
    if (iris) flat(ctx, Pel(x + rx * look, y + ry * 0.06, rx * 0.62, ry * 0.72), iris);
    flat(ctx, Pel(x + rx * look, y + ry * 0.08, rx * 0.44, ry * 0.56), col || '#2a2028');
    flat(ctx, Pel(x + rx * look - rx * 0.16, y - ry * 0.34, rx * 0.24, ry * 0.26), 'rgba(255,255,255,0.95)');
  }
  // ------------------------------------------------------------------ ROSTO
  // O rosto é o que faz o jogador GOSTAR do personagem, então é grande e
  // legível: olhos ~1/4 da cabeça, sobrancelha marcando a emoção e boca clara.
  // Cada classe recebe uma FICHA de expressão (EXPR) em vez de um estilo fixo.
  var INK = '#2b2028';
  var EXPR = {
    // eye: raio relativo · brow: [inclinação, altura] · mouth: forma · look: direção da pupila
    grim:  { eyeR: 0.20, eyeH: 0.20, brow: [0.42, -0.44], browW: 1.9, mouth: 'grit',  iris: '#7a4a22' },
    sharp: { eyeR: 0.20, eyeH: 0.22, brow: [0.22, -0.48], browW: 1.6, mouth: 'calm',  iris: '#4a8a52' },
    glow:  { eyeR: 0, eyeH: 0, brow: [0, 0], mouth: 'sly', glowEyes: true },
    grin:  { eyeR: 0.19, eyeH: 0.17, brow: [-0.2, -0.5], browW: 1.6, mouth: 'mask',   iris: '#4a7ab0' },
    cute:  { eyeR: 0.26, eyeH: 0.30, brow: [-0.16, -0.62], browW: 1.3, mouth: 'smile', iris: '#8a5aa8', blush: true },
    odd:   { eyeR: 0.22, eyeH: 0.24, brow: [-0.34, -0.5], browW: 1.5, mouth: 'open',  iris: '#3aa89a' }
  };
  function mouthShape(ctx, kind, cx, cy, r, p) {
    var col = '#7a3a38';
    if (kind === 'smile') {
      stroke(ctx, [cx - r * 0.3, cy + r * 0.36, cx + r * 0.02, cy + r * 0.58, cx + r * 0.34, cy + r * 0.34], col, W_IN * 1.9, true);
    } else if (kind === 'grit') {
      // boca de esforço: retângulo com dentes — o Sumô concentrado
      part(ctx, tag(function (g) {
        g.beginPath();
        g.moveTo(cx - r * 0.42, cy + r * 0.42);
        g.quadraticCurveTo(cx, cy + r * 0.3, cx + r * 0.42, cy + r * 0.42);
        g.quadraticCurveTo(cx, cy + r * 0.72, cx - r * 0.42, cy + r * 0.42);
        g.closePath();
      }, cx, cy + r * 0.5, r * 0.42), '#5e2a2c', { k: 0.14, lw: W_IN * 1.4, line: '#3a1a1c', keepLine: true });
      stroke(ctx, [cx - r * 0.3, cy + r * 0.44, cx + r * 0.3, cy + r * 0.44], '#f4ecd8', W_IN * 1.2);
    } else if (kind === 'open') {
      part(ctx, Pel(cx + r * 0.06, cy + r * 0.48, r * 0.2, r * 0.16), '#5e2a2c',
           { k: 0.12, lw: W_IN * 1.2, keepLine: true });
    } else if (kind === 'sly') {
      stroke(ctx, [cx - r * 0.26, cy + r * 0.5, cx + r * 0.1, cy + r * 0.42, cx + r * 0.34, cy + r * 0.54], col, W_IN * 1.6, true);
    } else if (kind === 'mask') {
      /* coberta pela meia-máscara */
    } else {
      stroke(ctx, [cx - r * 0.1, cy + r * 0.46, cx + r * 0.32, cy + r * 0.4], col, W_IN * 1.6);
    }
  }
  function drawFace(ctx, An, cfg, style) {
    if (cfg.back) return;
    var h = An.head, r = h[2], p = cfg.pal;
    var e = EXPR[style] || EXPR.sharp;
    var mood = cfg.mood || null;          // a pose pode trocar a emoção
    var cx = h[0] + r * 0.14, cy = h[1] + r * 0.16;
    var ex = r * 0.38;
    var browTilt = e.brow ? e.brow[0] : 0;
    var browY = e.brow ? e.brow[1] : -0.45;
    var mouth = e.mouth;
    if (mood === 'grito') { browTilt += 0.3; mouth = 'open'; }
    else if (mood === 'dor') { browTilt -= 0.42; mouth = 'open'; }
    else if (mood === 'morto') { mouth = 'calm'; }

    if (style === 'mask') return;

    // --- olhos acesos sob a aba do chapéu (bruxo)
    if (e.glowEyes) {
      ctx.save();
      Pel(h[0], h[1], r * 1.02, r * 1.06)(ctx); ctx.clip();
      flat(ctx, Prr(h[0], h[1] - r * 0.16, r * 2.6, r * 1.6, 0), 'rgba(22,12,28,0.88)');
      ctx.restore();
      glow(ctx, cx - ex, cy - r * 0.06, r * 0.8, p.accent, 0.85);
      glow(ctx, cx + ex, cy - r * 0.1, r * 0.76, p.accent, 0.85);
      part(ctx, Pel(cx - ex, cy - r * 0.06, r * 0.26, r * 0.14, -0.22), sh(p.accent, 0.6),
           { flat: true, lw: W_IN * 1.2, line: p.accent });
      part(ctx, Pel(cx + ex, cy - r * 0.1, r * 0.25, r * 0.13, -0.22), sh(p.accent, 0.6),
           { flat: true, lw: W_IN * 1.2, line: p.accent });
      mouthShape(ctx, mouth, cx, cy, r, p);
      return;
    }

    // --- meia-máscara do assassino (fica ATRÁS dos olhos)
    if (style === 'grin') {
      part(ctx, tag(function (g) {
        g.beginPath();
        g.moveTo(cx - r * 0.9, cy + r * 0.1);
        g.quadraticCurveTo(cx, cy + r * 0.02, cx + r * 0.9, cy + r * 0.04);
        g.quadraticCurveTo(cx + r * 0.6, cy + r * 0.92, cx - r * 0.06, cy + r * 0.9);
        g.quadraticCurveTo(cx - r * 0.76, cy + r * 0.72, cx - r * 0.9, cy + r * 0.1);
        g.closePath();
      }, cx, cy + r * 0.45, r * 0.9), mx(p.cloth, p.dark, 0.5), { k: 0.28, hi: 0.12, lw: W_MID });
    }

    var eyY = cy - r * 0.04;
    eye(ctx, cx - ex, eyY + r * 0.02, r * e.eyeR, r * e.eyeH, INK, 0.24, e.iris);
    eye(ctx, cx + ex, eyY - r * 0.02, r * e.eyeR, r * e.eyeH, INK, 0.24, e.iris);

    // sobrancelhas — o traço que carrega a emoção
    var bw = (e.browW || 1.6) * r * 0.24;
    var by = cy + r * browY;
    stroke(ctx, [cx - ex - bw * 0.5, by - browTilt * r * 0.5,
                 cx - ex + bw * 0.5, by + browTilt * r * 0.34], INK, W_IN * 2.4);
    stroke(ctx, [cx + ex - bw * 0.5, by + browTilt * r * 0.34,
                 cx + ex + bw * 0.5, by - browTilt * r * 0.5], INK, W_IN * 2.4);

    if (e.blush) {
      flat(ctx, Pel(cx - ex * 1.72, cy + r * 0.3, r * 0.19, r * 0.12), rgba('#ff8fa8', 0.62));
      flat(ctx, Pel(cx + ex * 1.72, cy + r * 0.28, r * 0.19, r * 0.12), rgba('#ff8fa8', 0.62));
    }
    if (style !== 'grin' || mood) mouthShape(ctx, mouth, cx, cy, r, p);
  }
  // nuca (vista de costas): massa de cabelo + gola
  function drawNape(ctx, An, cfg) {
    var h = An.head, r = h[2], p = cfg.pal;
    var c = sh(p.hair, -0.22);
    part(ctx, Pblob([h[0] - r * 0.84, h[1] + r * 0.38, h[0] - r * 0.9, h[1] - r * 0.42,
                     h[0] - r * 0.26, h[1] - r * 0.92, h[0] + r * 0.5, h[1] - r * 0.88,
                     h[0] + r * 0.9, h[1] - r * 0.26, h[0] + r * 0.82, h[1] + r * 0.44]), c, { k: 0.24 });
    stroke(ctx, [h[0] - r * 0.34, h[1] - r * 0.42, h[0] - r * 0.16, h[1] + r * 0.24], sh(c, -0.3), 0.85);
    stroke(ctx, [h[0] + r * 0.28, h[1] - r * 0.46, h[0] + r * 0.4, h[1] + r * 0.2], sh(c, -0.3), 0.85);
  }
  function elfEars(ctx, An, cfg) {
    var h = An.head, r = h[2], p = cfg.pal;
    part(ctx, Ppoly([h[0] - r * 0.86, h[1] - r * 0.02, h[0] - r * 1.66, h[1] - r * 0.78,
                     h[0] - r * 0.8, h[1] + r * 0.32]), An.skin, { k: 0.24, lw: 0.85 });
    part(ctx, Ppoly([h[0] + r * 0.88, h[1] - r * 0.06, h[0] + r * 1.7, h[1] - r * 0.82,
                     h[0] + r * 0.82, h[1] + r * 0.28]), An.skin, { k: 0.24, lw: 0.85 });
  }
  // crânio padrão (oval). O rosto vem depois, em paintUnit.
  function drawHead(ctx, An, cfg) {
    var h = An.head, r = h[2];
    part(ctx, Pcap(An.neck[0], An.neck[1] + 3, r * 0.42, h[0], h[1] + r * 0.5, r * 0.5),
         sh(An.skin, -0.1), { k: 0.2, lw: 0.85 });
    part(ctx, Pel(h[0], h[1], r, r * 1.04), An.skin, { k: 0.2, hi: 0.18 });
    if (cfg.acc.ears) elfEars(ctx, An, cfg);
    if (cfg.back) drawNape(ctx, An, cfg);
  }

  // ==========================================================================
  // AS SEIS CLASSES — plano de corpo + pintura
  // Cada plano devolve ÂNCORAS; o resto (acessórios, elemento, fusão) se apoia
  // nelas, o que permite montar qualquer combinação sem redesenhar nada.
  // ==========================================================================
  // RIG — esqueleto paramétrico de ~5 CABEÇAS (revisão v4, pela referência do
  // Dofus). Corpo ESGUIO E ADULTO: pernas longas, tronco enxuto, cabeça só um
  // pouco maior que o realista — nada de chibi de bebê. Mãos e pés continuam
  // generosos (saem do raio da cabeça), porque é o que dá leitura de desenho.
  // O Sumô é a exceção declarada: ~4 cabeças e corpo largo e pesado.
  // Os ombros/quadril saem desalinhados de propósito: nenhum herói em pose de
  // manequim.
  // ==========================================================================
  function rig(cfg, o) {
    var p = cfg.pal;
    var H = o.h;
    var hr = H * (o.headR || 0.105);            // ~4,8 cabeças
    var An = { h: H, headR: hr, wide: o.wide };
    An.skin = mx(p.skin, p.el.c, p.elId === 'neutro' ? 0 : (o.elSkin == null ? 0.1 : o.elSkin));

    var lean = o.lean || 0;                     // inclinação do tronco (atitude)
    var hx = (o.hx || 0) + lean * H * 0.06;
    var hy = -(H - hr * 1.02);
    An.head = [hx, hy, hr];
    An.neck = [hx * 0.7, hy + hr * 0.92];
    An.hipY = -H * (o.hip || 0.47);             // pernas LONGAS
    An.hipC = [lean * H * 0.02, An.hipY - H * 0.02];
    An.chest = [hx * 0.4, (An.neck[1] + An.hipY) * 0.5];
    An.backC = [An.chest[0] - o.wide * 0.14, An.chest[1]];

    // ombros: o de trás sobe um pouco (atitude), o da frente cai
    var shY = An.neck[1] + hr * 0.28;
    var tilt = (o.shTilt == null ? 0.12 : o.shTilt) * hr;
    An.shN = [o.wide * 0.95 + hx * 0.3, shY - tilt];
    An.shF = [-o.wide * 0.95 + hx * 0.3, shY + tilt];

    var aL = H * (o.armLen || 0.36);            // braço longo, mão generosa
    var aR = hr * (o.armR || 0.36);
    var handR = hr * (o.handR || 0.6);          // MÃO GRANDE
    An.armN = { sh: An.shN.slice(), r0: aR, r1: aR * 0.84, hr: handR,
                el: [An.shN[0] + o.wide * 0.42, An.shN[1] + aL * 0.5],
                hd: [An.shN[0] + o.wide * 0.28, An.shN[1] + aL] };
    An.armF = { sh: An.shF.slice(), r0: aR * 0.94, r1: aR * 0.8, hr: handR * 0.94,
                el: [An.shF[0] - o.wide * 0.4, An.shF[1] + aL * 0.5],
                hd: [An.shF[0] - o.wide * 0.24, An.shF[1] + aL * 0.98] };

    if (o.legs === false) { An.legN = null; An.legF = null; }
    else {
      var stance = o.stance == null ? 0.5 : o.stance;   // abertura das pernas
      var lR = hr * (o.legR || 0.5);
      var fw = hr * (o.footW || 1.5), fh = hr * (o.footH || 0.5);
      var weight = o.weight == null ? 1 : o.weight;     // peso na perna de trás
      An.legN = { hip: [o.wide * stance, An.hipY], r0: lR, r1: lR * 0.8,
                  knee: [o.wide * (stance + 0.18), An.hipY * 0.46],
                  ank: [o.wide * (stance + 0.12), -H * 0.045],
                  foot: [o.wide * (stance + 0.2), -H * 0.006, fw, fh], footDir: 1 };
      An.legF = { hip: [-o.wide * stance * 0.86, An.hipY], r0: lR * 0.94, r1: lR * 0.76,
                  knee: [-o.wide * (stance + 0.22) * weight, An.hipY * 0.5],
                  ank: [-o.wide * (stance + 0.3) * weight, -H * 0.05],
                  foot: [-o.wide * (stance + 0.36) * weight, -H * 0.008, fw * 0.94, fh * 0.94], footDir: -1 };
    }
    An.handN = An.armN.hd; An.handF = An.armF.hd;
    // membros um tom abaixo do tronco: pele sobre pele precisa de separação,
    // senão o braço some dentro da barriga. A separação é por TEMPERATURA
    // (mais terracota), nunca por cinza.
    An.skinSh = wsh(An.skin, 0.30);
    An.skinHi = whi(An.skin, 0.24);
    An.armCol = wsh(An.skin, 0.13); An.legCol = wsh(An.skin, 0.19); An.handCol = An.skin;
    An.footCol = mx(p.dark, An.skin, 0.3);
    // cor do nanquim: sépia escuro e QUENTE, tirado da própria carne — nunca
    // preto neutro (o preto endurece e esfria o desenho)
    An.ink = sh(wsh(An.skin, 0.86), -0.46);
    return An;
  }

  // ==========================================================================
  var PLANS = {};

  // ------------------------------------------------------------------- SUMÔ
  // ATITUDE: pés plantados largos, peso atrás, tronco enorme jogado à frente,
  // um punho fechado erguido na altura do peito. Já se lê "tanque" na silhueta.
  PLANS.sumo = {
    face: 'grim',
    anchors: function (cfg) {
      // ~4 cabeças, massa pesada: torso enorme, pernas CURTAS e troncudas,
      // braços grossos afastados do corpo, mãos e pés grandes.
      var An = rig(cfg, { h: 106, wide: 20, headR: 0.14, hip: 0.36, armLen: 0.36,
                          armR: 0.56, handR: 0.78, legR: 0.92, footW: 1.42, footH: 0.5,
                          stance: 0.95, weight: 1.0, shTilt: 0.1, lean: 0.05, elSkin: 0.12 });
      // ATITUDE da referência: braços AFASTADOS do corpo, cotovelos abertos,
      // mãos longe da barriga — silhueta de lutador pronto, e cada braço lê
      // separado do tronco sem precisar de linha entre eles.
      An.armF.el = [An.shF[0] - An.wide * 0.95, An.shF[1] + An.h * 0.11];
      An.armF.hd = [An.shF[0] - An.wide * 1.02, An.shF[1] + An.h * 0.26];
      An.handF = An.armF.hd;
      An.armN.el = [An.shN[0] + An.wide * 1.0, An.shN[1] + An.h * 0.12];
      An.armN.hd = [An.shN[0] + An.wide * 1.08, An.shN[1] + An.h * 0.27];
      An.handN = An.armN.hd;
      // peso na perna de trás, pé da frente adiantado e virado
      An.legF.knee = [An.legF.knee[0] - 2, An.legF.knee[1]];
      An.legF.ank = [An.legF.ank[0] - 5, An.legF.ank[1]];
      An.legF.foot = [An.legF.foot[0] - 7, An.legF.foot[1], An.legF.foot[2] * 1.1, An.legF.foot[3]];
      An.legN.ank = [An.legN.ank[0] + 3, An.legN.ank[1]];
      An.legN.foot = [An.legN.foot[0] + 4, An.legN.foot[1], An.legN.foot[2], An.legN.foot[3]];
      return An;
    },
    torso: function (ctx, An, cfg) {
      var s = An.skin, W = An.wide, hipY = An.hipY, chY = An.neck[1] + 3;
      var mid = (chY + hipY) * 0.5;
      var ink = An.ink;
      // BARRIGÃO: a massa é o personagem. Ombros largos, barriga caindo sobre
      // o cinto, quadril estreito — silhueta de pera bem marcada.
      part(ctx, Pblob([-W * 1.26, mid + 6, -W * 1.04, chY + 8, -W * 0.6, chY - 7,
                       0, chY - 11, W * 0.6, chY - 7, W * 1.06, chY + 8,
                       W * 1.32, mid + 6, W * 0.96, hipY + 6, 0, hipY + 10, -W * 0.98, hipY + 6]),
           s, { k: 0.26, hi: 0.16, lw: W_OUT, rot: LIGHT });
      // sombreado MÍNIMO: só sob a barriga (uma área chapada, sem degradê)
      part(ctx, tag(function (g) {
        g.beginPath();
        g.moveTo(-W * 1.04, mid + 2);
        g.quadraticCurveTo(0, mid + 20, W * 1.08, mid + 2);
        g.quadraticCurveTo(0, mid + 8, -W * 1.04, mid + 2);
        g.closePath();
      }, 0, mid + 8, W), sh(s, -0.14), { flat: true, noline: true });
      if (cfg.back) {
        // COSTAS: omoplatas e o sulco da coluna, em nanquim
        inkStroke(ctx, [-W * 0.6, chY + 4, -W * 0.34, chY + 16, -W * 0.5, mid - 2], 1.5, ink);
        inkStroke(ctx, [W * 0.62, chY + 4, W * 0.36, chY + 16, W * 0.52, mid - 2], 1.5, ink);
        inkStroke(ctx, [0, chY + 2, W * 0.06, mid, 0, hipY - 4], 1.6, ink);
        return;
      }
      // FRENTE: curva do peitoral e dobra da barriga — traço anatômico, não
      // contorno de peça. Espessura variável, grossa no meio.
      inkStroke(ctx, [-W * 0.86, mid - 10, -W * 0.3, mid + 1, 0, mid + 2,
                      W * 0.32, mid + 1, W * 0.88, mid - 10], 2.1, ink);
      inkStroke(ctx, [-W * 0.5, hipY - 9, 0, hipY - 4, W * 0.52, hipY - 10], 1.5, ink);
      part(ctx, Pel(-1, hipY - 7, An.headR * 0.22, An.headR * 0.15), ink, { flat: true, noline: true });
      // vinco entre o braço e o tronco (só sombra, nunca linha fechada)
      flat(ctx, Pel(-W * 1.0, chY + 16, W * 0.26, W * 0.52, 0.18), rgba(sh(s, -0.5), 0.26));
      flat(ctx, Pel(W * 1.04, chY + 16, W * 0.26, W * 0.52, -0.18), rgba(sh(s, -0.5), 0.2));
      // MARCAS VERMELHAS de lutador nos ombros
      var mk = '#c8452e';
      inkStroke(ctx, [-W * 0.82, chY + 2, -W * 0.62, chY + 9], 1.5, mk);
      inkStroke(ctx, [-W * 0.6, chY - 1, -W * 0.4, chY + 6], 1.2, mk);
      inkStroke(ctx, [W * 0.84, chY + 2, W * 0.64, chY + 9], 1.5, mk);
      inkStroke(ctx, [W * 0.62, chY - 1, W * 0.42, chY + 6], 1.2, mk);
    },
    head: function (ctx, An, cfg) {
      var h = An.head, r = h[2], s = An.skin, ink = An.ink;
      // pescoço grosso engolido pelos ombros
      part(ctx, Pcap(An.neck[0], An.neck[1] + r * 0.5, r * 0.52, h[0], h[1] + r * 0.5, r * 0.6),
           sh(s, -0.08), { k: 0.2, lw: W_MID });
      // cabeça larga de lutador, com mandíbula e bochechas
      part(ctx, Pblob([h[0] - r * 1.0, h[1] - r * 0.18, h[0] - r * 0.78, h[1] - r * 0.9,
                       h[0], h[1] - r * 1.08, h[0] + r * 0.78, h[1] - r * 0.88,
                       h[0] + r * 1.02, h[1] - r * 0.16, h[0] + r * 0.9, h[1] + r * 0.68,
                       h[0], h[1] + r * 1.04, h[0] - r * 0.88, h[1] + r * 0.66]),
           s, { k: 0.22, hi: 0.18, lw: W_OUT });
      // ORELHAS PONTUDAS (a referência tem)
      part(ctx, Ppoly([h[0] - r * 0.9, h[1] - r * 0.04, h[0] - r * 1.6, h[1] - r * 0.6,
                       h[0] - r * 0.84, h[1] + r * 0.4]), sh(s, -0.05), { k: 0.22, lw: W_MID });
      part(ctx, Ppoly([h[0] + r * 0.92, h[1] - r * 0.08, h[0] + r * 1.62, h[1] - r * 0.64,
                       h[0] + r * 0.86, h[1] + r * 0.36]), s, { k: 0.22, lw: W_MID });
      inkStroke(ctx, [h[0] + r * 1.02, h[1] - r * 0.06, h[0] + r * 1.3, h[1] - r * 0.38], 0.9, ink);
      if (cfg.back) {
        // de costas: nuca e a base da trança
        part(ctx, Pel(h[0], h[1] + r * 0.1, r * 0.86, r * 0.9), sh(An.cfg.pal.hair, -0.05),
             { k: 0.24, hi: 0.12, lw: W_MID });
        inkStroke(ctx, [h[0] - r * 0.4, h[1] - r * 0.5, h[0] - r * 0.2, h[1] + r * 0.5], 1.1, ink);
        inkStroke(ctx, [h[0] + r * 0.36, h[1] - r * 0.54, h[0] + r * 0.2, h[1] + r * 0.46], 1.1, ink);
      }
    }
  };

  // ------------------------------------------------------------ ELFO ARQUEIRO
  PLANS.arqueiro = {
    face: 'sharp',
    anchors: function (cfg) {
      var p = cfg.pal;
      var An = { h: 108, wide: 17, skin: mx(p.skin, p.el.c, p.elId === 'neutro' ? 0 : 0.08) };
      An.head = [3, -92, 11]; An.neck = [2, -80]; An.chest = [0, -70];
      An.hipY = -50; An.hipC = [0, -52]; An.backC = [-2, -66];
      An.shN = [15, -76]; An.shF = [-13, -76];
      An.armN = { sh: [14, -76], el: [24, -66], hd: [19, -55], r0: 4.6, r1: 3.7, hr: 4.8 };
      An.armF = { sh: [-13, -76], el: [-21, -66], hd: [-17, -54], r0: 4.3, r1: 3.5, hr: 4.5 };
      An.legN = { hip: [8, -50], knee: [11, -27], ank: [10, -5], r0: 5.6, r1: 4.2, foot: [11, -1, 13, 5] };
      An.legF = { hip: [-8, -50], knee: [-13, -28], ank: [-13, -6], r0: 5.4, r1: 4.0, foot: [-14, -2, 12, 4.6] };
      An.armCol = mx(p.main, p.cloth, 0.4); An.legCol = mx(p.dark, p.main, 0.24);
      An.handCol = An.skin; An.footCol = p.leather;
      An.handN = An.armN.hd; An.handF = An.armF.hd;
      return An;
    },
    torso: function (ctx, An, cfg) {
      var p = cfg.pal;
      part(ctx, Pblob([-16, -60, -15, -76, -6, -82, 6, -82, 15, -76, 16, -60,
                       12, -46, 0, -43, -12, -46]), p.main, { k: 0.24, hi: 0.14, rot: LIGHT });
      // gola em folha
      part(ctx, Ppoly([-9, -80, 0, -74, 9, -80, 6, -70, -6, -70]), mx(p.main, p.accent, 0.4), { k: 0.2, lw: 0.85 });
      stroke(ctx, [0, -72, 0, -48], sh(p.main, -0.28), 0.8);
    },
    head: function (ctx, An, cfg) {
      drawHead(ctx, An, cfg);
    }
  };

  // ------------------------------------------------------------------ BRUXO
  PLANS.bruxo = {
    face: 'glow',
    anchors: function (cfg) {
      var p = cfg.pal;
      var An = { h: 100, wide: 22, skin: p.skin };
      An.head = [2, -84, 11]; An.neck = [1, -73]; An.chest = [0, -66];
      An.hipY = -48; An.hipC = [0, -50]; An.backC = [-2, -62];
      An.shN = [15, -70]; An.shF = [-13, -70];
      An.armN = { sh: [14, -70], el: [24, -60], hd: [20, -50], r0: 5.8, r1: 4.6, hr: 4.8 };
      An.armF = { sh: [-13, -70], el: [-22, -61], hd: [-18, -50], r0: 5.5, r1: 4.4, hr: 4.5 };
      An.legN = null; An.legF = null;    // manto até o chão
      An.armCol = mx(p.main, p.cloth, 0.5); An.handCol = An.skin;
      An.handN = An.armN.hd; An.handF = An.armF.hd;
      return An;
    },
    torso: function (ctx, An, cfg) {
      var p = cfg.pal, c = mx(p.main, p.cloth, 0.3);
      // sino do manto: a silhueta que identifica o mago de longe
      part(ctx, tag(function (g) {
        g.beginPath();
        g.moveTo(-14, -70);
        g.quadraticCurveTo(-19, -40, -25, -6);
        g.quadraticCurveTo(-12, 1, 0, -1);
        g.quadraticCurveTo(13, 1, 25, -6);
        g.quadraticCurveTo(19, -40, 14, -70);
        g.quadraticCurveTo(0, -76, -14, -70);
        g.closePath();
      }, 0, -36, 26), c, { k: 0.22, hi: 0.1, rot: LIGHT });
      stroke(ctx, [-8, -62, -12, -34, -15, -4], sh(c, -0.26), 0.9, true);
      stroke(ctx, [9, -62, 13, -34, 16, -5], sh(c, -0.26), 0.9, true);
      // barra iluminada
      part(ctx, tag(function (g) {
        g.beginPath();
        g.moveTo(-25, -6); g.quadraticCurveTo(0, 2, 25, -6);
        g.quadraticCurveTo(0, -3, -25, -6); g.closePath();
      }, 0, -4, 25), p.accent, { k: 0.18, lw: 0.8 });
    },
    head: function (ctx, An, cfg) {
      drawHead(ctx, An, cfg);
    }
  };

  // ------------------------------------------------------------- ESPADACHIM
  PLANS.espadachim = {
    face: 'grin',
    anchors: function (cfg) {
      var p = cfg.pal;
      var An = { h: 104, wide: 17, skin: p.skin };
      An.head = [5, -90, 11]; An.neck = [4, -78]; An.chest = [2, -68];
      An.hipY = -48; An.hipC = [1, -50]; An.backC = [-1, -64];
      An.shN = [16, -74]; An.shF = [-11, -74];
      An.armN = { sh: [15, -74], el: [26, -66], hd: [24, -53], r0: 4.7, r1: 3.8, hr: 4.8 };
      An.armF = { sh: [-11, -74], el: [-21, -64], hd: [-15, -52], r0: 4.4, r1: 3.6, hr: 4.5 };
      An.legN = { hip: [9, -48], knee: [16, -26], ank: [17, -5], r0: 5.6, r1: 4.2, foot: [18, -1, 14, 6] };
      An.legF = { hip: [-7, -48], knee: [-14, -28], ank: [-17, -6], r0: 5.4, r1: 4.0, foot: [-18, -2, 13, 5.4] };
      An.armCol = mx(p.cloth, p.dark, 0.3); An.legCol = mx(p.dark, p.main, 0.3);
      An.handCol = An.skin; An.footCol = mx(p.dark, '#000', 0.1);
      An.handN = An.armN.hd; An.handF = An.armF.hd;
      return An;
    },
    torso: function (ctx, An, cfg) {
      var p = cfg.pal;
      part(ctx, Pblob([-13, -58, -13, -74, -4, -80, 8, -80, 17, -74, 16, -58,
                       12, -46, 1, -43, -10, -46]), p.main, { k: 0.24, hi: 0.14, rot: LIGHT });
      // lapelas cruzadas
      part(ctx, Ppoly([-6, -78, 3, -70, 12, -78, 10, -50, -4, -50]), mx(p.main, p.dark, 0.42), { k: 0.22, lw: 0.85 });
      stroke(ctx, [-4, -74, 3, -68, 11, -74], p.accent, 0.8, true);
    },
    head: function (ctx, An, cfg) {
      drawHead(ctx, An, cfg);
    }
  };

  // ------------------------------------------------------------- CURANDEIRA
  PLANS.curandeira = {
    face: 'cute',
    anchors: function (cfg) {
      var p = cfg.pal;
      var An = { h: 80, wide: 15, skin: p.skin };
      An.head = [2, -58, 17]; An.neck = [2, -42]; An.chest = [0, -38];
      An.hipY = -26; An.hipC = [0, -28]; An.backC = [-2, -38];
      An.shN = [11, -40]; An.shF = [-9, -40];
      An.armN = { sh: [10, -40], el: [17, -34], hd: [15, -25], r0: 3.9, r1: 3.2, hr: 4.2 };
      An.armF = { sh: [-9, -40], el: [-16, -33], hd: [-13, -25], r0: 3.7, r1: 3.0, hr: 3.9 };
      An.legN = { hip: [6, -18], knee: [8, -10], ank: [8, -4], r0: 3.8, r1: 3.2, foot: [8, -1, 10, 4.4] };
      An.legF = { hip: [-6, -18], knee: [-9, -11], ank: [-9, -5], r0: 3.6, r1: 3.0, foot: [-10, -2, 9, 4] };
      An.armCol = mx(p.cloth, p.main, 0.35); An.legCol = '#f4ead6';
      An.handCol = An.skin; An.footCol = p.leather;
      An.handN = An.armN.hd; An.handF = An.armF.hd;
      return An;
    },
    torso: function (ctx, An, cfg) {
      var p = cfg.pal, c = mx(p.cloth, p.main, 0.3);
      part(ctx, tag(function (g) {
        g.beginPath();
        g.moveTo(-9, -42);
        g.quadraticCurveTo(-14, -28, -18, -6);
        g.quadraticCurveTo(-8, 0, 0, -1);
        g.quadraticCurveTo(9, 0, 18, -6);
        g.quadraticCurveTo(14, -28, 9, -42);
        g.quadraticCurveTo(0, -46, -9, -42);
        g.closePath();
      }, 0, -24, 19), c, { k: 0.22, hi: 0.12, rot: LIGHT });
      part(ctx, tag(function (g) {
        g.beginPath(); g.moveTo(-18, -6); g.quadraticCurveTo(0, 2, 18, -6);
        g.quadraticCurveTo(0, -3, -18, -6); g.closePath();
      }, 0, -4, 18), p.accent, { k: 0.18, lw: 0.8 });
      stroke(ctx, [-4, -40, -6, -22, -7, -6], sh(c, -0.24), 0.8, true);
    },
    head: function (ctx, An, cfg) {
      drawHead(ctx, An, cfg);
    }
  };

  // -------------------------------------------------------------- INVOCADOR
  PLANS.invocador = {
    face: 'mask',
    anchors: function (cfg) {
      var p = cfg.pal;
      var An = { h: 100, wide: 20, skin: p.skin };
      An.head = [2, -82, 12]; An.neck = [1, -71]; An.chest = [0, -64];
      An.hipY = -44; An.hipC = [0, -46]; An.backC = [-2, -62];
      An.shN = [16, -70]; An.shF = [-14, -70];
      An.armN = { sh: [15, -70], el: [26, -62], hd: [23, -51], r0: 5.6, r1: 4.4, hr: 4.6 };
      An.armF = { sh: [-14, -70], el: [-24, -62], hd: [-19, -52], r0: 5.3, r1: 4.2, hr: 4.3 };
      An.legN = null; An.legF = null;
      An.armCol = mx(p.cloth, p.main, 0.28); An.handCol = An.skin;
      An.handN = An.armN.hd; An.handF = An.armF.hd;
      return An;
    },
    torso: function (ctx, An, cfg) {
      var p = cfg.pal, c = mx(p.cloth, p.dark, 0.2), i;
      part(ctx, tag(function (g) {
        g.beginPath();
        g.moveTo(-15, -68);
        g.quadraticCurveTo(-20, -38, -23, -5);
        g.quadraticCurveTo(-11, 1, 0, -1);
        g.quadraticCurveTo(12, 1, 23, -5);
        g.quadraticCurveTo(20, -38, 15, -68);
        g.quadraticCurveTo(0, -74, -15, -68);
        g.closePath();
      }, 0, -36, 24), c, { k: 0.22, hi: 0.1, rot: LIGHT });
      // franjas de cordinha com contas
      for (i = -1; i <= 1; i++) {
        stroke(ctx, [i * 8, -56, i * 9.5, -46, i * 9, -36], sh(c, -0.3), 0.7, true);
        part(ctx, Pel(i * 9, -35, 2.0, 2.0), p.accent, { k: 0.16, lw: 0.6 });
      }
    },
    head: function (ctx, An, cfg) {
      drawHead(ctx, An, cfg);
    }
  };

  // ==========================================================================
  // KITS por classe e MONTAGEM DE FUSÃO
  // Base = classe de corpo mais marcante (rank); a outra entra pelos adereços.
  // Cobre as 15 duplas sem desenhar nenhuma à mão.
  // ==========================================================================
  var KIT = {
    sumo:       { head: 'capBraid', torso: 'hipCloth', weapon: null,  back: null,     face: 'grim',  ears: false,
                  wrap: true, layers: ['hipCloth', 'beltBuckle'] },
    arqueiro:   { head: 'hood',    torso: 'baldric', weapon: 'bow',   back: 'quiver', face: 'sharp', ears: true },
    bruxo:      { head: 'wizhat',  torso: 'robe',    weapon: 'staff', back: 'cape',   face: 'glow',  ears: false },
    espadachim: { head: 'bandana', torso: 'sash',    weapon: 'sword', back: 'scarf',  face: 'grin',  ears: false },
    curandeira: { head: 'buns',    torso: 'apron',   weapon: 'wand',  back: null,     face: 'cute',  ears: false },
    invocador:  { head: 'mask',    torso: 'tabard',  weapon: 'tome',  back: 'totem',  face: 'mask',  ears: false }
  };
  // quanto o corpo da classe é "dono" da silhueta
  var BODY_RANK = { sumo: 6, arqueiro: 4, espadachim: 3.5, curandeira: 3, bruxo: 2.5, invocador: 2 };
  A.KIT = KIT;

  function baseCfg(classId, els) {
    var k = KIT[classId] || KIT.sumo;
    return {
      base: PLANS[classId] ? classId : 'sumo',
      pal: classPal(classId, els),
      acc: { head: k.head, torso: k.torso, weapon: k.weapon, back: k.back, face: k.face,
             ears: k.ears, wrap: k.wrap, layers: k.layers },
      fusion: false
    };
  }
  function fusionCfg(ca, cb, els) {
    var ra = BODY_RANK[ca] || 1, rb = BODY_RANK[cb] || 1;
    var dom = (ra > rb || (ra === rb && ca < cb)) ? ca : cb;
    var rec = dom === ca ? cb : ca;
    var kd = KIT[dom] || KIT.sumo, kr = KIT[rec] || KIT.sumo;
    // paleta: corpo do dominante puxado para a cor do recessivo + os 2 elementos
    var pd = classPal(dom, els), pr = classPal(rec, [els[1] || els[0]]);
    var pal = pd;
    pal.main = mx(pd.main, pr.main, 0.38);
    pal.cloth = mx(pd.cloth, pr.cloth, 0.45);
    pal.accent = mx(pd.accent, pr.accent, 0.5);
    pal.hair = pd.hair; pal.wood = mx(pd.wood, pr.wood, 0.4);
    pal.line = lineOf(pal.main);
    return {
      base: PLANS[dom] ? dom : 'sumo',
      pal: pal,
      acc: {
        // a máscara do invocador esconde o rosto: só vale quando ELE é o corpo
        head: (kr.head === 'mask' && dom !== 'invocador') ? kd.head : (kr.head || kd.head),
        torso: kd.torso,
        torso2: kr.torso !== kd.torso ? kr.torso : null,
        weapon: kr.weapon || kd.weapon,
        back: kr.back || kd.back,
        stow: kr.weapon && kd.weapon ? kd.weapon : null,
        stowBack: kr.back && kd.back && kr.back !== kd.back ? kd.back : null,
        face: kd.face === 'mask' && kr.face !== 'mask' ? kr.face : kd.face,
        ears: kd.ears || kr.ears
      },
      fusion: true, dom: dom, rec: rec
    };
  }

  // -------------------------------------------------------------- montagem
  function drawBackItems(ctx, An, cfg) {
    if (cfg.acc.stowBack && ACC.back[cfg.acc.stowBack]) ACC.back[cfg.acc.stowBack](ctx, An, cfg);
    if (cfg.acc.back && ACC.back[cfg.acc.back]) ACC.back[cfg.acc.back](ctx, An, cfg);
    if (cfg.acc.stow) drawStowed(ctx, An, cfg, cfg.acc.stow);
  }

  // ==========================================================================
  // POSE E ANIMAÇÃO — o esqueleto se move de verdade
  //
  // Entrega escolhida: QUADROS ASSADOS E CACHEADOS (`opts.pose`), não peças
  // soltas. O Renderer pede `Art.unit(defId, {pose:{fase, frame}})` ou
  // `Art.unitFrames(defId, opts, fase)` e monta um AnimatedSprite — uma textura
  // por quadro, cacheada, sem custo de montagem por frame no celular.
  //
  // O movimento é CINEMÁTICO, não um desenho novo por quadro: cada quadro
  // recalcula os ângulos das juntas (coxa/canela, ombro/cotovelo) e reposiciona
  // as âncoras. Por isso a perna anda de verdade e a arma acompanha a mão.
  // Poucos quadros e leitura clara, como no Dofus 1.29.
  // ==========================================================================
  var POSE = {
    idle:     { frames: 8, loop: true,  fps: 6,  name: 'Parado' },
    andar:    { frames: 8, loop: true,  fps: 11, name: 'Andar' },
    atacar:   { frames: 8, loop: false, fps: 14, name: 'Atacar' },
    conjurar: { frames: 8, loop: false, fps: 12, name: 'Conjurar' },
    dano:     { frames: 5, loop: false, fps: 14, name: 'Levar dano' },
    morte:    { frames: 7, loop: false, fps: 8,  name: 'Morrer' }
  };
  A.poseInfo = function () {
    var o = {}, k;
    for (k in POSE) o[k] = { frames: POSE[k].frames, loop: POSE[k].loop, fps: POSE[k].fps, name: POSE[k].name };
    return o;
  };
  A.poseNames = function () { var o = [], k; for (k in POSE) o.push(k); return o; };

  function ease(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
  function segAng(a, b) { return Math.atan2(b[0] - a[0], b[1] - a[1]); }   // 0 = para baixo
  function segLen(a, b) { var dx = b[0] - a[0], dy = b[1] - a[1]; return Math.sqrt(dx * dx + dy * dy); }
  // gira a junta 1 em d0 e a junta 2 em d0+d1 (cadeia), preservando comprimentos
  function bend(L, k0, k1, k2, d0, d1) {
    if (!L) return;
    var a = L[k0], b = L[k1], c = L[k2];
    var l1 = segLen(a, b), l2 = segLen(b, c);
    var a1 = segAng(a, b) + d0;
    var nb = [a[0] + Math.sin(a1) * l1, a[1] + Math.cos(a1) * l1];
    var a2 = segAng(b, c) + d0 + d1;
    var nc = [nb[0] + Math.sin(a2) * l2, nb[1] + Math.cos(a2) * l2];
    if (L.foot) L.foot = [L.foot[0] + (nc[0] - c[0]), L.foot[1] + (nc[1] - c[1]), L.foot[2], L.foot[3]];
    L[k1] = nb; L[k2] = nc;
  }
  function moveJoint(L, k, dx, dy) { if (L && L[k]) L[k] = [L[k][0] + dx, L[k][1] + dy]; }

  // gesto de ataque por classe — cada uma golpeia do seu jeito
  var ATTACK = {
    // Sumô: o BOTE. Recolhe o corpo todo e despeja o ombro para a frente.
    sumo: function (k, R) {
      if (k < 0.34) {                                   // antecipação: agacha e recua
        var a = k / 0.34;
        R.lean = -0.16 * a; R.sway = -6 * a; R.squash = 1 - 0.09 * a;
        R.legN = [-0.24 * a, 0.5 * a]; R.legF = [0.2 * a, 0.42 * a];
        R.armN = [-0.6 * a, -0.5 * a]; R.armF = [-0.5 * a, -0.7 * a];
      } else if (k < 0.56) {                            // golpe: o corpo inteiro vai junto
        var b = ease((k - 0.34) / 0.22);
        R.lean = -0.16 + 0.42 * b; R.sway = -6 + 14 * b; R.squash = 0.91 + 0.13 * b;
        R.legN = [-0.24 + 0.8 * b, 0.5 - 0.46 * b]; R.legF = [0.2 - 0.7 * b, 0.42 - 0.3 * b];
        R.armN = [-0.6 + 1.9 * b, -0.5 + 0.5 * b]; R.armF = [-0.5 + 1.5 * b, -0.7 + 0.7 * b];
        R.mood = 'grito';
      } else {                                          // retorno
        var c = ease((k - 0.56) / 0.44);
        R.lean = 0.26 * (1 - c); R.sway = 8 * (1 - c); R.squash = 1.04 - 0.04 * c;
        R.legN = [0.56 * (1 - c), 0.04]; R.legF = [-0.5 * (1 - c), 0.12];
        R.armN = [1.3 * (1 - c), 0]; R.armF = [1.0 * (1 - c), 0];
        if (c < 0.4) R.mood = 'grito';
      }
    },
    // Arqueiro: puxa a corda até a orelha, segura e solta.
    arqueiro: function (k, R) {
      if (k < 0.45) {
        var a = ease(k / 0.45);
        R.lean = -0.1 * a; R.sway = -3 * a;
        R.armF = [1.5 * a, -0.15 * a];                   // braço do arco esticado à frente
        R.armN = [-1.5 * a, -1.5 * a];                   // mão da corda recuando
        R.legN = [-0.12 * a, 0.18 * a]; R.legF = [0.16 * a, 0.1 * a];
      } else if (k < 0.6) {
        R.lean = -0.1; R.armF = [1.5, -0.15]; R.armN = [-1.55, -1.6]; R.sway = -3;
        R.mood = 'grito';
      } else {
        var c = ease((k - 0.6) / 0.4);
        R.lean = -0.1 + 0.2 * c; R.sway = -3 + 6 * c;
        R.armF = [1.5 - 0.5 * c, -0.15];
        R.armN = [-1.55 + 1.9 * c, -1.6 + 1.7 * c];
        R.legN = [-0.12 + 0.12 * c, 0.18 - 0.18 * c]; R.legF = [0.16 - 0.16 * c, 0.1 - 0.1 * c];
      }
    },
    // Bruxo: ergue o cajado bem alto e baixa cortando o ar.
    bruxo: function (k, R) {
      if (k < 0.45) {
        var a = ease(k / 0.45);
        R.lean = -0.14 * a; R.bob = -3 * a;
        R.armN = [-2.5 * a, -0.4 * a]; R.armF = [-0.7 * a, -0.3 * a];
        R.squash = 1 + 0.04 * a;
      } else if (k < 0.68) {
        var b = ease((k - 0.45) / 0.23);
        R.lean = -0.14 + 0.44 * b; R.bob = -3 + 4 * b;
        R.armN = [-2.5 + 3.0 * b, -0.4 + 0.4 * b]; R.armF = [-0.7 + 1.1 * b, -0.3];
        R.mood = 'grito'; R.squash = 1.04 - 0.06 * b;
      } else {
        var c = ease((k - 0.68) / 0.32);
        R.lean = 0.3 * (1 - c); R.armN = [0.5 * (1 - c), 0]; R.armF = [0.4 * (1 - c), 0];
        R.bob = 1 * (1 - c);
      }
    },
    // Espadachim: estocada baixa e rápida, corpo todo esticado na linha da lâmina.
    espadachim: function (k, R) {
      if (k < 0.3) {
        var a = ease(k / 0.3);
        R.lean = -0.24 * a; R.sway = -8 * a; R.squash = 1 - 0.06 * a;
        R.armN = [-1.5 * a, -0.9 * a]; R.armF = [-0.5 * a, -0.4 * a];
        R.legN = [-0.3 * a, 0.4 * a]; R.legF = [0.24 * a, 0.3 * a];
      } else if (k < 0.5) {
        var b = ease((k - 0.3) / 0.2);
        R.lean = -0.24 + 0.66 * b; R.sway = -8 + 28 * b; R.squash = 0.94 + 0.1 * b;
        R.armN = [-1.5 + 3.1 * b, -0.9 + 0.95 * b]; R.armF = [-0.5 - 0.6 * b, -0.4];
        R.legN = [-0.3 + 1.2 * b, 0.4 - 0.4 * b]; R.legF = [0.24 - 1.0 * b, 0.3 - 0.2 * b];
        R.mood = 'grito';
      } else {
        var c = ease((k - 0.5) / 0.5);
        R.lean = 0.42 * (1 - c); R.sway = 20 * (1 - c);
        R.armN = [1.6 * (1 - c), 0.05]; R.armF = [-1.1 * (1 - c), 0];
        R.legN = [0.9 * (1 - c), 0]; R.legF = [-0.76 * (1 - c), 0.1];
      }
    },
    // Curandeira: levanta as duas mãos e dá um pulinho.
    curandeira: function (k, R) {
      if (k < 0.5) {
        var a = ease(k / 0.5);
        R.armN = [-2.2 * a, -0.5 * a]; R.armF = [-2.1 * a, -0.5 * a];
        R.bob = -6 * a; R.squash = 1 + 0.05 * a; R.lean = -0.04 * a;
        R.legN = [0.1 * a, -0.2 * a]; R.legF = [-0.1 * a, -0.2 * a];
      } else {
        var c = ease((k - 0.5) / 0.5);
        R.armN = [-2.2 + 1.4 * c, -0.5 + 0.4 * c]; R.armF = [-2.1 + 1.3 * c, -0.5 + 0.4 * c];
        R.bob = -6 + 6 * c; R.squash = 1.05 - 0.05 * c;
        R.legN = [0.1 - 0.1 * c, -0.2 + 0.2 * c]; R.legF = [-0.1 + 0.1 * c, -0.2 + 0.2 * c];
      }
    },
    // Invocador: ergue o totem e BATE no chão — a batida é o gesto.
    invocador: function (k, R) {
      if (k < 0.4) {
        var a = ease(k / 0.4);
        R.armN = [-2.1 * a, -0.3 * a]; R.armF = [-0.8 * a, -0.2 * a];
        R.bob = -4 * a; R.lean = -0.12 * a;
        R.legN = [-0.1 * a, 0.1 * a]; R.legF = [0.1 * a, 0.1 * a];
      } else if (k < 0.58) {
        var b = ease((k - 0.4) / 0.18);
        R.armN = [-2.1 + 2.5 * b, -0.3 + 0.3 * b]; R.armF = [-0.8 + 0.9 * b, -0.2];
        R.bob = -4 + 7 * b; R.lean = -0.12 + 0.3 * b; R.squash = 1 - 0.1 * b;
        R.legN = [-0.1 + 0.5 * b, 0.1 + 0.4 * b]; R.legF = [0.1 - 0.5 * b, 0.1 + 0.4 * b];
        R.mood = 'grito';
      } else {
        var c = ease((k - 0.58) / 0.42);
        R.armN = [0.4 * (1 - c), 0]; R.armF = [0.1 * (1 - c), 0];
        R.bob = 3 * (1 - c); R.lean = 0.18 * (1 - c); R.squash = 0.9 + 0.1 * c;
        R.legN = [0.4 * (1 - c), 0.5 * (1 - c)]; R.legF = [-0.4 * (1 - c), 0.5 * (1 - c)];
      }
    }
  };

  // personalidade do "parado": cada classe respira do seu jeito
  var IDLE_STYLE = {
    sumo:       { breath: 1.5, arm: 0.05, tilt: 0.006, knee: 0.03 },
    arqueiro:   { breath: 1.0, arm: 0.09, tilt: 0.012, knee: 0.05 },
    bruxo:      { breath: 1.2, arm: 0.07, tilt: 0.014, knee: 0 },
    espadachim: { breath: 0.8, arm: 0.12, tilt: 0.016, knee: 0.07 },
    curandeira: { breath: 1.1, arm: 0.11, tilt: 0.018, knee: 0.05 },
    invocador:  { breath: 1.0, arm: 0.08, tilt: 0.01, knee: 0.04 }
  };

  // devolve o "delta de pose" para um quadro
  function poseRig(base, fase, t) {
    var R = { bob: 0, sway: 0, lean: 0, squash: 1, mood: null,
              legN: [0, 0], legF: [0, 0], armN: [0, 0], armF: [0, 0], headDy: 0, alpha: 1 };
    var ph = t * TAU;
    if (fase === 'andar') {
      // ciclo de passada: coxas em contrafase, joelho dobra na volta,
      // corpo sobe duas vezes por ciclo e os braços contrabalançam.
      // PASSADA EXAGERADA: a perna da frente vai bem à frente, a de trás bem
      // atrás, o joelho de trás dobra forte e o corpo sobe e desce de verdade.
      var sN = Math.sin(ph), sF = Math.sin(ph + Math.PI);
      R.legN = [sN * 0.8, -0.7 * Math.max(0, -sN) - 0.08];
      R.legF = [sF * 0.8, -0.7 * Math.max(0, -sF) - 0.08];
      R.armN = [sF * 0.7, -0.22 - 0.26 * Math.max(0, sF)];
      R.armF = [sN * 0.7, -0.22 - 0.26 * Math.max(0, sN)];
      R.bob = -Math.abs(Math.sin(ph)) * 5 + 1.8;
      R.lean = 0.1 + Math.sin(ph * 2) * 0.035;
      R.sway = Math.sin(ph * 2) * 2.6;
      R.squash = 1 + Math.sin(ph * 2) * 0.03;
    } else if (fase === 'atacar') {
      (ATTACK[base] || ATTACK.sumo)(t, R);
    } else if (fase === 'conjurar') {
      // as duas mãos sobem, o corpo flutua e a energia se acumula
      var e = t < 0.5 ? ease(t / 0.5) : 1 - ease((t - 0.5) / 0.5) * 0.35;
      R.armN = [-1.7 * e, -0.5 * e];
      R.armF = [-1.5 * e, -0.5 * e];
      R.bob = -5 * e - Math.abs(Math.sin(ph * 2)) * 1.5;
      R.lean = -0.08 * e;
      R.squash = 1 + 0.05 * e;
      R.legN = [0.06 * e, -0.1 * e]; R.legF = [-0.06 * e, -0.1 * e];
      if (t > 0.35 && t < 0.8) R.mood = 'grito';
    } else if (fase === 'dano') {
      // recuo seco + tremida que decai
      var d = 1 - t;
      var shake = Math.sin(t * TAU * 2.4) * 3.2 * d;
      R.sway = -9 * d + shake;
      R.lean = -0.3 * d;
      R.bob = -2 * d;
      R.squash = 1 - 0.06 * d;
      R.armN = [-0.8 * d, -0.4 * d]; R.armF = [-0.9 * d, -0.5 * d];
      R.legN = [-0.3 * d, 0.2 * d]; R.legF = [0.24 * d, 0.16 * d];
      R.mood = 'dor';
    } else if (fase === 'morte') {
      // joelhos cedem, tronco tomba para trás e a figura apaga
      var m = ease(t);
      R.lean = -0.55 * m;
      R.bob = 4 * m;
      R.sway = -6 * m;
      R.squash = 1 - 0.4 * m;
      R.legN = [-0.5 * m, 1.3 * m]; R.legF = [0.4 * m, 1.2 * m];
      R.armN = [-1.3 * m, -0.4 * m]; R.armF = [-1.2 * m, -0.4 * m];
      R.alpha = 1 - m * 0.55;
      R.mood = t > 0.5 ? 'morto' : 'dor';
    } else {
      // idle: respiração + micro-balanço, com o tempero da classe
      var S = IDLE_STYLE[base] || IDLE_STYLE.arqueiro;
      var br = Math.sin(ph);
      R.bob = -br * S.breath;
      R.squash = 1 + br * 0.012;
      R.lean = Math.sin(ph + 0.6) * S.tilt;
      R.armN = [Math.sin(ph + 0.4) * S.arm, 0];
      R.armF = [Math.sin(ph + 1.0) * S.arm, 0];
      R.legN = [0, Math.sin(ph) * S.knee]; R.legF = [0, Math.sin(ph + 0.5) * S.knee];
      R.sway = Math.sin(ph * 0.5) * 0.6;
    }
    return R;
  }

  function applyRig(An, R) {
    bend(An.legN, 'hip', 'knee', 'ank', R.legN[0], R.legN[1]);
    bend(An.legF, 'hip', 'knee', 'ank', R.legF[0], R.legF[1]);
    bend(An.armN, 'sh', 'el', 'hd', R.armN[0], R.armN[1]);
    bend(An.armF, 'sh', 'el', 'hd', R.armF[0], R.armF[1]);
    An.handN = An.armN.hd; An.handF = An.armF.hd;
    if (R.headDy) { An.head = [An.head[0], An.head[1] + R.headDy, An.head[2]]; }
  }

  function paintUnit(ctx, cfg) {
    var P = PLANS[cfg.base] || PLANS.sumo;
    var An = P.anchors(cfg);
    An.cfg = cfg;

    // --------------------------------------------------- pose deste quadro
    var pose = cfg.pose;
    if (pose && pose.fase && pose.fase !== 'estatico') {
      var inf = POSE[pose.fase] || POSE.idle;
      var n = inf.frames;
      var t = (pose.t != null) ? pose.t
            : (((pose.frame | 0) % n) + n) % n / (inf.loop ? n : Math.max(1, n - 1));
      var R = poseRig(cfg.base, pose.fase, t);
      applyRig(An, R);
      cfg.mood = R.mood;
      // as pontas de pano ATRASAM em relação ao corpo: é o balanço da roupa
      cfg.flap = { x: R.sway * 0.85 + R.lean * 26, y: R.bob * 0.7 };
      // tronco: sobe/desce, inclina (cisalhamento, pés plantados) e amassa
      ctx.save();
      ctx.translate(R.sway, R.bob);
      if (R.lean) ctx.transform(1, 0, -R.lean, 1, 0, 0);
      if (R.squash !== 1) ctx.scale(1, R.squash);
      if (R.alpha < 1) ctx.globalAlpha = R.alpha;
      An._posed = true;
    }
    var wp = cfg.acc.weapon && ACC.weapon[cfg.acc.weapon] ? ACC.weapon[cfg.acc.weapon] : null;

    elemBack(ctx, An, cfg);
    if (!cfg.back) drawBackItems(ctx, An, cfg);
    else if (wp) { ctx.save(); ctx.globalAlpha = 0.95; wp(ctx, An, cfg, An.handN[0], An.handN[1]); ctx.restore(); }

    var wrapCol = cfg.acc.wrap ? mx(cfg.pal.cloth, '#e8dcc0', 0.45) : null;

    if (An.legF) {
      drawLeg(ctx, An.legF, sh(An.legCol, -0.12), sh(An.footCol, -0.12));
      if (wrapCol) wraps(ctx, An.legF, 'knee', 'ank', sh(wrapCol, -0.12), 3);
    }
    drawArm(ctx, An.armF, sh(An.armCol, -0.12), An.ink);
    if (wrapCol) wraps(ctx, An.armF, 'el', 'hd', sh(wrapCol, -0.12), 3);
    drawHand(ctx, An.armF, sh(An.handCol, -0.12));

    P.torso(ctx, An, cfg);
    if (An.legN) {
      drawLeg(ctx, An.legN, An.legCol, An.footCol);
      if (wrapCol) wraps(ctx, An.legN, 'knee', 'ank', wrapCol, 3);
    }

    // vestuário em CAMADAS: 3 a 5 peças por classe, na ordem declarada
    var lay = cfg.acc.layers || [cfg.acc.torso, cfg.acc.torso2];
    for (var li = 0; li < lay.length; li++) {
      if (lay[li] && ACC.torso[lay[li]]) ACC.torso[lay[li]](ctx, An, cfg);
    }

    var hg = (cfg.acc.head && ACC.head[cfg.acc.head]) || null;
    if (hg && hg.behind) hg.behind(ctx, An, cfg);
    P.head(ctx, An, cfg);
    if (hg && hg.front) hg.front(ctx, An, cfg);
    if (!cfg.back && !(hg && hg.hideFace)) drawFace(ctx, An, cfg, cfg.acc.face || P.face || 'sharp');

    drawArm(ctx, An.armN, An.armCol, An.ink);
    if (wrapCol) wraps(ctx, An.armN, 'el', 'hd', wrapCol, 3);
    if (!cfg.back && wp) wp(ctx, An, cfg, An.handN[0], An.handN[1]);
    drawHand(ctx, An.armN, An.handCol);

    if (cfg.back) drawBackItems(ctx, An, cfg);
    elemFront(ctx, An, cfg);
    if (An._posed) ctx.restore();
    return An;
  }

  // ==========================================================================
  // MONSTROS E PETS — gerador por arquétipo.
  // Enquanto DATA.monsters/DATA.pets não existirem (ou trouxerem bichos novos),
  // o arquétipo sai de palavras-chave do id/nome e, em último caso, do hash:
  // nunca aparece um quadrado cinza no tabuleiro.
  // ==========================================================================
  // 9 arquétipos. A ordem da lista É a prioridade de casamento: o primeiro que
  // bater vence, então o mais específico vem antes (planta antes de fera para
  // 'Brotinho-Voraz'; pedra antes de bruto para 'Sentinela de Pedra').
  var ARCH = ['blob', 'fera', 'inseto', 'espirito', 'bruto', 'planta', 'pedra', 'ave', 'verme'];
  var ARCH_WORDS = [
    ['planta', /raiz|planta|flor|cipo|cipó|vinha|broto|semente|fungo|cogumelo|espor|musgo|trepad|carrapich|verga|jardin|seiv|p[óo]len|thorn|root|vine|sprout|seed|bloom|spore|pollen|burr|leaf|garden|sap\b/i],
    ['blob', /lodo|limo|gosma|blob|slime|lama|geleia|gota|gotinha|escorr|monte de|[áa]gua-viva|jelly|ooze|sludge|slag|drop|droplet|goo|seep|mound|\bdamp/i],
    ['verme', /verme|lombriga|serpe|serpente|cobra|enguia|moreia|larva|worm|snake|eel|moray|slither/i],
    ['ave', /p[aá]ssaro|falc[aã]o|[aá]guia|morcego|corvo|coruja|\basas?\b|\bpenas?\b|pican[çc]o|cantarol|\bcoro\b|assobio|bird|falcon|hawk|eagle|\bbat\b|crow|owl|shrike|warbler|choir|whistle|piper|\bwing/i],
    ['inseto', /inseto|besouro|aranha|escorpi|mosca|traca|traça|casulo|ferr[ãa]o|centop|vespa|formig|caranguejo|wasp|spider|beetle|mite|roach|moth|\bcrab\b|ant-/i],
    ['espirito', /esp[ií]rito|alma|\beco\b|fantasma|sopro|brilho|f[aá]tuo|nevoa|névoa|sombra|assombr|cinza|cinzent|espelho|g[êe]meo|estilha|\bmote|fogar[ée]u|familiar|cora[çc][ãa]o|ninfa|pregolim|wraith|wisp|ghost|spirit|revenant|phantom|shade|mirror|sliver|\bash|firedamp|rift(?!.*forge)|nymph|sprite/i],
    ['pedra', /pedra|rocha|golem|cristal|est[aá]tua|entulho|escombro|granito|mineral|laje|min[ée]rio|lasca|alicerce|bigorna|seixo|stone|rock|crystal|\bore\b|slate|boulder|anvil|lodestone|ballast/i],
    ['fera', /lobo|c[aã]o\b|cão|rato|fera|bicho|garra|presa|javali|peixe|caranguejo|bocarra|ti[çc][ãa]o|fagulha|gremlin|voraz|hound|wolf|beast|fang|claw|crab|jaw|imp\b|whelp|feral/i],
    ['bruto', /guarda|bruto|carrasco|gigante|capataz|soldado|mestre|senhor|rei|rainha|campe|ferreiro|zelador|colosso|sentinela|arauto|baron|xam[ãa]|enforca|puxa|bate|acendedor|smith|warden|colossus|sentinel|porter|hauler|herald|wright|forge|knock|shaman|hanger|revenant/i]
  ];
  function archOf(defId, md) {
    if (md && md.archetype && ARCH.indexOf(md.archetype) >= 0) return md.archetype;
    var s = defId + ' ' + ((md && md.name) || '');
    for (var i = 0; i < ARCH_WORDS.length; i++) if (ARCH_WORDS[i][1].test(s)) return ARCH_WORDS[i][0];
    return ARCH[hash(defId) % ARCH.length];
  }
  function creaturePal(defId, md, els) {
    var el = (md && md.element) || (els && els[0]) || null;
    var rd = rng(defId + 'pal');
    var base;
    if (el && el !== 'neutro') base = elemInfo(el).c;
    else base = ['#8a9a6a', '#9a7a5a', '#7a8a9a', '#9a6a7a', '#6a8a8a'][Math.floor(rd() * 5)];
    var p = {
      main: vivid(base, 0.08),
      dark: sh(base, -0.5),
      accent: el && el !== 'neutro' ? elemInfo(el).glow : sh(base, 0.42),
      skin: base, el: elemInfo(el || 'neutro'), elId: el || 'neutro',
      cloth: sh(base, -0.34), metal: '#c2cbd6', leather: '#8a5a34', wood: '#9a6b3f',
      hair: sh(base, -0.55)
    };
    p.line = lineOf(p.main);
    return p;
  }
  // olhos "de desenho" reaproveitáveis para bichos
  function critterEyes(ctx, x, y, r, n, spread, col) {
    var i, k;
    for (i = 0; i < (n || 2); i++) {
      k = (n || 2) === 1 ? 0 : (i / ((n || 2) - 1) - 0.5) * 2;
      part(ctx, Pel(x + k * spread, y - Math.abs(k) * r * 0.3, r, r * 1.1), '#fdfaf2', { k: 0.12, lw: 0.8 });
      flat(ctx, Pel(x + k * spread + r * 0.22, y - Math.abs(k) * r * 0.3, r * 0.46, r * 0.6), col || '#241c22');
      flat(ctx, Pel(x + k * spread + r * 0.06, y - Math.abs(k) * r * 0.3 - r * 0.34, r * 0.2, r * 0.22), 'rgba(255,255,255,0.9)');
    }
  }
  function paintCreature(ctx, defId, md, cfg) {
    var p = cfg.pal, a = cfg.arch, rd = rng(defId), i, ang;
    var big = cfg.boss ? 1.24 : 1;
    var H = (cfg.boss ? 92 : 62) * (md && md.scale ? md.scale : 1);
    // Variação por id: dois bichos do mesmo arquétipo nunca saem idênticos.
    // vw/vh mexem na proporção (gordo/magro, alto/baixo) e vd escolhe o
    // detalhe contável (nº de dentes, caudas, patas, pontas…).
    var vr = rng(defId + '#var');
    var vw = 0.86 + vr() * 0.34, vh = 0.88 + vr() * 0.3, vd = vr(), vd2 = vr();
    var nd = 3 + Math.floor(vd * 4);          // 3..6 elementos repetidos
    ctx.save(); ctx.scale(big * vw, big * vh);
    if (a === 'blob') {
      var bt = 1 + vd2 * 0.34;                    // quão "alto" o pingo é
      part(ctx, Pel(0, -6, 30, 8), rgba(p.dark, 0.35), { flat: true, noline: true });
      part(ctx, Pblob([-30, -14, -26, -38 * bt, -8, -48 * bt, 12, -46 * bt,
                       28, -34 * bt, 30, -12, 12, -3, -12, -3]),
           p.main, { k: 0.24, hi: 0.16 });
      for (i = 0; i < nd; i++) {                  // pingos escorrendo
        part(ctx, Pel(-16 + i * (32 / nd), -3, 8 - i * 1.2, 3.4), sh(p.main, -0.16), { k: 0.16, lw: 0.75 });
      }
      critterEyes(ctx, 2, -32 * bt, 6.4, vd2 > 0.72 ? 3 : 2, 10);
      stroke(ctx, [-6, -20 * bt, 2, -15 * bt, 11, -20 * bt], sh(p.main, -0.42), 1, true);
    } else if (a === 'fera') {
      part(ctx, Pcap(-16, -26, 13, 18, -30, 11), p.main, { k: 0.24, hi: 0.12 });
      for (i = 0; i < 4; i++) {
        var lx = -18 + (i % 2) * 30, ly = -4 - Math.floor(i / 2) * 2;
        part(ctx, Pcap(lx + 2, -20, 4.6, lx, ly, 3.6), i < 2 ? sh(p.main, -0.14) : p.main, { k: 0.22, lw: 0.9 });
        part(ctx, Pel(lx - 1, ly + 1, 5.4, 2.8), p.dark, { k: 0.2, lw: 0.8 });
      }
      part(ctx, Pel(24, -38, 12.5, 11), p.main, { k: 0.22, hi: 0.14 });
      part(ctx, Pcap(28, -34, 7, 38, -30, 4.4), sh(p.main, 0.06), { k: 0.22, lw: 0.9 });
      part(ctx, Pel(39, -30, 2.6, 2.2), p.dark, { k: 0.16, lw: 0.7 });
      var oe = 46 + vd2 * 16;                     // orelhas curtas ou compridas
      part(ctx, Ppoly([18, -oe, 14, -oe - 12, 26, -oe - 4]), sh(p.main, -0.1), { k: 0.24, lw: 0.9 });
      part(ctx, Ppoly([30, -oe, 34, -oe - 12, 38, -oe]), sh(p.main, -0.1), { k: 0.24, lw: 0.9 });
      critterEyes(ctx, 27, -40, 3.6, 2, 6);
      part(ctx, Pcap(-28, -28, 4, -40 - vd * 8, -40 + vd * 14, 2), sh(p.main, -0.12), { k: 0.22, lw: 0.9 });
      if (vd2 > 0.55) {                           // metade das feras tem placas nas costas
        for (i = 0; i < 3; i++) {
          part(ctx, Ppoly([-10 + i * 11, -38, -6 + i * 11, -50 - i, -2 + i * 11, -38]),
               sh(p.main, -0.2), { k: 0.2, lw: 0.8 });
        }
      }
    } else if (a === 'inseto') {
      for (i = 0; i < 6; i++) {
        ang = -0.5 + (i % 3) * 0.5;
        var sx = i < 3 ? -1 : 1;
        stroke(ctx, [sx * 10, -26, sx * (22 + (i % 3) * 5), -30 + (i % 3) * 4, sx * (26 + (i % 3) * 6), -2],
               sh(p.dark, 0.1), 1.1, true);
      }
      part(ctx, Pel(-10, -24, 16, 13, -0.2), p.main, { k: 0.24, hi: 0.12 });
      part(ctx, Pel(8, -30, 12, 11), sh(p.main, 0.06), { k: 0.22 });
      part(ctx, Pel(22, -36, 9.5, 8.5), p.main, { k: 0.22, hi: 0.14 });
      stroke(ctx, [24, -44, 30, -54, 36, -52], p.dark, 1, true);
      stroke(ctx, [20, -44, 20, -56, 27, -58], p.dark, 1, true);
      critterEyes(ctx, 24, -37, 3.2, 2, 5.5, p.dark);
      part(ctx, Ppoly([-24, -26, -38, -34, -26, -18]), p.accent, { k: 0.2, lw: 0.85 });
    } else if (a === 'espirito') {
      glow(ctx, 0, -34, 34, p.accent, 0.4);
      part(ctx, tag(function (g) {
        g.beginPath();
        g.moveTo(-20, -30);
        g.quadraticCurveTo(-22, -58, 0, -60);
        g.quadraticCurveTo(22, -58, 20, -30);
        g.quadraticCurveTo(16, -14, 8, -6);
        g.quadraticCurveTo(0, 2, -8, -8);
        g.quadraticCurveTo(-18, -16, -20, -30);
        g.closePath();
      }, 0, -32, 24), mx(p.main, '#f2f6ff', 0.2), { k: 0.2, hi: 0.16 });
      for (i = 0; i < nd; i++) {                  // franjas de névoa: 3 a 6
        var fx0 = -15 + i * (30 / nd);
        stroke(ctx, [fx0, -8, fx0 + 2, 2, fx0 - 2, 8 + vd2 * 5], rgba(p.accent, 0.7), 1, true);
      }
      critterEyes(ctx, 1, -40, 5.2, vd2 > 0.66 ? 3 : 2, 8.5, p.dark);
      if (vd > 0.5) {                             // capuz/coroa de sombra
        part(ctx, tag(function (g) {
          g.beginPath(); g.moveTo(-18, -46); g.quadraticCurveTo(0, -70, 18, -46);
          g.quadraticCurveTo(0, -56, -18, -46); g.closePath();
        }, 0, -54, 18), sh(p.main, -0.34), { k: 0.2, lw: 0.9 });
      }
    } else if (a === 'bruto') {
      part(ctx, Pcap(-14, -18, 9, -13, -3, 7), p.dark, { k: 0.22 });
      part(ctx, Pcap(14, -18, 9, 15, -3, 7), p.dark, { k: 0.22 });
      part(ctx, Pblob([-24, -30, -20, -54, 0, -62, 20, -54, 24, -30, 14, -14, -14, -14]),
           p.main, { k: 0.24, hi: 0.12 });
      part(ctx, Pcap(-22, -50, 7, -32, -24, 6), sh(p.main, -0.12), { k: 0.22 });
      part(ctx, Pcap(22, -50, 7, 33, -26, 6), p.main, { k: 0.22 });
      part(ctx, Pel(-34, -20, 7, 6.6), sh(p.main, -0.1), { k: 0.2 });
      part(ctx, Pel(35, -22, 7, 6.6), p.main, { k: 0.2 });
      part(ctx, Pel(2, -68, 12, 11), p.skin, { k: 0.2, hi: 0.14 });
      critterEyes(ctx, 3, -69, 3.4, 2, 5.6);
      stroke(ctx, [-4, -62, 3, -59, 10, -62], sh(p.skin, -0.4), 1, true);
      part(ctx, Prr(2, -78, 20, 6, 2), p.cloth, { k: 0.24, lw: 0.9 });
    } else if (a === 'planta') {
      part(ctx, Pel(0, -4, 24, 7), sh(p.dark, 0.1), { k: 0.2 });
      for (i = 0; i < 4; i++) {
        ang = -2.6 + i * 0.62;
        stroke(ctx, [Math.cos(ang) * 8, -6, Math.cos(ang) * 22, -12 - i, Math.cos(ang) * 30, -3],
               sh(p.dark, 0.16), 1.2, true);
      }
      part(ctx, Pcap(0, -10, 6.5, 3, -44, 5.4), mx(p.main, '#4a7a32', 0.4), { k: 0.24 });
      part(ctx, tag(function (g) {
        g.beginPath();
        g.moveTo(3, -44);
        g.quadraticCurveTo(-20, -52, -18, -66);
        g.quadraticCurveTo(-8, -78, 6, -76);
        g.quadraticCurveTo(22, -70, 20, -54);
        g.quadraticCurveTo(14, -44, 3, -44);
        g.closePath();
      }, 2, -60, 20), p.main, { k: 0.24, hi: 0.14 });
      // dentes
      for (i = 0; i < 5; i++) {
        part(ctx, Ppoly([-16 + i * 8, -50, -12 + i * 8, -42, -8 + i * 8, -50]), '#f4ecd8', { k: 0.14, lw: 0.7 });
      }
      part(ctx, Pel(-6, -64, 3.6, 3.8), p.accent, { k: 0.16, lw: 0.8 });
      part(ctx, Pel(9, -66, 3.6, 3.8), p.accent, { k: 0.16, lw: 0.8 });
      part(ctx, Ppoly([-22, -18, -38, -26, -24, -8]), mx(p.main, '#4a7a32', 0.55), { k: 0.22, lw: 0.9 });
      part(ctx, Ppoly([24, -20, 40, -30, 26, -10]), mx(p.main, '#4a7a32', 0.4), { k: 0.22, lw: 0.9 });
    } else if (a === 'ave') {
      // pássaro roliço pousado: corpo oval, peito claro, bico triangular, cauda em leque
      part(ctx, Pcap(-6, -2, 3.2, -9, -22, 2.6), p.dark, { k: 0.2, lw: 0.85 });
      part(ctx, Pcap(8, -2, 3.2, 6, -22, 2.6), p.dark, { k: 0.2, lw: 0.85 });
      for (i = 0; i < 4; i++) {                       // leque da cauda
        part(ctx, Ppoly([-16, -34, -34 - i * 3, -40 - i * 7, -18, -28 + i * 2]),
             i % 2 ? sh(p.main, -0.14) : p.main, { k: 0.22, lw: 0.9 });
      }
      part(ctx, Pel(-1, -34, 20, 22, -0.14), p.main, { k: 0.24, hi: 0.14 });
      part(ctx, Pel(3, -30, 11, 13), sh(p.main, 0.34), { k: 0.16, lw: 0.9 });   // peito
      part(ctx, Pel(-4, -38, 12.5, 10, -0.5), sh(p.main, -0.1), { k: 0.22 });   // asa dobrada
      stroke(ctx, [-12, -42, -2, -36, 6, -34], p.dark, 1, true);
      part(ctx, Pel(12, -52, 11, 10.5), p.main, { k: 0.22, hi: 0.16 });         // cabeça
      part(ctx, Ppoly([20, -54, 34, -50, 20, -46]), mx(p.accent, '#e8a63c', 0.4), { k: 0.22, lw: 0.9 });
      part(ctx, Ppoly([6, -60, 9, -70, 14, -60]), sh(p.main, -0.16), { k: 0.2, lw: 0.85 });  // topete
      critterEyes(ctx, 13, -54, 4, 2, 5.4, p.dark);
    } else if (a === 'verme') {
      // serpe: corpo em S de anéis decrescentes, cabeça com boca e presas
      var segN = 6;
      for (i = segN - 1; i >= 0; i--) {
        var t = i / (segN - 1);
        var sxx = -26 + i * 10 + Math.sin(i * 1.15) * 5;
        var syy = -6 - i * 8 - Math.cos(i * 0.9) * 5;
        part(ctx, Pel(sxx, syy, 15 - t * 5.5, 11 - t * 3.6, -0.2 + Math.sin(i) * 0.3),
             i % 2 ? sh(p.main, -0.12) : p.main, { k: 0.24, hi: 0.12 });
      }
      part(ctx, Pel(22, -50, 14, 11.5, -0.25), p.main, { k: 0.22, hi: 0.16 });
      part(ctx, tag(function (g) {                    // boca aberta
        g.beginPath(); g.moveTo(28, -48); g.quadraticCurveTo(40, -46, 38, -38);
        g.quadraticCurveTo(30, -38, 26, -44); g.closePath();
      }, 32, -44, 8), mx(p.dark, '#7a1e2a', 0.5), { k: 0.16, lw: 0.9 });
      part(ctx, Ppoly([29, -47, 31, -40, 33, -47]), '#f4ecd8', { k: 0.12, lw: 0.7 });
      part(ctx, Ppoly([35, -45, 36, -39, 38, -45]), '#f4ecd8', { k: 0.12, lw: 0.7 });
      critterEyes(ctx, 20, -54, 3.8, 2, 5.6, p.dark);
      stroke(ctx, [18, -62, 24, -72, 30, -66], p.accent, 1.1, true);   // antena
    } else { // pedra
      part(ctx, Pshard(0, -22, 26, defId + 'a'), p.main, { k: 0.28, hi: 0.12 });
      part(ctx, Pshard(-18, -44, 13, defId + 'b'), sh(p.main, 0.08), { k: 0.26 });
      part(ctx, Pshard(19, -40, 11, defId + 'c'), sh(p.main, -0.06), { k: 0.26 });
      part(ctx, Pshard(0, -52, 16, defId + 'd'), p.main, { k: 0.26, hi: 0.14 });
      critterEyes(ctx, 1, -52, 4.4, 2, 7.5, p.dark);
      part(ctx, Pel(-26, -6, 10, 5), sh(p.main, -0.2), { k: 0.24, lw: 0.9 });
      part(ctx, Pel(26, -6, 10, 5), sh(p.main, -0.12), { k: 0.24, lw: 0.9 });
      glow(ctx, 1, -52, 18, p.accent, 0.3);
    }
    // marca elemental
    if (p.elId && p.elId !== 'neutro') {
      var ei = p.el;
      if (p.elId === 'fogo') part(ctx, Pflame(-24, -44, 5, 15, 0.2), ei.c, { k: 0.16, lw: 0.8, line: lineOf(ei.deep) });
      else if (p.elId === 'agua') part(ctx, Pdrop(-24, -46, 4), ei.c, { k: 0.18, lw: 0.8, line: lineOf(ei.deep) });
      else if (p.elId === 'terra') part(ctx, Pshard(-25, -44, 6, 'me'), mx(ei.deep, '#6b5a3a', 0.4), { k: 0.24, lw: 0.85 });
      else if (p.elId === 'ar') part(ctx, Pfeather(-22, -46, 11, -0.7), ei.glow, { k: 0.18, lw: 0.8, line: lineOf(ei.deep) });
    }
    if (cfg.boss) {
      // coroa do chefe: leitura imediata de "esse é o grande"
      part(ctx, Ppoly([-16, -78, -12, -92, -5, -84, 2, -95, 9, -84, 16, -92, 18, -78]),
           '#ffc44d', { k: 0.2, lw: 0.9 });
      glow(ctx, 1, -86, 22, '#ffd98a', 0.4);
    }
    ctx.restore();
    return H;
  }

  // ------------------------------------------------------------------- PETS
  // Cada pet tem CORPO PRÓPRIO (não é o mesmo boneco repintado): o tipo sai de
  // palavras do id/nome/descrição. Todos ficam menores que um herói e com
  // cabeça grande — leitura de "bichinho" mesmo a 40 px.
  // ORDEM = prioridade. Regexes com \b: 'brasa' contém 'asa', 'guia' contém-se
  // em 'águia' — sem borda de palavra um pet cai no corpo errado.
  var PET_KIND = [
    ['dragao', /drag[ãa]o|dragonete|dragonzinho|brasinha|emberling|drake|wyrm|lagart/i],
    ['planta', /\bplanta|vaso|vinha|bocarra|snapvine|carn[íi]vora|\bflor\b|raiz|broto/i],
    ['caco', /\bcaco\b|estilha[çc]o|cristal|shard|\blasca\b|heartshard/i],
    ['gota', /\bgota\b|borbulha|bolha|dewling|orvalho|\bdrop|bubble/i],
    ['seixo', /seixo|pedrinha|pedregulh|\bstone\b|lodestone|rocha|magnetit/i],
    ['ave', /[áa]guia|falc[ãa]o|\bave\b|p[áa]ssaro|hawk|falcon|rasga-ar|\basas?\b|\bpenas?\b|gavi[ãa]o/i]
  ];
  function petKindOf(petId, pd) {
    var s = petId + ' ' + ((pd && pd.name) || '') + ' ' + ((pd && pd.description) || '');
    for (var i = 0; i < PET_KIND.length; i++) if (PET_KIND[i][1].test(s)) return PET_KIND[i][0];
    if (pd && pd.element === 'ar') return 'ave';
    if (pd && pd.element === 'agua') return 'gota';
    if (pd && pd.element === 'terra') return 'planta';
    if (pd && pd.element === 'fogo') return 'dragao';
    return 'seixo';
  }
  function paintPet(ctx, petId, pd, cfg) {
    var p = cfg.pal, i;
    var kind = petKindOf(petId, pd);
    var belly = sh(p.main, 0.36);
    ctx.save(); ctx.scale(0.74, 0.74);

    if (kind === 'dragao') {
      part(ctx, Pcap(-2, -14, 6, -26, -6, 4), sh(p.main, -0.16), { k: 0.2, lw: 0.9 });      // cauda
      part(ctx, Ppoly([-26, -10, -38, -14, -30, -2]), sh(p.main, 0.14), { k: 0.2, lw: 0.85 });
      part(ctx, Pel(-8, -5, 5, 4), sh(p.main, -0.2), { k: 0.2, lw: 0.9 });                  // pés
      part(ctx, Pel(9, -5, 5, 4), sh(p.main, -0.08), { k: 0.2, lw: 0.9 });
      part(ctx, Ppoly([-12, -30, -34, -46, -26, -20]), sh(p.main, 0.12), { k: 0.22, lw: 0.9 });  // asas
      part(ctx, Ppoly([12, -30, 34, -46, 26, -20]), sh(p.main, 0.2), { k: 0.22, lw: 0.9 });
      part(ctx, Pel(0, -20, 15, 14), p.main, { k: 0.24, hi: 0.14 });
      part(ctx, Pel(1, -17, 8.5, 8), belly, { k: 0.14, lw: 0.85 });
      for (i = 0; i < 3; i++) {                                                              // crista
        part(ctx, Ppoly([-4 + i * 5, -32 - i, -2 + i * 5, -42 - i * 2, 2 + i * 5, -32 - i]),
             sh(p.accent, -0.1), { k: 0.18, lw: 0.8 });
      }
      part(ctx, Pel(4, -38, 13, 12), p.main, { k: 0.22, hi: 0.16 });                         // cabeça
      part(ctx, Pel(14, -35, 7, 5.5, 0.15), sh(p.main, 0.1), { k: 0.18, lw: 0.85 });         // focinho
      part(ctx, Pel(18, -36, 1.4, 1.2), p.dark, { flat: true, noline: true });
      part(ctx, Ppoly([-4, -46, -8, -58, 3, -49]), sh(p.main, -0.14), { k: 0.2, lw: 0.85 }); // chifres
      part(ctx, Ppoly([7, -47, 11, -58, 12, -46]), sh(p.main, -0.08), { k: 0.2, lw: 0.85 });
      critterEyes(ctx, 5, -40, 4.4, 2, 6);

    } else if (kind === 'planta') {
      part(ctx, tag(function (g) {                                                           // vaso rachado
        g.beginPath(); g.moveTo(-17, -2); g.lineTo(-13, -22); g.lineTo(13, -22);
        g.lineTo(17, -2); g.closePath();
      }, 0, -12, 18), mx('#a4623c', p.dark, 0.24), { k: 0.24, hi: 0.1 });
      part(ctx, Prr(0, -23, 34, 6, 2), mx('#b56f45', p.dark, 0.2), { k: 0.22, lw: 0.9 });
      stroke(ctx, [-4, -20, -1, -12, -5, -4], sh('#7a4326', -0.2), 1.1, true);               // racho
      part(ctx, Pcap(0, -22, 5.5, 2, -46, 4.6), mx(p.main, '#4f8a34', 0.55), { k: 0.24 });   // caule
      part(ctx, Ppoly([-4, -34, -22, -42, -6, -28]), mx(p.main, '#4f8a34', 0.4), { k: 0.22, lw: 0.9 });
      part(ctx, Ppoly([6, -38, 24, -44, 8, -32]), mx(p.main, '#4f8a34', 0.3), { k: 0.22, lw: 0.9 });
      part(ctx, tag(function (g) {                                                           // cabeça-boca
        g.beginPath(); g.moveTo(2, -46); g.quadraticCurveTo(-19, -54, -16, -66);
        g.quadraticCurveTo(-6, -78, 6, -76); g.quadraticCurveTo(21, -70, 18, -55);
        g.quadraticCurveTo(13, -46, 2, -46); g.closePath();
      }, 1, -60, 19), p.main, { k: 0.24, hi: 0.14 });
      for (i = 0; i < 4; i++) {
        part(ctx, Ppoly([-13 + i * 8, -51, -10 + i * 8, -44, -6 + i * 8, -51]),
             '#f6efdd', { k: 0.12, lw: 0.7 });
      }
      critterEyes(ctx, 1, -64, 4.6, 2, 7.4, p.dark);

    } else if (kind === 'ave') {
      part(ctx, Pcap(-4, -3, 2.6, -6, -18, 2.2), '#e8b23c', { k: 0.18, lw: 0.8 });
      part(ctx, Pcap(6, -3, 2.6, 5, -18, 2.2), '#e8b23c', { k: 0.18, lw: 0.8 });
      for (i = 0; i < 3; i++) {
        part(ctx, Ppoly([-12, -26, -30 - i * 4, -30 - i * 6, -13, -21 + i * 2]),
             i % 2 ? sh(p.main, -0.12) : p.main, { k: 0.22, lw: 0.9 });
      }
      part(ctx, Pel(0, -26, 16, 17, -0.12), p.main, { k: 0.24, hi: 0.14 });
      part(ctx, Pel(4, -23, 9, 10), belly, { k: 0.14, lw: 0.85 });
      part(ctx, Pel(-3, -30, 11, 8.5, -0.55), sh(p.main, -0.12), { k: 0.22 });               // asa
      part(ctx, Pfeather(-14, -40, 13, -0.9), sh(p.main, 0.24), { k: 0.18, lw: 0.85 });
      part(ctx, Pel(10, -42, 10, 9.4), p.main, { k: 0.22, hi: 0.16 });
      part(ctx, Ppoly([17, -44, 30, -40, 17, -37]), '#e8b23c', { k: 0.22, lw: 0.9 });        // bico
      critterEyes(ctx, 11, -44, 4, 2, 5.2, p.dark);

    } else if (kind === 'gota') {
      glow(ctx, 0, -24, 30, p.accent, 0.28);
      part(ctx, Pel(0, -3, 17, 4.6), rgba(p.dark, 0.4), { flat: true, noline: true });
      part(ctx, tag(function (g) {                                                           // gota grande
        g.beginPath(); g.moveTo(0, -56); g.quadraticCurveTo(20, -34, 20, -20);
        g.quadraticCurveTo(20, -3, 0, -3); g.quadraticCurveTo(-20, -3, -20, -20);
        g.quadraticCurveTo(-20, -34, 0, -56); g.closePath();
      }, 0, -24, 22), mx(p.main, '#ffffff', 0.14), { k: 0.2, hi: 0.2 });
      part(ctx, Pel(-7, -32, 4.6, 7, -0.5), 'rgba(255,255,255,0.72)', { flat: true, noline: true });
      part(ctx, Pel(11, -14, 3.4, 3, 0), rgba(p.accent, 0.6), { flat: true, noline: true });
      critterEyes(ctx, 1, -26, 5.4, 2, 8, p.dark);
      stroke(ctx, [-5, -15, 1, -11, 7, -15], sh(p.main, -0.4), 1, true);

    } else if (kind === 'caco') {
      glow(ctx, 0, -28, 32, p.accent, 0.34);
      part(ctx, Pel(0, -3, 15, 4.4), rgba(p.dark, 0.38), { flat: true, noline: true });
      part(ctx, Ppoly([-13, -8, -17, -34, -3, -56, 12, -36, 9, -8]), p.main, { k: 0.28, hi: 0.16 });
      part(ctx, Ppoly([-3, -56, 12, -36, 9, -8, 2, -10]), sh(p.main, -0.16), { flat: true, lw: 0.9 });
      part(ctx, Ppoly([-16, -22, -26, -32, -19, -14]), sh(p.main, 0.18), { k: 0.24, lw: 0.85 });
      part(ctx, Ppoly([12, -28, 23, -38, 15, -18]), sh(p.main, 0.1), { k: 0.24, lw: 0.85 });
      critterEyes(ctx, -1, -28, 4.8, 2, 7, p.dark);
      part(ctx, Pel(-4, -46, 2.2, 3.2, 0.3), 'rgba(255,255,255,0.7)', { flat: true, noline: true });

    } else {  // seixo — pedrinha redonda que flutua um pouco
      part(ctx, Pel(0, -2, 15, 4.4), rgba(p.dark, 0.42), { flat: true, noline: true });
      part(ctx, Pblob([-18, -18, -14, -34, 0, -40, 15, -33, 18, -17, 10, -8, -10, -8]),
           p.main, { k: 0.26, hi: 0.14 });
      part(ctx, Pel(-6, -30, 5.4, 3.4, -0.4), sh(p.main, 0.22), { k: 0.12, lw: 0.8 });
      part(ctx, Pel(9, -14, 3.4, 2.4, 0.5), sh(p.main, -0.18), { k: 0.12, lw: 0.8 });
      for (i = 0; i < 2; i++) {                                                              // pedrinhas orbitando
        part(ctx, Pshard(-22 + i * 44, -30 - i * 8, 5, petId + i), sh(p.main, i ? 0.1 : -0.1),
             { k: 0.24, lw: 0.85 });
      }
      critterEyes(ctx, 1, -24, 5, 2, 7.6, p.dark);
      stroke(ctx, [-4, -14, 1, -11, 6, -14], sh(p.main, -0.42), 1, true);
    }

    // selo elemental — sempre acima da cabeça, mesmo lugar em todos os pets
    if (p.elId && p.elId !== 'neutro') {
      var ei = p.el;
      if (p.elId === 'fogo') part(ctx, Pflame(-16, -56, 4.4, 12, 0.1), ei.glow, { k: 0.14, lw: 0.8, line: lineOf(ei.c) });
      else if (p.elId === 'agua') part(ctx, Pdrop(-16, -58, 3.8), ei.glow, { k: 0.16, lw: 0.8, line: lineOf(ei.deep) });
      else if (p.elId === 'terra') part(ctx, Pshard(-16, -56, 5, 'pe'), mx(ei.c, '#8a7a52', 0.4), { k: 0.22, lw: 0.85 });
      else if (p.elId === 'ar') part(ctx, Pfeather(-16, -56, 10, -1.4), ei.glow, { k: 0.16, lw: 0.8, line: lineOf(ei.deep) });
    }
    ctx.restore();
  }

  // ==========================================================================
  // RESOLUÇÃO DE defId  →  configuração de desenho
  // ==========================================================================
  function normEls(opts) {
    var e = [];
    if (opts.elements && opts.elements.length) e = opts.elements.slice(0, 2);
    else if (opts.element) e = [opts.element];
    if (!e.length) e = ['neutro'];
    if (!ELEM[e[0]]) e[0] = 'neutro';
    if (e[1] && !ELEM[e[1]]) e[1] = 'neutro';
    return e;
  }
  var DIRS = [{ back: false, mirror: false }, { back: false, mirror: true },
              { back: true, mirror: true }, { back: true, mirror: false }];
  var DIR_NAMES = { SE: 0, SW: 1, NW: 2, NE: 3, se: 0, sw: 1, nw: 2, ne: 3 };
  function normDir(d) {
    if (typeof d === 'string') d = DIR_NAMES[d] != null ? DIR_NAMES[d] : 0;
    d = (d | 0) % 4; if (d < 0) d += 4;
    return d;
  }
  A.DIRS = DIR_NAMES;

  function parseFusion(defId) {
    if (defId.indexOf('fus:') !== 0) return null;
    var body = defId.slice(4);
    var i = body.indexOf('+');
    if (i < 0) return null;
    return [body.slice(0, i), body.slice(i + 1)];
  }
  function isClass(id) { return !!PLANS[id]; }

  function unitCanvas(defId, els, dir, scale, pose) {
    var w = M.unitW * scale, h = M.unitH * scale;
    var c = mkCanvas(w, h);
    // pinta o boneco SEM contornos numa camada à parte…
    var body = mkCanvas(w, h);
    var g = body.getContext('2d');
    var k = M.artUnit * scale * RES;
    setScale(k);
    var d = DIRS[dir];
    NO_LINE = true;
    g.save();
    g.translate(body.width / 2, body.height * M.anchorY);
    g.scale(k, k);
    if (d.mirror) g.scale(-1, 1);

    var lineCol = '#2e2119';
    var fus = parseFusion(defId);
    if (fus && (isClass(fus[0]) || isClass(fus[1]))) {
      var cfg = fusionCfg(fus[0], fus[1], els);
      cfg.back = d.back;
      cfg.pose = pose;
      paintUnit(g, cfg);
      lineCol = outlineColor(cfg.pal);
    } else if (isClass(defId)) {
      var cfg2 = baseCfg(defId, els);
      cfg2.back = d.back;
      cfg2.pose = pose;
      paintUnit(g, cfg2);
      lineCol = outlineColor(cfg2.pal);
    } else {
      var pets = (JOGO.DATA && JOGO.DATA.pets) || null;
      var pd = pets && pets[defId];
      if (pd) {
        var pp = creaturePal(defId, pd, els);
        paintPet(g, defId, pd, { pal: pp, back: d.back });
        lineCol = outlineColor(pp);
      } else {
        var md = (JOGO.DATA && JOGO.DATA.monsters && JOGO.DATA.monsters[defId]) || null;
        var mp = creaturePal(defId, md, els);
        paintCreature(g, defId, md, {
          pal: mp,
          arch: archOf(defId, md),
          boss: !!(md && (md.boss || md.isBoss)),
          back: d.back
        });
        lineCol = outlineColor(mp);
      }
    }
    g.restore();
    NO_LINE = false;
    // …e agora o contorno sai do alfa composto: só o perímetro externo.
    // espessura em px de TELA (o canvas já encolheu junto com o desenho, então
    // a linha NÃO deve escalar com `scale` — senão some no tamanho de jogo)
    outlineComposite(c.getContext('2d'), body, lineCol, Math.max(1.6, LW * RES * 1.15));
    c.__anchor = [M.anchorX, M.anchorY];
    return c;
  }
  // cor do contorno: a dominante do personagem, bem mais escura e dessaturada
  function outlineColor(pal) {
    var base = mx(pal.main || '#8a8f96', pal.cloth || pal.main || '#8a8f96', 0.4);
    return vivid(sh(base, -0.68), -0.35);
  }

  // ==========================================================================
  // CENÁRIO — chão, obstáculos e props por tema
  // ==========================================================================
  // Cada tema declara as MESMAS quantidades que `DATA.scenery`: 4 obstáculos
  // ALTOS, 5 BAIXOS e 5 props, **na mesma ordem** das descrições escritas pelo
  // Criativo Mundo. É isso que faz `'sebe alta e emaranhada'` virar o desenho
  // da sebe em vez de cair sempre na mesma peça genérica.
  var THEMES = {
    estufa:   { floor: '#7d9a4e', floor2: '#6a8642', edge: '#3f5326', wall: '#5c7a35', accent: '#e2f0a8',
                data: 'garden',
                highs: ['trelica', 'hedge', 'vidraca', 'bambu', 'palmeira', 'painelMofo'],
                lows:  ['planter', 'mureta', 'carrinhoJ', 'vasos', 'tora', 'floreira', 'cercaViva'],
                props: ['redoma', 'regador', 'espantalho', 'placa', 'esporos'] },
    cisterna: { floor: '#5d7f8c', floor2: '#4d6c78', edge: '#263a44', wall: '#456474', accent: '#b9f2ff',
                data: 'cistern',
                highs: ['coluna', 'comporta', 'arcada', 'barris', 'colunaSal', 'telaEclusa'],
                lows:  ['canal', 'degrau', 'banco', 'cano', 'perolas', 'muretaComporta', 'passarela'],
                props: ['lustre', 'lampiao', 'partitura', 'sapato', 'corrente'] },
    brasa:    { floor: '#7a4a3a', floor2: '#663c30', edge: '#3a1e18', wall: '#5c3428', accent: '#ffb347',
                data: 'forge',
                highs: ['blocoFerro', 'chamine', 'forja', 'lingotes', 'fornalha', 'prensa'],
                lows:  ['bigornaB', 'escoria', 'tempera', 'carvao', 'molde', 'trilhoLingote', 'blocoTempera'],
                props: ['correnteTeto', 'martelo', 'fole', 'avental', 'brasa'] },
    vento:    { floor: '#8a8296', floor2: '#756e82', edge: '#3c3748', wall: '#655e74', accent: '#f0eaff',
                data: 'scaffold',
                highs: ['andaime', 'guindaste', 'tapume', 'duto', 'elevador', 'lona'],
                lows:  ['guardaCorpo', 'vigas', 'caixa', 'brita', 'roldana', 'estrado', 'roloCabo'],
                props: ['prumo', 'bandeira', 'balde', 'ninho', 'serragem'] },
    mina:     { floor: '#7a6a4e', floor2: '#665842', edge: '#332b20', wall: '#5c4e38', accent: '#c9a227',
                data: 'mine',
                highs: ['escora', 'rocha', 'desabamento', 'silo', 'pilarRocha', 'portaGaleria'],
                lows:  ['vagonete', 'trilho', 'entulho', 'dinamite', 'cavalete', 'vigaCaida', 'britagem'],
                props: ['carbureto', 'gaiola', 'capacete', 'cristal', 'poeira'] },
    coracao:  { floor: '#5a5270', floor2: '#4a4360', edge: '#241f36', wall: '#463f60', accent: '#b98cff',
                data: 'heart',
                highs: ['costela', 'cristal', 'espelho', 'colunaQuatro', 'pilarPartido', 'lascaMundo'],
                lows:  ['basalto', 'caco', 'bacia', 'raizCoracao', 'anelCinza', 'soleira', 'bancoEstacoes'],
                props: ['relogio', 'estilhaco', 'chuvaCima', 'lampiao', 'runa'] }
  };
  // compatibilidade: `T.high`/`T.low` continuam existindo (a 1ª variante)
  (function () {
    for (var k in THEMES) {
      THEMES[k].high = THEMES[k].highs[0];
      THEMES[k].low = THEMES[k].lows[0];
    }
  })();
  var THEME_ALIAS = {
    greenhouse: 'estufa', garden: 'estufa', jardim: 'estufa', vegetal: 'estufa', estufa: 'estufa',
    cistern: 'cisterna', agua: 'cisterna', water: 'cisterna', afogados: 'cisterna', cisterna: 'cisterna',
    ember: 'brasa', emberlock: 'brasa', fogo: 'brasa', fire: 'brasa', forja: 'brasa', fecho: 'brasa', brasa: 'brasa',
    wind: 'vento', ar: 'vento', air: 'vento', andaime: 'vento', andaimes: 'vento', vendaval: 'vento', vento: 'vento',
    mine: 'mina', terra: 'mina', earth: 'mina', tremor: 'mina', mina: 'mina',
    heart: 'coracao', coracao: 'coracao', 'coração': 'coracao', final: 'coracao', partido: 'coracao'
  };
  function themeOf(theme) {
    if (!theme) return THEMES.estufa;
    var t = String(theme).toLowerCase();
    if (THEMES[t]) return withDungeonPalette(t, THEMES[t]);
    var al = THEME_ALIAS[t];
    if (al) return withDungeonPalette(al, THEMES[al]);
    for (var k in THEME_ALIAS) if (t.indexOf(k) >= 0) return withDungeonPalette(THEME_ALIAS[k], THEMES[THEME_ALIAS[k]]);
    // tema desconhecido: deriva uma paleta estável do hash (nunca cinza morto)
    var h = hash(t), base = 'hsl';
    var hue = h % 360;
    var col = hslHex(hue, 26, 44);
    return { floor: col, floor2: sh(col, -0.12), edge: sh(col, -0.5), wall: sh(col, -0.16),
             accent: sh(col, 0.55), high: 'rocha', low: 'entulho',
             highs: ['rocha', 'coluna', 'desabamento', 'silo', 'pilarRocha', 'portaGaleria'],
             lows: ['entulho', 'caixa', 'trilho', 'basalto', 'molde', 'estrado', 'vigaCaida'],
             props: ['lanterna', 'urna', 'cristal', 'poeira', 'corrente'] };
  }
  // ---------------------------------------------------------------- variantes
  // O Renderer passa como "variante" a DESCRIÇÃO em pt-BR que o Criativo Mundo
  // escreveu em `DATA.scenery` ('sebe alta e emaranhada'). Antes isso não casava
  // com nada e TODA peça da sala caía no mesmo desenho. Aqui a descrição vira o
  // desenho da MESMA POSIÇÃO na lista do tema — 4 altos e 5 baixos por tema, na
  // ordem declarada. Chave direta e índice numérico continuam valendo.
  function variantKey(T, map, list, want, kind) {
    var i, n = list.length;
    if (!n) return null;
    if (typeof want === 'string' && map[want]) return want;
    if (typeof want === 'number' && isFinite(want)) return list[((want % n) + n) % n];
    if (typeof want === 'string' && want) {
      var sc = (JOGO.DATA && JOGO.DATA.scenery) || null;
      var e = sc && T.data && sc[T.data];
      if (e && e[kind] && e[kind].length) {
        i = e[kind].indexOf(want);
        if (i >= 0) return list[i % n];
      }
      if (e) {                                   // descrição de outro tema: mesma posição
        for (var t in sc) {
          if (sc[t] && sc[t][kind]) {
            i = sc[t][kind].indexOf(want);
            if (i >= 0) return list[i % n];
          }
        }
      }
      return list[hash(want) % n];               // desconhecida: estável por hash
    }
    return list[0];
  }
  // lista de variantes de um tema (usado pela galeria e por quem quiser sortear)
  A.themeVariants = function (theme) {
    var T = themeOf(theme);
    return { high: (T.highs || [T.high]).slice(), low: (T.lows || [T.low]).slice(),
             props: (T.props || []).slice() };
  };
  // se o Criativo Mundo já escreveu os calabouços, respeita a paleta dele
  function withDungeonPalette(key, T) {
    var dgs = (JOGO.DATA && JOGO.DATA.dungeons) || null;
    if (!dgs || !dgs.length) return T;
    for (var i = 0; i < dgs.length; i++) {
      var d = dgs[i];
      var th = String(d.theme || d.id || '').toLowerCase();
      if (THEME_ALIAS[th] === key || th === key) {
        if (d.palette && d.palette.primary) {
          var o = {}; for (var k in T) o[k] = T[k];
          o.floor = mx(T.floor, d.palette.primary, 0.28);
          o.floor2 = sh(o.floor, -0.12);
          o.wall = mx(T.wall, d.palette.secondary || d.palette.primary, 0.3);
          o.accent = d.palette.accent || T.accent;
          return o;
        }
      }
    }
    return T;
  }
  function hslHex(h, s, l) {
    s /= 100; l /= 100;
    var c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2, r, g, b;
    if (h < 60) { r = c; g = x; b = 0; } else if (h < 120) { r = x; g = c; b = 0; }
    else if (h < 180) { r = 0; g = c; b = x; } else if (h < 240) { r = 0; g = x; b = c; }
    else if (h < 300) { r = x; g = 0; b = c; } else { r = c; g = 0; b = x; }
    return toHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
  }
  A.themePalette = themeOf;

  // caixa isométrica: 3 faces chapadas com contorno — a base de todo cenário
  function isoBox(ctx, cx, cy, w, hgt, col, o) {
    o = o || {};
    var hw = w / 2, hh = w / 4;
    var ln = o.line || lineOf(col);
    part(ctx, Ppoly([cx - hw, cy - hgt, cx, cy - hgt + hh, cx, cy + hh, cx - hw, cy]),
         sh(col, -0.3), { flat: true, lw: 0.9, line: ln });
    part(ctx, Ppoly([cx + hw, cy - hgt, cx, cy - hgt + hh, cx, cy + hh, cx + hw, cy]),
         sh(col, -0.13), { flat: true, lw: 0.9, line: ln });
    part(ctx, Ppoly([cx, cy - hgt - hh, cx + hw, cy - hgt, cx, cy - hgt + hh, cx - hw, cy - hgt]),
         sh(col, 0.1), { flat: true, lw: 0.9, line: ln });
  }

  function tileCanvas(theme, variant) {
    var T = themeOf(theme), tw = M.tileW, th = M.tileH, thick = 12;
    var c = mkCanvas(tw, th + thick), g = c.getContext('2d');
    setScale(RES);
    g.save(); g.scale(RES, RES);
    var cx = tw / 2, cy = th / 2;
    var v = (variant | 0);
    var col = v % 2 ? T.floor2 : T.floor;
    var rd = rng(theme + ':' + v);
    // espessura (lados do bloco de chão)
    part(g, Ppoly([cx - tw / 2 + 1, cy, cx, cy + th / 2, cx, cy + th / 2 + thick, cx - tw / 2 + 1, cy + thick]),
         sh(col, -0.42), { flat: true, lw: 0.7, line: rgba(T.edge, 0.8) });
    part(g, Ppoly([cx + tw / 2 - 1, cy, cx, cy + th / 2, cx, cy + th / 2 + thick, cx + tw / 2 - 1, cy + thick]),
         sh(col, -0.28), { flat: true, lw: 0.7, line: rgba(T.edge, 0.8) });
    // topo
    part(g, Pdiamond(cx, cy, tw - 2, th - 1), col, { flat: true, lw: 0.7, line: rgba(T.edge, 0.65) });
    // detalhe do topo por variante
    if (v === 1) {
      stroke(g, [cx - 26, cy - 4, cx - 4, cy + 6, cx + 20, cy - 2], sh(col, -0.24), 0.7, true);
      stroke(g, [cx + 6, cy + 12, cx + 22, cy + 6], sh(col, -0.24), 0.6, true);
    } else if (v === 2) {
      // chão "decorado" (,) — mosaico
      part(g, Pdiamond(cx, cy, (tw - 2) * 0.52, (th - 1) * 0.52), sh(col, 0.14), { flat: true, lw: 0.7, line: rgba(T.edge, 0.5) });
      part(g, Pdiamond(cx, cy, (tw - 2) * 0.2, (th - 1) * 0.2), T.accent, { flat: true, lw: 0.6, line: rgba(T.edge, 0.5) });
    } else if (v === 3) {
      var i, n = 5;
      for (i = 0; i < n; i++) {
        var a = rd() * TAU, r2 = rd() * 0.34 + 0.1;
        flat(g, Pel(cx + Math.cos(a) * tw * r2 * 0.5, cy + Math.sin(a) * th * r2 * 0.5, 5 + rd() * 5, 2.6 + rd() * 2),
             rgba(T.accent, 0.2));
      }
    }
    g.restore();
    c.__anchor = [0.5, (th / 2) / (th + thick)];
    c.__kind = 'tile';
    return c;
  }
  // ==========================================================================
  // BLOCOS GENÉRICOS DE CENÁRIO
  // Um obstáculo tem que ser lido em 64 px: UMA silhueta forte + 2 ou 3
  // detalhes. Estes construtores dão a silhueta; cada peça nomeada só escolhe
  // material, proporção e o detalhe que a identifica.
  // ==========================================================================
  // fiada horizontal atravessando as duas faces à vista de um isoBox
  function boxSeam(g, cx, cy, w, t, col, lw) {
    var hw = w / 2, hh = w / 4;
    stroke(g, [cx - hw, cy - t, cx, cy - t + hh, cx + hw, cy - t], col, lw == null ? 0.75 : lw);
  }
  // bloco maciço (parede, tapume, silo, bloco de ferro)
  function gBlock(g, T, cx, cy, o) {
    var col = o.col || T.wall, w = o.w || 72, h = o.h || 80, i, n = o.seams || 0;
    if (o.base) isoBox(g, cx, cy, w + 10, o.base, sh(col, -0.22));
    isoBox(g, cx, cy - (o.base || 0), w, h, col);
    for (i = 1; i <= n; i++) {
      boxSeam(g, cx, cy - (o.base || 0), w, h * (i / (n + 1)), rgba(sh(col, -0.5), 0.75));
    }
    if (o.rivets) {
      for (i = 0; i < 4; i++) {
        part(g, Pel(cx - w * 0.3 + i * w * 0.2, cy - (o.base || 0) - h * 0.5 + (i % 2) * 14 + w * 0.12,
                    2.2, 2.0), sh(col, 0.34), { flat: true, noline: true });
      }
    }
  }
  // coluna / chaminé: base, fuste e capitel
  function gPillar(g, T, cx, cy, o) {
    var col = o.col || T.wall, h = o.h || 62, w = o.w || 44;
    isoBox(g, cx, cy, w + 18, 12, sh(col, -0.14));
    isoBox(g, cx, cy - 12, w, h, col);
    if (o.flutes !== false) {
      stroke(g, [cx - w * 0.28, cy - 20, cx - w * 0.28, cy - 12 - h + 6], rgba(sh(col, -0.42), 0.8), 0.8);
      stroke(g, [cx + w * 0.28, cy - 20, cx + w * 0.28, cy - 12 - h + 6], rgba(sh(col, -0.42), 0.8), 0.8);
    }
    isoBox(g, cx, cy - 12 - h, o.capW || (w + 14), 12, sh(col, 0.08));
    if (o.halo) part(g, Pel(cx, cy - h - 32, 20, 8), rgba(T.accent, 0.35), { flat: true, noline: true });
  }
  // estrutura vazada: postes verticais + travessas (treliça, andaime, escora)
  function gFrame(g, T, cx, cy, o) {
    var col = o.col || mx(T.wall, '#8a6b3f', 0.5), h = o.h || 80, w = o.w || 48, i;
    var np = o.posts == null ? 2 : o.posts, nr = o.rungs == null ? 3 : o.rungs;
    for (i = 0; i < np; i++) {
      var x = cx - w / 2 + (np === 1 ? w / 2 : i * (w / (np - 1)));
      part(g, Prr(x, cy - h / 2, o.pw || 8, h, 2), i % 2 ? sh(col, -0.1) : col, { k: 0.26, lw: 0.9 });
    }
    for (i = 0; i < nr; i++) {
      part(g, Prr(cx, cy - 14 - i * ((h - 20) / Math.max(1, nr)), w + 12, o.rh || 6, 2),
           sh(col, 0.08), { k: 0.24, lw: 0.9 });
    }
    if (o.diag) stroke(g, [cx - w / 2, cy - h + 8, cx + w / 2, cy - 18], rgba(sh(col, 0.3), 0.85), 0.95);
  }
  // massa orgânica ou amontoado (sebe, desabamento, entulho alto)
  function gMass(g, T, cx, cy, o) {
    var col = o.col || T.wall, rd = rng(o.seed || 'm'), i, h = o.h || 66;
    part(g, Pblob([cx - 40, cy - h * 0.24, cx - 34, cy - h * 0.82, cx - 6, cy - h * 1.06,
                   cx + 26, cy - h * 0.96, cx + 41, cy - h * 0.55, cx + 34, cy - h * 0.22,
                   cx, cy - 4, cx - 30, cy - 10]), col, { k: 0.26, hi: 0.14 });
    for (i = 0; i < (o.tufts || 7); i++) {
      var a = rd() * TAU, rr = 11 + rd() * 24;
      if (o.shards) {
        part(g, Pshard(cx + Math.cos(a) * rr, cy - h * 0.6 + Math.sin(a) * rr * 0.6, 7 + rd() * 7, 's' + i),
             sh(col, -0.1 + rd() * 0.3), { k: 0.26, lw: 0.8 });
      } else {
        part(g, Pel(cx + Math.cos(a) * rr, cy - h * 0.62 + Math.sin(a) * rr * 0.62,
                    7 + rd() * 4, 5 + rd() * 3, rd()), sh(o.leaf || col, 0.12), { k: 0.18, lw: 0.75 });
      }
    }
    if (o.dots) for (i = 0; i < 3; i++) {
      part(g, Pel(cx - 20 + i * 20, cy - h * 0.86 + (i % 2) * 14, 4, 4),
           i === 1 ? (o.dot2 || '#ff8fa8') : T.accent, { k: 0.16, lw: 0.7 });
    }
  }
  // painel translúcido (vidraça, espelho, tapume envidraçado)
  function gPane(g, T, cx, cy, o) {
    var col = o.col || mx(T.wall, '#cfe4e8', 0.5), h = o.h || 86, w = o.w || 62, i;
    isoBox(g, cx, cy, w + 8, 10, sh(T.wall, -0.24));
    part(g, Ppoly([cx - w / 2, cy - 10, cx + w / 2, cy - 10, cx + w / 2, cy - h, cx - w / 2, cy - h]),
         rgba(col, o.alpha == null ? 0.72 : o.alpha), { k: 0.14, lw: 0.9, line: sh(T.wall, -0.5) });
    // reflexos em diagonal + a rachadura que conta a história
    for (i = 0; i < 3; i++) {
      stroke(g, [cx - w * 0.4 + i * 12, cy - 16, cx - w * 0.1 + i * 12, cy - h + 8],
             rgba('#ffffff', 0.28), 1.1);
    }
    if (o.crack) {
      stroke(g, [cx - w * 0.3, cy - h * 0.9, cx - 2, cy - h * 0.55, cx + w * 0.16, cy - h * 0.34,
                 cx + w * 0.1, cy - 16], rgba(sh(T.wall, -0.6), 0.85), 1.0);
      stroke(g, [cx - 2, cy - h * 0.55, cx + w * 0.34, cy - h * 0.62], rgba(sh(T.wall, -0.6), 0.7), 0.8);
    }
  }
  // empilhamento (barris, lingotes, vigas)
  function gStack(g, T, cx, cy, o) {
    var col = o.col || mx(T.wall, '#8a6b3f', 0.5), i, n = o.n || 5, rd = rng(o.seed || 'st');
    for (i = 0; i < n; i++) {
      var row = Math.floor(i / 2), sx = cx + ((i % 2) ? 15 : -15) + row * 4;
      var sy = cy - row * (o.dy || 24) - 4;
      if (o.round) {
        part(g, Prr(sx, sy - 12, 26, 26, 8), i % 2 ? sh(col, -0.12) : col, { k: 0.28, hi: 0.12, lw: 0.9 });
        part(g, Pel(sx, sy - 24, 12, 5), sh(col, 0.18), { k: 0.2, lw: 0.8 });
        stroke(g, [sx - 12, sy - 16, sx + 12, sy - 16], rgba(sh(col, -0.5), 0.8), 0.8);
      } else {
        part(g, Ppoly([sx - 15, sy, sx + 15, sy, sx + 19, sy - 11, sx - 11, sy - 11]),
             i % 2 ? sh(col, 0.12) : col, { k: 0.24, lw: 0.9 });
      }
      if (rd() > 0.7) stroke(g, [sx - 8, sy - 6, sx + 8, sy - 8], rgba(sh(col, -0.4), 0.6), 0.7);
    }
  }
  // ---------------- construtores de obstáculo BAIXO (cobertura) -------------
  function gCurb(g, T, cx, cy, o) {
    var col = o.col || mx(T.wall, '#8a7a5a', 0.4), w = o.w || 70, h = o.h || 22, i;
    isoBox(g, cx, cy, w, h, col);
    for (i = 0; i < (o.seams || 2); i++) boxSeam(g, cx, cy, w, h * ((i + 1) / (o.seams || 2 + 1)),
                                                 rgba(sh(col, -0.5), 0.6), 0.7);
    if (o.moss) {
      for (i = 0; i < 4; i++) {
        part(g, Pel(cx - 22 + i * 15, cy - h - 2 + (i % 2) * 4, 8, 4, 0.2),
             mx(col, '#66a83f', 0.7), { k: 0.2, lw: 0.7 });
      }
    }
  }
  function gCrate(g, T, cx, cy, o) {
    var col = o.col || mx(T.wall, '#9a7a4a', 0.55), w = o.w || 54, h = o.h || 34;
    isoBox(g, cx, cy, w, h, col);
    stroke(g, [cx - w / 2, cy - h * 0.55, cx, cy - h * 0.55 + w / 4, cx + w / 2, cy - h * 0.55],
           rgba(sh(col, -0.42), 0.85), 0.85);
    if (o.lid) part(g, Prr(cx, cy - h - 6, w * 0.56, 7, 2), sh(col, -0.16), { k: 0.24, lw: 0.85 });
    if (o.strap) {
      part(g, Prr(cx - w * 0.22, cy - h * 0.5, 5, h, 1), sh(col, -0.34), { k: 0.2, lw: 0.7 });
      part(g, Prr(cx + w * 0.22, cy - h * 0.5, 5, h, 1), sh(col, -0.34), { k: 0.2, lw: 0.7 });
    }
  }
  function gBasin(g, T, cx, cy, o) {
    var col = o.col || sh(T.wall, -0.1), liq = o.liquid || mx('#2f9fe0', T.floor, 0.25);
    isoBox(g, cx, cy, o.w || 74, o.h || 12, col);
    part(g, Pdiamond(cx, cy - (o.h || 12) - 2, (o.w || 74) * 0.76, (o.w || 74) * 0.38), liq,
         { k: 0.18, lw: 0.8 });
    if (o.inner) part(g, Pdiamond(cx, cy - (o.h || 12) - 3, (o.w || 74) * 0.42, (o.w || 74) * 0.21),
                     o.inner, { k: 0.14, lw: 0.7 });
    stroke(g, [cx - 18, cy - (o.h || 12) - 2, cx - 4, cy - (o.h || 12) + 4, cx + 12, cy - (o.h || 12) - 4],
           rgba(o.spark || '#b9f2ff', 0.75), 0.8, true);
    if (o.glow) glow(g, cx, cy - (o.h || 12) - 2, 34, o.glow, 0.42);
  }
  function gHeap(g, T, cx, cy, o) {
    var rd = rng(o.seed || 'hp'), i, col = o.col || T.wall;
    for (i = 0; i < (o.n || 5); i++) {
      part(g, Pshard(cx - 20 + rd() * 40, cy - 5 - rd() * 22, 8 + rd() * 8, (o.seed || 'h') + i),
           sh(col, -0.1 + rd() * 0.3), { k: 0.28, lw: 0.85 });
    }
    if (o.pole) part(g, Prr(cx + 10, cy - 24, 5, 30, 2), mx(col, '#8a6b3f', 0.6), { k: 0.26, lw: 0.85 });
    if (o.sack) {
      part(g, Pblob([cx - 16, cy - 2, cx - 18, cy - 20, cx - 4, cy - 28, cx + 12, cy - 22,
                     cx + 16, cy - 6]), mx(col, '#b8a074', 0.6), { k: 0.24, hi: 0.12 });
      stroke(g, [cx - 8, cy - 24, cx + 6, cy - 26], rgba(sh(col, -0.4), 0.7), 0.8);
    }
  }
  function gBeam(g, T, cx, cy, o) {
    var col = o.col || mx(T.wall, '#9a7a4a', 0.5), i;
    for (i = 0; i < 2; i++) {
      part(g, Prr(cx - 26 + i * 52, cy - 14, 7, 30, 2), sh(col, -0.14), { k: 0.26, lw: 0.9 });
    }
    part(g, Prr(cx, cy - 28, 62, 7, 2), col, { k: 0.24, lw: 0.9 });
    if (o.rope) {
      stroke(g, [cx - 26, cy - 22, cx, cy - 14, cx + 26, cy - 22], rgba(mx(col, '#e8dcc0', 0.6), 0.9), 1.0, true);
    } else {
      part(g, Prr(cx, cy - 16, 58, 5, 2), sh(col, 0.1), { k: 0.22, lw: 0.85 });
    }
  }
  function gCart(g, T, cx, cy, o) {
    var col = o.col || mx(T.wall, '#8a6b3f', 0.5), tip = o.tip || 0;
    g.save(); g.translate(cx, cy); g.rotate(tip); g.translate(-cx, -cy);
    part(g, Ppoly([cx - 22, cy - 30, cx + 22, cy - 30, cx + 16, cy - 9, cx - 16, cy - 9]), col,
         { k: 0.26, lw: 0.9 });
    part(g, Ppoly([cx - 22, cy - 30, cx + 22, cy - 30, cx + 17, cy - 25, cx - 17, cy - 25]),
         sh(col, 0.16), { k: 0.2, lw: 0.8 });
    part(g, Pel(cx - 11, cy - 5, 6.5, 6.5), '#3a3128', { k: 0.24, lw: 0.85 });
    part(g, Pel(cx + 11, cy - 5, 6.5, 6.5), '#3a3128', { k: 0.24, lw: 0.85 });
    if (o.load) part(g, Pshard(cx, cy - 33, 10, 'cl'), o.load, { k: 0.24, lw: 0.85 });
    g.restore();
  }

  var HIGH = {
    hedge: function (g, T, cx, cy, v) {
      var rd = rng('hedge' + v), i;
      isoBox(g, cx, cy, 74, 16, mx(T.wall, '#3f5326', 0.4));
      part(g, Pblob([cx - 40, cy - 26, cx - 34, cy - 62, cx - 6, cy - 78, cx + 26, cy - 70,
                     cx + 40, cy - 40, cx + 34, cy - 18, cx, cy - 8, cx - 30, cy - 14]),
           mx(T.wall, '#4f8a35', 0.55), { k: 0.24, hi: 0.14 });
      for (i = 0; i < 7; i++) {
        var a = rd() * TAU, rr = 12 + rd() * 24;
        part(g, Pel(cx + Math.cos(a) * rr, cy - 44 + Math.sin(a) * rr * 0.62, 7 + rd() * 4, 5 + rd() * 3, rd()),
             mx(T.wall, '#66a83f', 0.7), { k: 0.18, lw: 0.75 });
      }
      for (i = 0; i < 3; i++) {
        part(g, Pel(cx - 20 + i * 20, cy - 60 + (i % 2) * 14, 4, 4), i === 1 ? '#ff8fa8' : T.accent, { k: 0.16, lw: 0.7 });
      }
    },
    coluna: function (g, T, cx, cy, v) {
      isoBox(g, cx, cy, 62, 12, sh(T.wall, -0.14));
      isoBox(g, cx, cy - 12, 44, 62, T.wall);
      isoBox(g, cx, cy - 74, 58, 12, sh(T.wall, 0.08));
      stroke(g, [cx - 12, cy - 20, cx - 12, cy - 68], sh(T.wall, -0.34), 0.8);
      stroke(g, [cx + 12, cy - 20, cx + 12, cy - 68], sh(T.wall, -0.34), 0.8);
      part(g, Pel(cx, cy - 88, 20, 8), rgba(T.accent, 0.35), { flat: true, noline: true });
    },
    forja: function (g, T, cx, cy, v) {
      isoBox(g, cx, cy, 70, 44, sh(T.wall, -0.06));
      isoBox(g, cx, cy - 44, 48, 26, T.wall);
      part(g, Ppoly([cx - 20, cy - 30, cx + 20, cy - 30, cx + 14, cy - 6, cx - 14, cy - 6]),
           '#2a1410', { k: 0.2, lw: 0.9 });
      part(g, Pflame(cx, cy - 10, 12, 26, 0.1), '#ff8c3a', { k: 0.16, line: '#8a2a12' });
      part(g, Pflame(cx, cy - 12, 6, 15, -0.1), '#ffd98a', { k: 0.14, line: '#c3341a' });
      glow(g, cx, cy - 18, 34, '#ff8c3a', 0.5);
    },
    andaime: function (g, T, cx, cy, v) {
      var i;
      for (i = 0; i < 2; i++) {
        var x = cx - 22 + i * 44;
        part(g, Prr(x, cy - 40, 8, 80, 2), mx(T.wall, '#8a6b3f', 0.5), { k: 0.26, lw: 0.9 });
      }
      for (i = 0; i < 3; i++) {
        part(g, Prr(cx, cy - 16 - i * 28, 56, 6, 2), mx(T.wall, '#9a7a4a', 0.42), { k: 0.24, lw: 0.9 });
      }
      stroke(g, [cx - 22, cy - 72, cx + 22, cy - 20], rgba('#c8b48a', 0.8), 0.9);
      part(g, Ppoly([cx + 22, cy - 78, cx + 46, cy - 70, cx + 22, cy - 62]), T.accent, { k: 0.2, lw: 0.85 });
    },
    rocha: function (g, T, cx, cy, v) {
      var rd = rng('rocha' + v);
      part(g, Pshard(cx, cy - 24, 40, 'r' + v), T.wall, { k: 0.3, hi: 0.1 });
      part(g, Pshard(cx - 14, cy - 56, 22, 'r2' + v), sh(T.wall, 0.08), { k: 0.28 });
      part(g, Pshard(cx + 18, cy - 50, 17, 'r3' + v), sh(T.wall, -0.06), { k: 0.28 });
      part(g, Pel(cx + 8, cy - 40, 5, 4), rgba(T.accent, 0.8), { k: 0.18, lw: 0.7 });
      part(g, Pel(cx - 18, cy - 30, 3.6, 3), rgba(T.accent, 0.6), { k: 0.18, lw: 0.7 });
    },
    cristal: function (g, T, cx, cy, v) {
      isoBox(g, cx, cy, 60, 10, sh(T.wall, -0.2));
      part(g, Ppoly([cx, cy - 92, cx + 17, cy - 52, cx + 11, cy - 12, cx - 11, cy - 12, cx - 17, cy - 52]),
           mx(T.accent, T.wall, 0.35), { k: 0.24, hi: 0.2 });
      part(g, Ppoly([cx - 24, cy - 58, cx - 14, cy - 30, cx - 26, cy - 12, cx - 34, cy - 34]),
           mx(T.accent, T.wall, 0.5), { k: 0.24 });
      part(g, Ppoly([cx + 26, cy - 48, cx + 34, cy - 26, cx + 24, cy - 12, cx + 16, cy - 30]),
           mx(T.accent, T.wall, 0.45), { k: 0.24 });
      glow(g, cx, cy - 46, 44, T.accent, 0.45);
    },

    // ---------------------------------------------------- ESTUFA (garden)
    trelica: function (g, T, cx, cy) {                 // treliça de madeira podre
      var w = mx(T.wall, '#7a5a34', 0.66), i;
      gFrame(g, T, cx, cy, { col: w, h: 88, w: 52, posts: 2, rungs: 5, pw: 7, rh: 5 });
      for (i = 0; i < 5; i++) {                        // trepadeira subindo
        part(g, Pel(cx - 24 + i * 12, cy - 20 - i * 14, 8, 5, 0.5 + i * 0.3),
             mx(T.wall, '#5f9a38', 0.75), { k: 0.2, lw: 0.75 });
      }
      stroke(g, [cx - 22, cy - 12, cx + 4, cy - 46, cx - 8, cy - 84], rgba('#4a7a2a', 0.9), 1.0, true);
    },
    vidraca: function (g, T, cx, cy) {                 // estufa de vidro rachado
      gPane(g, T, cx, cy, { col: '#cfe8dc', h: 90, w: 64, crack: true, alpha: 0.62 });
      part(g, Prr(cx, cy - 92, 68, 7, 2), mx(T.wall, '#6a5a44', 0.6), { k: 0.26, lw: 0.9 });
      part(g, Prr(cx, cy - 52, 6, 82, 1), rgba(mx(T.wall, '#6a5a44', 0.6), 0.9), { k: 0.24, lw: 0.7 });
    },
    bambu: function (g, T, cx, cy) {                   // tutor de bambu cerrado
      var i, col = mx(T.wall, '#b8c06a', 0.62);
      for (i = 0; i < 5; i++) {
        var x = cx - 26 + i * 13, h = 74 + ((i * 37) % 5) * 6;
        part(g, Prr(x, cy - h / 2, 8, h, 3), i % 2 ? sh(col, -0.1) : col, { k: 0.26, lw: 0.85 });
        stroke(g, [x - 4, cy - h * 0.34, x + 4, cy - h * 0.34], rgba(sh(col, -0.45), 0.85), 0.8);
        stroke(g, [x - 4, cy - h * 0.68, x + 4, cy - h * 0.68], rgba(sh(col, -0.45), 0.85), 0.8);
      }
      part(g, Pfeather(cx + 22, cy - 70, 22, -0.9), mx(col, '#4f8a35', 0.6), { k: 0.22, lw: 0.8 });
      part(g, Pfeather(cx - 22, cy - 64, 20, -2.3), mx(col, '#4f8a35', 0.6), { k: 0.22, lw: 0.8 });
    },
    // -------------------------------------------------- CISTERNA (cistern)
    comporta: function (g, T, cx, cy) {                // comporta de ferro emperrada
      gBlock(g, T, cx, cy, { col: mx(T.wall, '#5a6670', 0.55), w: 66, h: 74, seams: 3, rivets: true });
      part(g, Pel(cx, cy - 46, 15, 15), sh(mx(T.wall, '#5a6670', 0.55), 0.12), { k: 0.26, lw: 0.9 });
      var i;
      for (i = 0; i < 4; i++) {                        // volante travado
        var a = i / 4 * Math.PI;
        stroke(g, [cx - Math.cos(a) * 15, cy - 46 - Math.sin(a) * 15,
                   cx + Math.cos(a) * 15, cy - 46 + Math.sin(a) * 15],
               rgba(sh(T.wall, -0.5), 0.9), 1.1);
      }
      part(g, Pel(cx, cy - 46, 4, 4), sh(T.wall, -0.4), { k: 0.2, lw: 0.7 });
    },
    arcada: function (g, T, cx, cy) {                  // arcada submersa até o meio
      var col = T.wall;
      isoBox(g, cx - 26, cy, 26, 62, col);
      isoBox(g, cx + 26, cy, 26, 62, sh(col, -0.06));
      part(g, tag(function (c2) {                      // arco cheio
        c2.beginPath();
        c2.moveTo(cx - 36, cy - 58);
        c2.quadraticCurveTo(cx, cy - 104, cx + 36, cy - 58);
        c2.lineTo(cx + 36, cy - 44);
        c2.quadraticCurveTo(cx, cy - 84, cx - 36, cy - 44);
        c2.closePath();
      }, cx, cy - 70, 38), sh(col, 0.06), { k: 0.26, hi: 0.14, lw: 0.9 });
      part(g, Pdiamond(cx, cy - 4, 92, 24), rgba('#2f9fe0', 0.42), { flat: true, noline: true });
      stroke(g, [cx - 30, cy - 6, cx - 6, cy - 1, cx + 26, cy - 8], rgba('#b9f2ff', 0.7), 0.9, true);
    },
    barris: function (g, T, cx, cy) {                  // pilha de barris apodrecidos
      gStack(g, T, cx, cy, { col: mx(T.wall, '#7a5a34', 0.62), n: 5, round: true, dy: 26, seed: 'br' });
      part(g, Pel(cx + 4, cy - 78, 12, 5), sh(mx(T.wall, '#7a5a34', 0.62), 0.2), { k: 0.2, lw: 0.8 });
      part(g, Pel(cx - 20, cy - 6, 10, 4), rgba(T.accent, 0.3), { flat: true, noline: true });
    },
    // ------------------------------------------------------ BRASA (forge)
    blocoFerro: function (g, T, cx, cy) {              // bloco de ferro rebitado
      gBlock(g, T, cx, cy, { col: mx(T.wall, '#5d5a58', 0.6), w: 72, h: 82, seams: 2, rivets: true, base: 8 });
      stroke(g, [cx - 30, cy - 40, cx + 6, cy - 56], rgba('#ff8c3a', 0.5), 1.2);
      glow(g, cx - 12, cy - 48, 20, '#ff8c3a', 0.25);
    },
    chamine: function (g, T, cx, cy) {                 // chaminé de tijolo refratário
      gPillar(g, T, cx, cy, { col: mx(T.wall, '#8a4a34', 0.55), h: 78, w: 40, capW: 52, flutes: false });
      var i;
      for (i = 1; i <= 5; i++) boxSeam(g, cx, cy - 12, 40, 78 * (i / 6), rgba('#3a1e18', 0.7), 0.7);
      part(g, Pel(cx, cy - 100, 15, 6), '#2a1410', { k: 0.2, lw: 0.8 });
      part(g, Pel(cx + 2, cy - 112, 11, 8), rgba('#8a7a70', 0.5), { flat: true, noline: true });
      part(g, Pel(cx - 4, cy - 124, 8, 6), rgba('#8a7a70', 0.3), { flat: true, noline: true });
    },
    lingotes: function (g, T, cx, cy) {                // pilha de lingotes empilhados
      gStack(g, T, cx, cy, { col: mx(T.wall, '#8a6a48', 0.5), n: 7, dy: 13, seed: 'lg' });
      part(g, Ppoly([cx - 14, cy - 92, cx + 16, cy - 92, cx + 20, cy - 103, cx - 10, cy - 103]),
           mx(T.accent, '#ffd98a', 0.4), { k: 0.2, hi: 0.24, lw: 0.85 });
      glow(g, cx + 4, cy - 96, 22, T.accent, 0.3);
    },
    // ------------------------------------------------- VENTO (scaffold)
    guindaste: function (g, T, cx, cy) {               // guindaste travado
      var col = mx(T.wall, '#8a7a5a', 0.5);
      gFrame(g, T, cx - 8, cy, { col: col, h: 92, w: 34, posts: 2, rungs: 4, pw: 7, rh: 5, diag: true });
      part(g, Prr(cx + 10, cy - 92, 62, 7, 2), sh(col, 0.1), { k: 0.24, lw: 0.9 });  // lança
      stroke(g, [cx + 36, cy - 88, cx + 36, cy - 42], rgba('#6a6055', 0.9), 1.0);
      part(g, Ppoly([cx + 30, cy - 42, cx + 42, cy - 42, cx + 36, cy - 28]), '#6a6055', { k: 0.24, lw: 0.85 });
      part(g, Pel(cx - 8, cy - 96, 8, 5), T.accent, { k: 0.2, lw: 0.8 });
    },
    tapume: function (g, T, cx, cy) {                  // tapume de tábuas pregadas
      var col = mx(T.wall, '#9a7a4a', 0.6), i;
      for (i = 0; i < 6; i++) {
        part(g, Prr(cx - 30 + i * 12, cy - 42, 11, 84 - (i % 3) * 5, 1),
             i % 2 ? sh(col, -0.12) : col, { k: 0.26, lw: 0.85 });
      }
      part(g, Prr(cx, cy - 26, 76, 7, 1), sh(col, -0.2), { k: 0.24, lw: 0.85 });
      part(g, Prr(cx, cy - 66, 76, 7, 1), sh(col, -0.2), { k: 0.24, lw: 0.85 });
      part(g, Ppoly([cx + 14, cy - 78, cx + 40, cy - 72, cx + 14, cy - 64]), T.accent, { k: 0.2, lw: 0.85 });
    },
    duto: function (g, T, cx, cy) {                    // chaminé de ventilação
      var col = mx(T.wall, '#7a808c', 0.55), i;
      isoBox(g, cx, cy, 56, 12, sh(col, -0.2));
      part(g, Prr(cx, cy - 54, 34, 86, 6), col, { k: 0.28, hi: 0.14, lw: 0.9 });
      for (i = 0; i < 4; i++) {
        part(g, Prr(cx, cy - 22 - i * 22, 40, 6, 3), sh(col, 0.12), { k: 0.22, lw: 0.8 });
      }
      part(g, Ppoly([cx - 20, cy - 96, cx + 20, cy - 96, cx + 26, cy - 108, cx - 14, cy - 108]),
           sh(col, -0.18), { k: 0.26, lw: 0.9 });
      part(g, Pel(cx + 6, cy - 112, 12, 5), rgba(T.accent, 0.35), { flat: true, noline: true });
    },
    // -------------------------------------------------------- MINA (mine)
    escora: function (g, T, cx, cy) {                  // escoramento de galeria
      var col = mx(T.wall, '#7a5a34', 0.62);
      part(g, Prr(cx - 32, cy - 44, 12, 88, 2), col, { k: 0.28, lw: 0.9 });
      part(g, Prr(cx + 32, cy - 44, 12, 88, 2), sh(col, -0.1), { k: 0.28, lw: 0.9 });
      part(g, Prr(cx, cy - 84, 84, 12, 2), sh(col, 0.1), { k: 0.24, lw: 0.9 });
      stroke(g, [cx - 26, cy - 76, cx - 14, cy - 62], rgba(sh(col, -0.4), 0.85), 1.0);
      stroke(g, [cx + 26, cy - 76, cx + 14, cy - 62], rgba(sh(col, -0.4), 0.85), 1.0);
      part(g, Pdiamond(cx, cy - 46, 46, 60), rgba('#100c08', 0.72), { flat: true, noline: true });
      part(g, Pel(cx, cy - 84, 5, 4), rgba(T.accent, 0.7), { k: 0.16, lw: 0.7 });
    },
    desabamento: function (g, T, cx, cy) {             // desabamento antigo
      gMass(g, T, cx, cy, { col: sh(T.wall, -0.06), h: 74, seed: 'dsb', shards: true, tufts: 9 });
      part(g, Prr(cx - 16, cy - 52, 6, 46, 1), mx(T.wall, '#7a5a34', 0.6), { k: 0.26, lw: 0.85, rot: 0.3 });
      part(g, Pel(cx + 16, cy - 44, 4.5, 3.6), rgba(T.accent, 0.8), { k: 0.18, lw: 0.7 });
    },
    silo: function (g, T, cx, cy) {                    // silo de minério
      var col = mx(T.wall, '#6a6258', 0.5);
      isoBox(g, cx, cy, 64, 16, sh(col, -0.24));
      part(g, tag(function (c2) {
        c2.beginPath();
        c2.moveTo(cx - 30, cy - 16); c2.lineTo(cx + 30, cy - 16);
        c2.lineTo(cx + 22, cy - 96); c2.lineTo(cx - 22, cy - 96); c2.closePath();
      }, cx, cy - 56, 30), col, { k: 0.28, hi: 0.14, lw: 0.9 });
      boxSeam(g, cx, cy - 34, 58, 0, rgba(sh(col, -0.5), 0.7), 0.8);
      boxSeam(g, cx, cy - 66, 52, 0, rgba(sh(col, -0.5), 0.7), 0.8);
      part(g, Ppoly([cx - 26, cy - 96, cx + 26, cy - 96, cx + 18, cy - 108, cx - 18, cy - 108]),
           sh(col, 0.14), { k: 0.24, lw: 0.9 });
      part(g, Pshard(cx + 2, cy - 20, 9, 'si'), T.accent, { k: 0.24, lw: 0.85 });
    },
    // ------------------------------------------------- CORAÇÃO (heart)
    costela: function (g, T, cx, cy) {                 // costela de pedra do Coração
      var col = mx(T.wall, '#6a627a', 0.5), i;
      isoBox(g, cx, cy, 56, 10, sh(col, -0.26));
      for (i = 0; i < 3; i++) {
        var lean = (i - 1) * 0.22;
        part(g, tag(function (c2) {
          c2.beginPath();
          c2.moveTo(cx - 12 + i * 12, cy - 10);
          c2.quadraticCurveTo(cx - 30 + i * 16 + lean * 40, cy - 60, cx - 6 + i * 14 + lean * 30, cy - 96);
          c2.quadraticCurveTo(cx + 6 + i * 14 + lean * 30, cy - 60, cx + 2 + i * 12, cy - 10);
          c2.closePath();
        }, cx + i * 12 - 4, cy - 54, 22), i % 2 ? sh(col, 0.08) : col, { k: 0.26, hi: 0.12, lw: 0.9 });
      }
      glow(g, cx + 8, cy - 70, 30, T.accent, 0.3);
    },
    espelho: function (g, T, cx, cy) {                 // muro de espelho fosco
      gPane(g, T, cx, cy, { col: '#d6d0e8', h: 88, w: 70, crack: true, alpha: 0.55 });
      part(g, Prr(cx, cy - 90, 76, 8, 2), mx(T.wall, '#4a4360', 0.6), { k: 0.26, lw: 0.9 });
      part(g, Pel(cx - 12, cy - 56, 11, 20, 0.2), rgba(T.accent, 0.22), { flat: true, noline: true });
      glow(g, cx, cy - 50, 40, T.accent, 0.18);
    },
    colunaQuatro: function (g, T, cx, cy) {            // coluna dos quatro elementos
      gPillar(g, T, cx, cy, { col: mx(T.wall, '#5a5270', 0.4), h: 74, w: 40, capW: 56 });
      var cols = ['#ff8c3a', '#57c8ec', '#9bd06a', '#c8b6ff'], i;
      for (i = 0; i < 4; i++) {
        part(g, Pel(cx - 12 + (i % 2) * 24, cy - 30 - Math.floor(i / 2) * 30, 6.5, 6.5), cols[i],
             { k: 0.2, hi: 0.24, lw: 0.75 });
      }
      part(g, Pstar(cx, cy - 104, 11, 4, 0.34), T.accent, { k: 0.18, lw: 0.8 });
      glow(g, cx, cy - 100, 34, T.accent, 0.42);
    },

    // ======================================================================
    // ADENDO 9-F — divisórias das salas grandes. Duas peças ALTAS a mais por
    // tema. O espaço extra só vira estrutura se cada bloco tiver silhueta
    // própria; repetir a mesma peça seis vezes é o que o adendo veio evitar.
    // ======================================================================
    palmeira: function (g, T, cx, cy) {                // estufa: palmeira tombada de través
      var tronco = mx(T.wall, '#7a5a34', 0.6), folha = mx(T.wall, '#4f8a35', 0.72), i;
      // deitada na diagonal: silhueta HORIZONTAL, o oposto do bambu vertical
      part(g, Pcap(cx - 42, cy - 14, 11, cx + 26, cy - 58, 8), tronco, { k: 0.28, hi: 0.12, lw: 0.9 });
      for (i = 1; i <= 4; i++) {
        var t = i / 5;
        stroke(g, [cx - 42 + 68 * t - 6, cy - 14 - 44 * t - 4, cx - 42 + 68 * t + 6, cy - 14 - 44 * t + 4],
               rgba(sh(tronco, -0.45), 0.85), 0.9);
      }
      for (i = 0; i < 5; i++) {                        // coroa de folhas na ponta alta
        part(g, Pfeather(cx + 28, cy - 60, 30, -2.5 + i * 0.62), i % 2 ? sh(folha, -0.1) : folha,
             { k: 0.24, lw: 0.85 });
      }
      part(g, Pel(cx - 40, cy - 12, 9, 6, 0.3), sh(tronco, 0.16), { k: 0.2, lw: 0.8 });
      part(g, Pel(cx + 6, cy - 24, 7, 4, 0.5), folha, { k: 0.2, lw: 0.75 });
    },
    painelMofo: function (g, T, cx, cy) {              // estufa: painel de vidro embaçado de mofo
      gPane(g, T, cx, cy, { col: '#b8c9a8', h: 84, w: 58, alpha: 0.82 });
      var rd = rng('mofo'), i;
      for (i = 0; i < 10; i++) {                       // manchas de mofo (o que o diferencia da vidraça)
        var x = cx - 24 + rd() * 48, y = cy - 18 - rd() * 58;
        part(g, Pel(x, y, 4 + rd() * 6, 3 + rd() * 5, rd() * 3), rgba(mx('#5f7a3a', T.wall, 0.3), 0.5),
             { flat: true, noline: true });
      }
      part(g, Prr(cx, cy - 46, 6, 74, 1), rgba(mx(T.wall, '#6a5a44', 0.6), 0.95), { k: 0.24, lw: 0.7 });
      part(g, Prr(cx, cy - 46, 60, 5, 1), rgba(mx(T.wall, '#6a5a44', 0.6), 0.95), { k: 0.24, lw: 0.7 });
    },
    colunaSal: function (g, T, cx, cy) {               // cisterna: coluna de sal grossa como carvalho
      var col = mx(T.wall, '#e4e8ea', 0.6), rd = rng('csal'), i;
      isoBox(g, cx, cy, 66, 14, sh(col, -0.3));
      // fuste irregular: não é a coluna lisa, é sal crescido
      part(g, tag(function (c2) {
        c2.beginPath();
        c2.moveTo(cx - 26, cy - 14);
        c2.quadraticCurveTo(cx - 34, cy - 56, cx - 20, cy - 100);
        c2.lineTo(cx + 22, cy - 100);
        c2.quadraticCurveTo(cx + 33, cy - 54, cx + 27, cy - 14);
        c2.closePath();
      }, cx, cy - 58, 30), col, { k: 0.26, hi: 0.2, lw: 0.9 });
      for (i = 0; i < 7; i++) {                        // cristais brotando dos lados
        var yy = cy - 20 - rd() * 74, sx = rd() > 0.5 ? 1 : -1;
        part(g, Ppoly([cx + sx * 24, yy, cx + sx * (36 + rd() * 10), yy - 8 - rd() * 8,
                       cx + sx * 26, yy + 9]), sh(col, 0.2), { k: 0.2, lw: 0.8 });
      }
      glow(g, cx, cy - 60, 40, '#b9f2ff', 0.24);
    },
    telaEclusa: function (g, T, cx, cy) {              // cisterna: tela de eclusa entupida de limo
      var col = mx(T.wall, '#4a5a62', 0.55), i;
      part(g, Prr(cx - 30, cy - 46, 8, 92, 2), col, { k: 0.28, lw: 0.9 });
      part(g, Prr(cx + 30, cy - 46, 8, 92, 2), sh(col, -0.1), { k: 0.28, lw: 0.9 });
      part(g, Prr(cx, cy - 90, 70, 8, 2), sh(col, 0.12), { k: 0.24, lw: 0.9 });
      for (i = 0; i < 5; i++) {                        // grade
        stroke(g, [cx - 24 + i * 12, cy - 86, cx - 24 + i * 12, cy - 6], rgba(sh(col, 0.06), 0.95), 1.1);
      }
      for (i = 0; i < 4; i++) {
        stroke(g, [cx - 28, cy - 20 - i * 18, cx + 28, cy - 20 - i * 18], rgba(sh(col, 0.06), 0.95), 1.0);
      }
      for (i = 0; i < 6; i++) {                        // limo pendurado na grade
        part(g, Pel(cx - 24 + i * 10, cy - 34 + (i % 3) * 10, 7, 12, 0.1),
             rgba(mx('#4f8a55', T.floor, 0.3), 0.72), { k: 0.18, lw: 0.7 });
      }
    },
    fornalha: function (g, T, cx, cy) {                // brasa: fornalha apagada do tamanho de uma casa
      var col = mx(T.wall, '#4a3a34', 0.5);
      gBlock(g, T, cx, cy, { col: col, w: 80, h: 92, seams: 3, base: 10 });
      // boca ENORME e fria: o contraste com o portão de fundição aceso
      part(g, tag(function (c2) {
        c2.beginPath();
        c2.moveTo(cx - 24, cy - 16);
        c2.lineTo(cx - 24, cy - 52);
        c2.quadraticCurveTo(cx, cy - 76, cx + 24, cy - 52);
        c2.lineTo(cx + 24, cy - 16);
        c2.closePath();
      }, cx, cy - 44, 26), '#181010', { k: 0.1, lw: 0.9, line: sh(col, -0.6) });
      var i;
      for (i = 0; i < 3; i++) {                        // cinza fria acumulada na boca
        part(g, Pel(cx - 12 + i * 12, cy - 20, 8, 4), rgba('#6a6058', 0.5), { flat: true, noline: true });
      }
      part(g, Prr(cx, cy - 100, 42, 9, 2), sh(col, 0.14), { k: 0.24, lw: 0.9 });
    },
    prensa: function (g, T, cx, cy) {                  // brasa: prensa emperrada NO ALTO
      var col = mx(T.wall, '#5d5a58', 0.6);
      part(g, Prr(cx - 28, cy - 40, 11, 80, 2), col, { k: 0.28, lw: 0.9 });
      part(g, Prr(cx + 28, cy - 40, 11, 80, 2), sh(col, -0.12), { k: 0.28, lw: 0.9 });
      part(g, Prr(cx, cy - 92, 76, 16, 3), sh(col, 0.12), { k: 0.26, lw: 0.9 });
      // martelo pendurado, parado no meio do curso — a leitura de "emperrada"
      part(g, Prr(cx, cy - 62, 46, 22, 3), mx(col, '#3a3630', 0.4), { k: 0.28, hi: 0.12, lw: 0.9 });
      stroke(g, [cx - 14, cy - 76, cx - 14, cy - 84], rgba(sh(col, -0.4), 0.9), 1.2);
      stroke(g, [cx + 14, cy - 76, cx + 14, cy - 84], rgba(sh(col, -0.4), 0.9), 1.2);
      part(g, Prr(cx, cy - 12, 54, 12, 2), sh(col, -0.2), { k: 0.26, lw: 0.9 });
      glow(g, cx, cy - 20, 22, '#ff8c3a', 0.18);
    },
    elevador: function (g, T, cx, cy) {                // vento: elevador de obra parado entre andares
      var col = mx(T.wall, '#7a808c', 0.5), i;
      for (i = 0; i < 2; i++) {                        // guias
        part(g, Prr(cx - 30 + i * 60, cy - 50, 7, 100, 2), sh(col, -0.16), { k: 0.26, lw: 0.9 });
      }
      // cabine SUSPENSA, com folga visível até o chão
      part(g, Prr(cx, cy - 62, 50, 40, 3), col, { k: 0.28, hi: 0.14, lw: 0.9 });
      part(g, Prr(cx, cy - 62, 38, 26, 2), sh(col, -0.3), { k: 0.18, lw: 0.8 });
      for (i = 0; i < 3; i++) {
        stroke(g, [cx - 16 + i * 16, cy - 74, cx - 16 + i * 16, cy - 50], rgba(sh(col, 0.2), 0.85), 0.9);
      }
      stroke(g, [cx, cy - 82, cx, cy - 98], rgba('#6a6055', 0.95), 1.3);
      part(g, Prr(cx, cy - 100, 30, 7, 2), sh(col, 0.16), { k: 0.24, lw: 0.85 });
      part(g, Pel(cx, cy - 8, 26, 8), rgba(sh(T.wall, -0.5), 0.45), { flat: true, noline: true });
    },
    lona: function (g, T, cx, cy) {                    // vento: lona de proteção inflada pelo vento
      var col = mx(T.accent, T.wall, 0.42), i;
      part(g, Prr(cx - 32, cy - 44, 6, 88, 2), mx(T.wall, '#8a7a5a', 0.5), { k: 0.26, lw: 0.85 });
      part(g, Prr(cx + 32, cy - 44, 6, 88, 2), mx(T.wall, '#8a7a5a', 0.5), { k: 0.26, lw: 0.85 });
      // barriga INFLADA: a única silhueta curva e mole do tema
      part(g, tag(function (c2) {
        c2.beginPath();
        c2.moveTo(cx - 30, cy - 86);
        c2.quadraticCurveTo(cx + 34, cy - 74, cx + 30, cy - 6);
        c2.quadraticCurveTo(cx - 4, cy - 22, cx - 30, cy - 12);
        c2.closePath();
      }, cx, cy - 50, 34), col, { k: 0.28, hi: 0.18, lw: 0.9, rot: LIGHT });
      for (i = 0; i < 3; i++) {                        // vincos da lona
        stroke(g, [cx - 24 + i * 6, cy - 78 + i * 4, cx + 18 + i * 4, cy - 40 + i * 14],
               rgba(sh(col, -0.34), 0.6), 0.9);
      }
      part(g, Pel(cx - 30, cy - 86, 3.4, 3.4), sh(col, -0.4), { k: 0.2, lw: 0.7 });
      part(g, Pel(cx - 30, cy - 12, 3.4, 3.4), sh(col, -0.4), { k: 0.2, lw: 0.7 });
    },
    pilarRocha: function (g, T, cx, cy) {              // mina: pilar deixado de pé para segurar o teto
      var col = sh(T.wall, 0.04), rd = rng('plr'), i;
      // rocha NÃO escavada: cintura fina, topo e base largos (é o que sobra)
      part(g, tag(function (c2) {
        c2.beginPath();
        c2.moveTo(cx - 34, cy - 4);
        c2.quadraticCurveTo(cx - 16, cy - 54, cx - 28, cy - 104);
        c2.lineTo(cx + 30, cy - 104);
        c2.quadraticCurveTo(cx + 17, cy - 52, cx + 35, cy - 4);
        c2.closePath();
      }, cx, cy - 54, 34), col, { k: 0.3, hi: 0.14, lw: 0.9 });
      for (i = 0; i < 4; i++) {                        // marcas de picareta
        var yy = cy - 20 - rd() * 70;
        stroke(g, [cx - 14 + rd() * 26, yy, cx - 6 + rd() * 26, yy - 7], rgba(sh(col, -0.5), 0.8), 1.0);
      }
      part(g, Prr(cx, cy - 108, 74, 10, 2), sh(col, -0.24), { k: 0.26, lw: 0.9 });
      part(g, Pel(cx + 12, cy - 68, 4.5, 3.6), rgba(T.accent, 0.8), { k: 0.18, lw: 0.7 });
    },
    portaGaleria: function (g, T, cx, cy) {            // mina: porta de galeria pregada e lacrada
      var mad = mx(T.wall, '#7a5a34', 0.62), i;
      part(g, Prr(cx - 34, cy - 46, 10, 92, 2), sh(mad, -0.14), { k: 0.28, lw: 0.9 });
      part(g, Prr(cx + 34, cy - 46, 10, 92, 2), sh(mad, -0.14), { k: 0.28, lw: 0.9 });
      part(g, Prr(cx, cy - 90, 88, 11, 2), sh(mad, 0.1), { k: 0.24, lw: 0.9 });
      for (i = 0; i < 6; i++) {                        // tábuas pregadas na diagonal
        part(g, Prr(cx, cy - 16 - i * 13, 58, 11, 1), i % 2 ? mad : sh(mad, -0.1), { k: 0.26, lw: 0.85 });
      }
      stroke(g, [cx - 28, cy - 12, cx + 28, cy - 84], rgba(sh(mad, -0.5), 0.9), 1.4);
      stroke(g, [cx + 28, cy - 12, cx - 28, cy - 84], rgba(sh(mad, -0.5), 0.9), 1.4);
      part(g, Pel(cx, cy - 48, 5, 5), mx(T.accent, '#c04a34', 0.5), { k: 0.2, lw: 0.8 });
    },
    pilarPartido: function (g, T, cx, cy) {            // coração: pilar partido ao meio que não caiu
      var col = mx(T.wall, '#6a627a', 0.5);
      isoBox(g, cx, cy, 58, 10, sh(col, -0.26));
      // metade de baixo reta, metade de cima DESLOCADA e flutuando
      part(g, Ppoly([cx - 22, cy - 10, cx + 22, cy - 10, cx + 20, cy - 50, cx - 20, cy - 50]),
           col, { k: 0.28, hi: 0.14, lw: 0.9 });
      stroke(g, [cx - 20, cy - 50, cx - 6, cy - 44, cx + 8, cy - 52, cx + 20, cy - 46],
             rgba(sh(col, -0.55), 0.9), 1.2, true);
      part(g, Ppoly([cx - 16, cy - 60, cx + 24, cy - 58, cx + 22, cy - 100, cx - 14, cy - 100]),
           sh(col, 0.08), { k: 0.26, hi: 0.14, lw: 0.9 });
      part(g, Prr(cx + 4, cy - 104, 52, 9, 2), sh(col, 0.16), { k: 0.24, lw: 0.9 });
      // a fresta entre as metades brilha: é o que prova que ele "não caiu"
      part(g, Ppoly([cx - 18, cy - 52, cx + 22, cy - 50, cx + 22, cy - 58, cx - 16, cy - 60]),
           rgba(T.accent, 0.45), { flat: true, noline: true });
      glow(g, cx + 2, cy - 55, 32, T.accent, 0.4);
    },
    lascaMundo: function (g, T, cx, cy) {              // coração: lasca de mundo suspensa e imóvel
      var col = mx(T.wall, '#5a5270', 0.44), i;
      // NADA toca o chão: só a sombra embaixo — silhueta única no jogo
      part(g, Pel(cx, cy - 4, 30, 10), rgba(sh(T.wall, -0.6), 0.5), { flat: true, noline: true });
      part(g, tag(function (c2) {
        c2.beginPath();
        c2.moveTo(cx - 36, cy - 60);
        c2.lineTo(cx + 32, cy - 72);
        c2.lineTo(cx + 20, cy - 40);
        c2.lineTo(cx - 6, cy - 26);
        c2.closePath();
      }, cx - 2, cy - 52, 36), col, { k: 0.28, hi: 0.16, lw: 0.9 });
      // grama/piso ainda agarrado no topo da lasca
      part(g, Ppoly([cx - 36, cy - 60, cx + 32, cy - 72, cx + 30, cy - 78, cx - 34, cy - 66]),
           mx(T.accent, '#6a8a55', 0.4), { k: 0.2, lw: 0.8 });
      for (i = 0; i < 4; i++) {                        // pedrinhas paradas no ar em volta
        var a = -0.4 + i * 0.7;
        part(g, Pshard(cx - 30 + i * 22, cy - 88 - Math.sin(a) * 14, 5 + (i % 2) * 3, 'lm' + i),
             sh(col, 0.1), { k: 0.22, lw: 0.75 });
      }
      glow(g, cx, cy - 56, 44, T.accent, 0.26);
    }
  };
  var LOW = {
    planter: function (g, T, cx, cy, v) {
      isoBox(g, cx, cy, 68, 22, mx(T.wall, '#8a6b3f', 0.55));
      var rd = rng('pl' + v), i;
      for (i = 0; i < 5; i++) {
        var a = rd() * TAU, rr = 8 + rd() * 16;
        part(g, Pel(cx + Math.cos(a) * rr, cy - 28 + Math.sin(a) * rr * 0.5, 8, 6, rd()),
             mx(T.wall, '#66a83f', 0.7), { k: 0.2, lw: 0.8 });
      }
      part(g, Pel(cx + 8, cy - 34, 4, 4), T.accent, { k: 0.16, lw: 0.7 });
    },
    canal: function (g, T, cx, cy, v) {
      isoBox(g, cx, cy, 74, 10, sh(T.wall, -0.1));
      part(g, Pdiamond(cx, cy - 12, 56, 28), mx('#2f9fe0', T.floor, 0.25), { k: 0.18, lw: 0.8 });
      stroke(g, [cx - 18, cy - 12, cx - 4, cy - 6, cx + 12, cy - 14], rgba('#b9f2ff', 0.8), 0.8, true);
      stroke(g, [cx - 8, cy - 20, cx + 6, cy - 16], rgba('#b9f2ff', 0.5), 0.7, true);
    },
    veio: function (g, T, cx, cy, v) {
      isoBox(g, cx, cy, 72, 12, sh(T.wall, -0.16));
      part(g, Pdiamond(cx, cy - 14, 54, 26), '#3a1610', { k: 0.2, lw: 0.8 });
      part(g, Pdiamond(cx, cy - 14, 40, 19), '#ff6a1e', { k: 0.16, lw: 0.7 });
      part(g, Pdiamond(cx, cy - 15, 22, 10), '#ffd98a', { k: 0.14, lw: 0.6 });
      glow(g, cx, cy - 14, 34, '#ff8c3a', 0.42);
    },
    caixa: function (g, T, cx, cy, v) {
      isoBox(g, cx, cy, 56, 34, mx(T.wall, '#9a7a4a', 0.55));
      stroke(g, [cx - 28, cy - 20, cx, cy - 6, cx + 28, cy - 20], sh(mx(T.wall, '#9a7a4a', 0.55), -0.34), 0.8, true);
      part(g, Prr(cx, cy - 40, 30, 6, 2), mx(T.wall, '#7a5a34', 0.5), { k: 0.24, lw: 0.85 });
    },
    entulho: function (g, T, cx, cy, v) {
      var rd = rng('en' + v), i;
      for (i = 0; i < 5; i++) {
        part(g, Pshard(cx - 20 + rd() * 40, cy - 6 - rd() * 22, 9 + rd() * 8, 'e' + v + i),
             sh(T.wall, -0.08 + rd() * 0.3), { k: 0.28, lw: 0.85 });
      }
      part(g, Prr(cx + 10, cy - 24, 5, 30, 2), mx(T.wall, '#8a6b3f', 0.6), { k: 0.26, lw: 0.85 });
    },
    runa: function (g, T, cx, cy, v) {
      isoBox(g, cx, cy, 64, 16, sh(T.wall, -0.08));
      part(g, Pdiamond(cx, cy - 18, 46, 23), sh(T.wall, 0.14), { k: 0.16, lw: 0.8 });
      part(g, Pstar(cx, cy - 18, 12, 4, 0.36), T.accent, { k: 0.16, lw: 0.8 });
      glow(g, cx, cy - 18, 26, T.accent, 0.4);
    },

    // ---------------------------------------------------- ESTUFA (garden)
    mureta: function (g, T, cx, cy) {                  // muretinha de tijolo com musgo
      gCurb(g, T, cx, cy, { col: mx(T.wall, '#a06a48', 0.6), w: 72, h: 24, seams: 3, moss: true });
    },
    carrinhoJ: function (g, T, cx, cy) {               // carrinho de jardinagem tombado
      gCart(g, T, cx, cy, { col: mx(T.wall, '#8a6b3f', 0.5), tip: 0.24, load: mx(T.wall, '#4f8a35', 0.7) });
      part(g, Pfeather(cx + 14, cy - 30, 18, -1.1), mx(T.wall, '#4f8a35', 0.7), { k: 0.22, lw: 0.8 });
    },
    vasos: function (g, T, cx, cy) {                   // fileira de vasos quebrados
      var col = mx(T.wall, '#b07a4a', 0.66), i;
      for (i = 0; i < 3; i++) {
        var x = cx - 20 + i * 20, hh = 20 - (i % 2) * 5;
        part(g, Ppoly([x - 11, cy - hh, x + 11, cy - hh, x + 8, cy - 1, x - 8, cy - 1]),
             i % 2 ? sh(col, -0.12) : col, { k: 0.26, hi: 0.12, lw: 0.85 });
        part(g, Pel(x, cy - hh, 11, 4), sh(col, -0.22), { k: 0.2, lw: 0.8 });
        if (i === 1) stroke(g, [x - 4, cy - hh, x + 2, cy - 6], rgba(sh(col, -0.5), 0.85), 0.9);
      }
      part(g, Pel(cx + 24, cy - 6, 7, 4, 0.4), mx(T.wall, '#4f8a35', 0.7), { k: 0.2, lw: 0.75 });
    },
    tora: function (g, T, cx, cy) {                    // tora caída coberta de hera
      var col = mx(T.wall, '#7a5a34', 0.6), i;
      part(g, Pcap(cx - 30, cy - 12, 11, cx + 30, cy - 9, 10), col, { k: 0.28, hi: 0.12, lw: 0.9 });
      part(g, Pel(cx + 30, cy - 9, 5, 10), sh(col, 0.14), { k: 0.2, lw: 0.8 });
      part(g, Pel(cx + 30, cy - 9, 2.4, 5), sh(col, -0.2), { flat: true, noline: true });
      for (i = 0; i < 5; i++) {
        part(g, Pel(cx - 24 + i * 12, cy - 20 + (i % 2) * 5, 7, 4, 0.4 + i),
             mx(T.wall, '#5f9a38', 0.72), { k: 0.2, lw: 0.75 });
      }
    },
    // -------------------------------------------------- CISTERNA (cistern)
    degrau: function (g, T, cx, cy) {                  // degrau de sal cristalizado
      var col = mx(T.wall, '#dcd8cf', 0.55);
      isoBox(g, cx, cy, 72, 12, col);
      isoBox(g, cx - 6, cy - 12, 52, 12, sh(col, 0.1));
      var i;
      for (i = 0; i < 4; i++) {
        part(g, Pshard(cx - 20 + i * 14, cy - 28 - (i % 2) * 5, 6, 'sal' + i), sh(col, 0.22),
             { k: 0.16, lw: 0.7 });
      }
      glow(g, cx, cy - 22, 24, '#b9f2ff', 0.22);
    },
    banco: function (g, T, cx, cy) {                   // banco de baile emborcado
      var col = mx(T.wall, '#8a6b3f', 0.55);
      g.save(); g.translate(cx, cy); g.rotate(0.16); g.translate(-cx, -cy);
      part(g, Prr(cx, cy - 24, 66, 9, 2), col, { k: 0.26, hi: 0.12, lw: 0.9 });
      part(g, Prr(cx - 22, cy - 12, 7, 24, 1), sh(col, -0.14), { k: 0.24, lw: 0.85 });
      part(g, Prr(cx + 22, cy - 12, 7, 24, 1), sh(col, -0.14), { k: 0.24, lw: 0.85 });
      part(g, Prr(cx, cy - 34, 58, 6, 2), sh(col, 0.14), { k: 0.22, lw: 0.85 });
      g.restore();
    },
    cano: function (g, T, cx, cy) {                    // cano rompido escorrendo
      var col = mx(T.wall, '#6a727c', 0.6);
      part(g, Pcap(cx - 34, cy - 18, 9, cx + 22, cy - 20, 9), col, { k: 0.28, hi: 0.12, lw: 0.9 });
      part(g, Pel(cx + 22, cy - 20, 5, 10), sh(col, -0.24), { k: 0.2, lw: 0.85 });
      part(g, Prr(cx - 10, cy - 20, 8, 22, 2), sh(col, 0.12), { k: 0.24, lw: 0.85 });
      stroke(g, [cx + 24, cy - 18, cx + 27, cy - 8, cx + 25, cy - 1], rgba('#7fd8f4', 0.85), 1.3, true);
      part(g, Pel(cx + 26, cy - 1, 12, 4.5), rgba('#2f9fe0', 0.5), { flat: true, noline: true });
    },
    perolas: function (g, T, cx, cy) {                 // amontoado de pérolas calcificadas
      var rd = rng('pe'), i;
      part(g, Pel(cx, cy - 6, 30, 11), rgba(sh(T.wall, -0.3), 0.6), { flat: true, noline: true });
      for (i = 0; i < 9; i++) {
        var a = rd() * TAU, rr = rd() * 22;
        part(g, Pel(cx + Math.cos(a) * rr, cy - 8 - Math.abs(Math.sin(a)) * 14, 6 + rd() * 4,
                    6 + rd() * 4), mx('#f0ece0', T.accent, rd() * 0.4), { k: 0.16, hi: 0.3, lw: 0.75 });
      }
      glow(g, cx, cy - 14, 26, '#b9f2ff', 0.24);
    },
    // ------------------------------------------------------ BRASA (forge)
    bigornaB: function (g, T, cx, cy) {                // bigorna abandonada
      var col = mx(T.wall, '#6a5a4a', 0.5);
      isoBox(g, cx, cy, 44, 14, col);
      part(g, Prr(cx, cy - 24, 16, 16, 2), '#5a5f66', { k: 0.26, lw: 0.9 });
      part(g, Ppoly([cx - 26, cy - 42, cx + 20, cy - 42, cx + 30, cy - 36, cx + 14, cy - 32,
                     cx - 20, cy - 32]), '#7a828c', { k: 0.24, hi: 0.16, lw: 0.9 });
      stroke(g, [cx - 18, cy - 38, cx + 12, cy - 38], rgba('#3a3f46', 0.8), 0.8);
    },
    escoria: function (g, T, cx, cy) {                 // mureta de contenção de escória
      gCurb(g, T, cx, cy, { col: mx(T.wall, '#5a4a44', 0.6), w: 74, h: 26, seams: 2 });
      var i;
      for (i = 0; i < 4; i++) {
        part(g, Pshard(cx - 22 + i * 15, cy - 30 - (i % 2) * 4, 7, 'esc' + i),
             mx('#3a1e18', '#ff6a1e', 0.25 + (i % 2) * 0.2), { k: 0.22, lw: 0.8 });
      }
      glow(g, cx, cy - 30, 28, '#ff8c3a', 0.24);
    },
    tempera: function (g, T, cx, cy) {                 // fosso de têmpera com borda
      gBasin(g, T, cx, cy, { col: mx(T.wall, '#4a4038', 0.5), w: 76, h: 14,
                             liquid: '#2a3a44', inner: rgba('#8fd4ec', 0.55), spark: '#cfeeff' });
      var i;
      for (i = 0; i < 3; i++) {
        part(g, Pel(cx - 12 + i * 12, cy - 24 - i * 7, 5 - i, 3.4 - i * 0.6),
             rgba('#e8e4dc', 0.4 - i * 0.1), { flat: true, noline: true });
      }
    },
    carvao: function (g, T, cx, cy) {                  // carrinho de carvão
      gCart(g, T, cx, cy, { col: mx(T.wall, '#5a4a3a', 0.55), load: '#241c18' });
      var rd = rng('cv'), i;
      for (i = 0; i < 5; i++) {
        part(g, Pshard(cx - 14 + rd() * 28, cy - 32 - rd() * 6, 5 + rd() * 3, 'cv' + i), '#2a2220',
             { k: 0.2, lw: 0.7 });
      }
      glow(g, cx + 6, cy - 32, 16, '#ff8c3a', 0.2);
    },
    molde: function (g, T, cx, cy) {                   // molde de areia rachado
      var col = mx(T.wall, '#b0a284', 0.62);
      isoBox(g, cx, cy, 70, 18, col);
      part(g, Pdiamond(cx, cy - 20, 50, 25), sh(col, -0.16), { k: 0.16, lw: 0.8 });
      stroke(g, [cx - 20, cy - 22, cx - 2, cy - 16, cx + 18, cy - 24], rgba(sh(col, -0.55), 0.9), 0.9, true);
      stroke(g, [cx - 4, cy - 28, cx + 2, cy - 12], rgba(sh(col, -0.55), 0.7), 0.7);
    },
    // ------------------------------------------------- VENTO (scaffold)
    guardaCorpo: function (g, T, cx, cy) {             // guarda-corpo de corda e tábua
      gBeam(g, T, cx, cy, { col: mx(T.wall, '#9a7a4a', 0.55), rope: true });
      part(g, Pel(cx, cy - 18, 3.4, 3.4), mx(T.wall, '#e8dcc0', 0.5), { k: 0.2, lw: 0.7 });
    },
    vigas: function (g, T, cx, cy) {                   // pilha de vigas amarradas
      gStack(g, T, cx, cy, { col: mx(T.wall, '#9a7a4a', 0.6), n: 5, dy: 11, seed: 'vg' });
      stroke(g, [cx - 16, cy - 6, cx - 12, cy - 40], rgba('#6a5a44', 0.9), 1.2);
      stroke(g, [cx + 18, cy - 6, cx + 14, cy - 40], rgba('#6a5a44', 0.9), 1.2);
    },
    brita: function (g, T, cx, cy) {                   // saco de brita de lastro
      gHeap(g, T, cx, cy, { col: sh(T.wall, -0.08), n: 4, seed: 'bt', sack: true });
    },
    roldana: function (g, T, cx, cy) {                 // roldana caída de lado
      var col = mx(T.wall, '#7a6a54', 0.55);
      part(g, Pel(cx, cy - 14, 20, 20), col, { k: 0.28, hi: 0.14, lw: 0.9 });
      part(g, Pel(cx, cy - 14, 12, 12), sh(col, -0.28), { k: 0.2, lw: 0.85 });
      part(g, Pel(cx, cy - 14, 4, 4), sh(col, 0.2), { k: 0.16, lw: 0.7 });
      stroke(g, [cx - 20, cy - 12, cx - 34, cy - 2], rgba(mx(col, '#e8dcc0', 0.5), 0.9), 1.2);
      stroke(g, [cx + 20, cy - 16, cx + 32, cy - 6], rgba(mx(col, '#e8dcc0', 0.5), 0.9), 1.2);
    },
    // -------------------------------------------------------- MINA (mine)
    vagonete: function (g, T, cx, cy) {                // vagonete emborcado
      gCart(g, T, cx, cy, { col: mx(T.wall, '#6a6258', 0.5), tip: -0.3, load: T.accent });
    },
    trilho: function (g, T, cx, cy) {                  // trilho elevado
      var col = mx(T.wall, '#6a6258', 0.5), i;
      for (i = 0; i < 4; i++) {
        part(g, Prr(cx - 24 + i * 16, cy - 6, 13, 6, 1), mx(T.wall, '#7a5a34', 0.6), { k: 0.24, lw: 0.8 });
      }
      part(g, Pcap(cx - 34, cy - 14, 3.4, cx + 34, cy - 18, 3.4), col, { k: 0.24, lw: 0.85 });
      part(g, Pcap(cx - 30, cy - 4, 3.4, cx + 38, cy - 8, 3.4), sh(col, 0.1), { k: 0.24, lw: 0.85 });
    },
    dinamite: function (g, T, cx, cy) {                // caixa de dinamite úmida
      gCrate(g, T, cx, cy, { col: mx(T.wall, '#8a6b3f', 0.55), w: 52, h: 30, lid: true, strap: true });
      part(g, Pel(cx - 4, cy - 42, 5, 9), '#c04a34', { k: 0.24, lw: 0.85 });
      part(g, Pel(cx + 6, cy - 42, 5, 9), '#c04a34', { k: 0.24, lw: 0.85 });
      stroke(g, [cx + 6, cy - 50, cx + 14, cy - 58], rgba('#3a3128', 0.9), 0.9);
    },
    cavalete: function (g, T, cx, cy) {                // vira-cavalete de escoramento
      var col = mx(T.wall, '#7a5a34', 0.6);
      part(g, Prr(cx, cy - 30, 62, 8, 2), col, { k: 0.26, lw: 0.9 });
      stroke(g, [cx - 22, cy - 28, cx - 30, cy - 2], rgba(sh(col, -0.24), 1), 2.6);
      stroke(g, [cx - 14, cy - 28, cx - 4, cy - 2], rgba(sh(col, -0.24), 1), 2.6);
      stroke(g, [cx + 16, cy - 28, cx + 8, cy - 2], rgba(sh(col, -0.32), 1), 2.6);
      stroke(g, [cx + 24, cy - 28, cx + 32, cy - 2], rgba(sh(col, -0.32), 1), 2.6);
      part(g, Prr(cx, cy - 16, 44, 5, 1), sh(col, 0.12), { k: 0.22, lw: 0.8 });
    },
    // ------------------------------------------------- CORAÇÃO (heart)
    basalto: function (g, T, cx, cy) {                 // degrau de basalto rachado
      var col = mx(T.wall, '#3a3448', 0.5);
      isoBox(g, cx, cy, 72, 14, col);
      isoBox(g, cx - 4, cy - 14, 54, 12, sh(col, 0.08));
      stroke(g, [cx - 22, cy - 28, cx - 4, cy - 20, cx + 16, cy - 30], rgba('#1a1626', 0.9), 1.0, true);
      part(g, Pel(cx + 6, cy - 24, 6, 3), rgba(T.accent, 0.4), { flat: true, noline: true });
    },
    caco: function (g, T, cx, cy) {                    // caco de espelho encravado
      var i;
      part(g, Pel(cx, cy - 4, 26, 9), rgba(sh(T.wall, -0.4), 0.5), { flat: true, noline: true });
      for (i = 0; i < 3; i++) {
        var lean = (i - 1) * 0.3;
        part(g, Ppoly([cx - 8 + i * 12, cy - 4, cx - 2 + i * 12 + lean * 18, cy - 30 - i * 6,
                       cx + 6 + i * 12, cy - 6]), rgba('#d6d0e8', 0.72),
             { k: 0.14, lw: 0.85, line: sh(T.wall, -0.55) });
      }
      glow(g, cx + 4, cy - 22, 24, T.accent, 0.28);
    },
    bacia: function (g, T, cx, cy) {                   // bacia elemental transbordando
      gBasin(g, T, cx, cy, { col: mx(T.wall, '#4a4360', 0.5), w: 70, h: 16,
                             liquid: mx(T.accent, '#4a4360', 0.4), inner: T.accent,
                             spark: '#f0eaff', glow: T.accent });
      var cols = ['#ff8c3a', '#57c8ec', '#9bd06a', '#c8b6ff'], i;
      for (i = 0; i < 4; i++) {
        part(g, Pel(cx - 24 + i * 16, cy - 6, 3.4, 3.0), cols[i], { k: 0.18, lw: 0.7 });
      }
    },
    raizCoracao: function (g, T, cx, cy) {             // raiz-do-coração grossa
      var col = mx(T.wall, '#5a3a44', 0.55);
      part(g, Pcap(cx - 34, cy - 8, 8, cx - 4, cy - 22, 10), col, { k: 0.28, hi: 0.12, lw: 0.9 });
      part(g, Pcap(cx - 4, cy - 22, 10, cx + 32, cy - 10, 7), sh(col, -0.06), { k: 0.28, lw: 0.9 });
      part(g, Pcap(cx - 2, cy - 20, 5, cx + 10, cy - 34, 3), sh(col, 0.1), { k: 0.24, lw: 0.85 });
      stroke(g, [cx - 26, cy - 12, cx - 4, cy - 24, cx + 24, cy - 14], rgba(sh(col, -0.45), 0.85), 0.9, true);
      glow(g, cx - 2, cy - 22, 22, T.accent, 0.24);
    },
    anelCinza: function (g, T, cx, cy) {               // anel de cinza compactada
      var col = mx(T.wall, '#8a8290', 0.55), i;
      part(g, Pdiamond(cx, cy - 6, 74, 37), sh(col, -0.16), { k: 0.16, lw: 0.8 });
      part(g, Pdiamond(cx, cy - 8, 46, 23), sh(col, 0.14), { k: 0.14, lw: 0.75 });
      for (i = 0; i < 6; i++) {
        var a = i / 6 * TAU;
        part(g, Pel(cx + Math.cos(a) * 28, cy - 8 + Math.sin(a) * 14, 4, 2.6), sh(col, 0.3),
             { flat: true, noline: true });
      }
      part(g, Pel(cx, cy - 14, 8, 4), rgba(T.accent, 0.4), { flat: true, noline: true });
    },

    // ======================================================================
    // ADENDO 9-F — duas coberturas a mais por tema (7 no total).
    // ======================================================================
    floreira: function (g, T, cx, cy) {                // estufa: floreira comprida de pedra
      var col = mx(T.wall, '#9a9284', 0.55), i;
      // COMPRIDA: ocupa a largura toda e é rasa — silhueta oposta ao canteiro
      isoBox(g, cx, cy, 86, 16, col);
      part(g, Pdiamond(cx, cy - 18, 64, 32), sh(col, -0.34), { k: 0.14, lw: 0.75 });
      for (i = 0; i < 6; i++) {
        part(g, Pel(cx - 26 + i * 11, cy - 22 - (i % 3) * 5, 7, 5, 0.3 + i),
             mx(T.wall, '#5f9a38', 0.72), { k: 0.2, lw: 0.75 });
      }
      part(g, Pel(cx - 8, cy - 30, 4, 4), '#e8746a', { k: 0.16, lw: 0.7 });
      part(g, Pel(cx + 18, cy - 27, 3.4, 3.4), T.accent, { k: 0.16, lw: 0.7 });
    },
    cercaViva: function (g, T, cx, cy) {               // estufa: cerca-viva podada na altura do peito
      var folha = mx(T.wall, '#4f8a35', 0.6), rd = rng('cvv'), i;
      // BLOCO retangular podado: a sebe alta é orgânica, esta é geométrica
      isoBox(g, cx, cy, 76, 30, folha);
      for (i = 0; i < 9; i++) {                        // textura de folhagem só nas bordas do topo
        var a = rd() * TAU, rr = 14 + rd() * 22;
        part(g, Pel(cx + Math.cos(a) * rr, cy - 32 + Math.sin(a) * rr * 0.42, 6 + rd() * 3,
                    4 + rd() * 2, rd()), sh(folha, 0.14 + rd() * 0.14), { k: 0.18, lw: 0.7 });
      }
      stroke(g, [cx - 38, cy - 30, cx, cy - 11, cx + 38, cy - 30], rgba(sh(folha, -0.45), 0.55), 0.8);
    },
    muretaComporta: function (g, T, cx, cy) {          // cisterna: mureta de comporta na cintura
      var col = mx(T.wall, '#5a6670', 0.55);
      gCurb(g, T, cx, cy, { col: col, w: 76, h: 30, seams: 2 });
      part(g, Prr(cx, cy - 34, 22, 8, 2), sh(col, 0.14), { k: 0.24, lw: 0.85 });
      part(g, Pel(cx, cy - 44, 9, 9), sh(col, 0.2), { k: 0.24, lw: 0.85 });   // volante pequeno
      var i;
      for (i = 0; i < 3; i++) {
        var a = i / 3 * Math.PI;
        stroke(g, [cx - Math.cos(a) * 9, cy - 44 - Math.sin(a) * 9,
                   cx + Math.cos(a) * 9, cy - 44 + Math.sin(a) * 9], rgba(sh(col, -0.5), 0.9), 0.9);
      }
    },
    passarela: function (g, T, cx, cy) {               // cisterna: passarela de tábua encalhada de lado
      var col = mx(T.wall, '#8a6b3f', 0.58), i;
      g.save(); g.translate(cx, cy); g.rotate(-0.42); g.translate(-cx, -cy);
      for (i = 0; i < 5; i++) {                        // DE LADO: as tábuas viram uma parede baixa
        part(g, Prr(cx - 26 + i * 13, cy - 18, 11, 40, 1), i % 2 ? sh(col, -0.12) : col,
             { k: 0.26, lw: 0.85 });
      }
      part(g, Prr(cx, cy - 32, 68, 6, 1), sh(col, -0.24), { k: 0.24, lw: 0.85 });
      g.restore();
      part(g, Pel(cx + 4, cy - 3, 24, 8), rgba('#2f9fe0', 0.4), { flat: true, noline: true });
    },
    trilhoLingote: function (g, T, cx, cy) {           // brasa: trilho elevado de vagoneta de lingote
      var col = mx(T.wall, '#6a5a4a', 0.5), i;
      for (i = 0; i < 3; i++) {                        // cavaletes que ERGUEM o trilho
        part(g, Prr(cx - 26 + i * 26, cy - 12, 8, 24, 1), sh(col, -0.16), { k: 0.26, lw: 0.85 });
      }
      part(g, Pcap(cx - 36, cy - 26, 4, cx + 36, cy - 30, 4), '#7a828c', { k: 0.24, lw: 0.85 });
      part(g, Pcap(cx - 34, cy - 34, 4, cx + 38, cy - 38, 4), '#8a929c', { k: 0.24, lw: 0.85 });
      part(g, Ppoly([cx - 8, cy - 40, cx + 14, cy - 40, cx + 18, cy - 50, cx - 4, cy - 50]),
           mx(T.accent, '#ffd98a', 0.4), { k: 0.2, hi: 0.24, lw: 0.85 });
      glow(g, cx + 5, cy - 45, 20, T.accent, 0.3);
    },
    blocoTempera: function (g, T, cx, cy) {            // brasa: bloco de têmpera com a água já seca
      var col = mx(T.wall, '#4a4038', 0.55);
      isoBox(g, cx, cy, 68, 28, col);
      part(g, Pdiamond(cx, cy - 30, 50, 25), sh(col, -0.4), { k: 0.12, lw: 0.8 });
      // crosta de sal/ferrugem no fundo seco — o oposto do fosso cheio
      var rd = rng('bt2'), i;
      for (i = 0; i < 6; i++) {
        part(g, Pel(cx - 16 + rd() * 32, cy - 30 + (rd() - 0.5) * 12, 4 + rd() * 4, 2 + rd() * 2),
             rgba(mx('#8a5a3a', T.accent, 0.3), 0.55), { flat: true, noline: true });
      }
      stroke(g, [cx - 18, cy - 32, cx, cy - 27, cx + 16, cy - 33], rgba(sh(col, -0.6), 0.8), 0.9, true);
    },
    estrado: function (g, T, cx, cy) {                 // vento: estrado de tábua empilhado
      var col = mx(T.wall, '#9a7a4a', 0.6), i, j;
      for (j = 0; j < 3; j++) {                        // 3 paletes, um sobre o outro
        var yy = cy - j * 11;
        part(g, Ppoly([cx - 34, yy, cx, yy + 16, cx + 34, yy, cx, yy - 16]),
             j % 2 ? sh(col, -0.1) : col, { k: 0.22, lw: 0.85 });
        for (i = 0; i < 3; i++) {
          stroke(g, [cx - 22 + i * 15, yy - 9, cx - 10 + i * 15, yy + 4], rgba(sh(col, -0.45), 0.6), 0.7);
        }
      }
    },
    roloCabo: function (g, T, cx, cy) {                // vento: rolo de cabo de aço na altura do joelho
      var col = mx(T.wall, '#7a828c', 0.5), i;
      part(g, Pel(cx, cy - 6, 30, 12), sh(col, -0.28), { k: 0.2, lw: 0.85 });
      for (i = 0; i < 4; i++) {                        // espiras empilhadas
        part(g, Pel(cx, cy - 10 - i * 6, 28 - i * 2.5, 11 - i), i % 2 ? col : sh(col, 0.12),
             { k: 0.24, hi: 0.12, lw: 0.85 });
      }
      stroke(g, [cx + 24, cy - 30, cx + 36, cy - 12, cx + 30, cy - 2],
             rgba(sh(col, 0.14), 0.95), 1.3, true);
      part(g, Pel(cx + 30, cy - 2, 3, 2.4), sh(col, -0.3), { k: 0.18, lw: 0.7 });
    },
    vigaCaida: function (g, T, cx, cy) {               // mina: viga de escoramento caída atravessada
      var col = mx(T.wall, '#7a5a34', 0.62), i;
      g.save(); g.translate(cx, cy); g.rotate(0.3); g.translate(-cx, -cy);
      part(g, Prr(cx, cy - 14, 84, 15, 2), col, { k: 0.28, hi: 0.12, lw: 0.9 });
      for (i = 0; i < 4; i++) {
        stroke(g, [cx - 30 + i * 20, cy - 21, cx - 30 + i * 20, cy - 7], rgba(sh(col, -0.45), 0.75), 0.85);
      }
      g.restore();
      part(g, Pshard(cx - 32, cy - 6, 8, 'vc1'), sh(T.wall, -0.06), { k: 0.26, lw: 0.8 });
      part(g, Pshard(cx + 30, cy - 5, 7, 'vc2'), sh(T.wall, 0.06), { k: 0.26, lw: 0.8 });
    },
    britagem: function (g, T, cx, cy) {                // mina: bancada de britagem quebrada
      var col = mx(T.wall, '#6a6258', 0.5), i;
      isoBox(g, cx, cy, 64, 22, col);
      // funil rachado por cima, tombado para um lado
      part(g, Ppoly([cx - 24, cy - 24, cx + 22, cy - 24, cx + 14, cy - 48, cx - 12, cy - 46]),
           sh(col, 0.12), { k: 0.26, hi: 0.12, lw: 0.9 });
      stroke(g, [cx - 6, cy - 46, cx + 2, cy - 32, cx - 2, cy - 25], rgba(sh(col, -0.55), 0.9), 1.0, true);
      for (i = 0; i < 4; i++) {                        // brita derramada na boca
        part(g, Pshard(cx - 12 + i * 9, cy - 22 - (i % 2) * 4, 5, 'brg' + i), sh(T.wall, -0.14),
             { k: 0.24, lw: 0.75 });
      }
    },
    soleira: function (g, T, cx, cy) {                 // coração: soleira de mármore partida
      var col = mx(T.wall, '#c8c2d4', 0.5);
      // duas metades AFASTADAS, com a fenda no meio
      part(g, Ppoly([cx - 40, cy - 4, cx - 6, cy - 14, cx - 8, cy - 28, cx - 42, cy - 18]),
           col, { k: 0.24, hi: 0.18, lw: 0.9 });
      part(g, Ppoly([cx + 4, cy - 15, cx + 40, cy - 5, cx + 42, cy - 19, cx + 6, cy - 29]),
           sh(col, -0.08), { k: 0.24, hi: 0.14, lw: 0.9 });
      part(g, Ppoly([cx - 6, cy - 14, cx + 4, cy - 15, cx + 6, cy - 29, cx - 8, cy - 28]),
           rgba(T.accent, 0.35), { flat: true, noline: true });
      stroke(g, [cx - 34, cy - 20, cx - 14, cy - 24], rgba(sh(col, -0.4), 0.55), 0.8);
      glow(g, cx, cy - 20, 22, T.accent, 0.26);
    },
    bancoEstacoes: function (g, T, cx, cy) {           // coração: banco de pedra das quatro estações
      var col = mx(T.wall, '#7a7288', 0.5);
      part(g, Prr(cx - 26, cy - 12, 12, 24, 2), sh(col, -0.18), { k: 0.26, lw: 0.9 });
      part(g, Prr(cx + 26, cy - 12, 12, 24, 2), sh(col, -0.18), { k: 0.26, lw: 0.9 });
      part(g, Prr(cx, cy - 28, 76, 12, 3), col, { k: 0.26, hi: 0.16, lw: 0.9 });
      var cols = ['#9bd06a', '#ff8c3a', '#c8b6ff', '#57c8ec'], i;
      for (i = 0; i < 4; i++) {                        // as quatro estações no encosto
        part(g, Pel(cx - 24 + i * 16, cy - 38, 5, 5), cols[i], { k: 0.2, hi: 0.24, lw: 0.75 });
      }
      stroke(g, [cx - 34, cy - 34, cx + 34, cy - 34], rgba(sh(col, -0.45), 0.7), 0.85);
    }
  };
  var PROPS = {
    samambaia: function (g, T, cx, cy) {
      var i;
      for (i = 0; i < 5; i++) {
        var a = -2.6 + i * 0.62;
        part(g, Pfeather(cx, cy - 4, 22, a), mx(T.wall, '#66a83f', 0.66), { k: 0.22, lw: 0.8 });
      }
    },
    cogumelo: function (g, T, cx, cy) {
      part(g, Pcap(cx, cy - 4, 4, cx + 1, cy - 16, 3.4), '#e8dcc0', { k: 0.2, lw: 0.85 });
      part(g, Pel(cx + 1, cy - 18, 11, 7.5), '#d8604a', { k: 0.22, hi: 0.18 });
      part(g, Pel(cx - 3, cy - 20, 2.6, 1.8), '#f4ecd8', { k: 0.14, lw: 0.6 });
      part(g, Pel(cx + 5, cy - 19, 2.2, 1.5), '#f4ecd8', { k: 0.14, lw: 0.6 });
      glow(g, cx + 1, cy - 18, 16, T.accent, 0.24);
    },
    lanterna: function (g, T, cx, cy) {
      part(g, Pcap(cx, cy - 2, 2.4, cx, cy - 34, 2.0), '#4a4038', { k: 0.26, lw: 0.85 });
      part(g, Ppoly([cx - 8, cy - 36, cx + 8, cy - 36, cx + 6, cy - 52, cx - 6, cy - 52]),
           mx(T.accent, '#ffd98a', 0.5), { k: 0.2, lw: 0.85 });
      part(g, Ppoly([cx - 9, cy - 52, cx + 9, cy - 52, cx, cy - 60]), '#4a4038', { k: 0.24, lw: 0.85 });
      glow(g, cx, cy - 44, 30, T.accent, 0.5);
    },
    vaso: function (g, T, cx, cy) {
      part(g, tag(function (c2) {
        c2.beginPath();
        c2.moveTo(cx - 12, cy - 24); c2.quadraticCurveTo(cx - 16, cy - 6, cx - 8, cy - 1);
        c2.quadraticCurveTo(cx, cy + 2, cx + 8, cy - 1);
        c2.quadraticCurveTo(cx + 16, cy - 6, cx + 12, cy - 24);
        c2.quadraticCurveTo(cx, cy - 28, cx - 12, cy - 24); c2.closePath();
      }, cx, cy - 12, 14), mx(T.wall, '#b07a4a', 0.6), { k: 0.24, hi: 0.14 });
      part(g, Pel(cx, cy - 24, 12, 4), sh(mx(T.wall, '#b07a4a', 0.6), -0.2), { k: 0.2, lw: 0.85 });
    },
    urna: function (g, T, cx, cy) {
      part(g, Pel(cx, cy - 16, 13, 18), mx(T.wall, '#8a7a5a', 0.5), { k: 0.24, hi: 0.14 });
      part(g, Prr(cx, cy - 34, 14, 6, 2), sh(mx(T.wall, '#8a7a5a', 0.5), -0.2), { k: 0.22, lw: 0.85 });
      stroke(g, [cx - 9, cy - 18, cx + 9, cy - 20], sh(T.wall, -0.34), 0.7);
    },
    poca: function (g, T, cx, cy) {
      part(g, Pel(cx, cy - 2, 22, 9), rgba('#2f9fe0', 0.55), { k: 0.14, lw: 0.7, line: rgba('#1f6bb0', 0.7) });
      stroke(g, [cx - 10, cy - 3, cx + 2, cy, cx + 12, cy - 4], rgba('#b9f2ff', 0.75), 0.7, true);
    },
    corrente: function (g, T, cx, cy) {
      var i;
      for (i = 0; i < 6; i++) part(g, Pel(cx, cy - 8 - i * 8, 3.6, 4.6), '#7a828c', { k: 0.24, lw: 0.8 });
    },
    brasa: function (g, T, cx, cy) {
      part(g, Pel(cx, cy - 3, 16, 7), '#3a1610', { k: 0.2, lw: 0.8 });
      part(g, Pflame(cx - 4, cy - 6, 5, 13, 0.15), '#ff8c3a', { k: 0.16, lw: 0.8, line: '#8a2a12' });
      part(g, Pflame(cx + 5, cy - 5, 4, 10, -0.1), '#ffd98a', { k: 0.14, lw: 0.8, line: '#c3341a' });
      glow(g, cx, cy - 10, 26, '#ff8c3a', 0.45);
    },
    bigorna: function (g, T, cx, cy) {
      part(g, Prr(cx, cy - 6, 22, 8, 2), '#5a5f66', { k: 0.24, lw: 0.85 });
      part(g, Prr(cx, cy - 16, 10, 12, 2), '#6a7078', { k: 0.24, lw: 0.85 });
      part(g, Ppoly([cx - 20, cy - 26, cx + 20, cy - 26, cx + 14, cy - 20, cx - 14, cy - 20]), '#7a828c', { k: 0.22, lw: 0.85 });
    },
    corda: function (g, T, cx, cy) {
      stroke(g, [cx - 26, cy - 52, cx, cy - 34, cx + 26, cy - 54], '#b09060', 1.1, true);
      part(g, Pel(cx, cy - 36, 3.4, 3.4), '#8a6b3f', { k: 0.22, lw: 0.8 });
    },
    bandeira: function (g, T, cx, cy) {
      part(g, Pcap(cx, cy - 2, 2.2, cx, cy - 46, 1.8), '#6a5a44', { k: 0.26, lw: 0.85 });
      part(g, tag(function (c2) {
        c2.beginPath(); c2.moveTo(cx + 2, cy - 46);
        c2.quadraticCurveTo(cx + 24, cy - 40, cx + 22, cy - 26);
        c2.quadraticCurveTo(cx + 10, cy - 30, cx + 2, cy - 24); c2.closePath();
      }, cx + 12, cy - 34, 14), T.accent, { k: 0.22, lw: 0.85 });
    },
    carrinho: function (g, T, cx, cy) {
      part(g, Ppoly([cx - 20, cy - 26, cx + 20, cy - 26, cx + 15, cy - 8, cx - 15, cy - 8]),
           mx(T.wall, '#8a6b3f', 0.5), { k: 0.26, lw: 0.9 });
      part(g, Pel(cx - 10, cy - 5, 6, 6), '#3a3128', { k: 0.24, lw: 0.85 });
      part(g, Pel(cx + 10, cy - 5, 6, 6), '#3a3128', { k: 0.24, lw: 0.85 });
      part(g, Pshard(cx, cy - 30, 9, 'cc'), T.accent, { k: 0.24, lw: 0.85 });
    },
    picareta: function (g, T, cx, cy) {
      part(g, Pcap(cx - 8, cy - 2, 2.2, cx + 6, cy - 38, 1.9), '#9a7a4a', { k: 0.26, lw: 0.85 });
      part(g, tag(function (c2) {
        c2.beginPath(); c2.moveTo(cx - 12, cy - 34);
        c2.quadraticCurveTo(cx + 6, cy - 46, cx + 22, cy - 34);
        c2.quadraticCurveTo(cx + 6, cy - 40, cx - 12, cy - 30); c2.closePath();
      }, cx + 4, cy - 37, 17), '#8a929c', { k: 0.24, lw: 0.85 });
    },
    cristal: function (g, T, cx, cy) {
      part(g, Ppoly([cx, cy - 40, cx + 9, cy - 18, cx + 5, cy - 2, cx - 5, cy - 2, cx - 9, cy - 18]),
           mx(T.accent, T.wall, 0.3), { k: 0.24, hi: 0.2 });
      glow(g, cx, cy - 20, 24, T.accent, 0.4);
    },
    runa: function (g, T, cx, cy) {
      part(g, Pstar(cx, cy - 8, 11, 4, 0.34), T.accent, { k: 0.18, lw: 0.8 });
      glow(g, cx, cy - 8, 22, T.accent, 0.42);
    },

    // ---------------------------------------------------- ESTUFA (garden)
    redoma: function (g, T, cx, cy) {                  // redoma de vagalumes
      var i;
      part(g, Pel(cx, cy - 4, 12, 5), mx(T.wall, '#6a5a44', 0.6), { k: 0.24, lw: 0.85 });
      part(g, tag(function (c2) {
        c2.beginPath(); c2.moveTo(cx - 11, cy - 6);
        c2.quadraticCurveTo(cx - 13, cy - 30, cx, cy - 32);
        c2.quadraticCurveTo(cx + 13, cy - 30, cx + 11, cy - 6); c2.closePath();
      }, cx, cy - 19, 13), rgba('#dff0e4', 0.5), { k: 0.12, lw: 0.85, line: sh(T.wall, -0.5) });
      for (i = 0; i < 4; i++) {
        part(g, Pel(cx - 6 + i * 4, cy - 12 - (i % 3) * 7, 1.8, 1.8), '#ffe98a', { flat: true, noline: true });
      }
      glow(g, cx, cy - 18, 20, '#ffe98a', 0.42);
    },
    regador: function (g, T, cx, cy) {                 // regador de cobre azinhavrado
      var col = mx('#7fb8a0', T.wall, 0.3);
      part(g, Pel(cx, cy - 12, 12, 11), col, { k: 0.26, hi: 0.18, lw: 0.85 });
      part(g, Pcap(cx + 9, cy - 18, 3, cx + 24, cy - 24, 4.4), sh(col, -0.08), { k: 0.24, lw: 0.85 });
      part(g, Pel(cx + 25, cy - 25, 4.6, 4), sh(col, 0.16), { k: 0.2, lw: 0.8 });
      stroke(g, [cx - 8, cy - 20, cx - 2, cy - 28, cx + 6, cy - 20], rgba(sh(col, -0.4), 0.9), 1.2, true);
    },
    espantalho: function (g, T, cx, cy) {              // espantalho de palha mofada
      var pal = mx('#c8b06a', T.wall, 0.28);
      part(g, Pcap(cx, cy - 2, 2.2, cx, cy - 44, 2.0), mx(T.wall, '#7a5a34', 0.6), { k: 0.26, lw: 0.85 });
      part(g, Prr(cx, cy - 34, 30, 4, 1), mx(T.wall, '#7a5a34', 0.6), { k: 0.24, lw: 0.8 });
      part(g, Pel(cx, cy - 50, 9, 10), pal, { k: 0.24, hi: 0.16, lw: 0.85 });
      part(g, Ppoly([cx - 12, cy - 55, cx + 12, cy - 55, cx + 8, cy - 62, cx - 8, cy - 62]), sh(pal, -0.2),
           { k: 0.22, lw: 0.85 });
      stroke(g, [cx - 4, cy - 50, cx - 2, cy - 48], '#3a2f24', 1.1);
      stroke(g, [cx + 4, cy - 50, cx + 6, cy - 48], '#3a2f24', 1.1);
      part(g, Ppoly([cx - 15, cy - 32, cx - 8, cy - 24, cx - 18, cy - 22]), pal, { k: 0.2, lw: 0.75 });
    },
    placa: function (g, T, cx, cy) {                   // placa de nome de planta ilegível
      part(g, Pcap(cx, cy - 2, 1.7, cx + 2, cy - 22, 1.5), mx(T.wall, '#7a5a34', 0.6), { k: 0.24, lw: 0.8 });
      part(g, Prr(cx + 3, cy - 28, 22, 12, 2), mx('#e8dcc0', T.wall, 0.2), { k: 0.2, hi: 0.18, lw: 0.85 });
      stroke(g, [cx - 4, cy - 30, cx + 9, cy - 30], rgba('#6a5a44', 0.7), 0.8);
      stroke(g, [cx - 4, cy - 26, cx + 6, cy - 26], rgba('#6a5a44', 0.5), 0.7);
    },
    esporos: function (g, T, cx, cy) {                 // esporos suspensos
      var rd = rng('esp'), i;
      for (i = 0; i < 9; i++) {
        var x = cx - 22 + rd() * 44, y = cy - 6 - rd() * 44;
        part(g, Pel(x, y, 2.2 + rd() * 2, 2.2 + rd() * 2), rgba(mx(T.accent, '#ffffff', 0.4), 0.6),
             { flat: true, noline: true });
      }
      glow(g, cx, cy - 26, 30, T.accent, 0.22);
    },
    // -------------------------------------------------- CISTERNA (cistern)
    lustre: function (g, T, cx, cy) {                  // lustre de águas-vivas
      var i;
      stroke(g, [cx, cy - 66, cx, cy - 46], rgba('#7a828c', 0.85), 1.0);
      for (i = 0; i < 3; i++) {
        var x = cx - 14 + i * 14, y = cy - 40 - (i % 2) * 8;
        part(g, tag(function (c2) {
          c2.beginPath(); c2.moveTo(x - 8, y);
          c2.quadraticCurveTo(x, y - 14, x + 8, y);
          c2.quadraticCurveTo(x, y + 4, x - 8, y); c2.closePath();
        }, x, y - 4, 9), rgba('#9fe8f4', 0.6), { k: 0.14, lw: 0.8, line: rgba('#1f6bb0', 0.7) });
        stroke(g, [x - 4, y + 2, x - 5, y + 12], rgba('#b9f2ff', 0.6), 0.7);
        stroke(g, [x + 3, y + 2, x + 5, y + 13], rgba('#b9f2ff', 0.6), 0.7);
      }
      glow(g, cx, cy - 42, 30, '#b9f2ff', 0.4);
    },
    lampiao: function (g, T, cx, cy) {                 // lampião submerso ainda aceso
      part(g, Pel(cx, cy - 4, 10, 4), rgba('#2f9fe0', 0.35), { flat: true, noline: true });
      part(g, Ppoly([cx - 7, cy - 6, cx + 7, cy - 6, cx + 6, cy - 22, cx - 6, cy - 22]),
           mx(T.accent, '#ffd98a', 0.5), { k: 0.2, lw: 0.85 });
      part(g, Ppoly([cx - 8, cy - 22, cx + 8, cy - 22, cx, cy - 29]), '#4a4038', { k: 0.24, lw: 0.85 });
      stroke(g, [cx, cy - 29, cx + 1, cy - 36], rgba('#4a4038', 0.9), 0.9);
      glow(g, cx, cy - 14, 26, T.accent, 0.5);
    },
    partitura: function (g, T, cx, cy) {               // partitura boiando
      var i;
      part(g, Ppoly([cx - 14, cy - 4, cx + 12, cy - 7, cx + 15, cy - 16, cx - 11, cy - 13]),
           '#efe6d2', { k: 0.14, hi: 0.2, lw: 0.8 });
      for (i = 0; i < 3; i++) stroke(g, [cx - 10, cy - 8 - i * 3, cx + 12, cy - 11 - i * 3],
                                     rgba('#6a6055', 0.55), 0.6);
      part(g, Pel(cx + 20, cy - 3, 14, 5), rgba('#2f9fe0', 0.4), { flat: true, noline: true });
    },
    sapato: function (g, T, cx, cy) {                  // sapato de baile solitário
      var col = mx('#8a4a5a', T.wall, 0.22);
      part(g, tag(function (c2) {
        c2.beginPath(); c2.moveTo(cx - 12, cy - 2);
        c2.quadraticCurveTo(cx - 14, cy - 12, cx - 4, cy - 13);
        c2.quadraticCurveTo(cx + 10, cy - 12, cx + 13, cy - 2); c2.closePath();
      }, cx, cy - 8, 14), col, { k: 0.26, hi: 0.18, lw: 0.85 });
      part(g, Prr(cx + 9, cy - 5, 4, 8, 1), sh(col, -0.2), { k: 0.22, lw: 0.75 });
      part(g, Pel(cx - 3, cy - 13, 3.4, 2.4), T.accent, { k: 0.16, lw: 0.7 });
    },
    // ------------------------------------------------------ BRASA (forge)
    correnteTeto: function (g, T, cx, cy) {            // corrente do teto balançando
      var i;
      for (i = 0; i < 8; i++) {
        part(g, Pel(cx + Math.sin(i * 0.5) * 3, cy - 12 - i * 8, 3.4, 4.6), '#7a828c', { k: 0.24, lw: 0.8 });
      }
      part(g, Ppoly([cx + 2, cy - 12, cx + 8, cy - 4, cx - 4, cy - 4]), '#6a7078', { k: 0.24, lw: 0.85 });
    },
    martelo: function (g, T, cx, cy) {                 // martelo cravado na bancada
      part(g, Pcap(cx - 6, cy - 4, 2.4, cx + 5, cy - 34, 2.2), mx(T.wall, '#9a7a4a', 0.6), { k: 0.26, lw: 0.85 });
      part(g, Prr(cx + 6, cy - 38, 22, 11, 2), '#6a7078', { k: 0.26, hi: 0.16, lw: 0.9 });
      part(g, Prr(cx + 15, cy - 38, 5, 12, 1), '#8a929c', { k: 0.2, lw: 0.8 });
      part(g, Pel(cx - 8, cy - 3, 13, 4), mx(T.wall, '#7a5a34', 0.6), { k: 0.2, lw: 0.8 });
    },
    fole: function (g, T, cx, cy) {                    // fole gigante murcho
      var col = mx(T.wall, '#8a5a3a', 0.5), i;
      part(g, Ppoly([cx - 22, cy - 6, cx + 12, cy - 18, cx + 20, cy - 12, cx - 18, cy - 2]),
           col, { k: 0.26, hi: 0.14, lw: 0.9 });
      for (i = 0; i < 4; i++) {
        stroke(g, [cx - 16 + i * 9, cy - 4 - i * 2.6, cx - 12 + i * 9, cy - 12 - i * 2.6],
               rgba(sh(col, -0.45), 0.85), 0.85);
      }
      part(g, Pcap(cx + 18, cy - 14, 2.4, cx + 30, cy - 18, 1.8), '#6a7078', { k: 0.22, lw: 0.8 });
    },
    avental: function (g, T, cx, cy) {                 // avental pendurado
      var col = mx(T.wall, '#7a4a2a', 0.55);
      stroke(g, [cx - 10, cy - 44, cx + 10, cy - 44], rgba('#6a6055', 0.8), 0.9);
      part(g, tag(function (c2) {
        c2.beginPath(); c2.moveTo(cx - 9, cy - 42); c2.lineTo(cx + 9, cy - 42);
        c2.quadraticCurveTo(cx + 14, cy - 26, cx + 11, cy - 8);
        c2.quadraticCurveTo(cx, cy - 4, cx - 11, cy - 8);
        c2.quadraticCurveTo(cx - 14, cy - 26, cx - 9, cy - 42); c2.closePath();
      }, cx, cy - 24, 14), col, { k: 0.26, hi: 0.12, lw: 0.9 });
      stroke(g, [cx - 6, cy - 30, cx + 2, cy - 20], rgba('#2a1410', 0.6), 0.8);
    },
    // ------------------------------------------------- VENTO (scaffold)
    prumo: function (g, T, cx, cy) {                   // prumo balançando
      stroke(g, [cx + 2, cy - 52, cx, cy - 22], rgba('#8a7a5a', 0.9), 0.9);
      part(g, Ppoly([cx - 5, cy - 22, cx + 5, cy - 22, cx, cy - 8]), '#7a828c', { k: 0.26, hi: 0.18, lw: 0.85 });
      part(g, Pel(cx + 2, cy - 52, 3, 2.4), '#6a6055', { k: 0.2, lw: 0.7 });
    },
    balde: function (g, T, cx, cy) {                   // balde pendurado
      var col = mx(T.wall, '#7a828c', 0.5);
      stroke(g, [cx, cy - 46, cx, cy - 30], rgba('#8a7a5a', 0.9), 0.9);
      stroke(g, [cx - 9, cy - 30, cx, cy - 36, cx + 9, cy - 30], rgba('#6a7078', 0.95), 1.0, true);
      part(g, Ppoly([cx - 10, cy - 30, cx + 10, cy - 30, cx + 7, cy - 10, cx - 7, cy - 10]),
           col, { k: 0.26, hi: 0.16, lw: 0.9 });
      part(g, Pel(cx, cy - 30, 10, 3.6), sh(col, 0.16), { k: 0.2, lw: 0.8 });
    },
    ninho: function (g, T, cx, cy) {                   // ninho de picanço com ossinhos
      var col = mx(T.wall, '#8a7a5a', 0.55), i;
      part(g, Pel(cx, cy - 8, 16, 8), col, { k: 0.26, hi: 0.12, lw: 0.9 });
      part(g, Pel(cx, cy - 10, 10, 4.4), sh(col, -0.3), { k: 0.18, lw: 0.75 });
      for (i = 0; i < 3; i++) {
        stroke(g, [cx - 12 + i * 9, cy - 13, cx - 6 + i * 9, cy - 18], rgba('#e8e0cc', 0.9), 1.0);
      }
      for (i = 0; i < 4; i++) {
        stroke(g, [cx - 16 + i * 10, cy - 6, cx - 8 + i * 10, cy - 10], rgba(sh(col, -0.4), 0.7), 0.7);
      }
    },
    serragem: function (g, T, cx, cy) {                // redemoinho de serragem
      var i;
      g.save();
      g.strokeStyle = rgba(mx('#d8c69a', T.accent, 0.3), 0.55); g.lineWidth = _lw * 1.3; g.lineCap = 'round';
      Pswirl(cx, cy - 18, 20, 1.3)(g); g.stroke();
      g.restore();
      for (i = 0; i < 6; i++) {
        part(g, Pel(cx - 16 + i * 7, cy - 10 - (i % 3) * 12, 2, 1.6, i), rgba('#d8c69a', 0.6),
             { flat: true, noline: true });
      }
    },
    // -------------------------------------------------------- MINA (mine)
    carbureto: function (g, T, cx, cy) {               // lampião de carbureto apagado
      var col = mx(T.wall, '#7a7268', 0.5);
      part(g, Ppoly([cx - 8, cy - 4, cx + 8, cy - 4, cx + 6, cy - 18, cx - 6, cy - 18]), col,
           { k: 0.26, hi: 0.14, lw: 0.9 });
      part(g, Pel(cx, cy - 20, 6.5, 4), sh(col, 0.18), { k: 0.2, lw: 0.8 });
      part(g, Pel(cx, cy - 24, 3, 3.4), sh(col, -0.3), { k: 0.18, lw: 0.75 });
      stroke(g, [cx - 6, cy - 24, cx, cy - 30, cx + 6, cy - 24], rgba(sh(col, -0.3), 0.9), 0.9, true);
    },
    gaiola: function (g, T, cx, cy) {                  // gaiola de pássaro vazia
      var col = mx(T.wall, '#8a8078', 0.5), i;
      part(g, Pel(cx, cy - 4, 11, 4), sh(col, -0.2), { k: 0.22, lw: 0.85 });
      for (i = 0; i < 5; i++) {
        var x = cx - 9 + i * 4.5;
        stroke(g, [x, cy - 6, x + (i - 2) * 0.6, cy - 28], rgba(col, 0.95), 0.85);
      }
      stroke(g, [cx - 11, cy - 28, cx, cy - 34, cx + 11, cy - 28], rgba(col, 0.95), 1.0, true);
      stroke(g, [cx, cy - 34, cx + 1, cy - 42], rgba(col, 0.9), 0.85);
      part(g, Pel(cx, cy - 4, 11, 4), rgba(sh(col, -0.4), 0.3), { flat: true, noline: true });
    },
    capacete: function (g, T, cx, cy) {                // capacete no chão
      var col = mx(T.accent, '#c07a2a', 0.4);
      part(g, tag(function (c2) {
        c2.beginPath(); c2.moveTo(cx - 13, cy - 3);
        c2.quadraticCurveTo(cx - 12, cy - 18, cx, cy - 18);
        c2.quadraticCurveTo(cx + 12, cy - 18, cx + 13, cy - 3); c2.closePath();
      }, cx, cy - 11, 14), col, { k: 0.26, hi: 0.22, lw: 0.9 });
      part(g, Pel(cx, cy - 3, 15, 4), sh(col, -0.22), { k: 0.2, lw: 0.8 });
      part(g, Pel(cx - 1, cy - 16, 4, 3), sh(col, 0.3), { flat: true, noline: true });
    },
    poeira: function (g, T, cx, cy) {                  // poeira em suspensão
      var rd = rng('po'), i;
      for (i = 0; i < 12; i++) {
        var x = cx - 26 + rd() * 52, y = cy - 4 - rd() * 40;
        part(g, Pel(x, y, 1.4 + rd() * 1.8, 1.2 + rd() * 1.4), rgba('#d8ccae', 0.45),
             { flat: true, noline: true });
      }
    },
    // ------------------------------------------------- CORAÇÃO (heart)
    relogio: function (g, T, cx, cy) {                 // relógio de estações parado
      var col = mx(T.wall, '#8a8296', 0.5);
      part(g, Pcap(cx, cy - 2, 2.4, cx, cy - 26, 2.2), sh(col, -0.24), { k: 0.24, lw: 0.85 });
      part(g, Pel(cx, cy - 36, 12, 12), col, { k: 0.24, hi: 0.2, lw: 0.9 });
      part(g, Pel(cx, cy - 36, 9, 9), sh(col, 0.28), { k: 0.14, lw: 0.7 });
      stroke(g, [cx, cy - 36, cx + 5, cy - 41], rgba('#2a2430', 0.9), 1.0);
      stroke(g, [cx, cy - 36, cx - 2, cy - 30], rgba('#2a2430', 0.9), 0.9);
      part(g, Pel(cx, cy - 36, 1.6, 1.6), '#2a2430', { flat: true, noline: true });
    },
    estilhaco: function (g, T, cx, cy) {               // estilhaço parado no ar
      part(g, Ppoly([cx - 9, cy - 30, cx + 5, cy - 40, cx + 11, cy - 26, cx - 2, cy - 18]),
           mx(T.accent, T.wall, 0.34), { k: 0.24, hi: 0.24, lw: 0.85 });
      part(g, Ppoly([cx + 12, cy - 44, cx + 19, cy - 48, cx + 17, cy - 38]),
           mx(T.accent, T.wall, 0.5), { k: 0.22, lw: 0.8 });
      glow(g, cx + 2, cy - 30, 26, T.accent, 0.34);
      stroke(g, [cx - 16, cy - 20, cx - 8, cy - 24], rgba(T.accent, 0.35), 0.8);
    },
    chuvaCima: function (g, T, cx, cy) {               // chuva que cai para cima
      var rd = rng('cc'), i;
      for (i = 0; i < 7; i++) {
        var x = cx - 22 + rd() * 44, y = cy - 6 - rd() * 44;
        part(g, Pdrop(x, y, 2.4 + rd() * 1.4), rgba('#b9f2ff', 0.55), { flat: true, noline: true });
        stroke(g, [x, y + 5, x, y + 12], rgba('#b9f2ff', 0.28), 0.7);
      }
    }
  };

  function sceneryCanvas(kindMap, theme, key, tall) {
    var T = themeOf(theme);
    var w = M.tileW + 24, h = tall;
    var c = mkCanvas(w, h), g = c.getContext('2d');
    setScale(RES);
    g.save(); g.scale(RES, RES);
    var cx = w / 2, cy = h - M.tileH / 2 - 4;
    var fn = kindMap[key];
    if (fn) fn(g, T, cx, cy, hash(String(key)) % 4);
    g.restore();
    c.__anchor = [0.5, cy / h];
    return c;
  }

  // ==========================================================================
  // RETRATOS — busto de frente, enquadrado no rosto
  // ==========================================================================
  function unitPalOf(defId, els) {
    var fus = parseFusion(defId);
    if (fus && (isClass(fus[0]) || isClass(fus[1]))) return fusionCfg(fus[0], fus[1], els).pal;
    if (isClass(defId)) return classPal(defId, els);
    var pets = (JOGO.DATA && JOGO.DATA.pets) || null;
    var md = pets && pets[defId] ? pets[defId]
           : ((JOGO.DATA && JOGO.DATA.monsters && JOGO.DATA.monsters[defId]) || null);
    return creaturePal(defId, md, els);
  }
  A.unitPalette = unitPalOf;

  function portraitCanvas(defId, els, size) {
    var c = mkCanvas(size, size), g = c.getContext('2d');
    var pal = unitPalOf(defId, els);
    var S = size * RES;
    // fundo: disco chapado com halo do elemento
    g.save();
    var bg1 = mx(pal.dark, '#0d1014', 0.34), bg2 = mx(pal.main, '#0d1014', 0.62);
    var lg = g.createLinearGradient(0, 0, 0, S);
    lg.addColorStop(0, bg2); lg.addColorStop(1, bg1);
    g.fillStyle = lg; g.fillRect(0, 0, S, S);
    var rg = g.createRadialGradient(S * 0.5, S * 0.66, S * 0.05, S * 0.5, S * 0.66, S * 0.62);
    rg.addColorStop(0, rgba(pal.el.c, 0.34)); rg.addColorStop(1, rgba(pal.el.c, 0));
    g.fillStyle = rg; g.fillRect(0, 0, S, S);
    g.restore();

    // figura enquadrada no rosto
    var fus = parseFusion(defId);
    var cfg, An, hx0, hy0, hr;
    if (fus && (isClass(fus[0]) || isClass(fus[1]))) cfg = fusionCfg(fus[0], fus[1], els);
    else if (isClass(defId)) cfg = baseCfg(defId, els);
    else cfg = null;

    g.save();
    g.beginPath(); g.rect(0, 0, S, S); g.clip();
    if (cfg) {
      cfg.back = false;
      An = (PLANS[cfg.base] || PLANS.sumo).anchors(cfg);
      hx0 = An.head[0]; hy0 = An.head[1]; hr = An.head[2];
      var k = S * 0.23 / hr;
      setScale(k);
      g.translate(S * 0.5 - hx0 * k, S * 0.46 - hy0 * k);
      g.scale(k, k);
      paintUnit(g, cfg);
    } else {
      var pets = (JOGO.DATA && JOGO.DATA.pets) || null;
      var pd = pets && pets[defId];
      var md = (JOGO.DATA && JOGO.DATA.monsters && JOGO.DATA.monsters[defId]) || null;
      var k2 = S * 0.016;
      setScale(k2);
      g.translate(S * 0.5, S * 0.5 + 34 * k2);
      g.scale(k2, k2);
      if (pd) paintPet(g, defId, pd, { pal: pal, back: false });
      else paintCreature(g, defId, md, { pal: pal, arch: archOf(defId, md),
                                         boss: !!(md && (md.boss || md.isBoss)), back: false });
    }
    g.restore();

    // moldura
    setScale(RES);
    g.save(); g.scale(RES, RES);
    var s2 = size;
    g.strokeStyle = rgba(pal.el.c, 0.55); g.lineWidth = 2;
    g.strokeRect(1, 1, s2 - 2, s2 - 2);
    g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 1;
    g.strokeRect(3, 3, s2 - 6, s2 - 6);
    g.restore();
    c.__anchor = [0.5, 0.5];
    return c;
  }

  // ==========================================================================
  // ÍCONES — feitiço, item, pet, evento de terreno
  // ==========================================================================
  var GLYPH = {
    burst: function (g, x, y, r, col) {
      part(g, Pstar(x, y, r, 8, 0.44), col, { k: 0.2, hi: 0.2 });
      part(g, Pel(x, y, r * 0.32, r * 0.32), sh(col, 0.42), { k: 0.14, lw: 0.7 });
    },
    flame: function (g, x, y, r, col) {
      part(g, Pflame(x, y + r * 0.8, r * 0.72, r * 1.75, 0.08), col, { k: 0.18, hi: 0.2 });
      part(g, Pflame(x, y + r * 0.7, r * 0.34, r * 0.95, -0.05), sh(col, 0.44), { k: 0.14, lw: 0.7 });
    },
    drop: function (g, x, y, r, col) {
      part(g, Pdrop(x, y + r * 0.28, r * 0.86), col, { k: 0.18, hi: 0.22 });
    },
    stone: function (g, x, y, r, col) {
      part(g, Pshard(x, y, r, 'gs'), col, { k: 0.26, hi: 0.16 });
      part(g, Pshard(x - r * 0.5, y + r * 0.5, r * 0.45, 'gs2'), sh(col, -0.14), { k: 0.24, lw: 0.8 });
    },
    gust: function (g, x, y, r, col) {
      g.save();
      g.strokeStyle = col; g.lineWidth = _lw * 1.5; g.lineCap = 'round';
      Pswirl(x, y, r, 1.15)(g); g.stroke();
      g.strokeStyle = sh(col, 0.4); g.lineWidth = _lw * 0.9;
      Pswirl(x + r * 0.2, y + r * 0.3, r * 0.5, 0.9)(g); g.stroke();
      g.restore();
    },
    heal: function (g, x, y, r, col) {
      part(g, Ppoly([x - r * 0.28, y - r, x + r * 0.28, y - r, x + r * 0.28, y - r * 0.3,
                     x + r, y - r * 0.3, x + r, y + r * 0.28, x + r * 0.28, y + r * 0.28,
                     x + r * 0.28, y + r, x - r * 0.28, y + r, x - r * 0.28, y + r * 0.28,
                     x - r, y + r * 0.28, x - r, y - r * 0.3, x - r * 0.28, y - r * 0.3]),
           col, { k: 0.2, hi: 0.2 });
    },
    shield: function (g, x, y, r, col) {
      part(g, tag(function (c2) {
        c2.beginPath();
        c2.moveTo(x, y - r);
        c2.quadraticCurveTo(x + r, y - r * 0.86, x + r * 0.92, y - r * 0.2);
        c2.quadraticCurveTo(x + r * 0.8, y + r * 0.72, x, y + r);
        c2.quadraticCurveTo(x - r * 0.8, y + r * 0.72, x - r * 0.92, y - r * 0.2);
        c2.quadraticCurveTo(x - r, y - r * 0.86, x, y - r);
        c2.closePath();
      }, x, y, r), col, { k: 0.22, hi: 0.2 });
      stroke(g, [x, y - r * 0.6, x, y + r * 0.6], sh(col, -0.3), 0.9);
    },
    up: function (g, x, y, r, col) {
      part(g, Ppoly([x, y - r, x + r * 0.86, y - r * 0.05, x + r * 0.34, y - r * 0.05,
                     x + r * 0.34, y + r * 0.86, x - r * 0.34, y + r * 0.86,
                     x - r * 0.34, y - r * 0.05, x - r * 0.86, y - r * 0.05]), col, { k: 0.2, hi: 0.2 });
    },
    down: function (g, x, y, r, col) {
      g.save(); g.translate(x, y); g.rotate(Math.PI); g.translate(-x, -y);
      GLYPH.up(g, x, y, r, col); g.restore();
    },
    push: function (g, x, y, r, col) {
      part(g, Ppoly([x + r, y, x + r * 0.1, y - r * 0.62, x + r * 0.1, y + r * 0.62]), col, { k: 0.2, hi: 0.2 });
      part(g, Prr(x - r * 0.62, y, r * 0.34, r * 1.5, 2), sh(col, -0.2), { k: 0.2, lw: 0.8 });
    },
    pull: function (g, x, y, r, col) {
      part(g, Ppoly([x - r, y, x - r * 0.1, y - r * 0.62, x - r * 0.1, y + r * 0.62]), col, { k: 0.2, hi: 0.2 });
      part(g, Prr(x + r * 0.62, y, r * 0.34, r * 1.5, 2), sh(col, -0.2), { k: 0.2, lw: 0.8 });
    },
    swirl: function (g, x, y, r, col) {
      g.save(); g.strokeStyle = col; g.lineWidth = _lw * 1.8; g.lineCap = 'round';
      Pswirl(x, y, r, 1.6)(g); g.stroke(); g.restore();
      part(g, Pel(x, y, r * 0.2, r * 0.14), sh(col, 0.4), { k: 0.14, lw: 0.7 });
    },
    poison: function (g, x, y, r, col) {
      part(g, Pel(x, y + r * 0.2, r * 0.8, r * 0.78), col, { k: 0.22, hi: 0.18 });
      part(g, Pel(x - r * 0.3, y + r * 0.1, r * 0.16, r * 0.2), '#241c22', { k: 0.1, lw: 0.7 });
      part(g, Pel(x + r * 0.3, y + r * 0.1, r * 0.16, r * 0.2), '#241c22', { k: 0.1, lw: 0.7 });
      part(g, Pel(x + r * 0.5, y - r * 0.7, r * 0.24, r * 0.24), sh(col, 0.3), { k: 0.16, lw: 0.7 });
      part(g, Pel(x - r * 0.6, y - r * 0.5, r * 0.16, r * 0.16), sh(col, 0.3), { k: 0.16, lw: 0.7 });
    },
    mark: function (g, x, y, r, col) {
      part(g, Pel(x, y, r, r), 'rgba(0,0,0,0)', { noline: false, flat: true, line: col, lw: 1.6 });
      part(g, Pel(x, y, r * 0.56, r * 0.56), 'rgba(0,0,0,0)', { flat: true, line: col, lw: 1.3 });
      part(g, Pel(x, y, r * 0.2, r * 0.2), col, { k: 0.14, lw: 0.7 });
    },
    summon: function (g, x, y, r, col) {
      part(g, Prr(x, y + r * 0.3, r * 1.1, r * 1.2, 3), col, { k: 0.24, hi: 0.16 });
      part(g, Ppoly([x - r * 0.9, y - r * 0.4, x, y - r, x + r * 0.9, y - r * 0.4]), sh(col, -0.16), { k: 0.2, lw: 0.85 });
      part(g, Pel(x - r * 0.3, y + r * 0.24, r * 0.16, r * 0.16), sh(col, 0.5), { k: 0.14, lw: 0.6 });
      part(g, Pel(x + r * 0.3, y + r * 0.24, r * 0.16, r * 0.16), sh(col, 0.5), { k: 0.14, lw: 0.6 });
    },
    trap: function (g, x, y, r, col) {
      var i;
      part(g, Pel(x, y + r * 0.3, r * 0.98, r * 0.42), sh(col, -0.24), { k: 0.2 });
      for (i = 0; i < 5; i++) {
        part(g, Ppoly([x - r * 0.8 + i * r * 0.4, y + r * 0.24, x - r * 0.62 + i * r * 0.4, y - r * 0.5,
                       x - r * 0.44 + i * r * 0.4, y + r * 0.24]), '#f2ead8', { k: 0.14, lw: 0.6 });
      }
    },
    chain: function (g, x, y, r, col) {
      part(g, Ppoly([x - r, y - r * 0.5, x - r * 0.1, y - r * 0.12, x - r * 0.42, y + r * 0.08,
                     x + r, y + r * 0.6, x + r * 0.14, y + r * 0.16, x + r * 0.46, y - r * 0.06]),
           col, { k: 0.2, hi: 0.2 });
    },
    root: function (g, x, y, r, col) {
      var i;
      for (i = 0; i < 3; i++) {
        stroke(g, [x - r * 0.8 + i * r * 0.8, y + r, x - r * 0.5 + i * r * 0.5, y, x - r * 0.9 + i * r * 0.9, y - r],
               col, 1.6, true);
      }
      part(g, Pel(x, y + r * 0.9, r * 0.9, r * 0.24), sh(col, -0.3), { k: 0.2, lw: 0.8 });
    },
    invisible: function (g, x, y, r, col) {
      part(g, tag(function (c2) {
        c2.beginPath();
        c2.moveTo(x - r, y);
        c2.quadraticCurveTo(x, y - r * 0.9, x + r, y);
        c2.quadraticCurveTo(x, y + r * 0.9, x - r, y);
        c2.closePath();
      }, x, y, r), col, { k: 0.2, hi: 0.2 });
      part(g, Pel(x, y, r * 0.34, r * 0.34), '#241c22', { k: 0.1, lw: 0.7 });
      stroke(g, [x - r, y + r * 0.6, x + r, y - r * 0.6], sh(col, -0.4), 1.4);
    },
    weather: function (g, x, y, r, col) {
      part(g, Pblob([x - r, y - r * 0.1, x - r * 0.5, y - r * 0.7, x + r * 0.3, y - r * 0.7,
                     x + r, y - r * 0.1, x + r * 0.4, y + r * 0.3, x - r * 0.4, y + r * 0.3]),
           sh(col, 0.2), { k: 0.2 });
      stroke(g, [x - r * 0.5, y + r * 0.4, x - r * 0.7, y + r], col, 1.2);
      stroke(g, [x + r * 0.1, y + r * 0.4, x - r * 0.1, y + r], col, 1.2);
      stroke(g, [x + r * 0.6, y + r * 0.4, x + r * 0.4, y + r], col, 1.2);
    },
    blade: function (g, x, y, r, col) {
      part(g, Ppoly([x - r * 0.24, y + r, x + r * 0.2, y + r, x + r * 0.3, y - r * 0.5,
                     x, y - r, x - r * 0.3, y - r * 0.5]), col, { k: 0.18, hi: 0.24 });
      part(g, Prr(x, y + r * 0.86, r * 1.1, r * 0.22, 2), sh(col, -0.36), { k: 0.2, lw: 0.8 });
    }
  };
  function glyphFor(spell) {
    if (!spell) return 'burst';
    if (typeof spell === 'string') return GLYPH[spell] ? spell : 'burst';
    var e = (spell.effects || []), i, t;
    var byElem = { fogo: 'flame', agua: 'drop', terra: 'stone', ar: 'gust', neutro: 'burst' };
    var pri = { heal: 'heal', shield: 'shield', buff: 'up', resist: 'shield', push: 'push', pull: 'pull',
                teleport: 'swirl', swap: 'swirl', poison: 'poison', regen: 'heal', summon: 'summon',
                taunt: 'mark', invisible: 'invisible', root: 'root', mark: 'mark', detonateMarks: 'burst',
                trap: 'trap', weatherShift: 'weather', cleanse: 'heal', reflect: 'shield',
                dispelShield: 'blade', moveTo: 'push', chain: 'chain' };
    for (i = 0; i < e.length; i++) {
      t = e[i].type;
      if (t === 'damage') continue;
      if (pri[t]) return pri[t];
    }
    for (i = 0; i < e.length; i++) if (e[i].type === 'damage') {
      if (spell.range && spell.range.max <= 1) return 'blade';
      return byElem[e[i].element] || 'burst';
    }
    return byElem[spell.element] || 'burst';
  }

  function iconFrame(g, size, col, rar) {
    var s = size;
    part(g, Prr(s / 2, s / 2, s - 3, s - 3, s * 0.22), mx(col, '#141a20', 0.62),
         { k: 0.3, lw: 1.1, line: sh(col, -0.55) });
    part(g, Prr(s / 2, s / 2, s - 9, s - 9, s * 0.17), mx(col, '#0f1418', 0.42),
         { flat: true, lw: 0.8, line: rgba(sh(col, 0.4), 0.5) });
    if (rar) {
      var rc = A.rarityColor(rar);
      // a lendária ganha moldura DUPLA: fio laranja por fora, creme por dentro
      if (A.rarityRank(rar) >= 3) {
        g.save(); g.strokeStyle = A.rarityGlow(rar); g.lineWidth = 4;
        Prr(s / 2, s / 2, s - 3, s - 3, s * 0.22)(g); g.stroke(); g.restore();
      }
      g.save(); g.strokeStyle = rc; g.lineWidth = 2;
      Prr(s / 2, s / 2, s - 3, s - 3, s * 0.22)(g); g.stroke(); g.restore();
    }
  }

  function spellIconCanvas(spell, size) {
    var c = mkCanvas(size, size), g = c.getContext('2d');
    setScale(RES); g.save(); g.scale(RES, RES);
    var el = (spell && spell.element) || 'neutro';
    var info = elemInfo(ELEM[el] ? el : 'neutro');
    iconFrame(g, size, info.c, null);
    var kind = glyphFor(spell);
    glow(g, size / 2, size / 2, size * 0.42, info.c, 0.4);
    (GLYPH[kind] || GLYPH.burst)(g, size / 2, size / 2, size * 0.27, info.c);
    g.restore();
    c.__anchor = [0.5, 0.5];
    return c;
  }

  // ADENDO v2.2 — os espaços têm nome próprio: punho · passo · casca · lume.
  // Os ids antigos (pa/pp/vida/especial) continuam aceitos como apelido para o
  // dia em que o `DATA.items` ainda não migrou.
  var SLOT_ALIAS = { pa: 'punho', pp: 'passo', vida: 'casca', especial: 'lume',
                     punho: 'punho', passo: 'passo', casca: 'casca', lume: 'lume', pet: 'pet' };
  A.slotKey = function (slot) { return SLOT_ALIAS[slot] || 'casca'; };
  A.slotName = function (slot) {
    return { punho: 'Punho', passo: 'Passo', casca: 'Casca', lume: 'Lume', pet: 'Bicho' }[A.slotKey(slot)];
  };
  A.slotColor = function (slot) {
    return { punho: '#e0674a', passo: '#5fc8a8', casca: '#e05a6a', lume: '#b98cff', pet: '#ffd166' }[A.slotKey(slot)];
  };

  var SLOT_GLYPH = {
    punho: function (g, x, y, r, col) {
      // manopla / punho fechado
      part(g, Pblob([x - r * 0.9, y + r * 0.2, x - r * 0.8, y - r * 0.5, x - r * 0.1, y - r * 0.86,
                     x + r * 0.7, y - r * 0.6, x + r * 0.9, y + r * 0.1, x + r * 0.4, y + r * 0.86,
                     x - r * 0.5, y + r * 0.86]), col, { k: 0.24, hi: 0.2 });
      var i;
      for (i = 0; i < 3; i++) {
        part(g, Prr(x - r * 0.4 + i * r * 0.42, y - r * 0.34, r * 0.3, r * 0.42, 2), sh(col, 0.18), { k: 0.2, lw: 0.7 });
      }
    },
    passo: function (g, x, y, r, col) {
      // bota / grevas
      part(g, tag(function (c2) {
        c2.beginPath();
        c2.moveTo(x - r * 0.5, y - r * 0.9);
        c2.lineTo(x + r * 0.16, y - r * 0.9);
        c2.quadraticCurveTo(x + r * 0.3, y + r * 0.1, x + r * 0.95, y + r * 0.4);
        c2.quadraticCurveTo(x + r, y + r * 0.86, x + r * 0.3, y + r * 0.86);
        c2.lineTo(x - r * 0.5, y + r * 0.86);
        c2.closePath();
      }, x, y, r), col, { k: 0.24, hi: 0.2 });
      part(g, Prr(x - r * 0.16, y + r * 0.78, r * 1.6, r * 0.28, 2), sh(col, -0.34), { k: 0.2, lw: 0.75 });
    },
    casca: function (g, x, y, r, col) {
      // couraça/carapaça: placa em escudo com nervura central
      part(g, tag(function (c2) {
        c2.beginPath();
        c2.moveTo(x, y - r * 0.98);
        c2.quadraticCurveTo(x + r * 0.94, y - r * 0.8, x + r * 0.9, y - r * 0.1);
        c2.quadraticCurveTo(x + r * 0.82, y + r * 0.72, x, y + r * 1.0);
        c2.quadraticCurveTo(x - r * 0.82, y + r * 0.72, x - r * 0.9, y - r * 0.1);
        c2.quadraticCurveTo(x - r * 0.94, y - r * 0.8, x, y - r * 0.98);
        c2.closePath();
      }, x, y, r), col, { k: 0.24, hi: 0.24 });
      part(g, Prr(x, y - r * 0.06, r * 0.26, r * 1.5, r * 0.12), sh(col, 0.24), { k: 0.18, lw: 0.7 });
      stroke(g, [x - r * 0.66, y - r * 0.3, x, y - r * 0.12, x + r * 0.66, y - r * 0.3], sh(col, -0.36), 0.9, true);
      stroke(g, [x - r * 0.58, y + r * 0.3, x, y + r * 0.46, x + r * 0.58, y + r * 0.3], sh(col, -0.36), 0.9, true);
    },
    lume: function (g, x, y, r, col) {
      // lanterna: a chama contida que se carrega no escuro
      glow(g, x, y + r * 0.1, r * 1.7, sh(col, 0.45), 0.55);
      part(g, Prr(x, y - r * 1.0, r * 0.5, r * 0.24, r * 0.1), sh(col, -0.35), { k: 0.2, lw: 0.75 });
      stroke(g, [x - r * 0.5, y - r * 0.9, x, y - r * 1.4, x + r * 0.5, y - r * 0.9], sh(col, -0.2), 1.1, true);
      part(g, tag(function (c2) {                   // corpo do lampião
        c2.beginPath();
        c2.moveTo(x - r * 0.62, y - r * 0.78);
        c2.lineTo(x + r * 0.62, y - r * 0.78);
        c2.lineTo(x + r * 0.86, y + r * 0.72);
        c2.lineTo(x - r * 0.86, y + r * 0.72);
        c2.closePath();
      }, x, y, r), mx(col, '#141a20', 0.45), { k: 0.24, hi: 0.14 });
      part(g, Pflame(x, y + r * 0.5, r * 0.34, r * 1.05, 0.05), sh(col, 0.5),
           { k: 0.16, lw: 0.8, line: sh(col, -0.3) });
      part(g, Prr(x, y + r * 0.86, r * 1.9, r * 0.26, r * 0.1), sh(col, -0.4), { k: 0.2, lw: 0.75 });
    },
    pet: function (g, x, y, r, col) {
      part(g, Pel(x, y + r * 0.16, r * 0.8, r * 0.72), col, { k: 0.22, hi: 0.2 });
      part(g, Ppoly([x - r * 0.5, y - r * 0.38, x - r * 0.72, y - r, x - r * 0.1, y - r * 0.6]), sh(col, -0.1), { k: 0.2, lw: 0.75 });
      part(g, Ppoly([x + r * 0.5, y - r * 0.38, x + r * 0.72, y - r, x + r * 0.1, y - r * 0.6]), sh(col, -0.04), { k: 0.2, lw: 0.75 });
      critterEyes(g, x, y, r * 0.24, 2, r * 0.34);
    }
  };
  function itemIconCanvas(itemId, size) {
    var c = mkCanvas(size, size), g = c.getContext('2d');
    setScale(RES); g.save(); g.scale(RES, RES);
    var it = (JOGO.DATA && JOGO.DATA.items && JOGO.DATA.items[itemId]) || null;
    var slot = A.slotKey((it && it.slot) || 'casca');
    var rar = (it && it.rarity) || 'comum';
    var rc = A.rarityColor(rar);
    var base = A.slotColor(slot);
    if (it && it.element && ELEM[it.element]) base = mx(base, elemInfo(it.element).c, 0.4);
    var rank = A.rarityRank(rar);
    iconFrame(g, size, base, rar);
    // LENDÁRIA: brasa de dois tempos — auréola laranja larga por baixo, núcleo
    // claro por cima. As outras mantêm o brilho simples de sempre.
    if (rank >= 3) {
      glow(g, size / 2, size / 2, size * 0.56, A.rarityGlow(rar), 0.5);
      glow(g, size / 2, size / 2, size * 0.34, rc, 0.6);
    } else {
      glow(g, size / 2, size / 2, size * 0.4, rc, rank >= 2 ? 0.45 : 0.25);
    }
    (SLOT_GLYPH[slot] || SLOT_GLYPH.casca)(g, size / 2, size / 2, size * 0.26, base);
    // pedrinhas de raridade: 1 · 2 · 3 · 4
    var n = rank + 1, i;
    for (i = 0; i < n; i++) {
      part(g, Pel(size * 0.5 + (i - (n - 1) / 2) * size * 0.13, size * 0.88, size * 0.038, size * 0.038),
           rc, { k: 0.2, lw: 0.6 });
    }
    // e uma coroa de fagulhas no alto, só da lendária
    if (rank >= 3) {
      for (i = 0; i < 5; i++) {
        var a = -Math.PI * 0.86 + i * (Math.PI * 0.72 / 4);
        part(g, Pstar(size / 2 + Math.cos(a) * size * 0.36, size / 2 + Math.sin(a) * size * 0.36,
                      size * (i === 2 ? 0.055 : 0.038), 4, 0.34), rc,
             { flat: true, noline: true });
      }
    }
    g.restore();
    c.__anchor = [0.5, 0.5];
    return c;
  }

  // espaço VAZIO do painel de equipamento (ADENDO v2.2): mesma silhueta do
  // espaço, mas apagada — o jogador vê o buraco e reconhece o que cabe nele.
  function slotIconCanvas(slot, size) {
    var c = mkCanvas(size, size), g = c.getContext('2d');
    var key = A.slotKey(slot);
    var col = mx(A.slotColor(key), '#2a323c', 0.62);
    setScale(RES); g.save(); g.scale(RES, RES);
    part(g, Prr(size / 2, size / 2, size - 3, size - 3, size * 0.22), '#161b22',
         { flat: true, lw: 1.2, line: '#333c49' });
    g.save(); g.globalAlpha = 0.85;
    (SLOT_GLYPH[key] || SLOT_GLYPH.casca)(g, size / 2, size / 2, size * 0.24, col);
    g.restore();
    g.restore();
    c.__anchor = [0.5, 0.5];
    return c;
  }

  function petIconCanvas(petId, size) {
    var c = mkCanvas(size, size), g = c.getContext('2d');
    var pd = (JOGO.DATA && JOGO.DATA.pets && JOGO.DATA.pets[petId]) || null;
    var pal = creaturePal(petId, pd, null);
    setScale(RES); g.save(); g.scale(RES, RES);
    iconFrame(g, size, pal.main, null);
    g.restore();
    g.save();
    g.beginPath(); g.rect(0, 0, size * RES, size * RES); g.clip();
    var k = size * RES * 0.0155;
    setScale(k);
    g.translate(size * RES * 0.5, size * RES * 0.5 + 22 * k);
    g.scale(k, k);
    paintPet(g, petId, pd, { pal: pal, back: false });
    g.restore();
    c.__anchor = [0.5, 0.5];
    return c;
  }

  var EVENT_KIND = {
    buff:     { col: '#ffd166', glyph: 'up' },
    mystery:  { col: '#b98cff', glyph: 'mystery' },
    portal:   { col: '#57c8ec', glyph: 'swirl' },
    drain:    { col: '#e05a6a', glyph: 'drain' },
    fountain: { col: '#7ef0d4', glyph: 'heal' }
  };
  function tileEventCanvas(kind, size) {
    var c = mkCanvas(size, size), g = c.getContext('2d');
    var K = EVENT_KIND[kind] || EVENT_KIND.buff;
    setScale(RES); g.save(); g.scale(RES, RES);
    var cx = size / 2, cy = size / 2, r = size * 0.4;
    // pastilha no chão: losango + halo
    glow(g, cx, cy, r * 1.5, K.col, 0.55);
    part(g, Pdiamond(cx, cy, size * 0.9, size * 0.5), rgba(K.col, 0.35),
         { flat: true, lw: 1.1, line: rgba(sh(K.col, 0.3), 0.9) });
    part(g, Pel(cx, cy - size * 0.06, r * 0.62, r * 0.62), mx(K.col, '#141a20', 0.5),
         { k: 0.24, lw: 1, line: sh(K.col, -0.4) });
    var gy = cy - size * 0.06, gr = size * 0.2;
    if (K.glyph === 'mystery') {
      g.save();
      g.fillStyle = K.col;
      g.font = 'bold ' + Math.round(size * 0.42) + 'px Georgia, serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.strokeStyle = sh(K.col, -0.6); g.lineWidth = 2.4; g.lineJoin = 'round';
      g.strokeText('?', cx, gy + 1); g.fillText('?', cx, gy + 1);
      g.restore();
    } else if (K.glyph === 'drain') {
      part(g, Pdrop(cx, gy + gr * 0.2, gr * 0.8), K.col, { k: 0.2, hi: 0.2 });
      stroke(g, [cx - gr * 0.5, gy + gr * 0.7, cx + gr * 0.5, gy + gr * 0.7], sh(K.col, -0.3), 1.1);
    } else {
      (GLYPH[K.glyph] || GLYPH.up)(g, cx, gy, gr, K.col);
    }
    g.restore();
    c.__anchor = [0.5, 0.5];
    return c;
  }

  // ------------------------------------------------- PEDRAS DE FORJA (§9-B)
  // Uma silhueta por elemento, para o jogador contar o estoque de relance:
  // fogo = brasa em chama · água = lágrima · terra = grão de rocha ·
  // ar = bolha assobiando · neutro = lasca de lousa (serve em qualquer forja).
  function stoneIconCanvas(stoneId, size) {
    var c = mkCanvas(size, size), g = c.getContext('2d');
    var sd = (JOGO.DATA && JOGO.DATA.stones && JOGO.DATA.stones[stoneId]) || null;
    var el = (sd && sd.element) || (/ember|fogo/.test(stoneId) ? 'fogo'
            : /tear|agua/.test(stoneId) ? 'agua' : /root|terra/.test(stoneId) ? 'terra'
            : /breath|\bar\b/.test(stoneId) ? 'ar' : 'neutro');
    var ei = elemInfo(ELEM[el] ? el : 'neutro');
    var cx = size / 2, cy = size / 2, r = size * 0.3;
    setScale(RES); g.save(); g.scale(RES, RES);
    iconFrame(g, size, ei.c, null);
    glow(g, cx, cy, r * 1.7, ei.glow, 0.42);
    // corpo mineral: cristal facetado, sempre a mesma leitura de "pedra"
    part(g, Ppoly([cx - r * 0.9, cy + r * 0.5, cx - r * 0.66, cy - r * 0.55,
                   cx, cy - r * 1.05, cx + r * 0.72, cy - r * 0.5,
                   cx + r * 0.86, cy + r * 0.55, cx, cy + r * 1.02]),
         ei.c, { k: 0.3, hi: 0.2, lw: 1.1, line: lineOf(ei.deep) });
    part(g, Ppoly([cx, cy - r * 1.05, cx + r * 0.72, cy - r * 0.5,
                   cx + r * 0.86, cy + r * 0.55, cx, cy + r * 1.02]),
         sh(ei.deep, 0.12), { flat: true, lw: 0.8, line: rgba(ei.deep, 0.7) });
    part(g, Ppoly([cx - r * 0.4, cy - r * 0.3, cx - r * 0.06, cy - r * 0.72,
                   cx + r * 0.1, cy - r * 0.2, cx - r * 0.2, cy + r * 0.16]),
         sh(ei.glow, 0.24), { flat: true, noline: true });
    // marca do elemento flutuando sobre o cristal
    if (el === 'fogo') part(g, Pflame(cx, cy - r * 0.35, r * 0.34, r * 1.0, 0), ei.glow, { k: 0.16, lw: 0.8, line: lineOf(ei.deep) });
    else if (el === 'agua') part(g, Pdrop(cx, cy - r * 0.25, r * 0.36), ei.glow, { k: 0.18, lw: 0.8, line: lineOf(ei.deep) });
    else if (el === 'terra') part(g, Pel(cx, cy + r * 0.05, r * 0.3, r * 0.26), sh(ei.glow, -0.05), { k: 0.2, lw: 0.8, line: lineOf(ei.deep) });
    else if (el === 'ar') part(g, Pfeather(cx - r * 0.1, cy - r * 0.1, r * 0.9, -0.9), ei.glow, { k: 0.16, lw: 0.8, line: lineOf(ei.deep) });
    else {
      stroke(g, [cx - r * 0.42, cy + r * 0.2, cx + r * 0.06, cy - r * 0.34, cx + r * 0.44, cy + r * 0.14],
             rgba('#ffffff', 0.8), 1.2, true);
    }
    g.restore();
    c.__anchor = [0.5, 0.5];
    return c;
  }

  // -------------------------------------------------- ESTRELAS DE CLASSE (§9-B)
  // filled = conquistada (dourada e brilhando) · vazia = contorno apagado.
  function starIconCanvas(filled, size, col) {
    var c = mkCanvas(size, size), g = c.getContext('2d');
    var on = !!filled;
    var base = col || (on ? '#ffc44d' : '#4a5361');
    var cx = size / 2, cy = size / 2, R = size * 0.42;
    setScale(RES); g.save(); g.scale(RES, RES);
    if (on) glow(g, cx, cy, R * 1.7, '#ffd98a', 0.5);
    part(g, Pstar(cx, cy, R, 5, 0.44), base, { k: on ? 0.26 : 0.1, hi: on ? 0.3 : 0,
                                               lw: 1.2, line: on ? '#7a4a10' : '#2b323c' });
    if (on) {
      part(g, Pel(cx - R * 0.24, cy - R * 0.3, R * 0.2, R * 0.14, -0.5),
           'rgba(255,255,255,0.85)', { flat: true, noline: true });
    }
    g.restore();
    c.__anchor = [0.5, 0.5];
    return c;
  }

  // ==========================================================================
  // CACHE + API PÚBLICA
  // ==========================================================================
  var CACHE = {};
  var MISSES = 0;
  function cached(key, make) {
    var v = CACHE[key];
    if (v) return v;
    MISSES++;
    v = make();
    CACHE[key] = v;
    return v;
  }
  A.clearCache = function () { CACHE = {}; MISSES = 0; };
  // IMPORTANTE: os canvases devolvidos são CACHEADOS e compartilhados. Para
  // colocar um no DOM (HUD, galeria) use SEMPRE uma cópia — inserir o original
  // duas vezes o MOVE do primeiro lugar. O Pixi pode usar o original à vontade.
  A.node = function (cv, cssW, cls) {
    var c = document.createElement('canvas');
    c.width = cv.width; c.height = cv.height;
    c.getContext('2d').drawImage(cv, 0, 0);
    var w = cssW || cv.__w || (cv.width / (cv.__res || 1));
    c.style.width = w + 'px';
    c.style.height = (w * cv.height / cv.width) + 'px';
    if (cls) c.className = cls;
    c.__res = cv.__res; c.__anchor = cv.__anchor;
    return c;
  };
  A.stats = function () {
    var n = 0, k, px = 0;
    for (k in CACHE) { n++; px += CACHE[k].width * CACHE[k].height; }
    return { entries: n, generated: MISSES, megabytes: Math.round(px * 4 / 1048576 * 10) / 10 };
  };
  A.setRes = function (r) {
    RES = M.res = Math.max(1, Math.min(4, r | 0 || 1));
    M.spriteScale = 1 / RES;
    A.clearCache();
  };

  // `opts.pose = {fase:'idle'|'andar'|'atacar'|'conjurar'|'dano'|'morte',
  //               frame:0..n-1}` (ou `t` de 0..1). Cada quadro é cacheado.
  function normPose(p) {
    if (!p) return null;
    if (typeof p === 'string') p = { fase: p, frame: 0 };
    var fase = POSE[p.fase] ? p.fase : 'idle';
    var n = POSE[fase].frames;
    var fr;
    if (p.t != null) fr = Math.round(p.t * (POSE[fase].loop ? n : n - 1));
    else fr = p.frame | 0;
    fr = ((fr % n) + n) % n;
    return { fase: fase, frame: fr, t: fr / (POSE[fase].loop ? n : Math.max(1, n - 1)) };
  }
  A.unit = function (defId, opts) {
    opts = opts || {};
    var els = normEls(opts), dir = normDir(opts.dir), scale = opts.scale || 1;
    var pose = normPose(opts.pose);
    var pk = pose ? pose.fase + '#' + pose.frame : '-';
    return cached('unit:' + defId + ':' + els.join('+') + ':' + dir + ':' + scale + ':' + pk, function () {
      return unitCanvas(defId, els, dir, scale, pose);
    });
  };
  // ciclo inteiro pronto para virar AnimatedSprite no Pixi
  A.unitFrames = function (defId, opts, fase) {
    opts = opts || {};
    fase = POSE[fase] ? fase : 'idle';
    var n = POSE[fase].frames, out = [], i;
    for (i = 0; i < n; i++) {
      var o = { element: opts.element, elements: opts.elements, dir: opts.dir,
                scale: opts.scale, pose: { fase: fase, frame: i } };
      out.push(A.unit(defId, o));
    }
    return out;
  };
  A.portrait = function (defId, opts) {
    opts = opts || {};
    var els = normEls(opts), size = opts.size || 128;
    return cached('portrait:' + defId + ':' + els.join('+') + ':' + size, function () {
      return portraitCanvas(defId, els, size);
    });
  };
  A.tile = function (theme, variant) {
    variant = variant | 0;
    return cached('tile:' + theme + ':' + variant, function () { return tileCanvas(theme, variant); });
  };
  A.obstacleHigh = function (theme, variant) {
    var T = themeOf(theme);
    var key = variantKey(T, HIGH, T.highs || [T.high], variant, 'high') || T.high;
    return cached('high:' + theme + ':' + key, function () {
      return sceneryCanvas(HIGH, theme, key, M.tileH + 116);
    });
  };
  A.obstacleLow = function (theme, variant) {
    var T = themeOf(theme);
    var key = variantKey(T, LOW, T.lows || [T.low], variant, 'low') || T.low;
    return cached('low:' + theme + ':' + key, function () {
      return sceneryCanvas(LOW, theme, key, M.tileH + 64);
    });
  };
  A.prop = function (theme, key) {
    var T = themeOf(theme);
    var k = variantKey(T, PROPS, T.props, key, 'props') || T.props[0];
    return cached('prop:' + theme + ':' + k, function () {
      return sceneryCanvas(PROPS, theme, k, M.tileH + 68);
    });
  };
  A.spellIcon = function (spellOrKey, size) {
    size = size || 56;
    var sp = spellOrKey, id;
    if (typeof spellOrKey === 'string') {
      sp = (JOGO.DATA && JOGO.DATA.spells && JOGO.DATA.spells[spellOrKey]) || null;
      id = spellOrKey;
      if (!sp) {
        // sem dados ainda: deriva elemento/forma do id ('classe-elemento-nivel')
        var m = /(?:^|[-:])(fogo|agua|terra|ar|neutro)(?:[-:]|$)/.exec(spellOrKey);
        sp = { id: spellOrKey, element: m ? m[1] : 'neutro', effects: [], range: { max: 4 } };
      }
    } else id = (sp && sp.id) || 'sp';
    return cached('spell:' + id + ':' + size, function () { return spellIconCanvas(sp, size); });
  };
  A.itemIcon = function (itemId, size) {
    size = size || 56;
    return cached('item:' + itemId + ':' + size, function () { return itemIconCanvas(itemId, size); });
  };
  A.petIcon = function (petId, size) {
    size = size || 56;
    return cached('pet:' + petId + ':' + size, function () { return petIconCanvas(petId, size); });
  };
  A.tileEventIcon = function (kind, size) {
    size = size || 48;
    return cached('event:' + kind + ':' + size, function () { return tileEventCanvas(kind, size); });
  };
  // ---- ADENDO v2.1: pedras de forja, cartas de classe e estrelas
  A.stoneIcon = function (stoneId, size) {
    size = size || 56;
    return cached('stone:' + stoneId + ':' + size, function () { return stoneIconCanvas(stoneId, size); });
  };
  A.starIcon = function (filled, size, col) {
    size = size || 28;
    return cached('star:' + (filled ? 1 : 0) + ':' + size + ':' + (col || '-'), function () {
      return starIconCanvas(filled, size, col);
    });
  };
  A.slotIcon = function (slot, size) {
    size = size || 56;
    return cached('slot:' + A.slotKey(slot) + ':' + size, function () { return slotIconCanvas(slot, size); });
  };
  A.slotIds = function () { return ['punho', 'passo', 'casca', 'lume']; };
  A.stoneIds = function () {
    var d = (JOGO.DATA && JOGO.DATA.stones) || null, o = [], k;
    if (d) { for (k in d) o.push(k); }
    return o.length ? o : ['stone-ember', 'stone-tear', 'stone-root', 'stone-breath', 'stone-slate'];
  };

  // carta de personagem (recompensa de chefe). `Art.cardIcon` é o nome do
  // adendo §9-B; `Art.classCard` continua valendo (mesma função).
  A.classCard = function (classId, w, h) {
    w = w || 132; h = h || 186;
    return cached('card:' + classId + ':' + w + ':' + h, function () {
      var c = mkCanvas(w, h), g = c.getContext('2d');
      var C = (JOGO.DATA && JOGO.DATA.classes && JOGO.DATA.classes[classId]) || null;
      var pal = classPal(classId, ['neutro']);
      var rar = (C && C.cardRarity) || 'comum';
      var rc = A.rarityColor(rar);
      setScale(RES); g.save(); g.scale(RES, RES);
      part(g, Prr(w / 2, h / 2, w - 4, h - 4, 10), mx(pal.dark, '#0b0e12', 0.4), { k: 0.3, lw: 1.2, line: '#0b0e12' });
      var lg = g.createLinearGradient(0, 0, 0, h);
      lg.addColorStop(0, rgba(pal.main, 0.4)); lg.addColorStop(1, rgba(pal.main, 0.05));
      g.save(); Prr(w / 2, h / 2, w - 10, h - 10, 8)(g); g.clip();
      g.fillStyle = lg; g.fillRect(0, 0, w, h); g.restore();
      g.save(); g.strokeStyle = rc; g.lineWidth = 2.2;
      Prr(w / 2, h / 2, w - 7, h - 7, 9)(g); g.stroke(); g.restore();
      g.restore();
      // figura
      g.save();
      g.beginPath(); g.rect(6 * RES, 10 * RES, (w - 12) * RES, (h - 40) * RES); g.clip();
      var cfg = baseCfg(classId, ['neutro']); cfg.back = false;
      var An = (PLANS[cfg.base] || PLANS.sumo).anchors(cfg);
      var k = (h - 46) * RES * 0.0092;
      setScale(k);
      g.translate(w * RES * 0.5, (h - 40) * RES * 0.92);
      g.scale(k, k);
      paintUnit(g, cfg);
      g.restore();
      // nome
      setScale(RES); g.save(); g.scale(RES, RES);
      g.fillStyle = 'rgba(8,10,14,0.82)';
      g.fillRect(5, h - 34, w - 10, 28);
      g.fillStyle = '#f0e8d8';
      g.font = 'bold ' + Math.round(w * 0.115) + 'px Georgia, serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText((C && C.name) || classId, w / 2, h - 24);
      g.fillStyle = rc;
      g.font = Math.round(w * 0.082) + 'px "Segoe UI", system-ui, sans-serif';
      g.fillText(rar.toUpperCase(), w / 2, h - 12);
      g.restore();
      c.__anchor = [0.5, 0.5];
      return c;
    });
  };

  A.cardIcon = A.classCard;

  // chave genérica — 'unit:sumo:fogo:0' · 'tile:estufa:1' · 'spell:x' · …
  A.texture = function (key) {
    if (CACHE[key]) return CACHE[key];
    var p = String(key).split(':');
    // defIds de fusão trazem ':' no meio — remonta antes de despachar
    if ((p[0] === 'unit' || p[0] === 'portrait') && p[1] === 'fus') {
      p = [p[0], 'fus:' + p[2]].concat(p.slice(3));
    }
    switch (p[0]) {
      case 'unit': return A.unit(p[1], { element: p[2], dir: p[3] });
      case 'portrait': return A.portrait(p[1], { element: p[2], size: p[3] ? +p[3] : 128 });
      case 'tile': return A.tile(p[1], +p[2] || 0);
      case 'high': return A.obstacleHigh(p[1], p[2]);
      case 'low': return A.obstacleLow(p[1], p[2]);
      case 'prop': return A.prop(p[1], p[2]);
      case 'spell': return A.spellIcon(p[1], p[2] ? +p[2] : 56);
      case 'item': return A.itemIcon(p[1], p[2] ? +p[2] : 56);
      case 'pet': return A.petIcon(p[1], p[2] ? +p[2] : 56);
      case 'event': return A.tileEventIcon(p[1], p[2] ? +p[2] : 48);
      case 'card': return A.classCard(p[1]);
      case 'stone': return A.stoneIcon(p[1], p[2] ? +p[2] : 56);
      case 'star': return A.starIcon(p[1] === '1' || p[1] === 'on', p[2] ? +p[2] : 28);
      default: return A.unit(key, {});
    }
  };

  // listas úteis para galeria/HUD
  A.classIds = function () {
    var d = (JOGO.DATA && JOGO.DATA.classes) || null, out = [], k;
    if (d) { for (k in d) out.push(k); }
    if (!out.length) for (k in PLANS) out.push(k);
    return out;
  };
  A.elementIds = function () {
    var d = (JOGO.DATA && JOGO.DATA.elements) || null;
    return d && d.length ? d.slice() : ['neutro', 'fogo', 'agua', 'terra', 'ar'];
  };
  A.fusionPairs = function () {
    var ids = A.classIds().filter(function (c) { return !!PLANS[c]; }).sort();
    var out = [], i, j;
    for (i = 0; i < ids.length; i++) for (j = i + 1; j < ids.length; j++) out.push(ids[i] + '+' + ids[j]);
    return out;
  };
  // arquétipo escolhido para um monstro (galeria usa para medir variedade)
  A.archetypeOf = function (defId) {
    var md = (JOGO.DATA && JOGO.DATA.monsters && JOGO.DATA.monsters[defId]) || null;
    return archOf(defId, md);
  };
  A.petKindOf = function (petId) {
    var pd = (JOGO.DATA && JOGO.DATA.pets && JOGO.DATA.pets[petId]) || null;
    return petKindOf(petId, pd);
  };
  A.themeIds = function () { var o = [], k; for (k in THEMES) o.push(k); return o; };
  A.propKeys = function () { var o = [], k; for (k in PROPS) o.push(k); return o; };
  A.highKeys = function () { var o = [], k; for (k in HIGH) o.push(k); return o; };
  A.lowKeys = function () { var o = [], k; for (k in LOW) o.push(k); return o; };
  A.eventKinds = function () { var o = [], k; for (k in EVENT_KIND) o.push(k); return o; };

  JOGO.Art = A;
})();
