/* wiki.js — a wiki do SOTERRA (site/wiki.html), 11/09.
 *
 * Como a página das fusões: NADA AQUI É NÚMERO COPIADO. Classes, feitiços,
 * calabouços, monstros, itens, conjuntos, pets e as regras saem dos arquivos do
 * próprio jogo, servidos da mesma origem — os dados (../js/core/data/*.js) e
 * os módulos sem tela de ../js/core/ (engine, fusion, missoes, diario, poco,
 * guilda, mercado, brasa), cada um lido com cuidado: módulo que não carregou
 * tira só a sua frase da página, nunca a página inteira.
 *
 * O que mora aqui é VOCABULÁRIO — o nome em português dos efeitos, das áreas,
 * dos espaços de item, do jeito de lutar dos monstros (o mesmo da fusoes.js,
 * mais os cinco traços dos monstros e a troca de lugar) — e as duas decisões
 * de conteúdo logo abaixo.
 *
 * O Mestre do Fundo (classe, Panóplia, Julgamento) não mora nos arquivos de
 * dados — gm.js o injeta só dentro do jogo —, por isso nunca aparece aqui.
 *
 * Rotas (no #): /classes, /classe/<id>, /feiticos, /feitico/<id>,
 * /calaboucos, /calabouco/<id>, /bestiario, /monstro/<id>, /itens,
 * /item/<id>, /conjuntos, /conjunto/<id>, /pets, /pet/<id>, /sistemas,
 * /sistemas/<seção>, /busca/<texto>. As listas guardam o filtro no próprio
 * endereço: #/itens?espaco=passo&raridade=raro, #/feiticos?classe=sumo.
 */
