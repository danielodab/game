/* fusoes.js — a página das fusões (site/fusoes.html), 10/09.
 *
 * NADA AQUI É NÚMERO COPIADO. Tudo sai dos arquivos do próprio jogo, servidos
 * da mesma origem (../js/core/data/*.js e ../js/core/fusion.js):
 *   - as regras (custo, PA e PP a mais, escudo, elemento puro) de JOGO.Fusion.*;
 *   - duplas, formas, misturas e obras de JOGO.DATA.fusion*;
 *   - os feitiços com os números de verdade de JOGO.Fusion.spellsFor, a MESMA
 *     conta que o jogo faz na hora de fundir (força pelo nível e ajuste por
 *     dupla).
 * Se o jogo mudar um número, a página muda junto no próximo carregamento.
 *
 * O que mora aqui é só VOCABULÁRIO: o nome em português dos tipos de efeito,
 * das formas de área e do lado do alvo. O jogo guarda isso como código
 * (`damage`, `ring`, `ally`), e a HUD mostra só uma parte. É uma lista fechada
 * — os atalhos de js/core/data/fusions.js (d, dl, pz, hl… ws) —, e o dono
 * confere o texto. Efeito que não estiver aqui aparece como "efeito especial",
 * nunca como código cru.
 *
 * Link direto para uma dupla:
 *   fusoes.html#dupla=arqueiro+bruxo&elementos=agua+ar&nivel=30
 */
