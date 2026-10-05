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
  /* O TEXTO NO IDIOMA DO VISITANTE (docs/IDIOMAS.md, etapa 3): a chave é o próprio português. Sem o
   * JOGO.I18n (página de prova que não carrega o js/core/i18n.js) volta o português, com as {variáveis}. */
  function Tx(s, v) {
    var I = window.JOGO && window.JOGO.I18n;
    if (I && I.t) return I.t(s, v);
    if (!v) return s;
    return String(s).replace(/\{([A-Za-z_]\w*)\}/g, function (m, k) {
      return Object.prototype.hasOwnProperty.call(v, k) ? String(v[k]) : m;
    });
  }
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
    single: function () { return Tx('alvo único'); },
    circle: function (n) { return Tx('círculo de raio {n}', { n: n }); },
    line:   function (n) { return Tx('linha de {a}', { a: casas(n) }); },
    cross:  function (n) { return Tx('cruz de raio {n}', { n: n }); },
    cone:   function (n) { return Tx('leque de {a}', { a: casas(n) }); },
    ring:   function (n) { return Tx('anel de raio {n}', { n: n }); }
  };
  var ALVO = { enemy: Tx('inimigo'), ally: Tx('aliado'), self: Tx('a própria fusão'), any: Tx('qualquer casa') };
  var ATRIBUTO = { power: Tx('poder'), pa: Tx('PA'), pp: Tx('PP'), dodge: Tx('esquiva'), lock: Tx('fixação'), initiative: Tx('iniciativa') };
  var LIMPA = { poison: Tx('veneno'), root: Tx('prisão') };
  // o papel das classes vem do dado como id (sem acento); só um precisa de acento
  var PAPEL = { guardiao: Tx('guardião') };

  function num(x) { var n = Number(x); return isFinite(n) ? n : 0; }
  function faixa(e) {
    var a = num(e.min), b = num(e.max);
    return (e.max == null || a === b) ? String(a) : a + '–' + b;
  }
  function turnos(n) {
    n = num(n);
    if (n >= 9999) return Tx('até o fim da batalha');
    return (n === 1
      ? Tx('por {n} turno', { n: n })
      : Tx('por {n} turnos', { n: n }));
  }
  function casas(n) { n = num(n); return n === 1 ? Tx('{n} casa', { n: n }) : Tx('{n} casas', { n: n }); }
  function nomeEl(id) { return ELINFO[id] ? ELINFO[id].name : Tx('Neutro'); }
  function corOk(c) { return /^#[0-9a-fA-F]{3,8}$/.test(c || '') ? c : ''; }
  function elem(id) {
    var i = ELINFO[id] || ELINFO.neutro;
    if (!i) return Tx('Neutro');
    return '<span class="elem" style="--cor:' + corOk(i.color) + '">' + E(i.name) + '</span>';
  }
  function pct(x) { return Math.round(num(x) * 100) + '%'; }

  /* Os 25 efeitos que as formas e as misturas usam (24 tipos, e o dano com
   * roubo de vida conta à parte). Devolvem HTML: o que é texto do dado passa
   * pelo esc. */
  var EFEITO = {
    damage: function (e) { return (e.lifesteal
      ? Tx('dano com roubo de vida {a} de {b}', { a: faixa(e), b: elem(e.element) })
      : Tx('dano {a} de {b}', { a: faixa(e), b: elem(e.element) })); },
    poison: function (e) { return Tx('veneno {a} de {b} a cada turno, {c}', { a: faixa(e), b: elem(e.element), c: turnos(e.duration) }); },
    heal: function (e) { return Tx('cura {a}', { a: faixa(e) }); },
    regen: function (e) { return Tx('regeneração {a} {b}', { a: faixa(e), b: turnos(e.duration) }); },
    shield: function (e) { return Tx('escudo de {a} {b}', { a: num(e.value), b: turnos(e.duration) }); },
    buff: function (e) {
      var v = num(e.value), s = (v >= 0 ? '+' : '') + v;
      if (e.stat === 'pa' || e.stat === 'pp') return s + ' ' + ATRIBUTO[e.stat] + ' ' + turnos(e.duration);
      return Tx('{s} de {a} {b}', { s: s, a: ATRIBUTO[e.stat] || Tx('atributo'), b: turnos(e.duration) });
    },
    resist: function (e) { return Tx('+{a} de resistência a {b} {c}', { a: num(e.value), b: elem(e.element), c: turnos(e.duration) }); },
    push: function (e) { var n = num(e.tiles); return n === 1 ? Tx('empurra {n} casa', { n: n }) : Tx('empurra {n} casas', { n: n }); },
    pull: function (e) { var n = num(e.tiles); return n === 1 ? Tx('puxa {n} casa', { n: n }) : Tx('puxa {n} casas', { n: n }); },
    root: function (e) { return Tx('prende no chão (0 PP) {a}', { a: turnos(e.duration) }); },
    mark: function (e) {
      return Tx('marca o alvo{a}{b}, {c}', { a: e.value != null ? Tx(': +{a}% de dano recebido por marca', { a: num(e.value) }) : '', b: e.max ? Tx(', até {a} marcas', { a: num(e.max) }) : '', c: turnos(e.duration) });
    },
    detonateMarks: function (e) { return Tx('detona as marcas: {a} de dano por marca', { a: SITE.decimal(num(e.mult)) }); },
    teleport: function () { return Tx('teleporta para a casa escolhida'); },
    moveTo: function (e) { return Tx('avança até {a}', { a: casas(e.maxTiles) }); },
    chain: function (e) {
      var j = num(e.jumps);
      return (j === 1
        ? Tx('cadeia de {a}: {b}, salta {j} vez{c}', { a: elem(e.element), b: faixa(e), j: j, c: e.falloff != null ? Tx(', e cada salto bate com {a} do anterior', { a: pct(e.falloff) }) : '' })
        : Tx('cadeia de {a}: {b}, salta {j} vezes{c}', { a: elem(e.element), b: faixa(e), j: j, c: e.falloff != null ? Tx(', e cada salto bate com {a} do anterior', { a: pct(e.falloff) }) : '' }));
    },
    summon: function (e) { var o = OBRAS[e.monsterId]; return Tx('invoca {a}', { a: o ? '<b>' + E(o.name) + '</b>' : Tx('uma obra de fusão') }); },
    trap: function (e) {
      var p = PAYLOADS[e.trapId];
      return (p ? Tx('arma a armadilha <b>{a}</b>', { a: E(p.name) }) : Tx('arma uma armadilha')) + ' ' + turnos(e.duration);
    },
    taunt: function (e) { return Tx('provoca os inimigos {a}', { a: turnos(e.duration) }); },
    // 03/10: o muro do Minotauro tem espinhos (engine.js, "O MURO QUE FERE QUEM ENCOSTA")
    wall: function (e) {
      return Tx('ergue muro {a}', { a: turnos(e.duration) }) +
        (num(e.fere) > 0 ? Tx(', com espinhos: fere {a} quem termina a vez encostado nele ou é jogado contra ele', { a: num(e.fere) }) : '');
    },
    invisible: function (e) { return Tx('fica invisível {a}', { a: turnos(e.duration) }); },
    reflect: function (e) { return Tx('devolve {a}% do dano recebido {b}', { a: num(e.pct), b: turnos(e.duration) }); },
    dispelShield: function () { return Tx('arranca o escudo do alvo'); },
    cleanse: function (e) {
      var k = (e.kinds || []).map(function (x) { return LIMPA[x] || Tx('efeito'); });
      return Tx('limpa {a}', { a: k.length ? k.reduce(function (a, b) { return Tx('{a} e {b}', { a: a, b: b }); }) : Tx('os efeitos') });
    },
    weatherShift: function (e) {
      var w = (DATA.weathers || {})[e.weather];
      return Tx('vira o clima para {a}', { a: w ? E(w.name) : Tx('outro') });
    }
  };
  function efeito(e) {
    var f = e && EFEITO[e.type];
    return f ? f(e) : Tx('efeito especial');
  }

  function alcance(r) {
    r = r || {};
    var a = num(r.min), b = num(r.max);
    var t = b === 0 ? Tx('em si') : (a === b ? String(b) : a + '–' + b);
    if (r.line) t += Tx(', em linha reta');
    if (r.los === false && b > 0) t += Tx(', por cima de obstáculo');
    return t;
  }
  function area(a) {
    a = a || {};
    var f = AREA[a.shape];
    return f ? f(num(a.size)) : Tx('área especial');
  }
  function alvo(forma) {
    var a = ALVO[forma.targetSide] || Tx('qualquer casa');
    return forma.needsEmptyTile ? Tx('{a} (casa vazia)', { a: a }) : a;
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
      caixa.innerHTML = Tx('<div class="estado fora">Não deu para ler as regras do jogo (../js/core/fusion.js).</div>');
      return;
    }
    var nv = nivelDoElemento();
    var itens = [
      ['⚔', Tx('Quem funde'), Tx('Dois heróis seus, lado a lado — em cruz, sem diagonal. Pet e invocação não fundem, e o Mestre do Fundo também não.')],
      ['◆', Tx('Quanto custa'), Tx('Quem declara gasta {FUSION_PA_COST} PA, e o turno acaba na hora.', { FUSION_PA_COST: F.FUSION_PA_COST })],
      ['⌛', Tx('Quando acontece'), Tx('No fim desse turno, se os dois ainda estiverem colados. Se um cair ou se afastar antes, a fusão falha.')],
      ['∞', Tx('Quanto dura'), Tx('Até o fim da batalha. Se o corpo fundido cair, os dois caem juntos: não há volta.')],
      ['♥', Tx('O corpo'), Tx('Vida somada. PA e PP do maior dos dois, com +{BONUS_PA} PA e +{BONUS_PP} PP. Escudo de {BONUS_SHIELD} que não acaba. Iniciativa e poder do maior; esquiva, fixação e resistências na média. O nível é a média dos dois, arredondada para baixo.', { BONUS_PA: F.BONUS_PA, BONUS_PP: F.BONUS_PP, BONUS_SHIELD: F.BONUS_SHIELD })],
      ['✦', Tx('Os feitiços'), Tx('Só os da dupla. A forma vem das duas classes e abre conforme o nível da fusão; o sobrenome e o efeito extra vêm da mistura dos elementos; a força cresce com o nível. As invocações dos dois somem do tabuleiro, e os pets acompanham a fusão.')],
      ['☯', Tx('Os elementos'), Tx('Entra o primeiro elemento de cada herói{a}. Dois elementos iguais dão ×{b} no dano, no veneno e na cadeia.', { a: nv ? Tx('; quem está abaixo do nível {nv} ainda não escolheu o seu e entra como Neutro', { nv: nv }) : Tx('; quem ainda não escolheu entra como Neutro'), b: SITE.decimal(F.PURO_MULT) })]
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
    var ficha = [Tx('{a} PA', { a: num(s.paCost) }), Tx('alcance {a}', { a: alcance(s.range) }), area(s.aoe)];
    if (s.cooldown) ficha.push(Tx('recarga {a}', { a: num(s.cooldown) }));
    if (num(s.castsPerTurn) > 1) ficha.push(Tx('{a}× por turno', { a: num(s.castsPerTurn) }));
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
    return Tx('<h4>Obras e armadilhas da dupla</h4><div class="obras">{a}{b}</div>', { a: obras.map(function (id) {
        var o = OBRAS[id], st = o.stats || {};
        return '<div class="cartao obra">' +
          Tx('<div class="foto retrato" data-letra="{a}"><img src="{b}" alt="{c}" loading="lazy" onerror="SITE.semFoto(this)"></div><div class="corpo"><span class="papel">{d}</span><h3>{c}</h3><p>{e}</p><p class="ficha">{f} PV · {g} PA · {h} PP</p></div>', { a: E(SITE.inicial(o.name)), b: SITE.img('obra', id), c: E(o.name), d: E(o.family || Tx('Obra de Fusão')), e: E(o.description || ''), f: num(st.hp), g: num(st.pa), h: num(st.pp) }) +
          '</div>';
      }).join(''), b: armas.map(function (id) {
        var p = PAYLOADS[id];
        return '<div class="cartao obra armadilha"><div class="corpo">' +
          Tx('<span class="papel">Armadilha</span><h3>{a}</h3><p>{b}</p><p class="ficha">{c}</p>', { a: E(p.name), b: E(p.description || ''), c: (p.effects || []).map(efeito).join(' · ') }) +
          '</div></div>';
      }).join('') });
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
      Tx('<div class="dupla-cab">{a}<div><span class="papel">{b}{c}</span><h3>{d}</h3>{e}<div class="controles"><label>Elemento de quem declara<select id="fu-el-a">{f}</select></label><label>Elemento do parceiro<select id="fu-el-b">{g}</select></label><label>Nível da fusão<select id="fu-nivel">{niveis}</select></label></div><p class="dica">Quem declara a fusão entra como o primeiro elemento. O nível da fusão é a média dos dois heróis.</p></div></div><h4>As formas da dupla</h4><div class="tabela-caixa"><table class="formas"><thead><tr><th class="num">Nível</th><th>Forma</th><th class="num">PA</th><th>Alcance</th><th>Área</th><th>Alvo</th><th>O que faz</th></tr></thead><tbody>{h}</tbody></table></div><h4>Os feitiços com {i} + {j} no nível {nivel}</h4>{k}{l}', { a: moldura(k, false), b: E(classesDupla(k)), c: papeis(k) ? ' · ' + E(papeis(k)) : '', d: E(nomeDupla(k)), e: idt.line ? '<p class="apoio">' + E(idt.line) + '</p>' : '', f: opcoesEl(estado.a), g: opcoesEl(estado.b), niveis: niveis, h: formas.map(function (f) {
        var t = num(f.tier), aberta = t <= estado.nivel;
        return '<tr' + (aberta ? '' : ' ' + Tx('class="trancada" title="abre no nível {t}"', { t: t })) + '>' +
          '<td class="num">' + (t ? t : Tx('início')) + '</td><td class="nome">' + E(f.formName) + '</td>' +
          '<td class="num">' + num(f.paCost) + '</td><td>' + E(alcance(f.range)) + '</td><td>' + E(area(f.aoe)) + '</td>' +
          '<td>' + E(alvo(f)) + '</td><td class="desc">' + E(f.description || '') + '</td></tr>';
      }).join(''), i: E(nomeEl(estado.a)), j: E(nomeEl(estado.b)), nivel: estado.nivel, k: feit.length ? '<div class="feiticos">' + feit.map(cartaoFeitico).join('') + '</div>'
                   : Tx('<p class="apoio">Nenhuma forma aberta neste nível.</p>'), l: obrasDaDupla(k) });
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
        ((m.rider || []).length ? '<p class="extra">' + Tx('<b>No ataque:</b> {a}.', { a: m.rider.map(efeito).join(', ') }) + '</p>' : '') +
        ((m.riderSupport || []).length ? '<p class="extra">' + Tx('<b>No apoio:</b> {a}.', { a: m.riderSupport.map(efeito).join(', ') }) + '</p>' : '') +
        (puro && F ? '<p class="extra puro">' + Tx('Elemento puro: ×{a} no dano, no veneno e na cadeia.', { a: SITE.decimal(F.PURO_MULT) }) + '</p>' : '') +
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
      roda.push(Tx('{a} vence {b}', { a: elem(atual), b: elem(B[atual]) }));
      atual = B[atual];
      if (atual === inicio) break;
    }
    var climas = Object.keys(W).filter(function (k) { return W[k] && W[k].favors; }).map(function (k) {
      var w = W[k];
      return '<li>' + Tx('<b>{a}</b>: favorece {b}', { a: E(w.name), b: elem(w.favors) }) + (w.harms ? ' ' + Tx('e fere {a}', { a: elem(w.harms) }) : '') + '</li>';
    }).join('');
    $('fu-rivais').innerHTML =
      Tx('<div class="destaque"><h3>No clima: quem se odeia</h3><p>{a}. Cada clima favorece um lado e fere o rival.</p>{b}</div><div class="destaque"><h3>Na briga: a roda</h3><p>{c}.</p>{d}</div>', { a: pares.join(' · ') || '—', b: climas ? '<ul class="climas">' + climas + '</ul>' : '', c: roda.join(' → ') || '—', d: afixos.length ? '<p>' + Tx('Mistura de rivais não se anula: vira outra coisa ({a}).', { a: afixos.join(', ') }) + '</p>' : '' });
  }

  /* ---- montagem ---- */
  regras();
  $('fu-duplas').innerHTML = PARES.map(cartaoDupla).join('') ||
    Tx('<div class="estado fora">Não deu para ler as duplas do jogo (../js/core/data/fusions.js).</div>');
  if (PARES.length) {
    $('fu-duplas-sub').textContent = Tx('São {length} duplas de classes, cada uma com corpo, nome e formas próprias, que abrem conforme o nível da fusão. Escolha uma para ver as formas e os feitiços com os elementos que quiser.', { length: PARES.length });
  }
  misturas();
  rivais();
  detalhe(aplicaHash());
  window.addEventListener('hashchange', function () { if (aplicaHash()) detalhe(true); });
})();