(function () {
  'use strict';

  /* ---- DUAS DECISÕES DE CONTEÚDO (o dono pode trocar) ----------------------
   * MOSTRA_CHANCES: as chances de saque (peça, carta de classe e de pet, selo,
   * insígnia, âncora, pedra, sorte de saque) ficam fora — a wiki diz a
   * raridade e de onde a coisa cai, não a porcentagem. O jogo é difícil de
   * propósito, e o número à vista muda a sensação. true mostra o que o
   * próprio dado diz.
   * PORTAL FECHADO (DATA.portalFechado): o calabouço aparece como "Em breve",
   * sem salas nem monstros. As peças dele aparecem, porque já caem nos
   * calabouços abertos (o vazamento de js/core/progress.js). */
  var MOSTRA_CHANCES = false;

  var E = SITE.esc;
  var JG = window.JOGO || {};
  var D = JG.DATA || {};
  var own = Object.prototype.hasOwnProperty;
  function $(id) { return document.getElementById(id); }
  function num(x) { var n = Number(x); return isFinite(n) ? n : 0; }
  function chaves(o) { return o ? Object.keys(o) : []; }
  function valores(o) { return chaves(o).map(function (k) { return o[k]; }); }
  function norm(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }

  var ELINFO = D.elementInfo || {};
  var ELEMENTOS = (D.elements || chaves(ELINFO)).filter(function (e) { return ELINFO[e]; });
  var CLASSES = D.classes || {};
  var SPELLS = D.spells || {};
  var MSPELLS = D.monsterSpells || {};
  var ISPELLS = D.itemSpells || {};
  var PSPELLS = D.petSpells || {};
  var MONSTROS = D.monsters || {};
  var ITENS = D.items || {};
  var SETS = D.sets || {};
  var PETS = D.pets || {};
  var PEDRAS = D.stones || {};
  var CLIMAS = D.weathers || {};
  var DIFS = D.dificuldades || {};
  var LV = D.leveling || {};
  var DGS = (Array.isArray(D.dungeons) ? D.dungeons : valores(D.dungeons)).filter(Boolean).slice()
    .sort(function (a, b) { return num(a.order) - num(b.order); });
  var FECHADO = typeof D.portalFechado === 'function' ? D.portalFechado : function () { return false; };

  /* ---- VOCABULÁRIO (o dono confere) ----------------------------------------- */
  var PAPEL = { tanque: 'Tanque', atirador: 'Atirador', mago: 'Mago', assassino: 'Assassino',
                suporte: 'Suporte', invocador: 'Invocador', guardiao: 'Guardião' };
  var AREA = {
    single: function () { return 'alvo único'; },
    circle: function (n) { return 'círculo de raio ' + n; },
    line:   function (n) { return 'linha de ' + casas(n); },
    cross:  function (n) { return 'cruz de raio ' + n; },
    cone:   function (n) { return 'leque de ' + casas(n); },
    ring:   function (n) { return 'anel de raio ' + n; }
  };
  var ALVO = { ally: 'aliado', any: 'qualquer casa' };
  var ATRIBUTO = { hp: 'PV', pa: 'PA', pp: 'PP', power: 'poder', initiative: 'iniciativa',
                   dodge: 'esquiva', lock: 'fixação' };
  var LIMPA = { poison: 'veneno', root: 'prisão' };
  var ESPACO = {
    punho: { nome: 'Punho', diz: 'o que golpeia' },
    passo: { nome: 'Passo', diz: 'o que anda — toda peça de Passo dá esquiva' },
    casca: { nome: 'Casca', diz: 'o que protege' },
    lume:  { nome: 'Lume', diz: 'a relíquia acesa — concede um feitiço' }
  };
  var ORDEM_ESPACO = ['punho', 'passo', 'casca', 'lume'];
  var RARIDADE = { comum: 'Comum', raro: 'Raro', epico: 'Épico', lendario: 'Lendário' };
  var RARA = { comum: 'comum', raro: 'rara', epico: 'épica', lendario: 'lendária' };
  var ORDEM_RAR = ['comum', 'raro', 'epico', 'lendario'];
  var IA = { melee: 'luta de perto', ranged: 'luta de longe', support: 'apoia os aliados', boss: 'chefe' };
  var JEITO_PET = { attack: 'ataca', guard: 'guarda o dono', support: 'apoia o dono' };
  var TIPO_EVENTO = { buff: 'bênção', mystery: 'mistério', portal: 'portal', drain: 'dreno', fountain: 'fonte' };
  var BONUS_ORDEM = ['hp', 'pa', 'pp', 'power', 'initiative', 'dodge', 'lock'];
  var BONUS_NOME = { hp: 'PV', pa: 'PA', pp: 'PP', power: 'de poder', initiative: 'de iniciativa',
                     dodge: 'de esquiva', lock: 'de fixação' };

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
  function pct(x) { return Math.round(num(x) * 100) + '%'; }
  function sinal(v) { v = num(v); return (v > 0 ? '+' : (v < 0 ? '−' : '')) + Math.abs(v); }
  function mult(x) { return '×' + SITE.decimal(num(x)); }
  function corOk(c) { return /^#[0-9a-fA-F]{3,8}$/.test(c || '') ? c : ''; }
  function nomeEl(id) { return ELINFO[id] ? ELINFO[id].name : 'Neutro'; }
  function corEl(id) { return corOk((ELINFO[id] || ELINFO.neutro || {}).color); }
  function estiloCor(c) { return c ? ' style="--cor:' + c + '"' : ''; }
  function elem(id) {
    if (!ELINFO[id]) id = 'neutro';
    return '<span class="wk-el"' + estiloCor(corEl(id)) + '>' + E(nomeEl(id)) + '</span>';
  }
  function rar(r) { return RARIDADE[r] ? '<span class="wk-rar r-' + r + '">' + RARIDADE[r] + '</span>' : ''; }
  function rota(tipo, id) { return '#/' + tipo + (id != null && id !== '' ? '/' + encodeURIComponent(id) : ''); }
  function link(tipo, id, nome) { return '<a href="' + rota(tipo, id) + '">' + E(nome) + '</a>'; }
  function trilha(passos, atual) {
    return '<nav class="wk-trilha" aria-label="Você está em"><a href="#/">Wiki</a>' +
      passos.map(function (p) { return ' › <a href="' + p[0] + '">' + E(p[1]) + '</a>'; }).join('') +
      (atual ? ' › <span>' + E(atual) + '</span>' : '') + '</nav>';
  }
  var DE = { A: 'da', O: 'do', As: 'das', Os: 'dos' }, EM = { A: 'na', O: 'no', As: 'nas', Os: 'nos' };
  function contrai(mapa, prep, nome) {
    var m = /^(A|O|As|Os) (.*)$/.exec(String(nome || ''));
    return m ? mapa[m[1]] + ' ' + m[2] : prep + ' ' + nome;
  }
  function lista(partes) {
    partes = partes.filter(Boolean);
    return partes.length < 2 ? partes.join('') : partes.slice(0, -1).join(', ') + ' e ' + partes[partes.length - 1];
  }

  /* ---- procuras ---------------------------------------------------------------- */
  function dg(id) { for (var i = 0; i < DGS.length; i++) if (DGS[i].id === id) return DGS[i]; return null; }
  function nomeDg(id) { var d = dg(id); return d ? d.name : ''; }
  function aberto(id) { return !!dg(id) && !FECHADO(id); }
  function monstroVisivel(m) { return !!m && (m.dungeonId ? aberto(m.dungeonId) : true); }
  function feitico(id) { return SPELLS[id] || MSPELLS[id] || ISPELLS[id] || PSPELLS[id] || null; }
  function nomeClasse(id) { return (CLASSES[id] && CLASSES[id].name) || String(id); }
  function corClasse(id) { return corOk(CLASSES[id] && CLASSES[id].palette && CLASSES[id].palette.primary); }
  function nomeClima(id) { return (CLIMAS[id] && CLIMAS[id].name) || 'Calmo'; }
  function pedraDe(el) { return valores(PEDRAS).filter(function (p) { return p.element === el; })[0] || null; }
  function diaHoje() {
    try { return SITE.diaDoCalabouco ? SITE.diaDoCalabouco(SITE.agora()) : null; } catch (e) { return null; }
  }
  function feiticosDaClasse(id) {
    var c = CLASSES[id] || {}, out = [];
    (c.baseSpells || []).forEach(function (sid) { if (SPELLS[sid]) out.push({ sp: SPELLS[sid], el: 'neutro', base: true }); });
    ELEMENTOS.forEach(function (el) {
      ((c.paths || {})[el] || []).forEach(function (sid) { if (SPELLS[sid]) out.push({ sp: SPELLS[sid], el: el, base: false }); });
    });
    return out;
  }
  function nivelFeitico(sp) { var n = num(sp.unlockLevel); return n > 0 ? 'nível ' + n : 'desde o início'; }

  /* ---- ícones e retratos ----------------------------------------------------------- */
  function icone(arquivo, nome, classe) {
    var ok = /^[a-z0-9-]+$/.test(String(arquivo));
    return '<span class="wk-ico' + (classe ? ' ' + classe : '') + (ok ? '' : ' sem-foto') + '" data-letra="' +
      E(SITE.inicial(nome)) + '">' +
      (ok ? '<img src="img/' + arquivo + '.webp" alt="" loading="lazy" onerror="SITE.semFoto(this)">' : '') + '</span>';
  }
  function iconeItem(it, tam) {
    return icone('item-' + it.id, it.name, (tam || '') + (RARIDADE[it.rarity] ? ' r-' + it.rarity : ''));
  }
  /* 11/09: o retrato do próprio 3D do jogo (tools/retratos_site.py, o quadro da
   * linha do tempo da batalha); a invocação de fusão usa a foto da obra dela.
   * Sem o arquivo, a moldura cai na inicial, como antes. */
  function bustoMonstro(m) {
    var src = /^fus-/.test(m.id) ? SITE.img('obra', m.id) : SITE.img('monstro', m.id);
    return SITE.busto({ src: src, letra: SITE.inicial(SITE.semArtigo(m.name)), cor: corEl(m.element) });
  }
  function bustoPet(p) { return SITE.busto({ src: SITE.img('pet', p.id), letra: SITE.inicial(p.name), cor: corEl(p.element) }); }

  /* ---- os efeitos ------------------------------------------------------------------- */
  var EFEITO = {
    damage: function (e) { return (e.lifesteal ? 'dano com roubo de vida ' : 'dano ') + faixa(e) + ' de ' + elem(e.element); },
    poison: function (e) { return 'veneno ' + faixa(e) + ' de ' + elem(e.element) + ' a cada turno, ' + turnos(e.duration); },
    heal: function (e) { return 'cura ' + faixa(e); },
    regen: function (e) { return 'regeneração ' + faixa(e) + ' ' + turnos(e.duration); },
    shield: function (e) { return 'escudo de ' + num(e.value) + ' ' + turnos(e.duration); },
    buff: function (e) {
      var s = sinal(e.value);
      if (e.stat === 'pa' || e.stat === 'pp') return s + ' ' + ATRIBUTO[e.stat] + ' ' + turnos(e.duration);
      return s + ' de ' + (ATRIBUTO[e.stat] || 'atributo') + ' ' + turnos(e.duration);
    },
    resist: function (e) { return sinal(e.value) + ' de resistência a ' + elem(e.element) + ' ' + turnos(e.duration); },
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
    swap: function () { return 'troca de lugar com o alvo'; },
    chain: function (e) {
      var j = num(e.jumps);
      return 'cadeia de ' + elem(e.element) + ': ' + faixa(e) + ', salta ' + j + (j === 1 ? ' vez' : ' vezes') +
        (e.falloff != null ? ', e cada salto bate com ' + pct(e.falloff) + ' do anterior' : '');
    },
    summon: function (e) {
      var m = MONSTROS[e.monsterId];
      return 'invoca ' + (m ? link('monstro', e.monsterId, m.name) : 'uma criatura') + (num(e.count) > 1 ? ' ×' + num(e.count) : '');
    },
    trap: function (e) {
      var p = SPELLS[e.trapId];
      return (p ? 'arma a armadilha ' + link('feitico', e.trapId, String(p.name).replace(/ \(disparo\)$/, '')) : 'arma uma armadilha') +
        (e.duration ? ' ' + turnos(e.duration) : '');
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
    weatherShift: function (e) { return 'vira o clima para ' + (CLIMAS[e.weather] ? E(CLIMAS[e.weather].name) : 'outro'); },
    // os cinco traços dos monstros (o vocabulário fechado do contrato)
    pushImmune: function () { return 'não pode ser empurrado nem puxado'; },
    enrage: function (e) { return 'fúria: abaixo de ' + pct(e.hpPct) + ' da vida, +' + num(e.power) + ' de poder'; },
    explodeOnDeath: function (e) {
      return 'explode ao morrer: ' + num(e.damage) + ' de dano de ' + elem(e.element) + (num(e.radius) ? ' em raio ' + num(e.radius) : '');
    },
    split: function (e) {
      var m = MONSTROS[e.monsterId];
      return 'ao morrer, se divide em ' + num(e.count) + ' ' + (m ? link('monstro', e.monsterId, m.name) : 'pedaços');
    },
    regenAura: function (e) { return 'aura: os aliados até ' + casas(e.radius) + ' recuperam ' + num(e.value) + ' PV por turno'; }
  };
  function efeito(e) { var f = e && EFEITO[e.type]; return f ? f(e) : 'efeito especial'; }
  function alcance(r) {
    r = r || {};
    var a = num(r.min), b = num(r.max);
    if (b === 0) return 'em si';
    var t = 'alcance ' + (a === b ? String(b) : a + '–' + b);
    if (r.line) t += ' em linha reta';
    if (r.los === false) t += ', por cima de obstáculo';
    return t;
  }
  function area(a) { a = a || {}; var f = AREA[a.shape]; return f ? f(num(a.size)) : 'área especial'; }
  function ehCarga(sp) { return /^trap-/.test(String(sp.id)) || (num(sp.paCost) === 0 && num(sp.castsPerTurn) === 0); }
  function fichaFeitico(sp) {
    var p = [];
    if (ehCarga(sp)) {
      p.push('dispara quando um inimigo pisa na armadilha');
      if (sp.aoe && sp.aoe.shape && sp.aoe.shape !== 'single') p.push(area(sp.aoe));
      return p.join(' · ');
    }
    if (num(sp.paCost) > 0) p.push('<b>' + num(sp.paCost) + ' PA</b>');
    p.push(alcance(sp.range));
    if (sp.aoe && sp.aoe.shape && sp.aoe.shape !== 'single') p.push(area(sp.aoe));
    if (ALVO[sp.targetSide] && num(sp.range && sp.range.max) > 0) p.push('em ' + ALVO[sp.targetSide]);
    if (sp.needsEmptyTile) p.push('precisa de casa vazia');
    if (num(sp.cooldown) > 0) p.push('recarga de ' + num(sp.cooldown) + (num(sp.cooldown) === 1 ? ' turno' : ' turnos'));
    if (num(sp.castsPerTurn) > 1) p.push(num(sp.castsPerTurn) + ' vezes por turno');
    return p.join(' · ');
  }
  function cartaoFeitico(sp, op) {
    op = op || {};
    var el = ELINFO[sp.element] ? sp.element : 'neutro';
    var efs = (sp.effects || []).map(function (e) { return '<li>' + efeito(e) + '</li>'; }).join('');
    return '<article class="wk-feitico" data-feitico="' + E(sp.id) + '"' + estiloCor(corEl(el)) + '>' +
      '<div class="wk-feitico-topo"><h4>' + (op.link ? link('feitico', sp.id, sp.name) : E(sp.name)) + '</h4>' + elem(el) +
      (op.nivel ? '<span class="wk-nivel">' + E(op.nivel) + '</span>' : '') + '</div>' +
      '<p class="wk-ficha">' + fichaFeitico(sp) + '</p>' +
      (efs ? '<ul class="wk-efeitos">' + efs + '</ul>' : '') +
      (sp.description ? '<p class="wk-desc">' + E(sp.description) + '</p>' : '') +
      (sp.flavor ? '<p class="wk-sabor">' + E(sp.flavor) + '</p>' : '') +
      '</article>';
  }

  /* ---- bônus -------------------------------------------------------------------- */
  function bonusPartes(b) {
    b = b || {};
    var p = [];
    BONUS_ORDEM.forEach(function (k) { if (num(b[k])) p.push(sinal(b[k]) + ' ' + BONUS_NOME[k]); });
    var r = b.resists || {};
    ELEMENTOS.forEach(function (el) { if (num(r[el])) p.push(sinal(r[el]) + '% de resistência a ' + nomeEl(el)); });
    return p;
  }
  function resistencias(r) {
    r = r || {};
    var p = ELEMENTOS.filter(function (el) { return num(r[el]); }).map(function (el) {
      var v = num(r[el]);
      return '<span class="' + (v > 0 ? 'bom' : 'mau') + '">' + E(nomeEl(el)) + ' ' + sinal(v) + '%</span>';
    });
    return p.length ? p.join(' · ') : 'nenhuma';
  }

  /* ---- o saque de uma peça ----------------------------------------------------------- */
  function entradaSaque(it) {
    var d = dg(it.dungeonId), lt = (d && d.lootTable) || [];
    for (var i = 0; i < lt.length; i++) if (lt[i] && lt[i].itemId === it.id) return lt[i];
    return null;
  }
  function textoSala(minRoom, d) {
    var n = num(minRoom), salas = (d && d.rooms) ? d.rooms.length : 0;
    if (n <= 0) return 'em qualquer sala';
    if (salas && n >= salas - 1) return 'só na sala do chefe';
    return 'da ' + (n + 1) + 'ª sala em diante';
  }
  function ehColecionador(it) { return !!(it.setId && D.selos && it.setId === D.selos.setId); }
  function ondeCai(it) {
    if (!it.dungeonId) return ehColecionador(it) ? 'Só sai da roleta do Colecionador, trocada por Selos' : 'Não cai em calabouço';
    var d = dg(it.dungeonId), e = entradaSaque(it);
    var sala = textoSala(e ? e.minRoom : it.minRoom, d);
    var onde = d ? link('calabouco', d.id, contrai(DE, 'de', d.name)) : 'de um calabouço';
    var chance = MOSTRA_CHANCES ? ' (peso no sorteio: ' + num(it.dropWeight) + ')' : '';
    if (d && FECHADO(d.id)) {
      return 'Vem ' + onde + ' (em breve). Enquanto o portal está fechado, a peça cai nos calabouços abertos, ' + sala + chance;
    }
    return 'Cai ' + onde + ', ' + sala + chance;
  }

  /* ---- listas com filtro -------------------------------------------------------------- */
  function controles(defs, params) {
    return '<form class="wk-filtros" onsubmit="return false">' + defs.map(function (d) {
      var v = String(params[d.k] || '');
      if (d.texto) {
        return '<label class="largo">' + E(d.rotulo) + '<input type="search" data-filtro="' + d.k + '" value="' +
          E(v) + '" autocomplete="off"></label>';
      }
      return '<label>' + E(d.rotulo) + '<select data-filtro="' + d.k + '">' + d.opcoes.map(function (o) {
        return '<option value="' + E(o[0]) + '"' + (v === o[0] ? ' selected' : '') + '>' + E(o[1]) + '</option>';
      }).join('') + '</select></label>';
    }).join('') + '</form>';
  }
  function ligaFiltros(caixa, pag, pinta) {
    var campos = caixa.querySelectorAll('[data-filtro]');
    function muda() {
      var p = {}, q = [];
      Array.prototype.forEach.call(campos, function (c) {
        var k = c.getAttribute('data-filtro'), v = c.value.trim();
        if (!v) return;
        p[k] = v;
        q.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
      });
      try { history.replaceState(null, '', '#/' + pag + (q.length ? '?' + q.join('&') : '')); } catch (e) { /* file:// antigo */ }
      pinta(p);
    }
    Array.prototype.forEach.call(campos, function (c) {
      c.addEventListener(c.tagName === 'SELECT' ? 'change' : 'input', muda);
    });
  }
  function contem(texto, q) {
    var palavras = norm(q).split(/\s+/).filter(Boolean), t = norm(texto);
    return palavras.every(function (p) { return t.indexOf(p) >= 0; });
  }

  /* ========================================================================
   * AS PÁGINAS — cada uma devolve { titulo, html, depois?, rolarPara? }
   * ====================================================================== */
  function naoAchou() {
    return { titulo: 'Não encontrada', html: '<h1>Página não encontrada</h1>' +
      '<p class="wk-sub">Este endereço não leva a nada da wiki. Volte ao <a href="#/">início</a> ou use a busca.</p>' };
  }
  function emBreve(titulo, texto, passos) {
    return { titulo: titulo, html: trilha(passos || [], titulo) + '<h1>' + E(titulo) + '</h1>' +
      '<p class="wk-chips"><span class="wk-selo fechado">Em breve</span></p><div class="wk-nota">' + E(texto) + '</div>' };
  }

  // ------------------------------------------------------------------ início
  function inicio() {
    var nFeit = 0;
    chaves(CLASSES).forEach(function (id) { nFeit += feiticosDaClasse(id).length; });
    var abertos = DGS.filter(function (d) { return aberto(d.id); }).length;
    var nMon = valores(MONSTROS).filter(monstroVisivel).length;
    var nPares = chaves(D.fusionForms || {}).length;
    var dia = diaHoje();
    var cartoes = [
      ['#/classes', 'Classes', chaves(CLASSES).length + ' classes: os números de cada uma e como liberar'],
      ['#/feiticos', 'Feitiços', nFeit + ' feitiços de classe, com o custo, o alcance e o efeito de cada um'],
      ['#/calaboucos', 'Calabouços', DGS.length + ' calabouços (' + abertos + ' abertos), com as salas, os monstros e o saque'],
      ['#/bestiario', 'Bestiário', nMon + ' monstros e invocações, com a ficha e os golpes'],
      ['#/itens', 'Itens', chaves(ITENS).length + ' peças, com os bônus, o nível de uso e de onde caem'],
      ['#/conjuntos', 'Conjuntos', chaves(SETS).length + ' conjuntos e o bônus de cada número de peças'],
      ['#/pets', 'Pets', chaves(PETS).length + ' bichos que lutam ao lado do dono'],
      ['fusoes.html', 'Fusões', nPares + ' duplas de classe: dois heróis num corpo só'],
      ['#/sistemas', 'Regras', 'elementos, climas, dificuldade, níveis, forja, saque, guilda, arena e o resto']
    ];
    var h = '<h1>Wiki do SOTERRA</h1>' +
      '<p class="wk-sub">Tudo o que o jogo sabe, lido dos arquivos do próprio jogo: se um número muda lá, muda aqui no mesmo dia. Use a busca ou escolha uma seção.</p>';
    if (dia) h += '<p class="wk-chips"><span class="wk-selo wk-dia">Calabouço do Dia: ' + E(dia.nome) + ' (+' + dia.bonus + '% de saque)</span></p>';
    h += '<div class="wk-grade">' + cartoes.map(function (c) {
      return '<a class="wk-cartao grande" href="' + c[0] + '"><b>' + E(c[1]) + '</b><span class="apoio">' + E(c[2]) + '</span></a>';
    }).join('') + '</div>';
    return { titulo: '', html: h };
  }

  // ------------------------------------------------------------------ classes
  function comoLibera(id) {
    var c = CLASSES[id] || {}, k = (D.cards || {})[id] || {};
    if (c.startsUnlocked || !num(k.unlockCost)) return 'liberada desde o começo';
    return num(k.unlockCost) + ' cartas para liberar';
  }
  function cartaoClasse(id) {
    var c = CLASSES[id];
    return '<a class="wk-cartao" href="' + rota('classe', id) + '" data-classe="' + E(id) + '">' +
      SITE.busto({ src: SITE.img('classe', id, true), letra: SITE.inicial(c.name), cor: corClasse(id) }) +
      '<span class="wk-cartao-tx"><b>' + E(c.name) + '</b><span class="apoio">' + E(PAPEL[c.role] || '') + ' · ' +
      E(comoLibera(id)) + '</span></span></a>';
  }
  function classes() {
    var h = '<h1>Classes</h1><p class="wk-sub">Cada herói é de uma classe. A classe decide a vida, os pontos de ação e de passo e os feitiços; o elemento, escolhido no nível ' +
      num(LV.elementChoiceLevel) + ', decide o caminho de feitiços que ele segue.</p>' +
      '<div class="wk-grade">' + chaves(CLASSES).map(cartaoClasse).join('') + '</div>';
    return { titulo: 'Classes', html: h };
  }
  function ondeCaiCarta(id) {
    return DGS.filter(function (d) {
      return aberto(d.id) && (d.cardDrops || []).some(function (c) { return c && c.classId === id && num(c.weight) > 0; });
    });
  }
  function classe(id) {
    var c = CLASSES[id];
    if (!c) return naoAchou();
    var st = c.stats || {}, k = (D.cards || {})[id] || {};
    var maxN = num(LV.maxLevel) || 30, esc = num(LV.elementChoiceLevel);
    var pl = LV.perLevel || {}, pe = LV.perLevelElement || {};
    var antes = Math.max(0, esc - 1), depois = Math.max(0, maxN - esc);
    var alvo = (LV.defenseByRole || {})[c.role] || {};
    var h = trilha([['#/classes', 'Classes']], c.name);
    h += '<header class="wk-cabeca">' +
      SITE.busto({ src: SITE.img('classe', id, true), letra: SITE.inicial(c.name), cor: corClasse(id) }) +
      '<div class="wk-cabeca-tx"><h1>' + E(c.name) + '</h1><p class="wk-chips"><span class="wk-selo">' + E(PAPEL[c.role] || '') +
      '</span><span class="wk-selo">' + E(comoLibera(id)) + '</span>' +
      (RARA[c.cardRarity] ? '<span class="wk-selo">carta ' + RARA[c.cardRarity] + '</span>' : '') + '</p>' +
      '<p>' + E(c.description) + '</p>' + (c.lore ? '<p class="wk-lore">' + E(c.lore) + '</p>' : '') + '</div></header>';

    // os números
    var linhas = [
      ['PV', num(st.hp), num(st.hp) + num(pl.hp) * antes + num(pe.hp) * depois],
      ['PA', num(st.pa), num(st.pa)],
      ['PP', num(st.pp), num(st.pp)],
      ['Iniciativa', num(st.initiative), num(st.initiative)],
      ['Esquiva', num(st.dodge), alvo.dodge != null ? num(alvo.dodge) : num(st.dodge)],
      ['Fixação', num(st.lock), alvo.lock != null ? num(alvo.lock) : num(st.lock)]
    ];
    h += '<h2>Os números</h2><div class="wk-rolagem"><table class="wk-tabela"><thead><tr><th></th><th class="n">nível 1</th><th class="n">nível ' +
      maxN + '</th></tr></thead><tbody>' + linhas.map(function (l) {
        return '<tr><td>' + l[0] + '</td><td class="n">' + l[1] + '</td><td class="n">' + l[2] + '</td></tr>';
      }).join('') + '<tr><td>Poder</td><td class="n">' + num(st.power) + '</td><td class="n">+' + num(pl.power) * antes +
      ', e +' + num(pe.elemPower) * depois + ' no elemento</td></tr></tbody></table></div>' +
      '<p>Resistências no nível 1: ' + resistencias(st.resists) + '.</p>' +
      '<p class="apoio">Todo nível dá +' + num(pl.hp) + ' PV. Do nível 2 ao ' + esc + ', cada nível dá +' + num(pl.power) +
      ' de poder; do ' + (esc + 1) + ' ao ' + maxN + ', dá +' + num(pe.elemPower) +
      ' de dano no elemento escolhido, que só vale nos feitiços desse elemento. Esquiva e fixação andam em linha reta até o número do nível ' +
      maxN + '. Estrelas e equipamento somam por cima. <a href="#/sistemas/niveis">Níveis e experiência</a></p>';

    // como liberar e as estrelas
    h += '<h2>Cartas e estrelas</h2>';
    var dgsCarta = ondeCaiCarta(id);
    h += '<p>' + (c.startsUnlocked || !num(k.unlockCost) ? 'A classe já vem liberada. ' :
      'Libera com ' + num(k.unlockCost) + ' cartas da classe. ') +
      (dgsCarta.length ? 'As cartas caem do chefe ' + lista(dgsCarta.map(function (d) {
        return link('calabouco', d.id, contrai(DE, 'de', d.name));
      })) + '. ' : 'Nenhum calabouço aberto derruba esta carta ainda. ') +
      (c.startsUnlocked ? '' : 'Também dá para liberar pela <a href="loja.html">Loja</a>. ') +
      'Carta repetida não é lixo: as que passam do desbloqueio compram estrelas.</p>';
    var S = D.stars || {}, sb = S.bonuses || {}, slots = S.elementSlots || {}, custos = k.starCosts || [];
    var estrelas = [];
    for (var n = 1; n <= num(S.max); n++) {
      var partes = bonusPartes(sb[n]);
      if (num(slots[n]) > num(slots[n - 1])) partes.push('libera o ' + num(slots[n]) + 'º caminho de elemento');
      estrelas.push('<tr><td>' + '★'.repeat(n) + '</td><td class="n">' + (custos[n - 1] != null ? num(custos[n - 1]) : '') +
        '</td><td>' + E(partes.join(', ')) + '</td></tr>');
    }
    if (estrelas.length) {
      h += '<div class="wk-rolagem"><table class="wk-tabela"><thead><tr><th>Estrela</th><th class="n">cartas a mais</th><th>o que dá</th></tr></thead><tbody>' +
        estrelas.join('') + '</tbody></table></div>';
    }

    // os feitiços
    var todos = feiticosDaClasse(id);
    var base = todos.filter(function (f) { return f.base; });
    h += '<h2>Feitiços</h2><p class="apoio">' + base.length + ' neutros desde o início; a partir do nível ' + esc +
      ', o herói segue o caminho do elemento dele. Cada caminho abre um feitiço nos níveis ' +
      lista((D.unlockTiers || []).map(String)) + '.</p>';
    h += '<h3>Neutros</h3><div class="wk-feiticos">' + base.map(function (f) {
      return cartaoFeitico(f.sp, { link: true, nivel: nivelFeitico(f.sp) });
    }).join('') + '</div>';
    ELEMENTOS.forEach(function (el) {
      var doCaminho = todos.filter(function (f) { return !f.base && f.el === el; });
      if (!doCaminho.length) return;
      h += '<details class="wk-caminho" data-caminho="' + el + '"><summary>Caminho ' + elem(el) + ' — ' + doCaminho.length +
        ' feitiços</summary><div class="wk-feiticos">' + doCaminho.map(function (f) {
          return cartaoFeitico(f.sp, { link: true, nivel: nivelFeitico(f.sp) });
        }).join('') + '</div></details>';
    });

    // as fusões da classe
    var ident = D.fusionIdentities || {};
    var pares = chaves(D.fusionForms || {}).filter(function (p) { return p.split('+').indexOf(id) >= 0; });
    if (pares.length) {
      h += '<h2>Fusões</h2><p class="apoio">Com outro herói colado, os dois viram um corpo só. As duplas desta classe:</p><div class="wk-grade">' +
        pares.map(function (p) {
          var outro = p.split('+').filter(function (x) { return x !== id; })[0] || id;
          return '<a class="wk-cartao" href="fusoes.html#dupla=' + E(p) + '">' +
            SITE.busto({ src: SITE.img('fusao', p, true), reserva: SITE.img('classe', id, true), letra: SITE.inicial(SITE.semArtigo((ident[p] || {}).name || outro)), cor: corClasse(outro) }) +
            '<span class="wk-cartao-tx"><b>' + E((ident[p] || {}).name || nomeClasse(outro)) + '</b><span class="apoio">com ' +
            E(nomeClasse(outro)) + '</span></span></a>';
        }).join('') + '</div>';
    }
    return { titulo: c.name, html: h };
  }

  // ------------------------------------------------------------------ feitiços
  function donosDoFeitico(sid) {
    var donos = [], visivel = false;
    chaves(CLASSES).forEach(function (cid) {
      feiticosDaClasse(cid).forEach(function (f) {
        if (f.sp.id !== sid) return;
        visivel = true;
        donos.push(link('classe', cid, nomeClasse(cid)) + (f.base ? ' (neutro)' : ' (caminho ' + nomeEl(f.el) + ')'));
      });
    });
    var sp = feitico(sid);
    if (sp && ehCarga(sp) && CLASSES[sp.classId]) {
      visivel = true;
      donos.push('carga de armadilha do ' + link('classe', sp.classId, nomeClasse(sp.classId)));
    }
    valores(ITENS).forEach(function (it) {
      if (it.grantsSpell === sid) { visivel = true; donos.push('o Lume ' + link('item', it.id, it.name)); }
    });
    valores(PETS).forEach(function (p) {
      if ((p.spells || []).indexOf(sid) >= 0) { visivel = true; donos.push('o pet ' + link('pet', p.id, p.name)); }
    });
    valores(MONSTROS).forEach(function (m) {
      if ((m.spells || []).indexOf(sid) >= 0 && monstroVisivel(m)) { visivel = true; donos.push(link('monstro', m.id, m.name)); }
    });
    return { visivel: visivel, lista: donos };
  }
  function feiticos(arg, params) {
    params = params || {};
    var tiers = D.unlockTiers || [];
    var nBase = ((CLASSES[chaves(CLASSES)[0]] || {}).baseSpells || []).length;
    var h = '<h1>Feitiços</h1><p class="wk-sub">Os feitiços das classes: ' + nBase +
      ' neutros de cada uma, desde o início, e os de cada caminho de elemento, que abrem nos níveis ' +
      lista(tiers.map(String)) + '. Toque num nome para ver o feitiço inteiro.</p>' +
      controles([
        { k: 'classe', rotulo: 'Classe', opcoes: [['', 'todas']].concat(chaves(CLASSES).map(function (c) { return [c, nomeClasse(c)]; })) },
        { k: 'elemento', rotulo: 'Elemento', opcoes: [['', 'todos']].concat(ELEMENTOS.map(function (e) { return [e, nomeEl(e)]; })) },
        { k: 'q', rotulo: 'Nome ou descrição', texto: true }
      ], params) + '<div id="wk-lista"></div>';
    var lumes = chaves(ISPELLS).map(function (sid) {
      var it = valores(ITENS).filter(function (x) { return x.grantsSpell === sid; })[0];
      return '<li>' + link('feitico', sid, ISPELLS[sid].name) + ' ' + elem(ISPELLS[sid].element) +
        (it ? ' — ' + link('item', it.id, it.name) : '') + '</li>';
    });
    if (lumes.length) h += '<h2>Feitiços dos Lumes</h2><p class="apoio">Todo Lume concede um feitiço a quem o veste.</p><ul class="wk-defs">' + lumes.join('') + '</ul>';
    var dosPets = chaves(PSPELLS).map(function (sid) {
      var p = valores(PETS).filter(function (x) { return (x.spells || []).indexOf(sid) >= 0; })[0];
      return '<li>' + link('feitico', sid, PSPELLS[sid].name) + ' ' + elem(PSPELLS[sid].element) + (p ? ' — ' + link('pet', p.id, p.name) : '') + '</li>';
    });
    if (dosPets.length) h += '<h2>Feitiços dos pets</h2><ul class="wk-defs">' + dosPets.join('') + '</ul>';
    function pinta(p) {
      var todos = [];
      chaves(CLASSES).forEach(function (cid) {
        if (p.classe && p.classe !== cid) return;
        feiticosDaClasse(cid).forEach(function (f) {
          if (p.elemento && f.el !== p.elemento) return;
          if (p.q && !contem(f.sp.name + ' ' + f.sp.description + ' ' + nomeClasse(cid), p.q)) return;
          todos.push({ f: f, cid: cid });
        });
      });
      var caixa = $('wk-lista');
      if (!caixa) return;
      caixa.innerHTML = '<p class="wk-contagem">' + todos.length + (todos.length === 1 ? ' feitiço' : ' feitiços') + '</p>' +
        (todos.length ? '<div class="wk-rolagem"><table class="wk-tabela"><thead><tr><th>Feitiço</th><th>Classe</th><th>Elemento</th><th>Abre</th><th class="n">PA</th><th>Alcance</th></tr></thead><tbody>' +
          todos.map(function (x) {
            var sp = x.f.sp;
            return '<tr data-linha-feitico="' + E(sp.id) + '"><td>' + link('feitico', sp.id, sp.name) + '</td><td>' + link('classe', x.cid, nomeClasse(x.cid)) +
              '</td><td>' + elem(x.f.el) + '</td><td>' + E(nivelFeitico(sp)) + '</td><td class="n">' + num(sp.paCost) + '</td><td>' +
              E(alcance(sp.range).replace(/^alcance /, '')) + '</td></tr>';
          }).join('') + '</tbody></table></div>' : '<p class="wk-vazio">Nenhum feitiço com esse filtro.</p>');
    }
    return { titulo: 'Feitiços', html: h, depois: function (caixa) { pinta(params); ligaFiltros(caixa, 'feiticos', pinta); } };
  }
  function feiticoPag(id) {
    var sp = feitico(id);
    if (!sp) return naoAchou();
    var donos = donosDoFeitico(id);
    if (!donos.visivel) return emBreve(sp.name, 'Quem usa este golpe mora num calabouço que ainda não abriu.', [['#/feiticos', 'Feitiços']]);
    var nivel = SPELLS[id] && !ehCarga(sp) && sp.classId ? nivelFeitico(sp) : '';
    var h = trilha([['#/feiticos', 'Feitiços']], sp.name) + '<h1>' + E(sp.name) + '</h1>' +
      '<p class="apoio">De ' + lista(donos.lista) + '.</p><div class="wk-feiticos">' + cartaoFeitico(sp, { nivel: nivel }) + '</div>';
    return { titulo: sp.name, html: h };
  }

  // ------------------------------------------------------------------ calabouços
  function contaBichos(sala) {
    var mons = sala.monsters || {}, conta = {}, ordem = [];
    (sala.layout || []).forEach(function (linha) {
      for (var i = 0; i < linha.length; i++) {
        var mid = own.call(mons, linha.charAt(i)) ? mons[linha.charAt(i)] : null;
        if (!mid) continue;
        if (!conta[mid]) { conta[mid] = 0; ordem.push(mid); }
        conta[mid]++;
      }
    });
    return ordem.map(function (mid) { return { id: mid, n: conta[mid] }; });
  }
  function mapa(sala) {
    var L = sala.layout || [], mons = sala.monsters || {};
    var larg = L.reduce(function (a, l) { return Math.max(a, l.length); }, 0);
    var cel = [];
    L.forEach(function (linha) {
      for (var x = 0; x < larg; x++) {
        var ch = linha.charAt(x) || '~', cls = 'chao', extra = '';
        if (ch === '#') cls = 'alto';
        else if (ch === '=') cls = 'baixo';
        else if (ch === '~') cls = 'vazio';
        else if (ch === 'P') cls = 'heroi';
        else if (own.call(mons, ch)) {
          var m = MONSTROS[mons[ch]];
          cls = 'bicho' + (m && m.boss ? ' chefe' : '');
          if (m) extra = estiloCor(corEl(m.element)) + ' title="' + E(m.name) + '"';
        }
        cel.push('<i class="' + cls + '"' + extra + '></i>');
      }
    });
    return '<div class="wk-mapa" data-mapa="' + E(sala.name) + '" style="--larg:' + larg + '" role="img" aria-label="Mapa da sala ' +
      E(sala.name) + '">' + cel.join('') + '</div>';
  }
  var LEGENDA = '<p class="wk-legenda"><span><i style="background:#2a3139"></i>chão</span><span><i style="background:#5b4a36"></i>parede (tapa a visão)</span>' +
    '<span><i style="background:#8a6f45"></i>mureta (não passa, mas dá para mirar por cima)</span><span><i style="background:transparent;border:1px dashed #555"></i>buraco</span>' +
    '<span><i style="background:#ffc44d"></i>onde os heróis nascem</span><span><i style="background:#e05a4f;border-radius:50%"></i>monstro</span></p>';
  function cartaoDg(d, dia) {
    var fechado = FECHADO(d.id);
    return '<a class="wk-cartao grande" href="' + rota('calabouco', d.id) + '" data-calabouco="' + E(d.id) + '">' +
      '<b>' + E(d.name) + '</b><span class="wk-chips">' + (fechado ? '<span class="wk-selo fechado">Em breve</span>' : '<span class="wk-selo aberto">Aberto</span>') +
      (dia && dia.id === d.id ? '<span class="wk-selo wk-dia">Calabouço do Dia</span>' : '') +
      '<span class="wk-selo">nível ' + num(d.recommendedLevel) + '</span></span>' +
      '<span class="apoio">' + E(d.description) + '</span></a>';
  }
  function calaboucos() {
    var dia = diaHoje(), Po = JG.Poco;
    var h = '<h1>Calabouços</h1><p class="wk-sub">Os portais do Acampamento levam aos calabouços. Cada descida é uma fila de salas; a última tem o chefe. O nível recomendado é onde a experiência rende inteira.</p>' +
      '<div class="wk-grade">' + DGS.map(function (d) { return cartaoDg(d, dia); }).join('');
    if (Po) {
      h += '<a class="wk-cartao grande" href="#/sistemas/poco"><b>O Poço sem Fundo</b><span class="wk-chips"><span class="wk-selo">na praça</span></span>' +
        '<span class="apoio">A torre infinita: salas emprestadas dos calabouços, andar após andar, cada vez mais duras.</span></a>';
    }
    h += '</div>';
    if (dia) h += '<p class="apoio">Todo dia um calabouço aberto é o <b>Calabouço do Dia</b> e paga +' + dia.bonus + '% de saque. Hoje: ' + link('calabouco', dia.id, dia.nome) + '.</p>';
    return { titulo: 'Calabouços', html: h };
  }
  function calabouco(id) {
    var d = dg(id);
    if (!d) return naoAchou();
    var fechado = FECHADO(id), dia = diaHoje();
    var h = trilha([['#/calaboucos', 'Calabouços']], d.name);
    h += '<header class="wk-cabeca"><div class="wk-cabeca-tx"><h1>' + E(d.name) + '</h1><p class="wk-chips">' +
      (fechado ? '<span class="wk-selo fechado">Em breve</span>' : '<span class="wk-selo aberto">Aberto</span>') +
      (dia && dia.id === id ? '<span class="wk-selo wk-dia">Calabouço do Dia: +' + dia.bonus + '% de saque</span>' : '') +
      '<span class="wk-selo">nível recomendado ' + num(d.recommendedLevel) + '</span>' +
      '<span class="wk-selo">clima: ' + E(nomeClima(d.defaultWeather)) + '</span></p><p>' + E(d.description) + '</p></div></header>';
    if (fechado) {
      h += '<div class="wk-nota">O portal deste calabouço ainda está fechado no Acampamento. As salas e os monstros aparecem aqui quando ele abrir. As peças dele já caem nos calabouços abertos.</div>';
    } else {
      h += '<h2>As salas</h2>';
      (d.rooms || []).forEach(function (s, i) {
        var ult = i === d.rooms.length - 1;
        h += '<section class="wk-sala"><h3>Sala ' + (i + 1) + ' — ' + E(s.name) + (ult ? ' <span class="wk-selo chefe">chefe</span>' : '') + '</h3>' +
          '<div class="wk-sala-corpo">' + mapa(s) + '<div><p class="apoio">Clima: ' + E(nomeClima(s.weather)) + '</p><ul class="wk-bichos">' +
          contaBichos(s).map(function (b) {
            var m = MONSTROS[b.id];
            return '<li>' + (m ? link('monstro', b.id, m.name) + ' ' + elem(m.element) + (m.boss ? ' <span class="wk-selo chefe">chefe</span>' : '') : E(b.id)) +
              (b.n > 1 ? ' ×' + b.n : '') + '</li>';
          }).join('') + '</ul></div></div>' + (i === 0 ? LEGENDA : '') + '</section>';
      });
    }
    // o saque
    var pecas = valores(ITENS).filter(function (it) { return it.dungeonId === id; });
    if (pecas.length) {
      h += '<h2>As peças</h2><p class="apoio">' + (fechado ? 'Enquanto o portal está fechado, estas peças caem nos calabouços abertos.' :
        'O que pode cair nas salas daqui. As mais raras só a partir de certa sala.') + '</p>';
      ORDEM_RAR.forEach(function (r) {
        var dessa = pecas.filter(function (it) { return it.rarity === r; });
        if (!dessa.length) return;
        h += '<h3>' + rar(r) + '</h3><div class="wk-linhas">' + dessa.map(function (it) { return linhaItem(it, true); }).join('') + '</div>';
      });
    }
    if (!fechado) {
      var chefes = valores(MONSTROS).filter(function (m) { return m.dungeonId === id && m.boss; });
      var comuns = valores(MONSTROS).filter(function (m) { return m.dungeonId === id && !m.boss && !m.summonOnly; });
      var els = [];
      comuns.concat(chefes).forEach(function (m) { if (els.indexOf(m.element) < 0) els.push(m.element); });
      var itens = [];
      var pedrasTxt = els.map(function (el) { var p = pedraDe(el); return p ? E(p.name) : ''; }).filter(Boolean);
      if (pedrasTxt.length) {
        var sd = chefes[0] && chefes[0].stoneDrop;
        itens.push('<li><b>Pedras de forja</b>: ' + lista(pedrasTxt) + ' — cada monstro deixa a do próprio elemento' +
          (sd ? '; o chefe, sempre, de ' + num(sd.min) + ' a ' + num(sd.max) : '') + '.</li>');
      }
      var U = D.upgrade || {}, anc = PEDRAS[U.guardStone];
      if (anc && num((U.guardDropByDungeon || {})[id]) > 0) {
        itens.push('<li><b>' + E(anc.name) + '</b>: o chefe pode derrubar' + (MOSTRA_CHANCES ? ' (' + pct(U.guardDropByDungeon[id]) + ')' : '') + '.</li>');
      }
      chefes.forEach(function (m) {
        if (D.selos) itens.push('<li><b>Selo do Colecionador</b> ' + elem(m.element) + ': ' + link('monstro', m.id, m.name) + ' pode derrubar o do elemento dele' +
          (MOSTRA_CHANCES ? ' (' + pct(D.selos.chance) + ')' : '') + '.</li>');
      });
      if (chefes.length && D.insignias) {
        itens.push('<li><b>Insígnia de Fundação</b>: o chefe pode derrubar — é a moeda que funda guildas' +
          (MOSTRA_CHANCES ? ' (' + pct(D.insignias.chance) + ')' : '') + '.</li>');
      }
      var cartas = (d.cardDrops || []).filter(function (c) { return c && CLASSES[c.classId] && num(c.weight) > 0; });
      if (cartas.length) {
        itens.push('<li><b>Cartas de classe</b>: ' + lista(cartas.map(function (c) {
          return link('classe', c.classId, nomeClasse(c.classId)) + (MOSTRA_CHANCES ? ' (' + num(c.weight) + '%)' : '');
        })) + '.</li>');
      }
      valores(PETS).filter(function (p) { return p.dropDungeon === id; }).forEach(function (p) {
        itens.push('<li><b>Cartas de pet</b>: o chefe pode derrubar cartas do pet ' + link('pet', p.id, p.name) + '.</li>');
      });
      if (itens.length) h += '<h2>O que mais cai</h2><ul class="wk-defs">' + itens.join('') + '</ul>';
    }
    return { titulo: d.name, html: h };
  }

  // ------------------------------------------------------------------ bestiário
  function cartaoMonstro(m) {
    return '<a class="wk-cartao" href="' + rota('monstro', m.id) + '" data-monstro="' + E(m.id) + '">' + bustoMonstro(m) +
      '<span class="wk-cartao-tx"><b>' + E(m.name) + '</b><span class="apoio">' + elem(m.element) + ' ' +
      (m.boss ? '<span class="wk-selo chefe">chefe</span> ' : '') + num(m.stats && m.stats.hp) + ' PV' +
      (m.family ? ' · ' + E(m.family) : '') + '</span></span></a>';
  }
  function ordemBichos(a, b) {
    function peso(m) { return m.boss ? 2 : (m.summonOnly ? 1 : 0); }
    return peso(a) - peso(b) || String(a.name).localeCompare(String(b.name), 'pt');
  }
  function bestiario() {
    var h = '<h1>Bestiário</h1><p class="wk-sub">Os monstros de cada calabouço aberto, os que só surgem de outro monstro e as invocações dos heróis. A vida e o poder já estão na escala do andar deles.</p>';
    DGS.forEach(function (d) {
      if (!aberto(d.id)) return;
      var lista2 = valores(MONSTROS).filter(function (m) { return m.dungeonId === d.id; }).sort(ordemBichos);
      if (!lista2.length) return;
      h += '<h2>' + link('calabouco', d.id, d.name) + '</h2><div class="wk-grade">' + lista2.map(cartaoMonstro).join('') + '</div>';
    });
    var inv = valores(MONSTROS).filter(function (m) { return !m.dungeonId; }).sort(ordemBichos);
    if (inv.length) h += '<h2>Invocações dos heróis</h2><div class="wk-grade">' + inv.map(cartaoMonstro).join('') + '</div>';
    var fechados = DGS.filter(function (d) { return !aberto(d.id); });
    if (fechados.length) {
      h += '<div class="wk-nota">Em breve: os monstros ' + lista(fechados.map(function (d) { return contrai(DE, 'de', d.name); }).map(E)) +
        ' aparecem aqui quando o portal abrir.</div>';
    }
    return { titulo: 'Bestiário', html: h };
  }
  function invocadoPor(id) {
    var achados = [];
    [SPELLS, MSPELLS, ISPELLS, PSPELLS].forEach(function (mapa2) {
      valores(mapa2).forEach(function (sp) {
        if (!(sp.effects || []).some(function (e) { return e && e.type === 'summon' && e.monsterId === id; })) return;
        if (MSPELLS[sp.id]) {
          valores(MONSTROS).forEach(function (m) {
            if ((m.spells || []).indexOf(sp.id) >= 0 && monstroVisivel(m)) achados.push(link('monstro', m.id, m.name) + ' (' + E(sp.name) + ')');
          });
        } else achados.push(link('feitico', sp.id, sp.name));
      });
    });
    valores(MONSTROS).forEach(function (m) {
      if ((m.traits || []).some(function (t) { return t && t.type === 'split' && t.monsterId === id; }) && monstroVisivel(m)) {
        achados.push(link('monstro', m.id, m.name) + ' (ao morrer)');
      }
    });
    return achados;
  }
  function monstro(id) {
    var m = MONSTROS[id];
    if (!m) return naoAchou();
    if (!monstroVisivel(m)) return emBreve(m.name, 'Este monstro mora ' + contrai(EM, 'em', nomeDg(m.dungeonId)) + ', que ainda não abriu.', [['#/bestiario', 'Bestiário']]);
    var st = m.stats || {};
    var h = trilha([['#/bestiario', 'Bestiário']], m.name);
    var sabor = String(m.flavor || ''), jeito = '';
    var mg = /^GIMMICK\s*[—-]\s*/.exec(sabor);
    if (mg) { jeito = sabor.slice(mg[0].length); sabor = ''; }
    h += '<header class="wk-cabeca">' + bustoMonstro(m) + '<div class="wk-cabeca-tx"><h1>' + E(m.name) + '</h1><p class="wk-chips">' + elem(m.element) +
      (m.boss ? '<span class="wk-selo chefe">chefe</span>' : '') + (m.family ? '<span class="wk-selo">' + E(m.family) + '</span>' : '') +
      (IA[m.ai] && m.ai !== 'boss' ? '<span class="wk-selo">' + IA[m.ai] + '</span>' : '') +
      (m.dungeonId ? '<span class="wk-selo">' + link('calabouco', m.dungeonId, nomeDg(m.dungeonId)) + '</span>' : '') + '</p>' +
      '<p>' + E(m.description) + '</p>' + (sabor ? '<p class="wk-lore">' + E(sabor) + '</p>' : '') + '</div></header>';
    if (jeito) h += '<div class="wk-nota"><b>Como luta.</b> ' + E(jeito) + '</div>';
    h += '<h2>A ficha</h2><div class="wk-rolagem"><table class="wk-tabela"><tbody>' +
      [['PV', st.hp], ['PA', st.pa], ['PP', st.pp], ['Iniciativa', st.initiative], ['Poder', st.power], ['Esquiva', st.dodge], ['Fixação', st.lock]]
        .map(function (l) { return '<tr><td>' + l[0] + '</td><td class="n">' + num(l[1]) + '</td></tr>'; }).join('') +
      '</tbody></table></div><p>Resistências: ' + resistencias(st.resists) + '.</p>';
    if (m.xp) h += '<p class="apoio">Vale ' + SITE.decimal(m.xp) + ' de experiência (a sala soma a de todos e divide pelo grupo).</p>';
    if ((m.traits || []).length) h += '<h2>Traços</h2><ul class="wk-defs">' + m.traits.map(function (t) { return '<li>' + efeito(t) + '</li>'; }).join('') + '</ul>';
    var golpes = (m.spells || []).map(function (sid) { return MSPELLS[sid] || feitico(sid); }).filter(Boolean);
    if (golpes.length) h += '<h2>Golpes</h2><div class="wk-feiticos">' + golpes.map(function (sp) { return cartaoFeitico(sp); }).join('') + '</div>';
    var onde = [];
    DGS.forEach(function (d) {
      (d.rooms || []).forEach(function (s, i) {
        contaBichos(s).forEach(function (b) {
          if (b.id === id && aberto(d.id)) onde.push(link('calabouco', d.id, d.name) + ', sala ' + (i + 1) + ' (' + E(s.name) + ')' + (b.n > 1 ? ' ×' + b.n : ''));
        });
      });
    });
    var por = invocadoPor(id);
    if (onde.length || por.length) {
      h += '<h2>Onde aparece</h2><ul class="wk-defs">' + onde.map(function (o) { return '<li>' + o + '</li>'; }).join('') +
        (por.length ? '<li>Surge por ' + lista(por) + '.</li>' : '') + '</ul>';
    }
    if (m.stoneDrop) {
      var p = pedraDe(m.element);
      h += '<p class="apoio">Pode deixar ' + num(m.stoneDrop.min) + (num(m.stoneDrop.max) !== num(m.stoneDrop.min) ? ' a ' + num(m.stoneDrop.max) : '') + ' ' +
        (p ? E(p.name) : 'pedras') + (MOSTRA_CHANCES ? ' (' + pct(m.stoneDrop.chance) + ')' : '') + '.</p>';
    }
    return { titulo: m.name, html: h };
  }

  // ------------------------------------------------------------------ itens
  function resumoItem(it) {
    var p = bonusPartes(it.bonuses);
    if (it.grantsSpell && feitico(it.grantsSpell)) p.push('feitiço ' + feitico(it.grantsSpell).name);
    return p.join(', ');
  }
  function linhaItem(it, semCalabouco) {
    var esp = ESPACO[it.slot];
    return '<a class="wk-linha" href="' + rota('item', it.id) + '" data-item="' + E(it.id) + '">' + iconeItem(it) +
      '<span class="wk-linha-tx"><b>' + E(it.name) + '</b><span class="apoio">' + rar(it.rarity) + ' ' + (esp ? E(esp.nome) : '') +
      (num(it.nivelUso) ? ' · nível ' + num(it.nivelUso) : '') +
      (!semCalabouco && it.dungeonId ? ' · ' + E(SITE.semArtigo(nomeDg(it.dungeonId))) : (!it.dungeonId && ehColecionador(it) ? ' · roleta' : '')) +
      '</span><span class="apoio">' + E(resumoItem(it)) + '</span></span></a>';
  }
  function ordemItens(a, b) {
    var da = dg(a.dungeonId), db = dg(b.dungeonId);
    return (da ? num(da.order) : 99) - (db ? num(db.order) : 99) ||
      ORDEM_RAR.indexOf(a.rarity) - ORDEM_RAR.indexOf(b.rarity) ||
      ORDEM_ESPACO.indexOf(a.slot) - ORDEM_ESPACO.indexOf(b.slot) ||
      String(a.name).localeCompare(String(b.name), 'pt');
  }
  function itens(arg, params) {
    params = params || {};
    var opcDg = [['', 'todos']].concat(DGS.map(function (d) { return [d.id, SITE.semArtigo(d.name) + (FECHADO(d.id) ? ' (em breve)' : '')]; }));
    if (valores(ITENS).some(ehColecionador)) opcDg.push(['roleta', 'Roleta do Colecionador']);
    var h = '<h1>Itens</h1><p class="wk-sub">Quatro espaços no herói: ' + lista(ORDEM_ESPACO.map(function (s) {
      return '<b>' + ESPACO[s].nome + '</b> (' + ESPACO[s].diz + ')';
    })) + '. A raridade diz quanto custa achar a peça; o poder cresce com a profundidade do calabouço. Cada peça pede um nível para ser vestida.</p>' +
      controles([
        { k: 'espaco', rotulo: 'Espaço', opcoes: [['', 'todos']].concat(ORDEM_ESPACO.map(function (s) { return [s, ESPACO[s].nome]; })) },
        { k: 'raridade', rotulo: 'Raridade', opcoes: [['', 'todas']].concat(ORDEM_RAR.map(function (r) { return [r, RARIDADE[r]]; })) },
        { k: 'calabouco', rotulo: 'De onde', opcoes: opcDg },
        { k: 'q', rotulo: 'Nome ou bônus', texto: true }
      ], params) + '<div id="wk-lista"></div>';
    function pinta(p) {
      var achados = valores(ITENS).filter(function (it) {
        if (p.espaco && it.slot !== p.espaco) return false;
        if (p.raridade && it.rarity !== p.raridade) return false;
        if (p.calabouco === 'roleta' ? !ehColecionador(it) : (p.calabouco && it.dungeonId !== p.calabouco)) return false;
        if (p.q && !contem(it.name + ' ' + resumoItem(it) + ' ' + it.description, p.q)) return false;
        return true;
      }).sort(ordemItens);
      var caixa = $('wk-lista');
      if (!caixa) return;
      caixa.innerHTML = '<p class="wk-contagem">' + achados.length + (achados.length === 1 ? ' peça' : ' peças') + '</p>' +
        (achados.length ? '<div class="wk-linhas">' + achados.map(function (it) { return linhaItem(it); }).join('') + '</div>'
                        : '<p class="wk-vazio">Nenhuma peça com esse filtro.</p>');
    }
    return { titulo: 'Itens', html: h, depois: function (caixa) { pinta(params); ligaFiltros(caixa, 'itens', pinta); } };
  }
  function itemPag(id) {
    var it = ITENS[id];
    if (!it) return naoAchou();
    var esp = ESPACO[it.slot], set = SETS[it.setId];
    var h = trilha([['#/itens', 'Itens']], it.name);
    h += '<header class="wk-cabeca">' + iconeItem(it, 'g') + '<div class="wk-cabeca-tx"><h1>' + E(it.name) + '</h1><p class="wk-chips">' + rar(it.rarity) +
      (esp ? '<span class="wk-selo">' + E(esp.nome) + '</span>' : '') + (it.element ? elem(it.element) : '') +
      (num(it.nivelUso) ? '<span class="wk-nivel">nível ' + num(it.nivelUso) + '</span>' : '') + '</p>' +
      '<p>' + E(it.description) + '</p>' + (it.flavor ? '<p class="wk-lore">' + E(it.flavor) + '</p>' : '') + '</div></header>';
    var b = bonusPartes(it.bonuses);
    h += '<h2>O que dá</h2>' + (b.length ? '<ul class="wk-defs">' + b.map(function (x) { return '<li>' + E(x) + '</li>'; }).join('') + '</ul>' : '<p>Nenhum bônus de atributo.</p>');
    if (esp) h += '<p class="apoio">' + E(esp.nome) + ': ' + E(esp.diz) + '.' + (it.keyPiece ? ' É uma peça-chave: muda como se joga, e por isso é das mais difíceis de achar na raridade dela.' : '') + '</p>';
    var sp = it.grantsSpell ? feitico(it.grantsSpell) : null;
    if (sp) h += '<h2>O feitiço que concede</h2><div class="wk-feiticos">' + cartaoFeitico(sp, { link: true }) + '</div>';
    h += '<h2>De onde vem</h2><p>' + ondeCai(it) + '.</p>';
    if (num(it.nivelUso)) h += '<p class="apoio">Pede nível ' + num(it.nivelUso) + ' para ser vestida. Acima disso ela ainda cai, fica no saco, é trocada e vendida — só não entra no herói. <a href="#/sistemas/nivel-uso">Nível de uso</a></p>';
    if (set) {
      h += '<h2>Conjunto</h2><p>Faz parte do conjunto ' + link('conjunto', set.id, set.name) + '. As outras peças:</p><div class="wk-linhas">' +
        (set.pieces || []).filter(function (pid) { return pid !== it.id && ITENS[pid]; }).map(function (pid) { return linhaItem(ITENS[pid], true); }).join('') + '</div>';
    }
    var U = D.upgrade || {};
    if (U.maxLevel) {
      var pedra = it.element && it.element !== 'neutro' ? pedraDe(it.element) : null;
      h += '<h2>Forja</h2><p>Sobe até +' + num(U.maxLevel) + ' na bigorna, com ' + (pedra ? E(pedra.name) + ' (a pedra do elemento dela)' : 'qualquer pedra de elemento') +
        '. Cada nível soma ' + pct(U.bonusPerLevel) + ' dos bônus de base' + ((U.nonScalingKeys || []).length ? '; ' + lista((U.nonScalingKeys || []).map(function (k) { return ATRIBUTO[k] || k; })) + ' nunca sobem' : '') +
        '. <a href="#/sistemas/forja">Como a forja funciona</a></p>';
    }
    return { titulo: it.name, html: h };
  }

  // ------------------------------------------------------------------ conjuntos
  function raridadeDoSet(s) {
    var top = 0;
    (s.pieces || []).forEach(function (pid) { var i = ORDEM_RAR.indexOf((ITENS[pid] || {}).rarity); if (i > top) top = i; });
    return s.rarity || ORDEM_RAR[top];
  }
  function conjuntos() {
    var sets = valores(SETS).sort(function (a, b) {
      var da = dg(a.dungeonId), db = dg(b.dungeonId);
      return (da ? num(da.order) : 99) - (db ? num(db.order) : 99) || String(a.name).localeCompare(String(b.name), 'pt');
    });
    var h = '<h1>Conjuntos</h1><p class="wk-sub">Peças do mesmo conjunto vestidas juntas dão um bônus a mais, que cresce com o número de peças. O elemento do conjunto é o dos monstros que derrubam as peças.</p>' +
      '<div class="wk-grade">' + sets.map(function (s) {
        return '<a class="wk-cartao grande" href="' + rota('conjunto', s.id) + '" data-conjunto="' + E(s.id) + '"><b>' + E(s.name) + '</b>' +
          '<span class="wk-chips">' + rar(raridadeDoSet(s)) + elem(s.element) + (s.dungeonId ? '<span class="wk-selo">' + E(SITE.semArtigo(nomeDg(s.dungeonId))) + '</span>' : '<span class="wk-selo">roleta</span>') + '</span>' +
          '<span class="apoio">' + (s.pieces || []).length + ' peças</span></a>';
      }).join('') + '</div>';
    return { titulo: 'Conjuntos', html: h };
  }
  function conjunto(id) {
    var s = SETS[id];
    if (!s) return naoAchou();
    var h = trilha([['#/conjuntos', 'Conjuntos']], s.name) + '<h1>' + E(s.name) + '</h1><p class="wk-chips">' + rar(raridadeDoSet(s)) + elem(s.element) +
      (s.dungeonId ? '<span class="wk-selo">' + link('calabouco', s.dungeonId, nomeDg(s.dungeonId)) + '</span>' : '') + '</p><p>' + E(s.description) + '</p>';
    h += '<h2>As peças</h2><div class="wk-linhas">' + (s.pieces || []).filter(function (pid) { return ITENS[pid]; }).map(function (pid) { return linhaItem(ITENS[pid]); }).join('') + '</div>';
    var bs = chaves(s.bonuses || {}).sort(function (a, b) { return num(a) - num(b); });
    if (bs.length) {
      h += '<h2>O bônus</h2><div class="wk-rolagem"><table class="wk-tabela"><thead><tr><th>vestidas</th><th>bônus</th></tr></thead><tbody>' +
        bs.map(function (n) { return '<tr><td>' + E(n) + ' peças</td><td>' + E(bonusPartes(s.bonuses[n]).join(', ')) + '</td></tr>'; }).join('') + '</tbody></table></div>';
    }
    var extras = [];
    if (s.aura) extras.push('Com as ' + (s.pieces || []).length + ' peças vestidas, o herói anda com uma aura de fogo branco.');
    if (s.pet && PETS[s.pet]) extras.push('Fechar o conjunto concede o pet ' + link('pet', s.pet, PETS[s.pet].name) + ', uma vez.');
    chaves(s).forEach(function (k) {
      var v = s[k];
      if (typeof v === 'string' && ISPELLS[v] && k !== 'id') extras.push('Conjunto completo concede o feitiço ' + link('feitico', v, ISPELLS[v].name) + '.');
    });
    if (extras.length) h += '<ul class="wk-defs">' + extras.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul>';
    if (D.selos && id === D.selos.setId) h += '<p class="apoio">As peças saem só da roleta do Colecionador. <a href="#/sistemas/selos">Os Selos</a></p>';
    return { titulo: s.name, html: h };
  }

  // ------------------------------------------------------------------ pets
  function cartaoPet(p) {
    return '<a class="wk-cartao" href="' + rota('pet', p.id) + '" data-pet="' + E(p.id) + '">' + bustoPet(p) +
      '<span class="wk-cartao-tx"><b>' + E(p.name) + '</b><span class="apoio">' + elem(p.element) + ' ' + E(JEITO_PET[p.behavior] || '') + '</span></span></a>';
  }
  function pets() {
    var h = '<h1>Pets</h1><p class="wk-sub">O pet entra na batalha junto do dono e age sozinho logo depois do turno dele. Não conta para vitória nem derrota. Os bônus valem enquanto ele estiver equipado.</p>' +
      '<div class="wk-grade">' + valores(PETS).map(cartaoPet).join('') + '</div>';
    return { titulo: 'Pets', html: h };
  }
  function petPag(id) {
    var p = PETS[id];
    if (!p) return naoAchou();
    var h = trilha([['#/pets', 'Pets']], p.name) + '<header class="wk-cabeca">' + bustoPet(p) + '<div class="wk-cabeca-tx"><h1>' + E(p.name) + '</h1><p class="wk-chips">' +
      elem(p.element) + (JEITO_PET[p.behavior] ? '<span class="wk-selo">' + JEITO_PET[p.behavior] + '</span>' : '') +
      (num(p.nivelUso) ? '<span class="wk-nivel">nível ' + num(p.nivelUso) + '</span>' : '') + '</p><p>' + E(p.description) + '</p></div></header>';
    var b = bonusPartes(p.bonuses);
    h += '<h2>O que dá ao dono</h2>' + (b.length ? '<ul class="wk-defs">' + b.map(function (x) { return '<li>' + E(x) + '</li>'; }).join('') + '</ul>' : '<p>Nenhum bônus.</p>');
    if (num(p.followDistance)) h += '<p class="apoio">Fica a até ' + casas(p.followDistance) + ' do dono.</p>';
    var sps = (p.spells || []).map(function (sid) { return PSPELLS[sid] || feitico(sid); }).filter(Boolean);
    if (sps.length) h += '<h2>Golpes</h2><div class="wk-feiticos">' + sps.map(function (sp) { return cartaoFeitico(sp, { link: true }); }).join('') + '</div>';
    h += '<h2>Como conseguir</h2><p>';
    if (p.dropDungeon && dg(p.dropDungeon)) {
      h += 'O chefe ' + link('calabouco', p.dropDungeon, contrai(DE, 'de', nomeDg(p.dropDungeon))) + ' pode derrubar cartas deste pet; juntando as cartas, ele é seu, e as repetidas viram estrelas.' +
        (FECHADO(p.dropDungeon) ? ' <span class="wk-selo fechado">Em breve</span> o portal ainda está fechado.' : '');
    } else {
      var dono = valores(SETS).filter(function (s) { return s.pet === id; })[0];
      h += dono ? 'Só fechando o ' + link('conjunto', dono.id, dono.name) + ' — o pet vem junto, uma vez.' : 'Não cai em calabouço.';
    }
    h += '</p>';
    return { titulo: p.name, html: h };
  }

  // ------------------------------------------------------------------ as regras
  function secoesRegras() {
    var S = [];
    function sec(id, titulo, html, busca) { S.push({ id: id, titulo: titulo, html: html, busca: busca || '' }); }
    var maxN = num(LV.maxLevel), esc = num(LV.elementChoiceLevel);

    var B = D.beats || {};
    sec('elementos', 'Elementos e a roda',
      '<p>' + ELEMENTOS.map(elem).join(' ') + '</p><p>Numa briga entre dois elementos, a roda diz quem leva a melhor: <span class="wk-roda">' +
      ELEMENTOS.filter(function (e) { return B[e]; }).map(function (e) { return elem(e) + ' vence ' + elem(B[e]); }).join(' · ') + '</span>. ' +
      'A roda chega ao dano pelas resistências: cada monstro resiste ao elemento que ele vence e é fraco contra quem o vence. O Neutro fica fora da roda.</p>' +
      '<ul class="wk-defs">' + ELEMENTOS.map(function (e) { return '<li>' + elem(e) + ' ' + E((ELINFO[e] || {}).description) + '</li>'; }).join('') + '</ul>' +
      (esc ? '<p>No nível ' + esc + ' cada herói escolhe o elemento dele: o caminho de feitiços e o dano extra de cada nível passam a ser desse elemento. A escolha é para sempre (o Pergaminho da Reescrita, da Loja, troca um caminho por outro).</p>' : ''),
      'fogo agua terra ar neutro roda rivalidade resistencia');

    var tick = num(JG.Engine && JG.Engine.WEATHER_TICK);
    sec('climas', 'Climas',
      '<p>Cada sala tem um clima. ' + (tick ? 'No início do turno de cada um, quem é do elemento que o clima favorece ganha ' + tick +
        ' PV, e quem é do elemento rival perde ' + tick + ' PV.' : 'O clima ajuda o elemento que favorece e castiga o rival.') +
      ' Alguns feitiços viram o clima no meio da luta.</p><div class="wk-rolagem"><table class="wk-tabela"><thead><tr><th>Clima</th><th>favorece</th><th>prejudica</th><th></th></tr></thead><tbody>' +
      valores(CLIMAS).map(function (w) {
        return '<tr><td><b>' + E(w.name) + '</b></td><td>' + (w.favors ? elem(w.favors) : '—') + '</td><td>' + (w.harms ? elem(w.harms) : '—') +
          '</td><td>' + E(w.description) + '</td></tr>';
      }).join('') + '</tbody></table></div>', 'clima chuva estiagem vendaval tremor calmo');

    var difs = valores(DIFS);
    if (difs.length) {
      sec('dificuldade', 'Dificuldade',
        '<p>Quem lidera a descida escolhe a dificuldade. O prêmio sobe mais que o custo.</p><div class="wk-rolagem"><table class="wk-tabela"><thead><tr><th></th><th class="n">vida dos monstros</th><th class="n">dano deles</th><th class="n">clima (a parte que machuca)</th><th class="n">experiência</th><th class="n">saque</th></tr></thead><tbody>' +
        difs.map(function (f) {
          return '<tr><td><b>' + E(f.icone || '') + ' ' + E(f.nome) + '</b><br><span class="apoio">' + E(f.resumo || '') + '</span></td><td class="n">' + mult(f.vida) + '</td><td class="n">' +
            mult(f.dano) + '</td><td class="n">' + mult(f.clima) + '</td><td class="n">' + mult(f.xp) + '</td><td class="n">' + mult(f.drop) + '</td></tr>';
        }).join('') + '</tbody></table></div>', 'facil normal dificil');
    }

    var tab = LV.xpTable || [], fo = LV.xpFalloff || {}, pl = LV.perLevel || {}, pe = LV.perLevelElement || {};
    var papel = LV.defenseByRole || {}, sc = D.summonCap || {};
    sec('niveis', 'Níveis e experiência',
      '<p>O herói vai do nível 1 ao ' + maxN + '. A experiência de uma sala é a soma dos monstros, dividida pelo grupo. Todo nível dá +' + num(pl.hp) + ' PV; do 2 ao ' + esc + ' dá +' +
      num(pl.power) + ' de poder, e do ' + (esc + 1) + ' em diante, +' + num(pe.elemPower) + ' de dano no elemento escolhido.</p>' +
      (fo.graceLevels != null ? '<p>Descer raso rende cada vez menos: até ' + num(fo.graceLevels) + ' níveis acima do recomendado do calabouço a experiência vale inteira; cada nível a mais multiplica por ' +
        mult(fo.factorPerLevel) + ', até o piso de ' + pct(fo.floor) + '. Descer fundo é o caminho.</p>' : '') +
      '<h3>A experiência de cada nível (acumulada)</h3><div class="wk-xp">' + tab.map(function (x, i) {
        return '<span>nível ' + (i + 1) + ': <b>' + SITE.num(x) + '</b></span>';
      }).join('') + '</div>' +
      '<h3>Esquiva e fixação no nível ' + maxN + ', por papel</h3><div class="wk-rolagem"><table class="wk-tabela"><thead><tr><th>papel</th><th class="n">esquiva</th><th class="n">fixação</th></tr></thead><tbody>' +
      chaves(papel).map(function (r) { return '<tr><td>' + E(PAPEL[r] || r) + '</td><td class="n">' + num(papel[r].dodge) + '</td><td class="n">' + num(papel[r].lock) + '</td></tr>'; }).join('') +
      '</tbody></table></div><p class="apoio">Cada classe sai dos números dela no nível 1 e anda em linha reta até estes.</p>' +
      (sc.base != null ? '<p>Invocações ao mesmo tempo: ' + num(sc.base) + (sc.degraus && sc.degraus.length ? ', e +1 ' + lista(sc.degraus.map(function (n) { return 'no nível ' + n; })) : '') + '.</p>' : ''),
      'nivel experiencia xp esquiva fixacao invocacao');

    var S2 = D.stars || {}, cards = D.cards || {};
    sec('estrelas', 'Cartas e estrelas',
      '<p>As cartas de classe caem dos chefes. Com as cartas do desbloqueio a classe é liberada; as que passam disso compram estrelas, bônus permanentes da classe.</p>' +
      '<div class="wk-rolagem"><table class="wk-tabela"><thead><tr><th>classe</th><th class="n">cartas para liberar</th></tr></thead><tbody>' +
      chaves(cards).filter(function (c) { return CLASSES[c]; }).map(function (c) {
        return '<tr><td>' + link('classe', c, nomeClasse(c)) + '</td><td class="n">' + (num(cards[c].unlockCost) ? num(cards[c].unlockCost) : 'já vem') + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<ul class="wk-defs">' + chaves(S2.bonuses || {}).map(function (n) {
        var extra = num((S2.elementSlots || {})[n]) > num((S2.elementSlots || {})[n - 1]) ? ', e libera o ' + num(S2.elementSlots[n]) + 'º caminho de elemento' : '';
        return '<li>' + '★'.repeat(num(n)) + ': ' + E(bonusPartes(S2.bonuses[n]).join(', ')) + extra + '</li>';
      }).join('') + '</ul>', 'carta estrela desbloqueio');

    var F = JG.Fusion;
    if (F) {
      sec('fusao', 'Fusão',
        '<p>Dois heróis colados (em cruz) viram um corpo só. Quem declara gasta ' + num(F.FUSION_PA_COST) + ' PA; o corpo soma a vida dos dois, ganha +' + num(F.BONUS_PA) + ' PA, +' +
        num(F.BONUS_PP) + ' PP e um escudo de ' + num(F.BONUS_SHIELD) + ' que não acaba, e usa os feitiços da dupla. Dura até o fim da batalha.</p><p><a href="fusoes.html">Todas as duplas, formas e misturas</a></p>',
        'fusao fundir dupla');
    }

    var fu = LV.roomFury || (JG.Engine && JG.Engine.ROOM_FURY) || {};
    if (fu.afterRound) {
      sec('furia', 'Fúria da sala',
        '<p>Batalha que não se resolve não dura para sempre. A partir da rodada ' + num(fu.afterRound) + ', a cada rodada os inimigos ganham +' + num(fu.powerPerRound) +
        ' de poder e toda cura cai ' + pct(fu.healCutPerRound) + ' (dos dois lados). Na rodada ' + num(fu.maxRounds) + ', a batalha acaba em derrota.</p>', 'furia rodada empate');
    }

    var ev = valores(D.tileEvents || {});
    if (ev.length) {
      sec('eventos-chao', 'Eventos do chão',
        '<p>De vez em quando algo brota numa casa do tabuleiro. Quem pisa leva o efeito.</p><div class="wk-rolagem"><table class="wk-tabela"><tbody>' + ev.map(function (x) {
          return '<tr><td>' + E(x.icon || '') + ' <b>' + E(x.name) + '</b><br><span class="apoio">' + E(TIPO_EVENTO[x.kind] || '') +
            (x.duration ? ' · some em ' + num(x.duration) + ' rodadas' : '') + '</span></td><td>' + E(x.description) + '</td></tr>';
        }).join('') + '</tbody></table></div>', 'evento chao casa portal fonte dreno');
    }

    var U = D.upgrade || {};
    if (U.maxLevel) {
      var custo = U.stoneCost || [], total = custo.reduce(function (a, b) { return a + num(b); }, 0), anc = PEDRAS[U.guardStone];
      sec('forja', 'Forja',
        '<p>Na bigorna, uma peça sobe até +' + num(U.maxLevel) + '. Cada nível soma ' + pct(U.bonusPerLevel) + ' dos bônus de base da peça' +
        ((U.nonScalingKeys || []).length ? ' (' + lista((U.nonScalingKeys || []).map(function (k) { return ATRIBUTO[k] || k; })) + ' nunca sobem)' : '') +
        '. A batida gasta pedras do elemento da peça; peça neutra aceita qualquer pedra. Do +0 ao +' + num(U.maxLevel) + ' são ' + total + ' pedras.</p>' +
        '<div class="wk-rolagem"><table class="wk-tabela"><thead><tr><th>batida</th><th class="n">pedras</th><th class="n">chance de dar certo</th></tr></thead><tbody>' +
        custo.map(function (c, i) {
          var ch = (U.chances || {})[i];
          return '<tr><td>+' + i + ' → +' + (i + 1) + '</td><td class="n">' + num(c) + '</td><td class="n">' + (i >= num(U.riskFrom) && ch != null ? pct(ch) : 'sempre') + '</td></tr>';
        }).join('') + '</tbody></table></div>' +
        '<p>Do +' + num(U.riskFrom) + ' em diante a batida pode falhar, e a peça volta um nível.' + (anc ? ' A <b>' + E(anc.name) + '</b>, posta junto das pedras, segura a queda: falhou, ficou onde estava. Só chefe derruba.' : '') + '</p>' +
        ((U.tiers || []).length ? '<p class="apoio">Os nomes dos degraus: ' + lista(U.tiers.map(function (t) { return E(t.name) + ' (+' + num(t.from) + (t.to !== t.from ? ' a +' + num(t.to) : '') + ')'; })) + '.</p>' : '') +
        '<h3>As pedras</h3><div class="wk-linhas">' + valores(PEDRAS).map(function (p) {
          return '<div class="wk-linha">' + icone('extra-' + p.id, p.name) + '<span class="wk-linha-tx"><b>' + E(p.name) + '</b><span class="apoio">' +
            (ELINFO[p.element] ? elem(p.element) + ' ' : '') + E(p.description) + '</span></span></div>';
        }).join('') + '</div>', 'forja bigorna pedra ancora melhorar');
    }

    var LW = D.lootWeights || {}, bag = D.bag || {}, Dd = JG.Diario;
    var minSala = {};
    valores(ITENS).forEach(function (it) { if (it.dungeonId && (minSala[it.rarity] == null || num(it.minRoom) < minSala[it.rarity])) minSala[it.rarity] = num(it.minRoom); });
    var salaRef = DGS[0];
    sec('saque', 'Saque e raridade',
      '<p>Toda sala vencida sorteia o saque; muitas vezes não sai peça nenhuma. A raridade diz quanto custa achar: ' +
      lista(ORDEM_RAR.filter(function (r) { return minSala[r] != null; }).map(function (r) { return RARIDADE[r].toLowerCase() + ' ' + textoSala(minSala[r], salaRef); })) +
      '. As peças que mudam como se joga (+1 PA, +1 PP e os Lumes) são as mais difíceis da raridade delas. O dono quer que peça boa seja rara de verdade.</p>' +
      (MOSTRA_CHANCES && LW.luck ? '<p>Sorte de saque: sozinho ' + mult(LW.luck.solo) + ', em dupla ' + mult(LW.luck.dupla) + '.</p>' : '') +
      (bag.base != null ? '<p>O saco tem fundo: ' + num(bag.base) + ' lugares, mais ' + num(bag.perClass) + ' por classe liberada. O que não cabe vai para o cofre do banco.</p>' : '') +
      (Dd && Dd.BONUS_DROP ? '<p>O <b>Calabouço do Dia</b> paga +' + Math.round((num(Dd.BONUS_DROP) - 1) * 100) + '% de saque. Cada dia é um calabouço aberto, o mesmo para todo mundo.</p>' : ''),
      'saque drop raridade comum raro epico lendario saco cofre calabouco do dia');

    var NU = D.nivelUso || {}, pc = NU.porCalabouco || {};
    sec('nivel-uso', 'Nível de uso',
      '<p>Cada peça pede um nível para ser vestida: quanto mais fundo o calabouço e mais rara a peça, maior. Acima do nível a peça ainda cai, fica no saco, é trocada e vendida.</p>' +
      '<div class="wk-rolagem"><table class="wk-tabela"><thead><tr><th>calabouço</th><th class="n">comum</th><th class="n">raro</th><th class="n">épico</th></tr></thead><tbody>' +
      DGS.filter(function (d) { return pc[d.id]; }).map(function (d) {
        return '<tr><td>' + link('calabouco', d.id, d.name) + (FECHADO(d.id) ? ' <span class="apoio">(em breve)</span>' : '') + '</td><td class="n">' + num(pc[d.id].comum) +
          '</td><td class="n">' + num(pc[d.id].raro) + '</td><td class="n">' + num(pc[d.id].epico) + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<p>Peça lendária: nível ' + num(NU.lendario) + '. Traje do Colecionador: nível ' + num(NU.colecionador) + '. Pet: nível ' + num(NU.pet) + '.</p>', 'nivel de uso equipar');

    if (D.selos) {
      var sset = SETS[D.selos.setId], spet = sset && PETS[sset.pet];
      sec('selos', 'Os Selos do Colecionador',
        '<p>Só chefe derruba Selos, e cada chefe derruba o do próprio elemento. No Mercadinho mora o Colecionador: ' + num(D.selos.porGiro) +
        ' selos, de qualquer elemento, pagam um giro na roleta, e cada giro dá uma peça ' + (sset ? 'do conjunto ' + link('conjunto', sset.id, sset.name) : 'lendária') +
        '. Peça repetida vira estrela.' + (spet ? ' Fechar as peças acende a aura de fogo branco e dá o pet ' + link('pet', spet.id, spet.name) + '.' : '') +
        (MOSTRA_CHANCES ? ' Chance de selo por chefe: ' + pct(D.selos.chance) + '.' : '') + '</p>', 'selo colecionador roleta aura');
    }

    var G = JG.Guilda, ins = D.insignias || {};
    sec('guilda', 'Guilda',
      '<p>Fundar uma guilda custa ' + num(ins.porGuilda || (G && G.CUSTO_CRIAR)) + ' <b>Insígnias de Fundação</b>, que só os chefes derrubam' +
      (MOSTRA_CHANCES && ins.chance ? ' (' + pct(ins.chance) + ' por chefe)' : '') + '. Quem funda lidera; há oficiais e membros.</p>' +
      (G ? '<ul class="wk-defs"><li>O cofre da guilda junta a moeda da guilda; só quem lidera (e os oficiais) gasta. ' + num(G.CUSTO_BONUS) + ' moedas compram ' +
        Math.round(num(G.BONUS_MS) / 3600000) + ' h de +' + Math.round((num(G.BONUS_FATOR) - 1) * 100) + '% de saque ou de experiência para todos os membros.</li>' +
        '<li>Doar vinténs à guilda (a oferenda) dá experiência a ela; quem lidera pode cobrar um dízimo da experiência dos membros, de até ' + num(G.DIZIMO_MAX) + '%.</li>' +
        '<li>O banco da guilda empresta peças entre os membros: um empréstimo por vez, devolve quem pegou, e o dono retira quando quiser.</li>' +
        '<li>O duelo de treino paga ' + num(G.XP_TREINO) + ' de experiência e ' + num(G.MOEDA_TREINO) + ' moeda à guilda.</li>' +
        // 15/09: a guerra de guilda 2×2 na Sede (os números espelham servidor/guerra.py e JOGO.Guerra)
        '<li><b>Guerra de Guilda 2×2</b>, na Sede: dois jogadores da mesma guilda, em grupo, cada um com os seus dois heróis, entram na fila; ' +
        'o jogo acha dois de outra guilda (até ' + num((JG.Guerra && JG.Guerra.PARIDADE) || 10) + ' níveis de diferença entre os heróis mais fortes) e os quatro confirmam em 30 s. ' +
        'As duplas dos adversários só aparecem na luta, no Salão da Sede. A guilda que vence ganha ' + num((JG.Guerra && JG.Guerra.XP) || 40) +
        ' de experiência; quem perde não perde nada, e a coroa não muda. Empate e W.O. não rendem, e o servidor segura quantas guerras valem por dia entre as mesmas guildas.</li></ul>' : ''),
      'guilda insignia cofre banco oferenda dizimo guerra sede 2x2');

    var M = JG.Mercado;
    if (M) {
      sec('mercadinho', 'Mercadinho',
        '<p>No Mercadinho do Acampamento um jogador anuncia uma peça com preço e outro compra. A venda paga ' + pct(M.TAXA) + ' de taxa (no mínimo 1 vintém). O preço vai até ' +
        SITE.num(M.PRECO_MAX) + ' vinténs. Um mercador-fantasma pendura ' + num(M.POR_DIA) + ' ofertas por dia.</p>', 'mercado mercadinho vender comprar taxa vintem');
    }

    // 13/09: as poções da banca do mercador, lidas dos dados do jogo (nenhum número copiado)
    var CONS = D.consumiveis, CR = D.consumiveisRegras || {}, VES = D.vidaEntreSalas || {};
    if (CONS) {
      var linhasCons = Object.keys(CONS).map(function (k) { return CONS[k]; })
        .sort(function (a, b) { return num(a.preco) - num(b.preco); })
        .map(function (c) {
          return '<li><b>' + SITE.esc(c.name || c.id) + '</b>: cura ' + num(c.cura) + ' PV · ' + SITE.num(num(c.preco)) + ' vinténs</li>';
        }).join('');
      sec('consumiveis', 'Consumíveis: as poções de vida',
        '<p>No Mercadinho mora a banca do mercador: poções de vida com estoque sem fim, preço fixo e sem taxa, pagas com os vinténs do saco. ' +
        'Elas ficam em Consumíveis no inventário, até ' + num(CR.teto) + ' de cada.</p><ul class="wk-defs">' + linhasCons + '</ul>' +
        // 13/09: a poção saiu da batalha (pedido do dono). 14/09: a vida é uma só por herói, e vale em toda parte
        '<p>Cada herói tem <b>uma vida só</b>, que vale em toda parte: na praça, nas salas do calabouço, no Poço, no grupo e no duelo. ' +
        'Quando uma luta acaba — vitória ou derrota — o herói fica com a vida com que terminou (quem caiu fica com zero), e ela ' +
        'volta sozinha, 1 PV a cada ' + num((VES.msPorPv || 2000) / 1000) + ' s, até encher. A próxima batalha começa com a vida ' +
        'que ele tiver: quem entra no duelo com a vida na metade luta com a metade.</p>' +
        '<p>A poção não se bebe na batalha: bebe-se <b>fora da luta</b> — na praça, na sala de espera entre as salas e nas telas de fim. ' +
        'Ela cura na hora, sem passar do PV máximo, para não esperar. Herói sem vida só entra numa batalha quando recuperar pelo ' +
        'menos 1 PV.</p>' +
        // 15/09 (as falhas conhecidas): sair antes do fim não foge da conta
        '<p>Sair da luta antes do fim não salva a vida. Quem <b>desiste do duelo</b> sai com os heróis a zero (e, na Arena e no ' +
        'Campo de PvP, perde a coroa como numa derrota); quem some do duelo e não volta em 60 s também — o servidor confere a queda. ' +
        'Quem fecha o jogo no meio de uma sala continua a luta dali quando voltar: o jogo fecha a sala no ponto em que parou. ' +
        'Abrir outra luta em outro lugar com a de antes ainda aberta faz os heróis dela voltarem do zero.</p>',
        'pocao pocoes consumivel consumiveis vida cura mercador banca espera antessala praca regenera duelo desistir abandonar');
    }

    var Mi = JG.Missoes;
    if (Mi) {
      sec('missoes', 'Missões e conquistas',
        '<p>Todo dia o quadro do Acampamento sorteia ' + num(Mi.POR_DIA) + ' missões, as mesmas para todo mundo, pagas em vinténs:</p><ul class="wk-defs">' +
        valores(Mi.DIARIAS || {}).map(function (x) { return '<li>' + E(x.texto) + ' — ' + num(x.premio) + ' vinténs</li>'; }).join('') + '</ul>' +
        '<p>As conquistas são para sempre e destravam um título, que aparece junto do nome:</p><ul class="wk-defs">' +
        valores(Mi.CONQUISTAS || {}).map(function (x) { return '<li>' + E(x.texto) + ' — ' + num(x.premio) + ' vinténs e o título <b>' + E(x.titulo) + '</b></li>'; }).join('') + '</ul>',
        'missao diaria conquista titulo');
    }

    var Br = JG.Brasa;
    if (Br) {
      sec('arena', 'Arena e Brasa',
        '<p>Há três jeitos de lutar contra outro jogador. O <b>desafio amistoso</b>: toque em alguém na praça — a luta é no mapa da praça, ' +
        'cada um leva 1 ou 2 heróis escolhidos às cegas, e a coroa não muda. A <b>Arena</b>: inscreva os seus dois heróis no quadro de ' +
        'inscritos (todos veem as classes) e espere um desafio, ou desafie um inscrito com até 5 níveis de diferença; os dois confirmam em 30 s ' +
        'e a luta é numa sala sorteada dos calabouços — vale coroa. O <b>Campo de PvP</b>: só se entra com a coroa ligada, escolhendo dois ' +
        'heróis em ordem (o 1º é a aparência, o 2º é a surpresa); lá dentro qualquer um ataca sem aviso quem estiver a até 10 níveis — também vale coroa.</p>' +
        '<p>A pontuação é a Brasa: todo mundo começa com ' + SITE.num(Br.INICIAL) +
        ', ganhar de quem vale menos paga pouco, perder devolve o que se subiu, e ninguém cai abaixo de ' + SITE.num(Br.PISO) + '. A cada ' + num(Br.TEMPORADA_DIAS) +
        ' dias a temporada fecha e os pontos voltam para perto do meio.</p><div class="wk-rolagem"><table class="wk-tabela"><thead><tr><th>coroa</th><th class="n">a partir de</th></tr></thead><tbody>' +
        (Br.TIERS || []).map(function (t) {
          return '<tr><td>' + E(t.nome) + '</td><td class="n">' + SITE.num(t.min) + (t.exigeTopo ? ' e ser o 1º do placar' : '') + '</td></tr>';
        }).join('') + '</tbody></table></div><p class="apoio">Quem decide a coroa é o servidor: ele refaz a luta da Arena e do Campo, confere a diferença de nível e segura quantos duelos valem por dia entre as mesmas duas contas.</p>',
        'arena duelo brasa coroa pvp temporada desafio amistoso quadro inscricao campo');
    }

    var Po = JG.Poco;
    if (Po) {
      sec('poco', 'O Poço sem Fundo',
        '<p>A torre infinita, com entrada pelo poço da praça, a leste da Árvore-Mundo, para quem desce sozinho. Cada andar é uma sala emprestada dos calabouços, e cada andar a mais deixa os monstros ' +
        pct(Po.FATOR_POR_ANDAR) + ' mais duros. A cada ' + num(Po.CHEFE_A_CADA) + ' andares, um chefe. O recorde da semana fica anotado.</p>', 'poco torre infinita andar');
    }

    sec('dupla', 'Em dupla',
      '<p>Toque noutro jogador na praça para chamar para o grupo, mandar mensagem particular, propor troca ou chamar para um desafio amistoso (na praça, sem coroa). O grupo é de dois: quem chama lidera, escolhe o calabouço e a dificuldade, e os dois descem juntos, cada um com um herói. O saque de cada sala é sorteado uma vez para o grupo. Quem cai da conexão no meio da batalha tem o herói tocado pela máquina até o fim da sala.</p>',
      'grupo dupla multijogador duelo troca mensagem');

    var PG = D.pergaminhos, BX = D.bonusXp;
    if (PG || BX) {
      sec('loja', 'Pergaminhos e bônus',
        '<ul class="wk-defs">' + (BX ? '<li><b>Bônus de experiência</b>: dias de ' + mult(BX.fator) + ' de experiência para o grupo, vendidos na <a href="loja.html">Loja</a>; comprar de novo soma dias.</li>' : '') +
        (PG && PG.xp ? '<li><b>Pergaminho da Sabedoria</b>: ' + mult(PG.xp.fator) + ' de experiência por ' + num(PG.xp.salas) + ' salas vencidas (até ' + num(PG.xp.tetoSalas) +
          ' guardadas). Não soma com o bônus por tempo.</li>' : '') +
        '<li><b>Pergaminho da Reescrita</b>: troca um caminho de elemento do herói por outro.</li></ul>' +
        '<p class="apoio">Com um evento de experiência no ar, tudo junto para no teto do evento.</p>', 'pergaminho bonus loja sabedoria reescrita');
    }
    return S;
  }
  function sistemas(arg) {
    var S = secoesRegras();
    var h = '<h1>Regras</h1><p class="wk-sub">As regras do jogo, com os números que o jogo usa.</p><ul class="wk-indice">' +
      S.map(function (s) { return '<li><a href="' + rota('sistemas', s.id) + '">' + E(s.titulo) + '</a></li>'; }).join('') + '</ul>' +
      S.map(function (s) { return '<section class="wk-regra" id="r-' + s.id + '"><h2>' + E(s.titulo) + '</h2>' + s.html + '</section>'; }).join('');
    var alvo = arg && S.some(function (s) { return s.id === arg; }) ? 'r-' + arg : null;
    var t = alvo ? S.filter(function (s) { return s.id === arg; })[0].titulo : 'Regras';
    return { titulo: t, html: h, rolarPara: alvo };
  }

  // ------------------------------------------------------------------ busca
  var indice = null;
  function montaIndice() {
    var I = [];
    function add(tipo, nome, extra, href) { I.push({ tipo: tipo, nome: String(nome), href: href, n: norm(nome), x: norm(nome + ' ' + (extra || '')) }); }
    chaves(CLASSES).forEach(function (id) {
      var c = CLASSES[id];
      add('Classe', c.name, [PAPEL[c.role], c.description, id].join(' '), rota('classe', id));
      feiticosDaClasse(id).forEach(function (f) {
        add('Feitiço', f.sp.name, [c.name, nomeEl(f.el), f.sp.description].join(' '), rota('feitico', f.sp.id));
      });
    });
    chaves(ISPELLS).forEach(function (sid) { add('Feitiço de Lume', ISPELLS[sid].name, ISPELLS[sid].description, rota('feitico', sid)); });
    chaves(PSPELLS).forEach(function (sid) { add('Feitiço de pet', PSPELLS[sid].name, PSPELLS[sid].description, rota('feitico', sid)); });
    valores(MONSTROS).filter(monstroVisivel).forEach(function (m) {
      add(m.boss ? 'Chefe' : 'Monstro', m.name, [m.family, nomeEl(m.element), m.description].join(' '), rota('monstro', m.id));
      (m.spells || []).forEach(function (sid) {
        var sp = MSPELLS[sid];
        if (sp) add('Golpe de monstro', sp.name, m.name + ' ' + sp.description, rota('monstro', m.id));
      });
    });
    valores(ITENS).forEach(function (it) {
      add('Item', it.name, [RARIDADE[it.rarity], (ESPACO[it.slot] || {}).nome, nomeDg(it.dungeonId), resumoItem(it), it.description].join(' '), rota('item', it.id));
    });
    valores(SETS).forEach(function (s) { add('Conjunto', s.name, s.description, rota('conjunto', s.id)); });
    valores(PETS).forEach(function (p) { add('Pet', p.name, p.description, rota('pet', p.id)); });
    DGS.forEach(function (d) {
      add('Calabouço', d.name, d.description, rota('calabouco', d.id));
      if (aberto(d.id)) (d.rooms || []).forEach(function (s) { add('Sala', s.name, d.name, rota('calabouco', d.id)); });
    });
    valores(PEDRAS).forEach(function (p) { add('Pedra de forja', p.name, p.description, rota('sistemas', 'forja')); });
    valores(CLIMAS).forEach(function (w) { add('Clima', w.name, w.description, rota('sistemas', 'climas')); });
    secoesRegras().forEach(function (s) { add('Regra', s.titulo, s.busca, rota('sistemas', s.id)); });
    return I;
  }
  function busca(q) {
    q = String(q || '').trim();
    var campo = $('wk-q');
    if (campo && document.activeElement !== campo) campo.value = q;
    var nq = norm(q);
    if (nq.length < 2) {
      return { titulo: 'Busca', html: '<h1>Busca</h1><p class="wk-sub">Digite pelo menos duas letras no campo da busca.</p>' };
    }
    indice = indice || montaIndice();
    var palavras = nq.split(/\s+/).filter(Boolean);
    var achados = indice.filter(function (e) {
      return palavras.every(function (p) { return e.x.indexOf(p) >= 0; });
    }).map(function (e) {
      var s = e.n === nq ? 4 : (e.n.indexOf(nq) === 0 ? 3 : (palavras.every(function (p) { return e.n.indexOf(p) >= 0; }) ? 2 : 1));
      return { e: e, s: s };
    }).sort(function (a, b) { return b.s - a.s || a.e.nome.localeCompare(b.e.nome, 'pt'); });
    var vistos = {}, unicos = [];
    achados.forEach(function (a) { var k = a.e.href + '|' + a.e.nome; if (!vistos[k]) { vistos[k] = true; unicos.push(a.e); } });
    var mostra2 = unicos.slice(0, 80);
    var h = '<h1>Busca: ' + E(q) + '</h1><p class="wk-contagem">' + (unicos.length ? unicos.length + (unicos.length === 1 ? ' resultado' : ' resultados') +
      (unicos.length > mostra2.length ? ' (os ' + mostra2.length + ' primeiros)' : '') : 'Nada encontrado.') + '</p>' +
      mostra2.map(function (e) {
        return '<p class="wk-resultado" data-tipo="' + E(e.tipo) + '"><a href="' + e.href + '">' + E(e.nome) + '</a> <span class="apoio">— ' + E(e.tipo) + '</span></p>';
      }).join('');
    return { titulo: 'Busca', html: h };
  }

  /* ========================================================================
   * AS ROTAS
   * ====================================================================== */
  var PAGINAS = {
    '': inicio, inicio: inicio, classes: classes, classe: classe, feiticos: feiticos, feitico: feiticoPag,
    calaboucos: calaboucos, calabouco: calabouco, bestiario: bestiario, monstro: monstro, itens: itens,
    item: itemPag, conjuntos: conjuntos, conjunto: conjunto, pets: pets, pet: petPag, sistemas: sistemas, busca: busca
  };
  var MENU_DE = { '': 'inicio', inicio: 'inicio', classe: 'classes', feitico: 'feiticos', calabouco: 'calaboucos',
                  monstro: 'bestiario', item: 'itens', conjunto: 'conjuntos', pet: 'pets' };
  function dec(s) { try { return decodeURIComponent(s); } catch (e) { return s; } }
  function leRota() {
    var h = location.hash.replace(/^#\/?/, ''), q = '', i = h.indexOf('?');
    if (i >= 0) { q = h.slice(i + 1); h = h.slice(0, i); }
    var partes = h.split('/'), params = {};
    q.split('&').forEach(function (kv) {
      if (!kv) return;
      var j = kv.indexOf('=');
      params[dec(j < 0 ? kv : kv.slice(0, j))] = j < 0 ? '' : dec(kv.slice(j + 1).replace(/\+/g, ' '));
    });
    return { pag: dec(partes[0] || ''), arg: partes.length > 1 ? dec(partes.slice(1).join('/')) : '', params: params };
  }
  function mostra(op) {
    var r = leRota(), res;
    try {
      res = own.call(PAGINAS, r.pag) ? PAGINAS[r.pag](r.arg, r.params) : naoAchou();
    } catch (e) {
      if (window.console) console.error(e);
      res = { titulo: 'Erro', html: '<h1>Esta página não abriu</h1><div class="wk-nota">Algo nos dados do jogo não bateu com a wiki. Volte ao <a href="#/">início</a>.</div>' };
    }
    var caixa = $('wk-conteudo');
    caixa.innerHTML = res.html;
    document.title = (res.titulo ? res.titulo + ' — ' : '') + 'Wiki do SOTERRA';
    var sec = own.call(MENU_DE, r.pag) ? MENU_DE[r.pag] : r.pag;
    Array.prototype.forEach.call(document.querySelectorAll('#wk-menu a[data-sec]'), function (a) {
      if (a.getAttribute('data-sec') === sec) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    if (res.depois) res.depois(caixa);
    if (op && op.semRolar) return;
    rolaPara(res.rolarPara ? $(res.rolarPara) : null);
  }
  /* a troca de página pula na hora para o topo (ou para a seção das regras): o
   * scroll-behavior: smooth do site.css faria cada clique descer a página longa
   * inteira em câmera lenta */
  function rolaPara(alvo) {
    try {
      if (alvo) alvo.scrollIntoView({ block: 'start', behavior: 'instant' });
      else window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    } catch (e) {
      if (alvo && alvo.scrollIntoView) alvo.scrollIntoView(); else window.scrollTo(0, 0);
    }
  }

  if (!chaves(CLASSES).length || !chaves(SPELLS).length) {
    $('wk-conteudo').innerHTML = '<div class="estado fora">Não deu para ler os dados do jogo (../js/core/data/).</div>';
    return;
  }
  window.addEventListener('hashchange', function () { mostra(); });
  var campo = $('wk-q'), espera = null;
  function buscaViva() {
    var v = campo.value.trim();
    if (norm(v).length < 2) return;
    try { history.replaceState(null, '', '#/busca/' + encodeURIComponent(v)); } catch (e) { location.hash = '#/busca/' + encodeURIComponent(v); return; }
    mostra({ semRolar: true });
  }
  campo.addEventListener('input', function () { clearTimeout(espera); espera = setTimeout(buscaViva, 180); });
  $('wk-busca').addEventListener('submit', function (ev) {
    ev.preventDefault();
    clearTimeout(espera);
    buscaViva();
    campo.blur();
  });
  mostra();
})();