(function () {
  'use strict';
  var E = SITE.esc;
  var JG = window.JOGO || {};
  var DATA = JG.DATA || {};
  var F = JG.Fusion;
  var CLASSES = DATA.classes || {};
  var FORMAS = DATA.fusionForms || {};
  var IDENT = DATA.fusionIdentities || {};
  var MISTURAS = DATA.fusionBlends || {};
  var OBRAS = DATA.fusionSummons || {};
  var PAYLOADS = DATA.fusionSpells || {};
  var ELINFO = DATA.elementInfo || {};
  var ELEMENTOS = (DATA.elements || Object.keys(ELINFO)).filter(function (e) { return ELINFO[e]; });
  function $(id) { return document.getElementById(id); }

  /* ---- VOCABULÁRIO (o dono confere) ------------------------------------ */
  var AREA = {
    single: function () { return 'alvo único'; },
    circle: function (n) { return 'círculo de raio ' + n; },
    line:   function (n) { return 'linha de ' + casas(n); },
    cross:  function (n) { return 'cruz de raio ' + n; },
    cone:   function (n) { return 'leque de ' + casas(n); },
    ring:   function (n) { return 'anel de raio ' + n; }
  };
  var ALVO = { enemy: 'inimigo', ally: 'aliado', self: 'a própria fusão', any: 'qualquer casa' };
  var ATRIBUTO = { power: 'poder', pa: 'PA', pp: 'PP', dodge: 'esquiva', lock: 'fixação', initiative: 'iniciativa' };
  var LIMPA = { poison: 'veneno', root: 'prisão' };
  // o papel das classes vem do dado como id (sem acento); só um precisa de acento
  var PAPEL = { guardiao: 'guardião' };

  function num(x) { var n = Number(x); return isFinite(n) ? n : 0; }
  function faixa(e) {
    var a = num(e.min), b = num(e.max);
    return (e.max == null || a === b) ? String(a) : a + '–' + b;
  }
  function turnos(n) {
    n = num(n);
    if (n >= 9999) return 'até o fim da batalha';
    return 'por ' + n + (n === 1 ? ' turno' : ' turnos');
  }
  function casas(n) { n = num(n); return n + (n === 1 ? ' casa' : ' casas'); }
  function nomeEl(id) { return ELINFO[id] ? ELINFO[id].name : 'Neutro'; }
  function corOk(c) { return /^#[0-9a-fA-F]{3,8}$/.test(c || '') ? c : ''; }
  function elem(id) {
    var i = ELINFO[id] || ELINFO.neutro;
    if (!i) return 'Neutro';
    return '<span class="elem" style="--cor:' + corOk(i.color) + '">' + E(i.name) + '</span>';
  }
  function pct(x) { return Math.round(num(x) * 100) + '%'; }

  /* Os 25 efeitos que as formas e as misturas usam (24 tipos, e o dano com
   * roubo de vida conta à parte). Devolvem HTML: o que é texto do dado passa
   * pelo esc. */
  var EFEITO = {
    damage: function (e) { return (e.lifesteal ? 'dano com roubo de vida ' : 'dano ') + faixa(e) + ' de ' + elem(e.element); },
    poison: function (e) { return 'veneno ' + faixa(e) + ' de ' + elem(e.element) + ' a cada turno, ' + turnos(e.duration); },
    heal: function (e) { return 'cura ' + faixa(e); },
    regen: function (e) { return 'regeneração ' + faixa(e) + ' ' + turnos(e.duration); },
    shield: function (e) { return 'escudo de ' + num(e.value) + ' ' + turnos(e.duration); },
    buff: function (e) {
      var v = num(e.value), s = (v >= 0 ? '+' : '') + v;
      if (e.stat === 'pa' || e.stat === 'pp') return s + ' ' + ATRIBUTO[e.stat] + ' ' + turnos(e.duration);
      return s + ' de ' + (ATRIBUTO[e.stat] || 'atributo') + ' ' + turnos(e.duration);
    },
    resist: function (e) { return '+' + num(e.value) + ' de resistência a ' + elem(e.element) + ' ' + turnos(e.duration); },
    push: function (e) { return 'empurra ' + casas(e.tiles); },
    pull: function (e) { return 'puxa ' + casas(e.tiles); },
    root: function (e) { return 'prende no chão (0 PP) ' + turnos(e.duration); },
    mark: function (e) {
      return 'marca o alvo' + (e.value != null ? ': +' + num(e.value) + '% de dano recebido por marca' : '') +
        (e.max ? ', até ' + num(e.max) + ' marcas' : '') + ', ' + turnos(e.duration);
    },
    detonateMarks: function (e) { return 'detona as marcas: ' + SITE.decimal(num(e.mult)) + ' de dano por marca'; },
    teleport: function () { return 'teleporta para a casa escolhida'; },
    moveTo: function (e) { return 'avança até ' + casas(e.maxTiles); },
    chain: function (e) {
      var j = num(e.jumps);
      return 'cadeia de ' + elem(e.element) + ': ' + faixa(e) + ', salta ' + j + (j === 1 ? ' vez' : ' vezes') +
        (e.falloff != null ? ', e cada salto bate com ' + pct(e.falloff) + ' do anterior' : '');
    },
    summon: function (e) { var o = OBRAS[e.monsterId]; return 'invoca ' + (o ? '<b>' + E(o.name) + '</b>' : 'uma obra de fusão'); },
    trap: function (e) {
      var p = PAYLOADS[e.trapId];
      return (p ? 'arma a armadilha <b>' + E(p.name) + '</b>' : 'arma uma armadilha') + ' ' + turnos(e.duration);
    },
    taunt: function (e) { return 'provoca os inimigos ' + turnos(e.duration); },
    wall: function (e) { return 'ergue muro ' + turnos(e.duration); },
    invisible: function (e) { return 'fica invisível ' + turnos(e.duration); },
    reflect: function (e) { return 'devolve ' + num(e.pct) + '% do dano recebido ' + turnos(e.duration); },
    dispelShield: function () { return 'arranca o escudo do alvo'; },
    cleanse: function (e) {
      var k = (e.kinds || []).map(function (x) { return LIMPA[x] || 'efeito'; });
      return 'limpa ' + (k.length ? k.join(' e ') : 'os efeitos');
    },
    weatherShift: function (e) {
      var w = (DATA.weathers || {})[e.weather];
      return 'vira o clima para ' + (w ? E(w.name) : 'outro');
    }
  };
  function efeito(e) {
    var f = e && EFEITO[e.type];
    return f ? f(e) : 'efeito especial';
  }

  function alcance(r) {
    r = r || {};
    var a = num(r.min), b = num(r.max);
    var t = b === 0 ? 'em si' : (a === b ? String(b) : a + '–' + b);
    if (r.line) t += ', em linha reta';
    if (r.los === false && b > 0) t += ', por cima de obstáculo';
    return t;
  }
  function area(a) {
    a = a || {};
    var f = AREA[a.shape];
    return f ? f(num(a.size)) : 'área especial';
  }
  function alvo(forma) {
    return (ALVO[forma.targetSide] || 'qualquer casa') + (forma.needsEmptyTile ? ' (casa vazia)' : '');
  }

  /* ---- classes e duplas ---- */
  function nomeClasse(id) { return (CLASSES[id] && CLASSES[id].name) || String(id); }
  function papel(id) { var r = CLASSES[id] && CLASSES[id].role; return r ? (PAPEL[r] || r) : ''; }
  function cor(id) { return corOk(CLASSES[id] && CLASSES[id].palette && CLASSES[id].palette.primary); }
  function classesDupla(k) { var p = k.split('+'); return nomeClasse(p[0]) + ' + ' + nomeClasse(p[1]); }
  function nomeDupla(k) { var i = IDENT[k]; return (i && i.name) || classesDupla(k); }
  function papeis(k) { var p = k.split('+'); return [papel(p[0]), papel(p[1])].filter(Boolean).join(' + '); }
  function moldura(k, preguica) {
    var p = k.split('+'), nome = nomeDupla(k);
    return '<div class="foto retrato dupla-foto" data-letra="' + E(SITE.inicial(SITE.semArtigo(nome))) + '"' +
      SITE.estiloCores(cor(p[0]), cor(p[1])) + '>' +
      '<img src="' + SITE.img('fusao', k) + '" alt="' + E(nome) + '"' + (preguica ? ' loading="lazy"' : '') +
      ' onerror="SITE.semFoto(this)"></div>';
  }

  var PARES = Object.keys(FORMAS).filter(function (k) { return Array.isArray(FORMAS[k]) && FORMAS[k].length; });
  // o nível mais alto em que uma forma abre é o topo do seletor de nível
  var NIVEL_MAX = 1;
  PARES.forEach(function (k) {
    FORMAS[k].forEach(function (f) { if (num(f.tier) > NIVEL_MAX) NIVEL_MAX = num(f.tier); });
  });

  /* O nível em que o herói escolhe elemento sai do próprio dado: o 1º feitiço
   * de cada caminho elemental tem o nível no id (`sumo-fogo-5`, a convenção
   * de classes.js). */
  function nivelDoElemento() {
    var menor = null;
    Object.keys(CLASSES).forEach(function (id) {
      var ps = CLASSES[id].paths || {};
      Object.keys(ps).forEach(function (el) {
        var m = /-(\d+)$/.exec((ps[el] || [])[0] || '');
        if (m && (menor === null || Number(m[1]) < menor)) menor = Number(m[1]);
      });
    });
    return menor;
  }

  /* ---- 1. O que é fusão ---- */
  function regras() {
    var caixa = $('fu-regras');
    if (!F) {
      caixa.innerHTML = '<div class="estado fora">Não deu para ler as regras do jogo (../js/core/fusion.js).</div>';
      return;
    }
    var nv = nivelDoElemento();
    var itens = [
      ['⚔', 'Quem funde', 'Dois heróis seus, lado a lado — em cruz, sem diagonal. Pet e invocação não fundem, e o Mestre do Fundo também não.'],
      ['◆', 'Quanto custa', 'Quem declara gasta ' + F.FUSION_PA_COST + ' PA, e o turno acaba na hora.'],
      ['⌛', 'Quando acontece', 'No fim desse turno, se os dois ainda estiverem colados. Se um cair ou se afastar antes, a fusão falha.'],
      ['∞', 'Quanto dura', 'Até o fim da batalha. Se o corpo fundido cair, os dois caem juntos: não há volta.'],
      ['♥', 'O corpo', 'Vida somada. PA e PP do maior dos dois, com +' + F.BONUS_PA + ' PA e +' + F.BONUS_PP + ' PP. ' +
        'Escudo de ' + F.BONUS_SHIELD + ' que não acaba. Iniciativa e poder do maior; esquiva, fixação e resistências na média. ' +
        'O nível é a média dos dois, arredondada para baixo.'],
      ['✦', 'Os feitiços', 'Só os da dupla. A forma vem das duas classes e abre conforme o nível da fusão; o sobrenome e o efeito extra ' +
        'vêm da mistura dos elementos; a força cresce com o nível. As invocações dos dois somem do tabuleiro, e os pets acompanham a fusão.'],
      ['☯', 'Os elementos', 'Entra o primeiro elemento de cada herói' +
        (nv ? '; quem está abaixo do nível ' + nv + ' ainda não escolheu o seu e entra como Neutro' : '; quem ainda não escolheu entra como Neutro') +
        '. Dois elementos iguais dão ×' + SITE.decimal(F.PURO_MULT) + ' no dano, no veneno e na cadeia.']
    ];
    caixa.innerHTML = itens.map(function (i) {
      return '<div class="destaque"><div class="glifo">' + i[0] + '</div><h3>' + i[1] + '</h3><p>' + i[2] + '</p></div>';
    }).join('');
  }

  /* ---- 2. As duplas ---- */
  function cartaoDupla(k) {
    var idt = IDENT[k] || {};
    return '<a class="cartao dupla" href="#dupla=' + k + '" data-dupla="' + E(k) + '">' + moldura(k, true) +
      '<div class="corpo"><span class="papel">' + E(classesDupla(k)) + '</span><h3>' + E(nomeDupla(k)) + '</h3>' +
      (idt.line ? '<p>' + E(idt.line) + '</p>' : '') +
      (papeis(k) ? '<p class="papeis">' + E(papeis(k)) + '</p>' : '') + '</div></a>';
  }

  var estado = { dupla: PARES[0] || null, a: 'neutro', b: 'neutro', nivel: NIVEL_MAX };

  function leHash() {
    var q = {};
    location.hash.replace(/^#/, '').split('&').forEach(function (par) {
      var i = par.indexOf('=');
      if (i <= 0) return;
      try { q[par.slice(0, i)] = decodeURIComponent(par.slice(i + 1)); } catch (e) { /* pedaço torto: ignora */ }
    });
    return q;
  }
  /* devolve true quando o endereço escolhe uma dupla que existe */
  function aplicaHash() {
    var q = leHash(), achou = false;
    if (q.dupla) {
      var p = SITE.parDe(q.dupla), k = p && p.join('+');
      if (k && FORMAS[k]) { estado.dupla = k; achou = true; }
    }
    if (q.elementos) {
      var el = q.elementos.split('+');
      if (el.length === 2 && ELINFO[el[0]] && ELINFO[el[1]]) { estado.a = el[0]; estado.b = el[1]; }
    }
    if (q.nivel) {
      var n = parseInt(q.nivel, 10);
      if (n >= 1 && n <= NIVEL_MAX) estado.nivel = n;
    }
    return achou;
  }
  function gravaEndereco() {
    if (!history.replaceState || !estado.dupla) return;
    history.replaceState(null, '', '#dupla=' + estado.dupla + '&elementos=' + estado.a + '+' + estado.b + '&nivel=' + estado.nivel);
  }

  function cartaoFeitico(s) {
    var ficha = [num(s.paCost) + ' PA', 'alcance ' + alcance(s.range), area(s.aoe)];
    if (s.cooldown) ficha.push('recarga ' + num(s.cooldown));
    if (num(s.castsPerTurn) > 1) ficha.push(num(s.castsPerTurn) + '× por turno');
    return '<div class="feitico"><b>' + E(s.name) + '</b><span class="ficha">' + E(ficha.join(' · ')) + '</span>' +
      '<ul>' + (s.effects || []).map(function (e) { return '<li>' + efeito(e) + '</li>'; }).join('') + '</ul></div>';
  }

  /* as obras (invocações) e as armadilhas que as formas da dupla usam */
  function obrasDaDupla(k) {
    var obras = [], armas = [];
    FORMAS[k].forEach(function (f) {
      (f.mechanic || []).forEach(function (m) {
        if (m.type === 'summon' && OBRAS[m.monsterId] && obras.indexOf(m.monsterId) < 0) obras.push(m.monsterId);
        if (m.type === 'trap' && PAYLOADS[m.trapId] && armas.indexOf(m.trapId) < 0) armas.push(m.trapId);
      });
    });
    if (!obras.length && !armas.length) return '';
    return '<h4>Obras e armadilhas da dupla</h4><div class="obras">' +
      obras.map(function (id) {
        var o = OBRAS[id], st = o.stats || {};
        return '<div class="cartao obra"><div class="foto retrato" data-letra="' + E(SITE.inicial(o.name)) + '">' +
          '<img src="' + SITE.img('obra', id) + '" alt="' + E(o.name) + '" loading="lazy" onerror="SITE.semFoto(this)"></div>' +
          '<div class="corpo"><span class="papel">' + E(o.family || 'Obra de Fusão') + '</span><h3>' + E(o.name) + '</h3>' +
          '<p>' + E(o.description || '') + '</p>' +
          '<p class="ficha">' + num(st.hp) + ' PV · ' + num(st.pa) + ' PA · ' + num(st.pp) + ' PP</p></div></div>';
      }).join('') +
      armas.map(function (id) {
        var p = PAYLOADS[id];
        return '<div class="cartao obra armadilha"><div class="corpo"><span class="papel">Armadilha</span><h3>' + E(p.name) + '</h3>' +
          '<p>' + E(p.description || '') + '</p>' +
          '<p class="ficha">' + (p.effects || []).map(efeito).join(' · ') + '</p></div></div>';
      }).join('') + '</div>';
  }

  function detalhe(rolar) {
    var caixa = $('fu-detalhe'), k = estado.dupla;
    if (!k || !FORMAS[k]) { caixa.hidden = true; return; }
    var idt = IDENT[k] || {};
    var formas = FORMAS[k].slice().sort(function (x, y) { return num(x.tier) - num(y.tier); });
    function opcoesEl(sel) {
      return ELEMENTOS.map(function (el) {
        return '<option value="' + el + '"' + (el === sel ? ' selected' : '') + '>' + E(nomeEl(el)) + '</option>';
      }).join('');
    }
    var niveis = '';
    for (var n = 1; n <= NIVEL_MAX; n++) niveis += '<option value="' + n + '"' + (n === estado.nivel ? ' selected' : '') + '>' + n + '</option>';
    var feit = [];
    try { feit = (F && F.spellsFor) ? F.spellsFor(k, estado.a + '+' + estado.b, estado.nivel) : []; } catch (e) { feit = []; }

    caixa.innerHTML =
      '<div class="dupla-cab">' + moldura(k, false) +
        '<div>' +
          '<span class="papel">' + E(classesDupla(k)) + (papeis(k) ? ' · ' + E(papeis(k)) : '') + '</span>' +
          '<h3>' + E(nomeDupla(k)) + '</h3>' + (idt.line ? '<p class="apoio">' + E(idt.line) + '</p>' : '') +
          '<div class="controles">' +
            '<label>Elemento de quem declara<select id="fu-el-a">' + opcoesEl(estado.a) + '</select></label>' +
            '<label>Elemento do parceiro<select id="fu-el-b">' + opcoesEl(estado.b) + '</select></label>' +
            '<label>Nível da fusão<select id="fu-nivel">' + niveis + '</select></label>' +
          '</div>' +
          '<p class="dica">Quem declara a fusão entra como o primeiro elemento. O nível da fusão é a média dos dois heróis.</p>' +
        '</div>' +
      '</div>' +
      '<h4>As formas da dupla</h4>' +
      '<div class="tabela-caixa"><table class="formas"><thead><tr><th class="num">Nível</th><th>Forma</th><th class="num">PA</th>' +
        '<th>Alcance</th><th>Área</th><th>Alvo</th><th>O que faz</th></tr></thead><tbody>' +
      formas.map(function (f) {
        var t = num(f.tier), aberta = t <= estado.nivel;
        return '<tr' + (aberta ? '' : ' class="trancada" title="abre no nível ' + t + '"') + '>' +
          '<td class="num">' + (t ? t : 'início') + '</td><td class="nome">' + E(f.formName) + '</td>' +
          '<td class="num">' + num(f.paCost) + '</td><td>' + E(alcance(f.range)) + '</td><td>' + E(area(f.aoe)) + '</td>' +
          '<td>' + E(alvo(f)) + '</td><td class="desc">' + E(f.description || '') + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<h4>Os feitiços com ' + E(nomeEl(estado.a)) + ' + ' + E(nomeEl(estado.b)) + ' no nível ' + estado.nivel + '</h4>' +
      (feit.length ? '<div class="feiticos">' + feit.map(cartaoFeitico).join('') + '</div>'
                   : '<p class="apoio">Nenhuma forma aberta neste nível.</p>') +
      obrasDaDupla(k);
    caixa.hidden = false;

    [].forEach.call(document.querySelectorAll('.cartao.dupla'), function (c) {
      c.classList.toggle('escolhida', c.getAttribute('data-dupla') === k);
    });
    $('fu-el-a').addEventListener('change', function () { estado.a = this.value; gravaEndereco(); detalhe(false); });
    $('fu-el-b').addEventListener('change', function () { estado.b = this.value; gravaEndereco(); detalhe(false); });
    $('fu-nivel').addEventListener('change', function () { estado.nivel = parseInt(this.value, 10) || NIVEL_MAX; gravaEndereco(); detalhe(false); });
    if (rolar && caixa.scrollIntoView) caixa.scrollIntoView({ block: 'start' });
  }

  /* ---- 3. As misturas e as rivalidades ---- */
  function misturas() {
    var chaves = Object.keys(MISTURAS).filter(function (k) { return !MISTURAS[k].mirrorOf; });
    $('fu-misturas').innerHTML = chaves.map(function (k) {
      var m = MISTURAS[k], els = (m.elements && m.elements.length === 2) ? m.elements : k.split('+'), pal = m.palette || {};
      var puro = els[0] === els[1];
      // a faixa de cor da mistura, só com cor de verdade (um --m1 vazio apagaria a faixa)
      var tinta = [['--m1', pal.primary], ['--m2', pal.secondary], ['--m3', pal.accent]]
        .filter(function (x) { return corOk(x[1]); }).map(function (x) { return x[0] + ':' + x[1]; }).join(';');
      return '<div class="cartao mistura" data-mistura="' + E(k) + '"' + (tinta ? ' style="' + tinta + '"' : '') + '>' +
        '<div class="faixa-mistura"></div><div class="corpo">' +
        '<span class="papel">' + elem(els[0]) + ' + ' + elem(els[1]) + '</span><h3>' + E(m.affix) + '</h3>' +
        '<p>' + E(m.description || '') + '</p>' +
        ((m.rider || []).length ? '<p class="extra"><b>No ataque:</b> ' + m.rider.map(efeito).join(', ') + '.</p>' : '') +
        ((m.riderSupport || []).length ? '<p class="extra"><b>No apoio:</b> ' + m.riderSupport.map(efeito).join(', ') + '.</p>' : '') +
        (puro && F ? '<p class="extra puro">Elemento puro: ×' + SITE.decimal(F.PURO_MULT) + ' no dano, no veneno e na cadeia.</p>' : '') +
        '</div></div>';
    }).join('');
  }

  function rivais() {
    var R = DATA.rivals || {}, B = DATA.beats || {}, W = DATA.weathers || {};
    var pares = [], afixos = [];
    Object.keys(R).forEach(function (a) {
      var b = R[a];
      if (!b || !(a < b)) return;
      pares.push(elem(a) + ' × ' + elem(b));
      var mist = MISTURAS[a + '+' + b] || MISTURAS[b + '+' + a];
      if (mist && mist.affix) afixos.push(E(mist.affix));
    });
    // a roda: segue quem vence quem até voltar ao começo
    var roda = [], inicio = ELEMENTOS.filter(function (e) { return B[e]; })[0], atual = inicio, voltas = 0;
    while (atual && B[atual] && voltas++ < 10) {
      roda.push(elem(atual) + ' vence ' + elem(B[atual]));
      atual = B[atual];
      if (atual === inicio) break;
    }
    var climas = Object.keys(W).filter(function (k) { return W[k] && W[k].favors; }).map(function (k) {
      var w = W[k];
      return '<li><b>' + E(w.name) + '</b>: favorece ' + elem(w.favors) + (w.harms ? ' e fere ' + elem(w.harms) : '') + '</li>';
    }).join('');
    $('fu-rivais').innerHTML =
      '<div class="destaque"><h3>No clima: quem se odeia</h3><p>' + (pares.join(' · ') || '—') +
        '. Cada clima favorece um lado e fere o rival.</p>' + (climas ? '<ul class="climas">' + climas + '</ul>' : '') + '</div>' +
      '<div class="destaque"><h3>Na briga: a roda</h3><p>' + (roda.join(' → ') || '—') + '.</p>' +
        (afixos.length ? '<p>Mistura de rivais não se anula: vira outra coisa (' + afixos.join(', ') + ').</p>' : '') + '</div>';
  }

  /* ---- montagem ---- */
  regras();
  $('fu-duplas').innerHTML = PARES.map(cartaoDupla).join('') ||
    '<div class="estado fora">Não deu para ler as duplas do jogo (../js/core/data/fusions.js).</div>';
  if (PARES.length) {
    $('fu-duplas-sub').textContent = 'São ' + PARES.length + ' duplas de classes, cada uma com corpo, nome e formas próprias, ' +
      'que abrem conforme o nível da fusão. Escolha uma para ver as formas e os feitiços com os elementos que quiser.';
  }
  misturas();
  rivais();
  detalhe(aplicaHash());
  window.addEventListener('hashchange', function () { if (aplicaHash()) detalhe(true); });
})();
