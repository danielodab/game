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
  // 02/10: o elenco do Eco Primordial mora à parte (js/core/data/eco.js) — fora do bestiário de calabouço
  var ECO_MONSTROS = D.ecoMonstros || {};
  function monstroDe(id) { return own.call(MONSTROS, id) ? MONSTROS[id] : (own.call(ECO_MONSTROS, id) ? ECO_MONSTROS[id] : null); }
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
  /* OS TABULEIROS QUE NÃO SÃO CALABOUÇO (21/09). `DATA.arenas` tem o MESMO formato de
   * `rooms[].layout` de um calabouço — a Praça (desafio amistoso) e o Salão da Sede
   * (guerra de guilda 2×2). A wiki nem carregava o arquivo, então os dois mapas mais
   * jogados do PvP eram os únicos lugares de luta sem mapinha. Ali `P` é o lado A e a
   * letra minúscula é o lado B, não monstro. */
  var ARENAS = (Array.isArray(D.arenas) ? D.arenas : valores(D.arenas)).filter(Boolean);
  /* OS CALABOUÇOS ESPECIAIS (03/10, o Santuário dos Elementos). Moram em DATA.especiais, fora dos seis
   * portais (js/core/data/santuario.js diz por quê), então nada que enumera DGS os vê: nem a grade de
   * calabouços, nem o Calabouço do Dia, nem o Poço. Aqui eles entram em "Os outros tabuleiros", com
   * página própria — e os monstros deles passam a ter casa (nome do lugar, "onde aparece"). */
  var ESPECIAIS = (Array.isArray(D.especiais) ? D.especiais : []).filter(Boolean);
  function especial(id) { for (var i = 0; i < ESPECIAIS.length; i++) if (ESPECIAIS[i].id === id) return ESPECIAIS[i]; return null; }

  /* ---- VOCABULÁRIO (o dono confere) ----------------------------------------- */
  var PAPEL = { tanque: Tx('Tanque'), atirador: Tx('Atirador'), mago: Tx('Mago'), assassino: Tx('Assassino'),
                suporte: Tx('Suporte'), invocador: Tx('Invocador'), guardiao: Tx('Guardião') };
  var AREA = {
    single: function () { return Tx('alvo único'); },
    circle: function (n) { return Tx('círculo de raio {n}', { n: n }); },
    line:   function (n) { return Tx('linha de {a}', { a: casas(n) }); },
    cross:  function (n) { return Tx('cruz de raio {n}', { n: n }); },
    cone:   function (n) { return Tx('leque de {a}', { a: casas(n) }); },
    ring:   function (n) { return Tx('anel de raio {n}', { n: n }); }
  };
  var ALVO = { ally: Tx('aliado'), any: Tx('qualquer casa') };
  var ATRIBUTO = { hp: Tx('PV'), pa: Tx('PA'), pp: Tx('PP'), power: Tx('poder'), initiative: Tx('iniciativa'),
                   dodge: Tx('esquiva'), lock: Tx('fixação') };
  var LIMPA = { poison: Tx('veneno'), root: Tx('prisão') };
  var ESPACO = {
    punho: { nome: Tx('Punho'), diz: Tx('o que golpeia') },
    passo: { nome: Tx('Passo'), diz: Tx('o que anda — toda peça de Passo dá esquiva') },
    casca: { nome: Tx('Casca'), diz: Tx('o que protege') },
    lume:  { nome: Tx('Lume'), diz: Tx('a relíquia acesa — concede um feitiço') }
  };
  var ORDEM_ESPACO = ['punho', 'passo', 'casca', 'lume'];
  var RARIDADE = { comum: Tx('Comum'), raro: Tx('Raro'), epico: Tx('Épico'), lendario: Tx('Lendário') };
  var RARA = { comum: Tx('comum'), raro: Tx('rara'), epico: Tx('épica'), lendario: Tx('lendária') };
  var ORDEM_RAR = ['comum', 'raro', 'epico', 'lendario'];
  var IA = { melee: Tx('luta de perto'), ranged: Tx('luta de longe'), support: Tx('apoia os aliados'), boss: Tx('chefe') };
  var JEITO_PET = { attack: Tx('ataca'), guard: Tx('guarda o dono'), support: Tx('apoia o dono') };
  var TIPO_EVENTO = { buff: Tx('bênção'), mystery: Tx('mistério'), portal: Tx('portal'), drain: Tx('dreno'), fountain: Tx('fonte') };
  var BONUS_ORDEM = ['hp', 'pa', 'pp', 'power', 'initiative', 'dodge', 'lock'];
  var BONUS_NOME = { hp: Tx('PV'), pa: Tx('PA'), pp: Tx('PP'), power: Tx('de poder'), initiative: Tx('de iniciativa'),
                     dodge: Tx('de esquiva'), lock: Tx('de fixação') };

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
  function pct(x) { return Math.round(num(x) * 100) + '%'; }
  function sinal(v) { v = num(v); return (v > 0 ? '+' : (v < 0 ? '−' : '')) + Math.abs(v); }
  function mult(x) { return '×' + SITE.decimal(num(x)); }
  function corOk(c) { return /^#[0-9a-fA-F]{3,8}$/.test(c || '') ? c : ''; }
  function nomeEl(id) { return ELINFO[id] ? ELINFO[id].name : Tx('Neutro'); }
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
    return '<nav class="wk-trilha" aria-label="' + Tx('Você está em') + '">' +
      Tx('<a href="#/">Wiki</a>{a}{b}', { a: passos.map(function (p) { return ' › <a href="' + p[0] + '">' + E(p[1]) + '</a>'; }).join(''), b: atual ? ' › <span>' + E(atual) + '</span>' : '' }) +
      '</nav>';
  }
  var DE = { A: 'da', O: 'do', As: 'das', Os: 'dos' }, EM = { A: 'na', O: 'no', As: 'nas', Os: 'nos' };
  function contrai(mapa, prep, nome) {
    var m = /^(A|O|As|Os) (.*)$/.exec(String(nome || ''));
    return m ? mapa[m[1]] + ' ' + m[2] : prep + ' ' + nome;
  }
  function lista(partes) {
    partes = partes.filter(Boolean);
    return partes.length < 2 ? partes.join('') : Tx('{a} e {b}', { a: partes.slice(0, -1).join(', '), b: partes[partes.length - 1] });
  }

  /* ---- procuras ---------------------------------------------------------------- */
  function dg(id) { for (var i = 0; i < DGS.length; i++) if (DGS[i].id === id) return DGS[i]; return null; }
  function nomeDg(id) { var d = dg(id) || especial(id); return d ? d.name : ''; }
  function aberto(id) { return !!especial(id) || (!!dg(id) && !FECHADO(id)); }
  // o link para a página do lugar onde um monstro mora: calabouço dos seis, ou o tabuleiro do especial
  function linkLugar(id) { return link(especial(id) ? 'tabuleiro' : 'calabouco', id, nomeDg(id)); }
  function monstroVisivel(m) { return !!m && (m.dungeonId ? aberto(m.dungeonId) : true); }
  function feitico(id) { return SPELLS[id] || MSPELLS[id] || ISPELLS[id] || PSPELLS[id] || null; }
  function nomeClasse(id) { return (CLASSES[id] && CLASSES[id].name) || String(id); }
  function corClasse(id) { return corOk(CLASSES[id] && CLASSES[id].palette && CLASSES[id].palette.primary); }
  function nomeClima(id) { return (CLIMAS[id] && CLIMAS[id].name) || Tx('Calmo'); }
  function arena(id) { for (var i = 0; i < ARENAS.length; i++) if (ARENAS[i].id === id) return ARENAS[i]; return null; }
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
  function nivelFeitico(sp) { var n = num(sp.unlockLevel); return n > 0 ? Tx('nível {n}', { n: n }) : Tx('desde o início'); }

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
    damage: function (e) { return (e.lifesteal
      ? Tx('dano com roubo de vida {a} de {b}', { a: faixa(e), b: elem(e.element) })
      : Tx('dano {a} de {b}', { a: faixa(e), b: elem(e.element) })); },
    poison: function (e) { return Tx('veneno {a} de {b} a cada turno, {c}', { a: faixa(e), b: elem(e.element), c: turnos(e.duration) }); },
    heal: function (e) { return Tx('cura {a}', { a: faixa(e) }); },
    regen: function (e) { return Tx('regeneração {a} {b}', { a: faixa(e), b: turnos(e.duration) }); },
    shield: function (e) { return Tx('escudo de {a} {b}', { a: num(e.value), b: turnos(e.duration) }); },
    buff: function (e) {
      var s = sinal(e.value);
      if (e.stat === 'pa' || e.stat === 'pp') return s + ' ' + ATRIBUTO[e.stat] + ' ' + turnos(e.duration);
      return Tx('{s} de {a} {b}', { s: s, a: ATRIBUTO[e.stat] || Tx('atributo'), b: turnos(e.duration) });
    },
    resist: function (e) { return Tx('{a} de resistência a {b} {c}', { a: sinal(e.value), b: elem(e.element), c: turnos(e.duration) }); },
    push: function (e) { var n = num(e.tiles); return n === 1 ? Tx('empurra {n} casa', { n: n }) : Tx('empurra {n} casas', { n: n }); },
    pull: function (e) { var n = num(e.tiles); return n === 1 ? Tx('puxa {n} casa', { n: n }) : Tx('puxa {n} casas', { n: n }); },
    root: function (e) { return Tx('prende no chão (0 PP) {a}', { a: turnos(e.duration) }); },
    mark: function (e) {
      return Tx('marca o alvo{a}{b}, {c}', { a: e.value != null ? Tx(': +{a}% de dano recebido por marca', { a: num(e.value) }) : '', b: e.max ? Tx(', até {a} marcas', { a: num(e.max) }) : '', c: turnos(e.duration) });
    },
    detonateMarks: function (e) { return Tx('detona as marcas: {a} de dano por marca', { a: SITE.decimal(num(e.mult)) }); },
    teleport: function () { return Tx('teleporta para a casa escolhida'); },
    moveTo: function (e) { return Tx('avança até {a}', { a: casas(e.maxTiles) }); },
    swap: function () { return Tx('troca de lugar com o alvo'); },
    chain: function (e) {
      var j = num(e.jumps);
      return (j === 1
        ? Tx('cadeia de {a}: {b}, salta {j} vez{c}', { a: elem(e.element), b: faixa(e), j: j, c: e.falloff != null ? Tx(', e cada salto bate com {a} do anterior', { a: pct(e.falloff) }) : '' })
        : Tx('cadeia de {a}: {b}, salta {j} vezes{c}', { a: elem(e.element), b: faixa(e), j: j, c: e.falloff != null ? Tx(', e cada salto bate com {a} do anterior', { a: pct(e.falloff) }) : '' }));
    },
    summon: function (e) {
      var m = MONSTROS[e.monsterId];
      return Tx('invoca {a}', { a: m ? link('monstro', e.monsterId, m.name) : Tx('uma criatura') }) + (num(e.count) > 1 ? ' ×' + num(e.count) : '');
    },
    trap: function (e) {
      var p = SPELLS[e.trapId];
      return (p ? Tx('arma a armadilha {a}', { a: link('feitico', e.trapId, String(p.name).replace(/ \(disparo\)$/, '')) }) : Tx('arma uma armadilha')) +
        (e.duration ? ' ' + turnos(e.duration) : '');
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
    weatherShift: function (e) { return Tx('vira o clima para {a}', { a: CLIMAS[e.weather] ? E(CLIMAS[e.weather].name) : Tx('outro') }); },
    // os cinco traços dos monstros (o vocabulário fechado do contrato)
    pushImmune: function () { return Tx('não pode ser empurrado nem puxado'); },
    enrage: function (e) { return Tx('fúria: abaixo de {a} da vida, +{b} de poder', { a: pct(e.hpPct), b: num(e.power) }); },
    explodeOnDeath: function (e) {
      return Tx('explode ao morrer: {a} de dano de {b}{c}', { a: num(e.damage), b: elem(e.element), c: num(e.radius) ? ' ' + Tx('em raio {a}', { a: num(e.radius) }) : '' });
    },
    split: function (e) {
      var m = MONSTROS[e.monsterId];
      return Tx('ao morrer, se divide em {a} {b}', { a: num(e.count), b: m ? link('monstro', e.monsterId, m.name) : Tx('pedaços') });
    },
    regenAura: function (e) { return Tx('aura: os aliados até {a} recuperam {b} PV por turno', { a: casas(e.radius), b: num(e.value) }); },
    // 02/10: os quatro dos Colossos do Poço (js/core/poco.js)
    rastroBrasa: function (e) { return Tx('deixa em brasa as casas por onde passa, por {a}: queima quem pisa', { a: turnos(e.duration) }); },
    mare: function (e) { return Tx('deixa uma poça onde termina a vez; parado em cima dela, recupera {a} da vida', { a: pct(e.cura) }); },
    couraca: function (e) {
      return Tx('couraça: corta {a} de cada golpe até perder {b} placas (golpe de ar arranca duas)', { a: pct(e.reducao), b: num(e.pontos) });
    },
    ventania: function (e) { return Tx('quem o golpeia de perto é soprado {a} para longe', { a: casas(e.tiles) }); },
    // 03/10: o guardião do Fogo do Santuário dos Elementos (js/core/santuario.js)
    veNoEscuro: function () { return Tx('enxerga no escuro: mira de longe mesmo na casa sem luz, como quem é do caminho do Fogo'); }
  };
  function efeito(e) { var f = e && EFEITO[e.type]; return f ? f(e) : Tx('efeito especial'); }
  // semRotulo: só o número (a coluna "Alcance" da tabela já diz o que é)
  function alcance(r, semRotulo) {
    r = r || {};
    var a = num(r.min), b = num(r.max);
    if (b === 0) return Tx('em si');
    var t = a === b ? String(b) : a + '–' + b;
    if (!semRotulo) t = Tx('alcance {a}', { a: t });
    if (r.line) t += Tx(' em linha reta');
    if (r.los === false) t += Tx(', por cima de obstáculo');
    return t;
  }
  function area(a) { a = a || {}; var f = AREA[a.shape]; return f ? f(num(a.size)) : Tx('área especial'); }
  function ehCarga(sp) { return /^trap-/.test(String(sp.id)) || (num(sp.paCost) === 0 && num(sp.castsPerTurn) === 0); }
  function fichaFeitico(sp) {
    var p = [];
    if (ehCarga(sp)) {
      p.push(Tx('dispara quando um inimigo pisa na armadilha'));
      if (sp.aoe && sp.aoe.shape && sp.aoe.shape !== 'single') p.push(area(sp.aoe));
      return p.join(' · ');
    }
    if (num(sp.paCost) > 0) p.push('<b>' + Tx('{a} PA', { a: num(sp.paCost) }) + '</b>');
    p.push(alcance(sp.range));
    if (sp.aoe && sp.aoe.shape && sp.aoe.shape !== 'single') p.push(area(sp.aoe));
    if (ALVO[sp.targetSide] && num(sp.range && sp.range.max) > 0) p.push(Tx('em {a}', { a: ALVO[sp.targetSide] }));
    if (sp.needsEmptyTile) p.push(Tx('precisa de casa vazia'));
    if (num(sp.cooldown) > 0) p.push((num(sp.cooldown) === 1
      ? Tx('recarga de {a} turno', { a: num(sp.cooldown) })
      : Tx('recarga de {a} turnos', { a: num(sp.cooldown) })));
    if (num(sp.castsPerTurn) > 1) p.push(Tx('{a} vezes por turno', { a: num(sp.castsPerTurn) }));
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
    ELEMENTOS.forEach(function (el) { if (num(r[el])) p.push(Tx('{a}% de resistência a {b}', { a: sinal(r[el]), b: nomeEl(el) })); });
    return p;
  }
  function resistencias(r) {
    r = r || {};
    var p = ELEMENTOS.filter(function (el) { return num(r[el]); }).map(function (el) {
      var v = num(r[el]);
      return '<span class="' + (v > 0 ? 'bom' : 'mau') + '">' + E(nomeEl(el)) + ' ' + sinal(v) + '%</span>';
    });
    return p.length ? p.join(' · ') : Tx('nenhuma');
  }

  /* ---- o saque de uma peça ----------------------------------------------------------- */
  function entradaSaque(it) {
    var d = dg(it.dungeonId), lt = (d && d.lootTable) || [];
    for (var i = 0; i < lt.length; i++) if (lt[i] && lt[i].itemId === it.id) return lt[i];
    return null;
  }
  function textoSala(minRoom, d) {
    var n = num(minRoom), salas = (d && d.rooms) ? d.rooms.length : 0;
    if (n <= 0) return Tx('em qualquer sala');
    if (salas && n >= salas - 1) return Tx('só na sala do chefe');
    return Tx('da {a}ª sala em diante', { a: n + 1 });
  }
  function ehColecionador(it) { return !!(it.setId && D.selos && it.setId === D.selos.setId); }
  function ondeCai(it) {
    if (!it.dungeonId) return ehColecionador(it) ? Tx('Só sai da roleta do Colecionador, trocada por Selos') : Tx('Não cai em calabouço');
    var d = dg(it.dungeonId), e = entradaSaque(it);
    var sala = textoSala(e ? e.minRoom : it.minRoom, d);
    var onde = d ? link('calabouco', d.id, contrai(DE, 'de', d.name)) : Tx('de um calabouço');
    var chance = MOSTRA_CHANCES ? ' ' + Tx('(peso no sorteio: {a})', { a: num(it.dropWeight) }) : '';
    if (d && FECHADO(d.id)) {
      return Tx('Vem {onde} (em breve). Enquanto o portal está fechado, a peça cai nos calabouços abertos, {sala}{chance}', { onde: onde, sala: sala, chance: chance });
    }
    return Tx('Cai {onde}', { onde: onde }) + ', ' + sala + chance;
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
    return { titulo: Tx('Não encontrada'), html: Tx('<h1>Página não encontrada</h1><p class="wk-sub">Este endereço não leva a nada da wiki. Volte ao <a href="#/">início</a> ou use a busca.</p>') };
  }
  function emBreve(titulo, texto, passos) {
    return { titulo: titulo, html: Tx('{a}<h1>{b}</h1><p class="wk-chips"><span class="wk-selo fechado">Em breve</span></p><div class="wk-nota">{c}</div>', { a: trilha(passos || [], titulo), b: E(titulo), c: E(texto) }) };
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
      ['#/classes', Tx('Classes'), Tx('{length} classes: os números de cada uma e como liberar', { length: chaves(CLASSES).length })],
      ['#/feiticos', Tx('Feitiços'), Tx('{nFeit} feitiços de classe, com o custo, o alcance e o efeito de cada um', { nFeit: nFeit })],
      ['#/calaboucos', Tx('Calabouços'), Tx('{length} calabouços ({abertos} abertos), com as salas, os monstros e o saque', { length: DGS.length, abertos: abertos })],
      ['#/bestiario', Tx('Bestiário'), Tx('{nMon} monstros e invocações, com a ficha e os golpes', { nMon: nMon })],
      ['#/itens', Tx('Itens'), Tx('{length} peças, com os bônus, o nível de uso e de onde caem', { length: chaves(ITENS).length })],
      ['#/conjuntos', Tx('Conjuntos'), Tx('{length} conjuntos e o bônus de cada número de peças', { length: chaves(SETS).length })],
      ['#/pets', Tx('Pets'), Tx('{length} bichos que lutam ao lado do dono', { length: chaves(PETS).length })],
      ['fusoes.html', Tx('Fusões'), Tx('{nPares} duplas de classe: dois heróis num corpo só', { nPares: nPares })],
      ['#/sistemas', Tx('Regras'), Tx('elementos, climas, dificuldade, níveis, forja, saque, guilda, arena e o resto')]
    ];
    var h = Tx('<h1>Wiki do SOTERRA</h1><p class="wk-sub">Tudo o que o jogo sabe, lido dos arquivos do próprio jogo: se um número muda lá, muda aqui no mesmo dia. Use a busca ou escolha uma seção.</p>');
    if (dia) h += '<p class="wk-chips"><span class="wk-selo wk-dia">' +
      Tx('Calabouço do Dia: {a} (+{bonus}% de saque)', { a: E(dia.nome), bonus: dia.bonus }) +
      '</span></p>';
    h += '<div class="wk-grade">' + cartoes.map(function (c) {
      return '<a class="wk-cartao grande" href="' + c[0] + '"><b>' + E(c[1]) + '</b><span class="apoio">' + E(c[2]) + '</span></a>';
    }).join('') + '</div>';
    return { titulo: '', html: h };
  }

  // ------------------------------------------------------------------ classes
  function comoLibera(id) {
    var c = CLASSES[id] || {}, k = (D.cards || {})[id] || {};
    if (c.startsUnlocked || !num(k.unlockCost)) return Tx('liberada desde o começo');
    return Tx('{a} cartas para liberar', { a: num(k.unlockCost) });
  }
  function cartaoClasse(id) {
    var c = CLASSES[id];
    return '<a class="wk-cartao" href="' + rota('classe', id) + '" data-classe="' + E(id) + '">' +
      SITE.busto({ src: SITE.img('classe', id, true), letra: SITE.inicial(c.name), cor: corClasse(id) }) +
      '<span class="wk-cartao-tx"><b>' + E(c.name) + '</b><span class="apoio">' + E(PAPEL[c.role] || '') + ' · ' +
      E(comoLibera(id)) + '</span></span></a>';
  }
  function classes() {
    var h = Tx('<h1>Classes</h1><p class="wk-sub">Cada herói é de uma classe. A classe decide a vida, os pontos de ação e de passo e os feitiços; o elemento, escolhido no nível {a}, decide o caminho de feitiços que ele segue.</p><div class="wk-grade">{b}</div>', { a: num(LV.elementChoiceLevel), b: chaves(CLASSES).map(cartaoClasse).join('') });
    return { titulo: Tx('Classes'), html: h };
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
    var h = trilha([['#/classes', Tx('Classes')]], c.name);
    h += '<header class="wk-cabeca">' +
      SITE.busto({ src: SITE.img('classe', id, true), letra: SITE.inicial(c.name), cor: corClasse(id) }) +
      '<div class="wk-cabeca-tx"><h1>' + E(c.name) + '</h1><p class="wk-chips"><span class="wk-selo">' + E(PAPEL[c.role] || '') +
      '</span><span class="wk-selo">' + E(comoLibera(id)) + '</span>' +
      (RARA[c.cardRarity] ? '<span class="wk-selo">' + Tx('carta {a}', { a: RARA[c.cardRarity] }) + '</span>' : '') + '</p>' +
      '<p>' + E(c.description) + '</p>' + (c.lore ? '<p class="wk-lore">' + E(c.lore) + '</p>' : '') + '</div></header>';

    // os números
    var linhas = [
      [Tx('PV'), num(st.hp), num(st.hp) + num(pl.hp) * antes + num(pe.hp) * depois],
      [Tx('PA'), num(st.pa), num(st.pa)],
      [Tx('PP'), num(st.pp), num(st.pp)],
      [Tx('Iniciativa'), num(st.initiative), num(st.initiative)],
      [Tx('Esquiva'), num(st.dodge), alvo.dodge != null ? num(alvo.dodge) : num(st.dodge)],
      [Tx('Fixação'), num(st.lock), alvo.lock != null ? num(alvo.lock) : num(st.lock)]
    ];
    h += Tx('<h2>Os números</h2><div class="wk-rolagem"><table class="wk-tabela"><thead><tr><th></th><th class="n">nível 1</th><th class="n">nível {maxN}</th></tr></thead><tbody>{a}<tr><td>Poder</td><td class="n">{b}</td><td class="n">+{c}, e +{d} no elemento</td></tr></tbody></table></div><p>Resistências no nível 1: {e}.</p><p class="apoio">Todo nível dá +{f} PV. Do nível 2 ao {esc}, cada nível dá +{g} de poder; do {h} ao {maxN}, dá +{i} de dano no elemento escolhido, que só vale nos feitiços desse elemento. Esquiva e fixação andam em linha reta até o número do nível {maxN}. Estrelas e equipamento somam por cima. <a href="#/sistemas/niveis">Níveis e experiência</a></p>', { maxN: maxN, a: linhas.map(function (l) {
        return '<tr><td>' + l[0] + '</td><td class="n">' + l[1] + '</td><td class="n">' + l[2] + '</td></tr>';
      }).join(''), b: num(st.power), c: num(pl.power) * antes, d: num(pe.elemPower) * depois, e: resistencias(st.resists), f: num(pl.hp), esc: esc, g: num(pl.power), h: esc + 1, i: num(pe.elemPower) });

    // como liberar e as estrelas
    h += Tx('<h2>Cartas e estrelas</h2>');
    var dgsCarta = ondeCaiCarta(id);
    h += (c.startsUnlocked
      ? '<p>' +
      Tx('{a}{b}Carta repetida não é lixo: as que passam do desbloqueio compram estrelas.', { a: c.startsUnlocked || !num(k.unlockCost) ? Tx('A classe já vem liberada. ') :
      Tx('Libera com {a} cartas da classe.', { a: num(k.unlockCost) }) + ' ', b: dgsCarta.length ? Tx('As cartas caem do chefe {a}.', { a: lista(dgsCarta.map(function (d) {
        return link('calabouco', d.id, contrai(DE, 'de', d.name));
      })) }) +
        ' ' : Tx('Nenhum calabouço aberto derruba esta carta ainda. ') }) +
      '</p>'
      : '<p>' +
      Tx('{a}{b}Também dá para liberar pela <a href="loja.html">Loja</a>. Carta repetida não é lixo: as que passam do desbloqueio compram estrelas.', { a: c.startsUnlocked || !num(k.unlockCost) ? Tx('A classe já vem liberada. ') :
      Tx('Libera com {a} cartas da classe.', { a: num(k.unlockCost) }) + ' ', b: dgsCarta.length ? Tx('As cartas caem do chefe {a}.', { a: lista(dgsCarta.map(function (d) {
        return link('calabouco', d.id, contrai(DE, 'de', d.name));
      })) }) +
        ' ' : Tx('Nenhum calabouço aberto derruba esta carta ainda. ') }) +
      '</p>');
    var S = D.stars || {}, sb = S.bonuses || {}, slots = S.elementSlots || {}, custos = k.starCosts || [];
    var estrelas = [];
    for (var n = 1; n <= num(S.max); n++) {
      var partes = bonusPartes(sb[n]);
      if (num(slots[n]) > num(slots[n - 1])) partes.push(Tx('libera o {a}º caminho de elemento', { a: num(slots[n]) }));
      estrelas.push('<tr><td>' + '★'.repeat(n) + '</td><td class="n">' + (custos[n - 1] != null ? num(custos[n - 1]) : '') +
        '</td><td>' + E(partes.join(', ')) + '</td></tr>');
    }
    if (estrelas.length) {
      h += '<div class="wk-rolagem"><table class="wk-tabela">' +
        Tx('<thead><tr><th>Estrela</th><th class="n">cartas a mais</th><th>o que dá</th></tr></thead><tbody>{a}</tbody>', { a: estrelas.join('') }) +
        '</table></div>';
    }

    // os feitiços
    var todos = feiticosDaClasse(id);
    var base = todos.filter(function (f) { return f.base; });
    h += Tx('<h2>Feitiços</h2><p class="apoio">{length} neutros desde o início; a partir do nível {esc}, o herói segue o caminho do elemento dele. Cada caminho abre um feitiço nos níveis {a}.</p>', { length: base.length, esc: esc, a: lista((D.unlockTiers || []).map(String)) });
    h += Tx('<h3>Neutros</h3><div class="wk-feiticos">{a}</div>', { a: base.map(function (f) {
      return cartaoFeitico(f.sp, { link: true, nivel: nivelFeitico(f.sp) });
    }).join('') });
    ELEMENTOS.forEach(function (el) {
      var doCaminho = todos.filter(function (f) { return !f.base && f.el === el; });
      if (!doCaminho.length) return;
      h += '<details class="wk-caminho" data-caminho="' +
        el +
        '">' +
        Tx('<summary>Caminho {a} — {length} feitiços</summary><div class="wk-feiticos">{b}</div>', { a: elem(el), length: doCaminho.length, b: doCaminho.map(function (f) {
          return cartaoFeitico(f.sp, { link: true, nivel: nivelFeitico(f.sp) });
        }).join('') }) +
        '</details>';
    });

    // as fusões da classe
    var ident = D.fusionIdentities || {};
    var pares = chaves(D.fusionForms || {}).filter(function (p) { return p.split('+').indexOf(id) >= 0; });
    if (pares.length) {
      h += Tx('<h2>Fusões</h2><p class="apoio">Com outro herói colado, os dois viram um corpo só. As duplas desta classe:</p><div class="wk-grade">{a}</div>', { a: pares.map(function (p) {
          var outro = p.split('+').filter(function (x) { return x !== id; })[0] || id;
          return '<a class="wk-cartao" href="fusoes.html#dupla=' +
            E(p) +
            '">' +
            Tx('{b}<span class="wk-cartao-tx"><b>{c}</b><span class="apoio">com {d}</span></span>', { b: SITE.busto({ src: SITE.img('fusao', p, true), reserva: SITE.img('classe', id, true), letra: SITE.inicial(SITE.semArtigo((ident[p] || {}).name || outro)), cor: corClasse(outro) }), c: E((ident[p] || {}).name || nomeClasse(outro)), d: E(nomeClasse(outro)) }) +
            '</a>';
        }).join('') });
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
        donos.push(f.base
          ? Tx('{a} (neutro)', { a: link('classe', cid, nomeClasse(cid)) })
          : Tx('{a} (caminho {b})', { a: link('classe', cid, nomeClasse(cid)), b: nomeEl(f.el) }));
      });
    });
    var sp = feitico(sid);
    if (sp && ehCarga(sp) && CLASSES[sp.classId]) {
      visivel = true;
      donos.push(Tx('carga de armadilha do {a}', { a: link('classe', sp.classId, nomeClasse(sp.classId)) }));
    }
    valores(ITENS).forEach(function (it) {
      if (it.grantsSpell === sid) { visivel = true; donos.push(Tx('o Lume {a}', { a: link('item', it.id, it.name) })); }
    });
    valores(PETS).forEach(function (p) {
      if ((p.spells || []).indexOf(sid) >= 0) { visivel = true; donos.push(Tx('o pet {a}', { a: link('pet', p.id, p.name) })); }
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
    var h = Tx('<h1>Feitiços</h1><p class="wk-sub">Os feitiços das classes: {nBase} neutros de cada uma, desde o início, e os de cada caminho de elemento, que abrem nos níveis {a}. Toque num nome para ver o feitiço inteiro.</p>{b}<div id="wk-lista"></div>', { nBase: nBase, a: lista(tiers.map(String)), b: controles([
        { k: 'classe', rotulo: Tx('Classe'), opcoes: [['', Tx('todas')]].concat(chaves(CLASSES).map(function (c) { return [c, nomeClasse(c)]; })) },
        { k: 'elemento', rotulo: Tx('Elemento'), opcoes: [['', Tx('todos')]].concat(ELEMENTOS.map(function (e) { return [e, nomeEl(e)]; })) },
        { k: 'q', rotulo: Tx('Nome ou descrição'), texto: true }
      ], params) });
    var lumes = chaves(ISPELLS).map(function (sid) {
      var it = valores(ITENS).filter(function (x) { return x.grantsSpell === sid; })[0];
      return '<li>' + link('feitico', sid, ISPELLS[sid].name) + ' ' + elem(ISPELLS[sid].element) +
        (it ? ' — ' + link('item', it.id, it.name) : '') + '</li>';
    });
    if (lumes.length) h += Tx('<h2>Feitiços dos Lumes</h2><p class="apoio">Todo Lume concede um feitiço a quem o veste.</p><ul class="wk-defs">{a}</ul>', { a: lumes.join('') });
    var dosPets = chaves(PSPELLS).map(function (sid) {
      var p = valores(PETS).filter(function (x) { return (x.spells || []).indexOf(sid) >= 0; })[0];
      return '<li>' + link('feitico', sid, PSPELLS[sid].name) + ' ' + elem(PSPELLS[sid].element) + (p ? ' — ' + link('pet', p.id, p.name) : '') + '</li>';
    });
    if (dosPets.length) h += Tx('<h2>Feitiços dos pets</h2><ul class="wk-defs">{a}</ul>', { a: dosPets.join('') });
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
      caixa.innerHTML = (todos.length === 1
        ? Tx('<p class="wk-contagem">{length} feitiço</p>{a}', { length: todos.length, a: todos.length ? '<div class="wk-rolagem"><table class="wk-tabela">' +
          Tx('<thead><tr><th>Feitiço</th><th>Classe</th><th>Elemento</th><th>Abre</th><th class="n">PA</th><th>Alcance</th></tr></thead><tbody>{a}</tbody>', { a: todos.map(function (x) {
            var sp = x.f.sp;
            return '<tr data-linha-feitico="' + E(sp.id) + '"><td>' + link('feitico', sp.id, sp.name) + '</td><td>' + link('classe', x.cid, nomeClasse(x.cid)) +
              '</td><td>' + elem(x.f.el) + '</td><td>' + E(nivelFeitico(sp)) + '</td><td class="n">' + num(sp.paCost) + '</td><td>' +
              E(alcance(sp.range, true)) + '</td></tr>';
          }).join('') }) +
          '</table></div>' : Tx('<p class="wk-vazio">Nenhum feitiço com esse filtro.</p>') })
        : Tx('<p class="wk-contagem">{length} feitiços</p>{a}', { length: todos.length, a: todos.length ? '<div class="wk-rolagem"><table class="wk-tabela">' +
          Tx('<thead><tr><th>Feitiço</th><th>Classe</th><th>Elemento</th><th>Abre</th><th class="n">PA</th><th>Alcance</th></tr></thead><tbody>{a}</tbody>', { a: todos.map(function (x) {
            var sp = x.f.sp;
            return '<tr data-linha-feitico="' + E(sp.id) + '"><td>' + link('feitico', sp.id, sp.name) + '</td><td>' + link('classe', x.cid, nomeClasse(x.cid)) +
              '</td><td>' + elem(x.f.el) + '</td><td>' + E(nivelFeitico(sp)) + '</td><td class="n">' + num(sp.paCost) + '</td><td>' +
              E(alcance(sp.range, true)) + '</td></tr>';
          }).join('') }) +
          '</table></div>' : Tx('<p class="wk-vazio">Nenhum feitiço com esse filtro.</p>') }));
    }
    return { titulo: Tx('Feitiços'), html: h, depois: function (caixa) { pinta(params); ligaFiltros(caixa, 'feiticos', pinta); } };
  }
  function feiticoPag(id) {
    var sp = feitico(id);
    if (!sp) return naoAchou();
    var donos = donosDoFeitico(id);
    if (!donos.visivel) return emBreve(sp.name, Tx('Quem usa este golpe mora num calabouço que ainda não abriu.'), [['#/feiticos', Tx('Feitiços')]]);
    var nivel = SPELLS[id] && !ehCarga(sp) && sp.classId ? nivelFeitico(sp) : '';
    var h = trilha([['#/feiticos', Tx('Feitiços')]], sp.name) + '<h1>' + E(sp.name) + '</h1>' +
      '<p class="apoio">' + Tx('De {a}.', { a: lista(donos.lista) }) + '</p><div class="wk-feiticos">' + cartaoFeitico(sp, { nivel: nivel }) + '</div>';
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
  /* O MAPINHA DA SALA. `duelo` troca a leitura das letras: num tabuleiro de PvP
   * (DATA.arenas) a minúscula não é monstro, é o nascimento do lado B. */
  function mapa(sala, duelo) {
    var L = sala.layout || [], mons = sala.monsters || {};
    var larg = L.reduce(function (a, l) { return Math.max(a, l.length); }, 0);
    var cel = [];
    L.forEach(function (linha) {
      for (var x = 0; x < larg; x++) {
        var ch = linha.charAt(x) || '~', cls = 'chao', extra = '';
        if (ch === '#') cls = 'alto';
        else if (ch === '=') cls = 'baixo';
        else if (ch === '~') cls = 'vazio';
        else if (ch === 'P') cls = duelo ? 'heroi' : 'heroi';
        else if (duelo && ch >= 'a' && ch <= 'z') cls = 'ladob';
        else if (own.call(mons, ch)) {
          var m = monstroDe(mons[ch]);
          cls = 'bicho' + (m && m.boss ? ' chefe' : '');
          if (m) extra = estiloCor(corEl(m.element)) + ' title="' + E(m.name) + '"';
        }
        cel.push('<i class="' + cls + '"' + extra + '></i>');
      }
    });
    return '<div class="wk-mapa" data-mapa="' + E(sala.name) + '" style="--larg:' + larg + '" role="img" aria-label="' +
      (duelo ? Tx('Mapa do tabuleiro {a}', { a: E(sala.name) }) : Tx('Mapa da sala {a}', { a: E(sala.name) })) + '">' + cel.join('') + '</div>';
  }
  function legendaCel(cor, txt) {
    return '<span><i style="' + cor + '"></i>' + txt + '</span>';
  }
  /* A legenda entra UMA vez por página, junto do primeiro mapinha — e a linha de
   * quem nasce muda conforme o tabuleiro seja de monstro ou de duelo. */
  function legenda(duelo) {
    return '<p class="wk-legenda">' +
      legendaCel('background:#2a3139', Tx('chão')) +
      legendaCel('background:#5b4a36', Tx('parede (tapa a visão)')) +
      legendaCel('background:#8a6f45', Tx('mureta (não passa, mas dá para mirar por cima)')) +
      legendaCel('background:transparent;border:1px dashed #555', Tx('buraco')) +
      (duelo
        ? legendaCel('background:#ffc44d', Tx('nasce o lado de quem chama')) +
          legendaCel('background:#6fb1ff', Tx('nasce o lado de quem aceita'))
        : legendaCel('background:#ffc44d', Tx('onde os heróis nascem')) +
          legendaCel('background:#e05a4f;border-radius:50%', Tx('monstro'))) +
      '</p>';
  }
  var LEGENDA = legenda(false);
  /* O BLOCO DE SALA — o padrão da wiki, um só, para TODO lugar onde se luta:
   * título, mapinha, clima e quem está lá dentro. As salas dos calabouços, a
   * Praça e o Salão da Sede usam este mesmo bloco (21/09, pedido do dono:
   * "mantenha o padrão das salas com os mapinhas... nem todos têm"). */
  function blocoSala(sala, o) {
    o = o || {};
    var elenco = o.elenco != null ? o.elenco : contaBichos(sala).map(function (b) {
      var m = MONSTROS[b.id];
      return '<li>' + (m ? link('monstro', b.id, m.name) + ' ' + elem(m.element) + (m.boss ? ' <span class="wk-selo chefe">' + Tx('chefe') + '</span>' : '') : E(b.id)) +
        (b.n > 1 ? ' ×' + b.n : '') + '</li>';
    }).join('');
    return '<section class="wk-sala">' +
      Tx('{a}<div class="wk-sala-corpo">{b}<div><p class="apoio">Clima: {c}</p>{d}{e}{f}</div></div>{g}', { a: o.titulo ? '<h3>' + o.titulo + '</h3>' : '', b: mapa(sala, o.duelo), c: E(nomeClima(sala.weather)), d: o.antes || '', e: elenco ? '<ul class="wk-bichos">' + elenco + '</ul>' : '', f: o.depois || '', g: o.legenda ? legenda(o.duelo) : '' }) +
      '</section>';
  }
  function cartaoDg(d, dia) {
    var fechado = FECHADO(d.id);
    return (fechado
      ? (dia && dia.id === d.id ? '<a class="wk-cartao grande" href="' +
      rota('calabouco', d.id) +
      '" data-calabouco="' +
      E(d.id) +
      '">' +
      Tx('<b>{c}</b><span class="wk-chips"><span class="wk-selo fechado">Em breve</span><span class="wk-selo wk-dia">Calabouço do Dia</span><span class="wk-selo">nível {d}</span></span><span class="apoio">{e}</span>', { c: E(d.name), d: num(d.recommendedLevel), e: E(d.description) }) +
      '</a>' : '<a class="wk-cartao grande" href="' +
      rota('calabouco', d.id) +
      '" data-calabouco="' +
      E(d.id) +
      '">' +
      Tx('<b>{c}</b><span class="wk-chips"><span class="wk-selo fechado">Em breve</span><span class="wk-selo">nível {d}</span></span><span class="apoio">{e}</span>', { c: E(d.name), d: num(d.recommendedLevel), e: E(d.description) }) +
      '</a>')
      : (dia && dia.id === d.id ? '<a class="wk-cartao grande" href="' +
      rota('calabouco', d.id) +
      '" data-calabouco="' +
      E(d.id) +
      '">' +
      Tx('<b>{c}</b><span class="wk-chips"><span class="wk-selo aberto">Aberto</span><span class="wk-selo wk-dia">Calabouço do Dia</span><span class="wk-selo">nível {d}</span></span><span class="apoio">{e}</span>', { c: E(d.name), d: num(d.recommendedLevel), e: E(d.description) }) +
      '</a>' : '<a class="wk-cartao grande" href="' +
      rota('calabouco', d.id) +
      '" data-calabouco="' +
      E(d.id) +
      '">' +
      Tx('<b>{c}</b><span class="wk-chips"><span class="wk-selo aberto">Aberto</span><span class="wk-selo">nível {d}</span></span><span class="apoio">{e}</span>', { c: E(d.name), d: num(d.recommendedLevel), e: E(d.description) }) +
      '</a>'));
  }
  /* OS OUTROS TABULEIROS (21/09): tudo onde se luta e que não é calabouço. Cada um
   * tem a MESMA anatomia de página de calabouço — cabeça, mapinha da sala, legenda —
   * porque era o que faltava: a Praça e o Salão da Sede não apareciam em lugar nenhum
   * da wiki, e o Poço aparecia só como parágrafo de regra. */
  function tabuleiros() {
    var Po = JG.Poco, out = [];
    var pr = arena('praca'), se = arena('sede');
    if (pr) out.push({ id: 'praca', nome: pr.name, selo: Tx('desafio amistoso'),
      resumo: Tx('A praça da Árvore-Mundo virada em tabuleiro: é aqui que acontece o desafio entre dois jogadores que se encontram no Acampamento. Não vale coroa.') });
    if (se) out.push({ id: 'sede', nome: se.name, selo: Tx('guerra de guilda'),
      resumo: Tx('O salão do trono da Sede, onde duas guildas medem forças 2×2 — quatro heróis de cada lado, as duplas por fila.') });
    if (Po) out.push({ id: 'poco', nome: Tx('O Poço sem Fundo'), selo: Tx('na praça'),
      resumo: Tx('A torre infinita: cada andar é uma sala emprestada de um calabouço, andar após andar, cada vez mais dura.') });
    // 02/10: a arena do chefe supremo da semana
    var ce = D.eco ? arena(D.eco.arena) : null;
    if (ce) out.push({ id: ce.id, nome: ce.name, selo: Tx('chefe supremo da semana'),
      resumo: Tx('A arena do Eco Primordial: 12 rodadas para tirar dele o máximo de dano. O placar é semanal, conferido pelo servidor, e o pódio leva prêmio.') });
    // 03/10: os calabouços especiais — a porta fica no cais do Acampamento, não num portal
    ESPECIAIS.forEach(function (e) {
      out.push({ id: e.id, nome: e.name, selo: Tx('calabouço especial'),
        resumo: Tx('Cinco salas sem chefe, para quem já chegou ao fim: cada uma tem uma regra de terreno ligada a um elemento — o escuro, a água, os pilares que andam, o vento — e a última junta as quatro em volta do altar.') });
    });
    return out;
  }
  function calaboucos() {
    var dia = diaHoje();
    var h = Tx('<h1>Calabouços</h1><p class="wk-sub">Os portais do Acampamento levam aos calabouços. Cada descida é uma fila de salas; a última tem o chefe. O nível recomendado é onde a experiência rende inteira.</p><div class="wk-grade">{a}</div>', { a: DGS.map(function (d) { return cartaoDg(d, dia); }).join('') });
    if (dia) h += '<p class="apoio">' +
      Tx('Todo dia um calabouço aberto é o <b>Calabouço do Dia</b> e paga +{bonus}% de saque. Hoje: {a}.', { bonus: dia.bonus, a: link('calabouco', dia.id, dia.nome) }) +
      '</p>';
    var outros = tabuleiros();
    if (outros.length) {
      h += Tx('<h2>Os outros tabuleiros</h2><p class="wk-sub">Nem tudo o que se joga é calabouço. Estes são os outros lugares com mapa próprio.</p><div class="wk-grade">{a}</div>', { a: outros.map(function (t) {
          return '<a class="wk-cartao grande" href="' + rota('tabuleiro', t.id) + '" data-tabuleiro="' + E(t.id) + '"><b>' + E(t.nome) + '</b>' +
            '<span class="wk-chips"><span class="wk-selo">' + E(t.selo) + '</span></span><span class="apoio">' + E(t.resumo) + '</span></a>';
        }).join('') });
    }
    return { titulo: Tx('Calabouços'), html: h };
  }
  /* A página de um tabuleiro que não é calabouço. Mesmo esqueleto do calabouço:
   * trilha, cabeça com selos, e o bloco de sala com o mapinha e a legenda. */
  function tabuleiro(id) {
    var t = null, lista = tabuleiros(), i;
    for (i = 0; i < lista.length; i++) if (lista[i].id === id) t = lista[i];
    if (!t) return naoAchou();
    var h = trilha([['#/calaboucos', Tx('Calabouços')]], t.nome) +
      '<header class="wk-cabeca"><div class="wk-cabeca-tx"><h1>' + E(t.nome) + '</h1><p class="wk-chips">' +
      '<span class="wk-selo aberto">' + E(t.selo) + '</span>';

    if (id === 'poco') {
      var Po = JG.Po || JG.Poco;
      h += Tx('<span class="wk-selo">sozinho</span><span class="wk-selo">+{a} por andar</span></p><p>{b}</p>', { a: pct(Po.FATOR_POR_ANDAR), b: E(t.resumo) }) +
        '</div></header>';
      // O Poço não tem mapa PRÓPRIO: ele empresta as salas dos calabouços abertos.
      // Mostrar um mapa inventado mentiria — o que a página mostra é de onde vêm.
      h += '<div class="wk-nota">' +
        Tx('O Poço não tem sala própria: cada andar é sorteado entre as salas dos calabouços <b>abertos</b>, com o elenco remontado e mais duro. Os mapas são os mesmos das páginas dos calabouços.') +
        '</div>';
      var abertas = DGS.filter(function (d) { return !FECHADO(d.id); });
      h += Tx('<p>Hoje o Poço pode sortear <b>{a} salas</b>, de {length} calabouços:</p><ul class="wk-defs">{b}</ul>', { a: abertas.reduce(function (a, d) { return a + (d.rooms || []).length; }, 0), length: abertas.length, b: abertas.map(function (d) {
          return '<li>' + link('calabouco', d.id, d.name) + ' — ' + (d.rooms || []).map(function (r) { return E(r.name); }).join(' · ') + '</li>';
        }).join('') });
      h += '<p class="apoio">' +
        Tx('Cada andar a mais deixa os monstros {a} mais duros, e a cada {b} andares vem um chefe. O recorde da semana fica anotado. Mais em <a href="{c}">Regras → O Poço sem Fundo</a>.', { a: pct(Po.FATOR_POR_ANDAR), b: num(Po.CHEFE_A_CADA), c: rota('sistemas', 'poco') }) +
        '</p>';
      return { titulo: t.nome, html: h };
    }

    if (especial(id)) {
      // 03/10: o Santuário dos Elementos. Os números das regras saem de DATA.santuario (o mesmo dado que o
      // motor e o juiz leem): mudou o dado, mudou a frase.
      var es = especial(id), S = D.santuario || {};
      var esc = S.escuro || {}, ag = S.agua || {}, pil = S.pilares || {}, ve = S.vento || {};
      var REGRA = {
        fogo: Tx('Escuro. Quem <b>não</b> é do caminho do <b>Fogo</b> só mira uma casa escura a <b>{a}</b>, e não vê o monstro que está no breu. O braseiro aceso clareia {b} em volta: um golpe de Fogo acende, um de Água apaga.', { a: casas(esc.visao), b: casas(esc.raio) }),
        agua: Tx('Entrar numa casa com água custa <b>{a} PP</b> ({b} para quem é do caminho da <b>Água</b>). No fim de cada rodada a correnteza leva 1 casa quem está na água; ela troca de direção a cada {c} rodadas, e a bica que vai verter avisa antes. A ponte é seca.', { a: num(ag.custo), b: num(ag.custoAgua), c: num(ag.trocaACada) }),
        terra: Tx('Os pilares <b>sobem e descem a cada {a} rodadas</b>, avisados uma rodada antes (▲ vai subir, ▼ vai descer). Pilar de pé fecha o caminho e a visão. Ninguém é esmagado: quem está em cima do soquete segura o pilar até sair — e nunca se fecha o único caminho.', { a: num(pil.periodo) }),
        ar: Tx('No fim de cada rodada a <b>rajada</b> empurra todo mundo 1 casa para onde o cata-vento aponta; ela gira a cada {a} rodadas, avisada antes. Feitiço de <b>Ar</b> lançado do terraço alcança {b} a mais. Ao lado de um respiro o vento não pega.', { a: num(ve.giraACada), b: casas(ve.alcance) }),
        altar: Tx('As quatro regras de uma vez, cada uma no seu canto: escuro a noroeste, água a nordeste, pilares a sudoeste e vento a sudeste, em volta do altar.')
      };
      h += Tx('<span class="wk-selo">nível recomendado {a}</span><span class="wk-selo">{length} salas, sem chefe</span></p><p>{b}</p>', { a: num(es.recommendedLevel), length: (es.rooms || []).length, b: E(es.description) }) +
        '</div></header>';
      h += '<div class="wk-nota">' +
        Tx('A porta fica no <b>cais do Acampamento</b> (o botão Santuário), não num portal. A descida é a de qualquer calabouço: sozinho, com dois heróis ou em dupla pela Rede; a vida atravessa de uma sala para a outra. Não há armadilha no chão, e nenhuma regra acontece sem aviso: o que muda no mapa é avisado na rodada anterior.') +
        '</div>';
      h += Tx('<h2>As salas</h2>');
      (es.rooms || []).forEach(function (s, i) {
        var regra = s.santuario && s.santuario.regra;
        h += blocoSala(s, {
          titulo: Tx('Sala {a} — {b}{c}', { a: i + 1, b: E(s.name), c: ELINFO[regra] ? ' ' + elem(regra) : '' }),
          legenda: i === 0,
          antes: REGRA[regra] ? '<p>' + Tx('<b>A regra.</b> {a}', { a: REGRA[regra] }) + '</p>' : ''
        });
      });
      var fonte = dg(es.saqueDe), guard = valores(MONSTROS).filter(function (m) { return m.dungeonId === id; });
      var itensS = [];
      if (fonte) {
        itensS.push('<li>' +
          Tx('<b>Peças</b>: as mesmas {a}. Nas quatro primeiras salas, comuns e raras; no Altar, dois sorteios, com épicas e lendárias.', { a: link('calabouco', fonte.id, contrai(DE, 'de', fonte.name)) }) +
          '</li>');
      }
      var sdS = guard[0] && guard[0].stoneDrop;
      if (sdS) {
        itensS.push('<li>' +
          Tx('<b>Pedras de forja</b>: cada guardião deixa a do elemento dele, de {a} a {b}{c} — é o que o Santuário paga a mais.', { a: num(sdS.min), b: num(sdS.max), c: MOSTRA_CHANCES ? ' (' + pct(sdS.chance) + ')' : '' }) +
          '</li>');
      }
      itensS.push(Tx('<li>Sem chefe, não há selo, insígnia, âncora nem carta: isso continua sendo dos chefes dos seis calabouços.</li>'));
      h += Tx('<h2>O que cai</h2><ul class="wk-defs">{a}</ul>', { a: itensS.join('') });
      return { titulo: t.nome, html: h };
    }

    var a = arena(id);
    var sala = (a.rooms || [])[0];
    if (a.modo === 'eco' && D.eco) {
      // 02/10: a Câmara do Eco — PvE: a letra É o Eco, e as regras moram em js/core/data/eco.js
      var C = D.eco, eco = monstroDe(C.chefe) || {};
      h += Tx('<span class="wk-selo">{a} rodadas</span><span class="wk-selo">{b} tentativas por dia</span></p><p>{c}</p>', { a: num(C.rodadas), b: num(C.tentativasPorDia), c: E(t.resumo) }) +
        '</div></header>';
      h += Tx('<h2>O tabuleiro</h2>{a}', { a: blocoSala(sala, {
        titulo: E(sala.name), legenda: true,
        elenco: Tx('<li><b>{a}</b> {b} <span class="wk-selo chefe">chefe supremo</span> · {c} PV · ocupa 2×2 casas e não anda</li>{d}', { a: E(eco.name || C.chefe), b: elem(eco.element), c: num(eco.stats && eco.stats.hp), d: ['fogo', 'agua', 'terra', 'ar'].map(function (el) {
            var mn = monstroDe((C.menores || {})[el]);
            return mn ? '<li>' + Tx('{a} {b} — chamado na troca para {c}', { a: E(mn.name), b: elem(mn.element), c: E(nomeEl(el)) }) + '</li>' : '';
          }).join('') }),
        depois: '<p class="apoio">' +
          Tx('A cada 25% da vida perdida ele troca de elemento (Fogo → Água → Terra → Ar), fica fraco a quem vence o elemento novo e chama dois Ecos Menores. O golpe grande é avisado: as casas marcadas no chão explodem na vez seguinte dele, e os pilares altos abrigam. Derrubá-lo soma {a}% da vida dele aos pontos.', { a: Math.round((C.bonusDerrubada || 0) * 100) }) +
          '</p>'
      }) });
      h += Tx('<p class="apoio">O placar da semana: <a href="ranking.html#eco">Ranking → O Eco Primordial</a>.</p>');
      return { titulo: t.nome, html: h };
    }
    h += '<span class="wk-selo">' + Tx('clima: {a}', { a: E(nomeClima(a.defaultWeather)) }) + '</span>' +
      (sala ? '<span class="wk-selo">' + Tx('{length}×{a} casas', { length: (sala.layout[0] || '').length, a: sala.layout.length }) + '</span>' : '') +
      '</p><p>' + E(t.resumo) + '</p></div></header>';
    if (sala) {
      h += Tx('<h2>O tabuleiro</h2>{a}', { a: blocoSala(sala, {
        titulo: E(sala.name),
        duelo: true,
        legenda: true,
        elenco: '',
        depois: (id === 'sede'
          ? '<p class="apoio">' + Tx('Quatro nascimentos de cada lado: as duas duplas de cada guilda entram pela sua ponta do salão.') + '</p>'
          : '<p class="apoio">' +
          Tx('Sem monstros: quem está no tabuleiro são os heróis dos dois jogadores. A Árvore-Mundo no centro tapa a visão, e as barracas e os bancos servem de cobertura baixa.') +
          '</p>')
      }) });
    }
    h += (id === 'sede'
      ? '<p class="apoio">' +
      Tx('Como se chega até aqui: <a href="{a}">Regras → Guilda</a>.', { a: rota('sistemas', id === 'sede' ? 'guilda' : 'arena') }) +
      '</p>'
      : '<p class="apoio">' +
      Tx('Como se chega até aqui: <a href="{a}">Regras → Arena e Brasa</a>.', { a: rota('sistemas', id === 'sede' ? 'guilda' : 'arena') }) +
      '</p>');
    return { titulo: t.nome, html: h };
  }
  function calabouco(id) {
    if (especial(id)) return tabuleiro(id);          // 03/10: o especial tem página de tabuleiro
    var d = dg(id);
    if (!d) return naoAchou();
    var fechado = FECHADO(id), dia = diaHoje();
    var h = trilha([['#/calaboucos', Tx('Calabouços')]], d.name);
    h += (fechado
      ? '<header class="wk-cabeca"><div class="wk-cabeca-tx">' +
      Tx('<h1>{a}</h1><p class="wk-chips"><span class="wk-selo fechado">Em breve</span>{b}<span class="wk-selo">nível recomendado {c}</span><span class="wk-selo">clima: {d}</span></p><p>{e}</p>', { a: E(d.name), b: dia && dia.id === id ? '<span class="wk-selo wk-dia">' + Tx('Calabouço do Dia: +{bonus}% de saque', { bonus: dia.bonus }) + '</span>' : '', c: num(d.recommendedLevel), d: E(nomeClima(d.defaultWeather)), e: E(d.description) }) +
      '</div></header>'
      : '<header class="wk-cabeca"><div class="wk-cabeca-tx">' +
      Tx('<h1>{a}</h1><p class="wk-chips"><span class="wk-selo aberto">Aberto</span>{b}<span class="wk-selo">nível recomendado {c}</span><span class="wk-selo">clima: {d}</span></p><p>{e}</p>', { a: E(d.name), b: dia && dia.id === id ? '<span class="wk-selo wk-dia">' + Tx('Calabouço do Dia: +{bonus}% de saque', { bonus: dia.bonus }) + '</span>' : '', c: num(d.recommendedLevel), d: E(nomeClima(d.defaultWeather)), e: E(d.description) }) +
      '</div></header>');
    if (fechado) {
      h += Tx('<div class="wk-nota">O portal deste calabouço ainda está fechado no Acampamento. As salas e os monstros aparecem aqui quando ele abrir. As peças dele já caem nos calabouços abertos.</div>');
    } else {
      h += Tx('<h2>As salas</h2>');
      (d.rooms || []).forEach(function (s, i) {
        var ult = i === d.rooms.length - 1;
        h += blocoSala(s, {
          titulo: (ult
            ? Tx('Sala {a} — {b} <span class="wk-selo chefe">chefe</span>', { a: i + 1, b: E(s.name) })
            : Tx('Sala {a} — {b}', { a: i + 1, b: E(s.name) })),
          legenda: i === 0
        });
      });
    }
    // o saque
    var pecas = valores(ITENS).filter(function (it) { return it.dungeonId === id; });
    if (pecas.length) {
      h += (fechado
        ? Tx('<h2>As peças</h2><p class="apoio">Enquanto o portal está fechado, estas peças caem nos calabouços abertos.</p>')
        : Tx('<h2>As peças</h2><p class="apoio">O que pode cair nas salas daqui. As mais raras só a partir de certa sala.</p>'));
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
        itens.push('<li>' +
          Tx('<b>Pedras de forja</b>: {a} — cada monstro deixa a do próprio elemento{b}.', { a: lista(pedrasTxt), b: sd ? Tx('; o chefe, sempre, de {a} a {b}', { a: num(sd.min), b: num(sd.max) }) : '' }) +
          '</li>');
      }
      var U = D.upgrade || {}, anc = PEDRAS[U.guardStone];
      if (anc && num((U.guardDropByDungeon || {})[id]) > 0) {
        itens.push('<li>' +
          Tx('<b>{a}</b>: o chefe pode derrubar{b}.', { a: E(anc.name), b: MOSTRA_CHANCES ? ' (' + pct(U.guardDropByDungeon[id]) + ')' : '' }) +
          '</li>');
      }
      chefes.forEach(function (m) {
        if (D.selos) itens.push('<li>' +
          Tx('<b>Selo do Colecionador</b> {a}: {b} pode derrubar o do elemento dele{c}.', { a: elem(m.element), b: link('monstro', m.id, m.name), c: MOSTRA_CHANCES ? ' (' + pct(D.selos.chance) + ')' : '' }) +
          '</li>');
      });
      if (chefes.length && D.insignias) {
        itens.push('<li>' +
          Tx('<b>Insígnia de Fundação</b>: o chefe pode derrubar — é a moeda que funda guildas{a}.', { a: MOSTRA_CHANCES ? ' (' + pct(D.insignias.chance) + ')' : '' }) +
          '</li>');
      }
      var cartas = (d.cardDrops || []).filter(function (c) { return c && CLASSES[c.classId] && num(c.weight) > 0; });
      if (cartas.length) {
        itens.push('<li>' +
          Tx('<b>Cartas de classe</b>: {a}.', { a: lista(cartas.map(function (c) {
          return link('classe', c.classId, nomeClasse(c.classId)) + (MOSTRA_CHANCES ? ' (' + num(c.weight) + '%)' : '');
        })) }) +
          '</li>');
      }
      valores(PETS).filter(function (p) { return p.dropDungeon === id; }).forEach(function (p) {
        itens.push('<li>' + Tx('<b>Cartas de pet</b>: o chefe pode derrubar cartas do pet {a}.', { a: link('pet', p.id, p.name) }) + '</li>');
      });
      if (itens.length) h += Tx('<h2>O que mais cai</h2><ul class="wk-defs">{a}</ul>', { a: itens.join('') });
    }
    return { titulo: d.name, html: h };
  }

  // ------------------------------------------------------------------ bestiário
  function cartaoMonstro(m) {
    return (m.boss
      ? '<a class="wk-cartao" href="' +
      rota('monstro', m.id) +
      '" data-monstro="' +
      E(m.id) +
      '">' +
      Tx('{c}<span class="wk-cartao-tx"><b>{d}</b><span class="apoio">{e} <span class="wk-selo chefe">chefe</span> {f} PV{g}</span></span>', { c: bustoMonstro(m), d: E(m.name), e: elem(m.element), f: num(m.stats && m.stats.hp), g: m.family ? ' · ' + E(m.family) : '' }) +
      '</a>'
      : '<a class="wk-cartao" href="' +
      rota('monstro', m.id) +
      '" data-monstro="' +
      E(m.id) +
      '">' +
      Tx('{c}<span class="wk-cartao-tx"><b>{d}</b><span class="apoio">{e} {f} PV{g}</span></span>', { c: bustoMonstro(m), d: E(m.name), e: elem(m.element), f: num(m.stats && m.stats.hp), g: m.family ? ' · ' + E(m.family) : '' }) +
      '</a>');
  }
  function ordemBichos(a, b) {
    function peso(m) { return m.boss ? 2 : (m.summonOnly ? 1 : 0); }
    return peso(a) - peso(b) || String(a.name).localeCompare(String(b.name), 'pt');
  }
  function bestiario() {
    var h = Tx('<h1>Bestiário</h1><p class="wk-sub">Os monstros de cada calabouço aberto, os que só surgem de outro monstro e as invocações dos heróis. A vida e o poder já estão na escala do andar deles.</p>');
    DGS.forEach(function (d) {
      if (!aberto(d.id)) return;
      var lista2 = valores(MONSTROS).filter(function (m) { return m.dungeonId === d.id; }).sort(ordemBichos);
      if (!lista2.length) return;
      h += '<h2>' + link('calabouco', d.id, d.name) + '</h2><div class="wk-grade">' + lista2.map(cartaoMonstro).join('') + '</div>';
    });
    // 02/10: os Colossos do Poço também não têm calabouço — e não são invocação de herói
    var col = valores(MONSTROS).filter(function (m) { return m.colosso; }).sort(ordemBichos);
    if (col.length) h += Tx('<h2>Colossos do Poço</h2><div class="wk-grade">{a}</div>', { a: col.map(cartaoMonstro).join('') });
    var inv = valores(MONSTROS).filter(function (m) { return !m.dungeonId && !m.colosso; }).sort(ordemBichos);
    if (inv.length) h += Tx('<h2>Invocações dos heróis</h2><div class="wk-grade">{a}</div>', { a: inv.map(cartaoMonstro).join('') });
    /* 03/10: os guardiões dos calabouços especiais não entram na grade ainda — cada cartão daqui mostra o
     * retrato tirado do 3D do jogo (tools/retratos_site.py), e a arte deles chega em outro lote. Enquanto
     * isso a lista deles está na página do lugar, e cada um tem a ficha inteira. */
    ESPECIAIS.forEach(function (e) {
      var gs = valores(MONSTROS).filter(function (m) { return m.dungeonId === e.id; }).sort(ordemBichos);
      if (!gs.length) return;
      h += Tx('<h2>{a}</h2><p class="apoio">Os {length} guardiões: {b}.</p>', { a: link('tabuleiro', e.id, e.name), length: gs.length, b: lista(gs.map(function (m) { return link('monstro', m.id, m.name); })) });
    });
    var fechados = DGS.filter(function (d) { return !aberto(d.id); });
    if (fechados.length) {
      h += '<div class="wk-nota">' +
        Tx('Em breve: os monstros {a} aparecem aqui quando o portal abrir.', { a: lista(fechados.map(function (d) { return contrai(DE, 'de', d.name); }).map(E)) }) +
        '</div>';
    }
    return { titulo: Tx('Bestiário'), html: h };
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
        achados.push(Tx('{a} (ao morrer)', { a: link('monstro', m.id, m.name) }));
      }
    });
    return achados;
  }
  function monstro(id) {
    var m = MONSTROS[id];
    if (!m) return naoAchou();
    if (!monstroVisivel(m)) return emBreve(m.name, Tx('Este monstro mora {a}, que ainda não abriu.', { a: contrai(EM, 'em', nomeDg(m.dungeonId)) }), [['#/bestiario', Tx('Bestiário')]]);
    var st = m.stats || {};
    var h = trilha([['#/bestiario', Tx('Bestiário')]], m.name);
    var sabor = String(m.flavor || ''), jeito = '';
    var mg = /^GIMMICK\s*[—-]\s*/.exec(sabor);
    if (mg) { jeito = sabor.slice(mg[0].length); sabor = ''; }
    h += '<header class="wk-cabeca">' + bustoMonstro(m) + '<div class="wk-cabeca-tx"><h1>' + E(m.name) + '</h1><p class="wk-chips">' + elem(m.element) +
      (m.boss ? '<span class="wk-selo chefe">' + Tx('chefe') + '</span>' : '') + (m.family ? '<span class="wk-selo">' + E(m.family) + '</span>' : '') +
      (IA[m.ai] && m.ai !== 'boss' ? '<span class="wk-selo">' + IA[m.ai] + '</span>' : '') +
      (m.dungeonId ? '<span class="wk-selo">' + linkLugar(m.dungeonId) + '</span>' : '') +
      (m.colosso ? '<span class="wk-selo">' + link('tabuleiro', 'poco', Tx('O Poço sem Fundo')) + '</span>' : '') + '</p>' +
      '<p>' + E(m.description) + '</p>' + (sabor ? '<p class="wk-lore">' + E(sabor) + '</p>' : '') + '</div></header>';
    if (jeito) h += '<div class="wk-nota">' + Tx('<b>Como luta.</b> {a}', { a: E(jeito) }) + '</div>';
    h += Tx('<h2>A ficha</h2><div class="wk-rolagem"><table class="wk-tabela"><tbody>{a}</tbody></table></div><p>Resistências: {b}.</p>', { a: [[Tx('PV'), st.hp], [Tx('PA'), st.pa], [Tx('PP'), st.pp], [Tx('Iniciativa'), st.initiative], [Tx('Poder'), st.power], [Tx('Esquiva'), st.dodge], [Tx('Fixação'), st.lock]]
        .map(function (l) { return '<tr><td>' + l[0] + '</td><td class="n">' + num(l[1]) + '</td></tr>'; }).join(''), b: resistencias(st.resists) });
    if (m.xp) h += '<p class="apoio">' + Tx('Vale {a} de experiência (a sala soma a de todos e divide pelo grupo).', { a: SITE.decimal(m.xp) }) + '</p>';
    if ((m.traits || []).length) h += Tx('<h2>Traços</h2><ul class="wk-defs">{a}</ul>', { a: m.traits.map(function (t) { return '<li>' + efeito(t) + '</li>'; }).join('') });
    var golpes = (m.spells || []).map(function (sid) { return MSPELLS[sid] || feitico(sid); }).filter(Boolean);
    if (golpes.length) h += Tx('<h2>Golpes</h2><div class="wk-feiticos">{a}</div>', { a: golpes.map(function (sp) { return cartaoFeitico(sp); }).join('') });
    var onde = [];
    DGS.forEach(function (d) {
      (d.rooms || []).forEach(function (s, i) {
        contaBichos(s).forEach(function (b) {
          if (b.id === id && aberto(d.id)) onde.push(Tx('{a}, sala {n} ({b})', { a: link('calabouco', d.id, d.name), n: i + 1, b: E(s.name) }) + (b.n > 1 ? ' ×' + b.n : ''));
        });
      });
    });
    ESPECIAIS.forEach(function (d) {
      (d.rooms || []).forEach(function (s, i) {
        contaBichos(s).forEach(function (b) {
          if (b.id === id) onde.push(Tx('{a}, sala {n} ({b})', { a: link('tabuleiro', d.id, d.name), n: i + 1, b: E(s.name) }) + (b.n > 1 ? ' ×' + b.n : ''));
        });
      });
    });
    var por = invocadoPor(id);
    if (onde.length || por.length) {
      h += Tx('<h2>Onde aparece</h2><ul class="wk-defs">{a}{b}</ul>', { a: onde.map(function (o) { return '<li>' + o + '</li>'; }).join(''), b: por.length ? '<li>' + Tx('Surge por {a}.', { a: lista(por) }) + '</li>' : '' });
    }
    if (m.stoneDrop) {
      var p = pedraDe(m.element);
      h += '<p class="apoio">' +
        Tx('Pode deixar {a}{b} {c}{d}.', { a: num(m.stoneDrop.min), b: num(m.stoneDrop.max) !== num(m.stoneDrop.min) ? Tx(' a {a}', { a: num(m.stoneDrop.max) }) : '', c: p ? E(p.name) : Tx('pedras'), d: MOSTRA_CHANCES ? ' (' + pct(m.stoneDrop.chance) + ')' : '' }) +
        '</p>';
    }
    return { titulo: m.name, html: h };
  }

  // ------------------------------------------------------------------ itens
  function resumoItem(it) {
    var p = bonusPartes(it.bonuses);
    if (it.grantsSpell && feitico(it.grantsSpell)) p.push(Tx('feitiço {name}', { name: feitico(it.grantsSpell).name }));
    return p.join(', ');
  }
  function linhaItem(it, semCalabouco) {
    var esp = ESPACO[it.slot];
    return '<a class="wk-linha" href="' + rota('item', it.id) + '" data-item="' + E(it.id) + '">' + iconeItem(it) +
      '<span class="wk-linha-tx"><b>' + E(it.name) + '</b><span class="apoio">' + rar(it.rarity) + ' ' + (esp ? E(esp.nome) : '') +
      (num(it.nivelUso) ? ' ' + Tx('· nível {a}', { a: num(it.nivelUso) }) : '') +
      (!semCalabouco && it.dungeonId ? ' · ' + E(SITE.semArtigo(nomeDg(it.dungeonId))) : (!it.dungeonId && ehColecionador(it) ? ' · ' + Tx('roleta') : '')) +
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
    var opcDg = [['', Tx('todos')]].concat(DGS.map(function (d) { return [d.id, SITE.semArtigo(d.name) + (FECHADO(d.id) ? Tx(' (em breve)') : '')]; }));
    if (valores(ITENS).some(ehColecionador)) opcDg.push(['roleta', Tx('Roleta do Colecionador')]);
    var h = Tx('<h1>Itens</h1><p class="wk-sub">Quatro espaços no herói: {a}. A raridade diz quanto custa achar a peça; o poder cresce com a profundidade do calabouço. Cada peça pede um nível para ser vestida.</p>{b}<div id="wk-lista"></div>', { a: lista(ORDEM_ESPACO.map(function (s) {
      return '<b>' + ESPACO[s].nome + '</b> (' + ESPACO[s].diz + ')';
    })), b: controles([
        { k: 'espaco', rotulo: Tx('Espaço'), opcoes: [['', Tx('todos')]].concat(ORDEM_ESPACO.map(function (s) { return [s, ESPACO[s].nome]; })) },
        { k: 'raridade', rotulo: Tx('Raridade'), opcoes: [['', Tx('todas')]].concat(ORDEM_RAR.map(function (r) { return [r, RARIDADE[r]]; })) },
        { k: 'calabouco', rotulo: Tx('De onde'), opcoes: opcDg },
        { k: 'q', rotulo: Tx('Nome ou bônus'), texto: true }
      ], params) });
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
      caixa.innerHTML = (achados.length === 1
        ? Tx('<p class="wk-contagem">{length} peça</p>{a}', { length: achados.length, a: achados.length ? '<div class="wk-linhas">' + achados.map(function (it) { return linhaItem(it); }).join('') + '</div>'
                        : Tx('<p class="wk-vazio">Nenhuma peça com esse filtro.</p>') })
        : Tx('<p class="wk-contagem">{length} peças</p>{a}', { length: achados.length, a: achados.length ? '<div class="wk-linhas">' + achados.map(function (it) { return linhaItem(it); }).join('') + '</div>'
                        : Tx('<p class="wk-vazio">Nenhuma peça com esse filtro.</p>') }));
    }
    return { titulo: Tx('Itens'), html: h, depois: function (caixa) { pinta(params); ligaFiltros(caixa, 'itens', pinta); } };
  }
  function itemPag(id) {
    var it = ITENS[id];
    if (!it) return naoAchou();
    var esp = ESPACO[it.slot], set = SETS[it.setId];
    var h = trilha([['#/itens', Tx('Itens')]], it.name);
    h += '<header class="wk-cabeca">' + iconeItem(it, 'g') + '<div class="wk-cabeca-tx"><h1>' + E(it.name) + '</h1><p class="wk-chips">' + rar(it.rarity) +
      (esp ? '<span class="wk-selo">' + E(esp.nome) + '</span>' : '') + (it.element ? elem(it.element) : '') +
      (num(it.nivelUso) ? '<span class="wk-nivel">' + Tx('nível {a}', { a: num(it.nivelUso) }) + '</span>' : '') + '</p>' +
      '<p>' + E(it.description) + '</p>' + (it.flavor ? '<p class="wk-lore">' + E(it.flavor) + '</p>' : '') + '</div></header>';
    var b = bonusPartes(it.bonuses);
    h += Tx('<h2>O que dá</h2>{a}', { a: b.length ? '<ul class="wk-defs">' + b.map(function (x) { return '<li>' + E(x) + '</li>'; }).join('') + '</ul>' : Tx('<p>Nenhum bônus de atributo.</p>') });
    if (esp) h += '<p class="apoio">' + E(esp.nome) + ': ' + E(esp.diz) + '.' + (it.keyPiece ? Tx(' É uma peça-chave: muda como se joga, e por isso é das mais difíceis de achar na raridade dela.') : '') + '</p>';
    var sp = it.grantsSpell ? feitico(it.grantsSpell) : null;
    if (sp) h += Tx('<h2>O feitiço que concede</h2><div class="wk-feiticos">{a}</div>', { a: cartaoFeitico(sp, { link: true }) });
    h += Tx('<h2>De onde vem</h2><p>{a}.</p>', { a: ondeCai(it) });
    if (num(it.nivelUso)) h += '<p class="apoio">' +
      Tx('Pede nível {a} para ser vestida. Acima disso ela ainda cai, fica no saco, é trocada e vendida — só não entra no herói. <a href="#/sistemas/nivel-uso">Nível de uso</a>', { a: num(it.nivelUso) }) +
      '</p>';
    if (set) {
      h += Tx('<h2>Conjunto</h2><p>Faz parte do conjunto {a}. As outras peças:</p><div class="wk-linhas">{b}</div>', { a: link('conjunto', set.id, set.name), b: (set.pieces || []).filter(function (pid) { return pid !== it.id && ITENS[pid]; }).map(function (pid) { return linhaItem(ITENS[pid], true); }).join('') });
    }
    var U = D.upgrade || {};
    if (U.maxLevel) {
      var pedra = it.element && it.element !== 'neutro' ? pedraDe(it.element) : null;
      h += Tx('<h2>Forja</h2><p>Sobe até +{a} na bigorna, com {b}. Cada nível soma {c} dos bônus de base{d}. <a href="#/sistemas/forja">Como a forja funciona</a></p>', { a: num(U.maxLevel), b: pedra ? Tx('{a} (a pedra do elemento dela)', { a: E(pedra.name) }) : Tx('qualquer pedra de elemento'), c: pct(U.bonusPerLevel), d: (U.nonScalingKeys || []).length ? Tx('; {a} nunca sobem', { a: lista((U.nonScalingKeys || []).map(function (k) { return ATRIBUTO[k] || k; })) }) : '' });
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
    var h = Tx('<h1>Conjuntos</h1><p class="wk-sub">Peças do mesmo conjunto vestidas juntas dão um bônus a mais, que cresce com o número de peças. O elemento do conjunto é o dos monstros que derrubam as peças.</p><div class="wk-grade">{a}</div>', { a: sets.map(function (s) {
        return '<a class="wk-cartao grande" href="' +
          rota('conjunto', s.id) +
          '" data-conjunto="' +
          E(s.id) +
          '">' +
          Tx('<b>{c}</b><span class="wk-chips">{d}{e}{f}</span><span class="apoio">{length} peças</span>', { c: E(s.name), d: rar(raridadeDoSet(s)), e: elem(s.element), f: s.dungeonId ? '<span class="wk-selo">' + E(SITE.semArtigo(nomeDg(s.dungeonId))) + '</span>' : '<span class="wk-selo">' + Tx('roleta') + '</span>', length: (s.pieces || []).length }) +
          '</a>';
      }).join('') });
    return { titulo: Tx('Conjuntos'), html: h };
  }
  function conjunto(id) {
    var s = SETS[id];
    if (!s) return naoAchou();
    var h = trilha([['#/conjuntos', Tx('Conjuntos')]], s.name) + '<h1>' + E(s.name) + '</h1><p class="wk-chips">' + rar(raridadeDoSet(s)) + elem(s.element) +
      (s.dungeonId ? '<span class="wk-selo">' + link('calabouco', s.dungeonId, nomeDg(s.dungeonId)) + '</span>' : '') + '</p><p>' + E(s.description) + '</p>';
    h += Tx('<h2>As peças</h2><div class="wk-linhas">{a}</div>', { a: (s.pieces || []).filter(function (pid) { return ITENS[pid]; }).map(function (pid) { return linhaItem(ITENS[pid]); }).join('') });
    var bs = chaves(s.bonuses || {}).sort(function (a, b) { return num(a) - num(b); });
    if (bs.length) {
      h += Tx('<h2>O bônus</h2><div class="wk-rolagem"><table class="wk-tabela"><thead><tr><th>vestidas</th><th>bônus</th></tr></thead><tbody>{a}</tbody></table></div>', { a: bs.map(function (n) { return '<tr>' + Tx('<td>{a} peças</td><td>{b}</td>', { a: E(n), b: E(bonusPartes(s.bonuses[n]).join(', ')) }) + '</tr>'; }).join('') });
    }
    var extras = [];
    if (s.aura) extras.push(Tx('Com as {length} peças vestidas, o herói anda com uma aura de fogo branco.', { length: (s.pieces || []).length }));
    if (s.pet && PETS[s.pet]) extras.push(Tx('Fechar o conjunto concede o pet {a}, uma vez.', { a: link('pet', s.pet, PETS[s.pet].name) }));
    chaves(s).forEach(function (k) {
      var v = s[k];
      if (typeof v === 'string' && ISPELLS[v] && k !== 'id') extras.push(Tx('Conjunto completo concede o feitiço {a}.', { a: link('feitico', v, ISPELLS[v].name) }));
    });
    if (extras.length) h += '<ul class="wk-defs">' + extras.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul>';
    if (D.selos && id === D.selos.setId) h += Tx('<p class="apoio">As peças saem só da roleta do Colecionador. <a href="#/sistemas/selos">Os Selos</a></p>');
    return { titulo: s.name, html: h };
  }

  // ------------------------------------------------------------------ pets
  function cartaoPet(p) {
    return '<a class="wk-cartao" href="' + rota('pet', p.id) + '" data-pet="' + E(p.id) + '">' + bustoPet(p) +
      '<span class="wk-cartao-tx"><b>' + E(p.name) + '</b><span class="apoio">' + elem(p.element) + ' ' + E(JEITO_PET[p.behavior] || '') + '</span></span></a>';
  }
  function pets() {
    var h = Tx('<h1>Pets</h1><p class="wk-sub">O pet entra na batalha junto do dono e age sozinho logo depois do turno dele. Não conta para vitória nem derrota. Os bônus valem enquanto ele estiver equipado.</p><div class="wk-grade">{a}</div>', { a: valores(PETS).map(cartaoPet).join('') });
    return { titulo: Tx('Pets'), html: h };
  }
  function petPag(id) {
    var p = PETS[id];
    if (!p) return naoAchou();
    var h = trilha([['#/pets', Tx('Pets')]], p.name) + '<header class="wk-cabeca">' + bustoPet(p) + '<div class="wk-cabeca-tx"><h1>' + E(p.name) + '</h1><p class="wk-chips">' +
      elem(p.element) + (JEITO_PET[p.behavior] ? '<span class="wk-selo">' + JEITO_PET[p.behavior] + '</span>' : '') +
      (num(p.nivelUso) ? '<span class="wk-nivel">' + Tx('nível {a}', { a: num(p.nivelUso) }) + '</span>' : '') + '</p><p>' + E(p.description) + '</p></div></header>';
    var b = bonusPartes(p.bonuses);
    h += Tx('<h2>O que dá ao dono</h2>{a}', { a: b.length ? '<ul class="wk-defs">' + b.map(function (x) { return '<li>' + E(x) + '</li>'; }).join('') + '</ul>' : Tx('<p>Nenhum bônus.</p>') });
    if (num(p.followDistance)) h += '<p class="apoio">' + Tx('Fica a até {a} do dono.', { a: casas(p.followDistance) }) + '</p>';
    var sps = (p.spells || []).map(function (sid) { return PSPELLS[sid] || feitico(sid); }).filter(Boolean);
    if (sps.length) h += Tx('<h2>Golpes</h2><div class="wk-feiticos">{a}</div>', { a: sps.map(function (sp) { return cartaoFeitico(sp, { link: true }); }).join('') });
    h += Tx('<h2>Como conseguir</h2><p>');
    if (p.dropDungeon && dg(p.dropDungeon)) {
      h += (FECHADO(p.dropDungeon)
        ? Tx('O chefe {a} pode derrubar cartas deste pet; juntando as cartas, ele é seu, e as repetidas viram estrelas. <span class="wk-selo fechado">Em breve</span> o portal ainda está fechado.', { a: link('calabouco', p.dropDungeon, contrai(DE, 'de', nomeDg(p.dropDungeon))) })
        : Tx('O chefe {a} pode derrubar cartas deste pet; juntando as cartas, ele é seu, e as repetidas viram estrelas.', { a: link('calabouco', p.dropDungeon, contrai(DE, 'de', nomeDg(p.dropDungeon))) }));
    } else {
      var dono = valores(SETS).filter(function (s) { return s.pet === id; })[0];
      h += dono ? Tx('Só fechando o {a} — o pet vem junto, uma vez.', { a: link('conjunto', dono.id, dono.name) }) : Tx('Não cai em calabouço.');
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
    sec('elementos', Tx('Elementos e a roda'),
      Tx('<p>{a}</p><p>Numa briga entre dois elementos, a roda diz quem leva a melhor: <span class="wk-roda">{b}</span>. A roda chega ao dano pelas resistências: cada monstro resiste ao elemento que ele vence e é fraco contra quem o vence. O Neutro fica fora da roda.</p><ul class="wk-defs">{c}</ul>{d}', { a: ELEMENTOS.map(elem).join(' '), b: ELEMENTOS.filter(function (e) { return B[e]; }).map(function (e) { return Tx('{a} vence {b}', { a: elem(e), b: elem(B[e]) }); }).join(' · '), c: ELEMENTOS.map(function (e) { return '<li>' + elem(e) + ' ' + E((ELINFO[e] || {}).description) + '</li>'; }).join(''), d: esc ? '<p>' +
        Tx('No nível {esc} cada herói escolhe o elemento dele: o caminho de feitiços e o dano extra de cada nível passam a ser desse elemento. A escolha é para sempre (o Pergaminho da Reescrita, da Loja, troca um caminho por outro).', { esc: esc }) +
        '</p>' : '' }),
      'fogo agua terra ar neutro roda rivalidade resistencia');

    var tick = num(JG.Engine && JG.Engine.WEATHER_TICK);
    sec('climas', Tx('Climas'),
      Tx('<p>Cada sala tem um clima. {a} Alguns feitiços viram o clima no meio da luta.</p><div class="wk-rolagem"><table class="wk-tabela"><thead><tr><th>Clima</th><th>favorece</th><th>prejudica</th><th></th></tr></thead><tbody>{b}</tbody></table></div>', { a: tick ? Tx('No início do turno de cada um, quem é do elemento que o clima favorece ganha {tick} PV, e quem é do elemento rival perde {tick} PV.', { tick: tick }) : Tx('O clima ajuda o elemento que favorece e castiga o rival.'), b: valores(CLIMAS).map(function (w) {
        return '<tr><td><b>' + E(w.name) + '</b></td><td>' + (w.favors ? elem(w.favors) : '—') + '</td><td>' + (w.harms ? elem(w.harms) : '—') +
          '</td><td>' + E(w.description) + '</td></tr>';
      }).join('') }), 'clima chuva estiagem vendaval tremor calmo');

    var difs = valores(DIFS);
    if (difs.length) {
      sec('dificuldade', Tx('Dificuldade'),
        Tx('<p>Quem lidera a descida escolhe a dificuldade. O prêmio sobe mais que o custo.</p><div class="wk-rolagem"><table class="wk-tabela"><thead><tr><th></th><th class="n">vida dos monstros</th><th class="n">dano deles</th><th class="n">clima (a parte que machuca)</th><th class="n">experiência</th><th class="n">saque</th></tr></thead><tbody>{a}</tbody></table></div>', { a: difs.map(function (f) {
          return '<tr><td><b>' + E(f.icone || '') + ' ' + E(f.nome) + '</b><br><span class="apoio">' + E(f.resumo || '') + '</span></td><td class="n">' + mult(f.vida) + '</td><td class="n">' +
            mult(f.dano) + '</td><td class="n">' + mult(f.clima) + '</td><td class="n">' + mult(f.xp) + '</td><td class="n">' + mult(f.drop) + '</td></tr>';
        }).join('') }), 'facil normal dificil');
    }

    var tab = LV.xpTable || [], fo = LV.xpFalloff || {}, pl = LV.perLevel || {}, pe = LV.perLevelElement || {};
    var papel = LV.defenseByRole || {}, sc = D.summonCap || {};
    sec('niveis', Tx('Níveis e experiência'),
      Tx('<p>O herói vai do nível 1 ao {maxN}. A experiência de uma sala é a soma dos monstros, dividida pelo grupo. Todo nível dá +{a} PV; do 2 ao {esc} dá +{b} de poder, e do {c} em diante, +{d} de dano no elemento escolhido.</p>{e}<h3>A experiência de cada nível (acumulada)</h3><div class="wk-xp">{f}</div><h3>Esquiva e fixação no nível {maxN}, por papel</h3><div class="wk-rolagem"><table class="wk-tabela"><thead><tr><th>papel</th><th class="n">esquiva</th><th class="n">fixação</th></tr></thead><tbody>{g}</tbody></table></div><p class="apoio">Cada classe sai dos números dela no nível 1 e anda em linha reta até estes.</p>{h}', { maxN: maxN, a: num(pl.hp), esc: esc, b: num(pl.power), c: esc + 1, d: num(pe.elemPower), e: fo.graceLevels != null ? '<p>' +
        Tx('Descer raso rende cada vez menos: até {a} níveis acima do recomendado do calabouço a experiência vale inteira; cada nível a mais multiplica por {b}, até o piso de {c}. Descer fundo é o caminho.', { a: num(fo.graceLevels), b: mult(fo.factorPerLevel), c: pct(fo.floor) }) +
        '</p>' : '', f: tab.map(function (x, i) {
        return '<span>' + Tx('nível {a}: <b>{b}</b>', { a: i + 1, b: SITE.num(x) }) + '</span>';
      }).join(''), g: chaves(papel).map(function (r) { return '<tr><td>' + E(PAPEL[r] || r) + '</td><td class="n">' + num(papel[r].dodge) + '</td><td class="n">' + num(papel[r].lock) + '</td></tr>'; }).join(''), h: sc.base != null ? '<p>' +
        Tx('Invocações ao mesmo tempo: {a}{b}.', { a: num(sc.base), b: sc.degraus && sc.degraus.length ? Tx(', e +1 {a}', { a: lista(sc.degraus.map(function (n) { return Tx('no nível {n}', { n: n }); })) }) : '' }) +
        '</p>' : '' }),
      'nivel experiencia xp esquiva fixacao invocacao');

    var S2 = D.stars || {}, cards = D.cards || {};
    sec('estrelas', Tx('Cartas e estrelas'),
      Tx('<p>As cartas de classe caem dos chefes. Com as cartas do desbloqueio a classe é liberada; as que passam disso compram estrelas, bônus permanentes da classe.</p><div class="wk-rolagem"><table class="wk-tabela"><thead><tr><th>classe</th><th class="n">cartas para liberar</th></tr></thead><tbody>{a}</tbody></table></div><ul class="wk-defs">{b}</ul>', { a: chaves(cards).filter(function (c) { return CLASSES[c]; }).map(function (c) {
        return '<tr><td>' + link('classe', c, nomeClasse(c)) + '</td><td class="n">' + (num(cards[c].unlockCost) ? num(cards[c].unlockCost) : Tx('já vem')) + '</td></tr>';
      }).join(''), b: chaves(S2.bonuses || {}).map(function (n) {
        var extra = num((S2.elementSlots || {})[n]) > num((S2.elementSlots || {})[n - 1]) ? Tx(', e libera o {a}º caminho de elemento', { a: num(S2.elementSlots[n]) }) : '';
        return '<li>' + '★'.repeat(num(n)) + ': ' + E(bonusPartes(S2.bonuses[n]).join(', ')) + extra + '</li>';
      }).join('') }), 'carta estrela desbloqueio');

    var F = JG.Fusion;
    if (F) {
      sec('fusao', Tx('Fusão'),
        Tx('<p>Dois heróis colados (em cruz) viram um corpo só. Quem declara gasta {a} PA; o corpo soma a vida dos dois, ganha +{b} PA, +{c} PP e um escudo de {d} que não acaba, e usa os feitiços da dupla. Dura até o fim da batalha.</p><p><a href="fusoes.html">Todas as duplas, formas e misturas</a></p>', { a: num(F.FUSION_PA_COST), b: num(F.BONUS_PA), c: num(F.BONUS_PP), d: num(F.BONUS_SHIELD) }),
        'fusao fundir dupla');
    }

    var fu = LV.roomFury || (JG.Engine && JG.Engine.ROOM_FURY) || {};
    if (fu.afterRound) {
      sec('furia', Tx('Fúria da sala'),
        '<p>' +
          Tx('Batalha que não se resolve não dura para sempre. A partir da rodada {a}, a cada rodada os inimigos ganham +{b} de poder e toda cura cai {c} (dos dois lados). Na rodada {d}, a batalha acaba em derrota.', { a: num(fu.afterRound), b: num(fu.powerPerRound), c: pct(fu.healCutPerRound), d: num(fu.maxRounds) }) +
          '</p>', 'furia rodada empate');
    }

    var ev = valores(D.tileEvents || {});
    if (ev.length) {
      sec('eventos-chao', Tx('Eventos do chão'),
        Tx('<p>De vez em quando algo brota numa casa do tabuleiro. Quem pisa leva o efeito.</p><div class="wk-rolagem"><table class="wk-tabela"><tbody>{a}</tbody></table></div>', { a: ev.map(function (x) {
          return '<tr><td>' + E(x.icon || '') + ' <b>' + E(x.name) + '</b><br><span class="apoio">' + E(TIPO_EVENTO[x.kind] || '') +
            (x.duration ? ' ' + Tx('· some em {a} rodadas', { a: num(x.duration) }) : '') + '</span></td><td>' + E(x.description) + '</td></tr>';
        }).join('') }), 'evento chao casa portal fonte dreno');
    }

    var U = D.upgrade || {};
    if (U.maxLevel) {
      var custo = U.stoneCost || [], total = custo.reduce(function (a, b) { return a + num(b); }, 0), anc = PEDRAS[U.guardStone];
      sec('forja', Tx('Forja'),
        Tx('<p>Na bigorna, uma peça sobe até +{a}. Cada nível soma {b} dos bônus de base da peça{c}. A batida gasta pedras do elemento da peça; peça neutra aceita qualquer pedra. Do +0 ao +{a} são {total} pedras.</p><div class="wk-rolagem"><table class="wk-tabela"><thead><tr><th>batida</th><th class="n">pedras</th><th class="n">chance de dar certo</th></tr></thead><tbody>{d}</tbody></table></div><p>Do +{e} em diante a batida pode falhar, e a peça volta um nível.{f}</p>{g}<h3>As pedras</h3><div class="wk-linhas">{h}</div>', { a: num(U.maxLevel), b: pct(U.bonusPerLevel), c: (U.nonScalingKeys || []).length ? Tx(' ({a} nunca sobem)', { a: lista((U.nonScalingKeys || []).map(function (k) { return ATRIBUTO[k] || k; })) }) : '', total: total, d: custo.map(function (c, i) {
          var ch = (U.chances || {})[i];
          return '<tr><td>+' + i + ' → +' + (i + 1) + '</td><td class="n">' + num(c) + '</td><td class="n">' + (i >= num(U.riskFrom) && ch != null ? pct(ch) : Tx('sempre')) + '</td></tr>';
        }).join(''), e: num(U.riskFrom), f: anc ? ' ' + Tx('A <b>{a}</b>, posta junto das pedras, segura a queda: falhou, ficou onde estava. Só chefe derruba.', { a: E(anc.name) }) : '', g: (U.tiers || []).length ? '<p class="apoio">' +
          Tx('Os nomes dos degraus: {a}.', { a: lista(U.tiers.map(function (t) { return t.to !== t.from ? Tx('{a} (+{b} a +{c})', { a: E(t.name), b: num(t.from), c: num(t.to) }) : E(t.name) + ' (+' + num(t.from) + ')'; })) }) +
          '</p>' : '', h: valores(PEDRAS).map(function (p) {
          return '<div class="wk-linha">' + icone('extra-' + p.id, p.name) + '<span class="wk-linha-tx"><b>' + E(p.name) + '</b><span class="apoio">' +
            (ELINFO[p.element] ? elem(p.element) + ' ' : '') + E(p.description) + '</span></span></div>';
        }).join('') }), 'forja bigorna pedra ancora melhorar');
    }

    var LW = D.lootWeights || {}, bag = D.bag || {}, Dd = JG.Diario;
    var minSala = {};
    valores(ITENS).forEach(function (it) { if (it.dungeonId && (minSala[it.rarity] == null || num(it.minRoom) < minSala[it.rarity])) minSala[it.rarity] = num(it.minRoom); });
    var salaRef = DGS[0];
    sec('saque', Tx('Saque e raridade'),
      Tx('<p>Toda sala vencida sorteia o saque; muitas vezes não sai peça nenhuma. A raridade diz quanto custa achar: {a}. As peças que mudam como se joga (+1 PA, +1 PP e os Lumes) são as mais difíceis da raridade delas. O dono quer que peça boa seja rara de verdade.</p>{b}{c}{d}', { a: lista(ORDEM_RAR.filter(function (r) { return minSala[r] != null; }).map(function (r) { return RARIDADE[r].toLowerCase() + ' ' + textoSala(minSala[r], salaRef); })), b: MOSTRA_CHANCES && LW.luck ? '<p>' + Tx('Sorte de saque: sozinho {a}, em dupla {b}.', { a: mult(LW.luck.solo), b: mult(LW.luck.dupla) }) + '</p>' : '', c: bag.base != null ? '<p>' +
        Tx('O saco tem fundo: {a} lugares, mais {b} por classe liberada. O que não cabe vai para o cofre do banco.', { a: num(bag.base), b: num(bag.perClass) }) +
        '</p>' : '', d: Dd && Dd.BONUS_DROP ? '<p>' +
        Tx('O <b>Calabouço do Dia</b> paga +{a}% de saque. Cada dia é um calabouço aberto, o mesmo para todo mundo.', { a: Math.round((num(Dd.BONUS_DROP) - 1) * 100) }) +
        '</p>' : '' }),
      'saque drop raridade comum raro epico lendario saco cofre calabouco do dia');

    var NU = D.nivelUso || {}, pc = NU.porCalabouco || {};
    sec('nivel-uso', Tx('Nível de uso'),
      Tx('<p>Cada peça pede um nível para ser vestida: quanto mais fundo o calabouço e mais rara a peça, maior. Acima do nível a peça ainda cai, fica no saco, é trocada e vendida.</p><div class="wk-rolagem"><table class="wk-tabela"><thead><tr><th>calabouço</th><th class="n">comum</th><th class="n">raro</th><th class="n">épico</th></tr></thead><tbody>{a}</tbody></table></div><p>Peça lendária: nível {b}. Traje do Colecionador: nível {c}. Pet: nível {d}.</p>', { a: DGS.filter(function (d) { return pc[d.id]; }).map(function (d) {
        return '<tr><td>' + link('calabouco', d.id, d.name) + (FECHADO(d.id) ? Tx(' <span class="apoio">(em breve)</span>') : '') + '</td><td class="n">' + num(pc[d.id].comum) +
          '</td><td class="n">' + num(pc[d.id].raro) + '</td><td class="n">' + num(pc[d.id].epico) + '</td></tr>';
      }).join(''), b: num(NU.lendario), c: num(NU.colecionador), d: num(NU.pet) }), 'nivel de uso equipar');

    if (D.selos) {
      var sset = SETS[D.selos.setId], spet = sset && PETS[sset.pet];
      sec('selos', Tx('Os Selos do Colecionador'),
        '<p>' +
          Tx('Só chefe derruba Selos, e cada chefe derruba o do próprio elemento. No Mercadinho mora o Colecionador: {a} selos, de qualquer elemento, pagam um giro na roleta, e cada giro dá uma peça {b}. Peça repetida vira estrela.{c}{d}', { a: num(D.selos.porGiro), b: sset ? Tx('do conjunto {a}', { a: link('conjunto', sset.id, sset.name) }) : Tx('lendária'), c: spet ? ' ' + Tx('Fechar as peças acende a aura de fogo branco e dá o pet {a}.', { a: link('pet', spet.id, spet.name) }) : '', d: MOSTRA_CHANCES ? ' ' + Tx('Chance de selo por chefe: {a}.', { a: pct(D.selos.chance) }) : '' }) +
          '</p>', 'selo colecionador roleta aura');
    }

    var G = JG.Guilda, ins = D.insignias || {};
    sec('guilda', Tx('Guilda'),
      Tx('<p>Fundar uma guilda custa {a} <b>Insígnias de Fundação</b>, que só os chefes derrubam{b}. Quem funda lidera; há oficiais e membros.</p>{c}', { a: num(ins.porGuilda || (G && G.CUSTO_CRIAR)), b: MOSTRA_CHANCES && ins.chance ? ' ' + Tx('({a} por chefe)', { a: pct(ins.chance) }) : '', c: G ? '<ul class="wk-defs">' +
        Tx('<li>O cofre da guilda junta a moeda da guilda; só quem lidera (e os oficiais) gasta. {a} moedas compram {b} h de +{c}% de saque ou de experiência para todos os membros.</li><li>A guilda ganha experiência pelo dízimo — a parte da experiência de cada batalha que o membro doa, definida por quem lidera, de até {d}% — e pela guerra de guilda. Vinténs não compram experiência para a guilda.</li><li>O banco da guilda empresta peças entre os membros: um empréstimo por vez, devolve quem pegou, e o dono retira quando quiser.</li><li>O duelo de treino paga {e} de experiência e {f} moeda à guilda.</li>', { a: num(G.CUSTO_BONUS), b: Math.round(num(G.BONUS_MS) / 3600000), c: Math.round((num(G.BONUS_FATOR) - 1) * 100), d: num(G.DIZIMO_MAX), e: num(G.XP_TREINO), f: num(G.MOEDA_TREINO) }) +
        // 15/09: a guerra de guilda 2×2 na Sede (os números espelham servidor/guerra.py e JOGO.Guerra)
        Tx('<li><b>Guerra de Guilda 2×2</b>, na Sede: dois jogadores da mesma guilda, em grupo, cada um com os seus dois heróis, entram na fila; o jogo acha dois de outra guilda (até {a} níveis de diferença entre os heróis mais fortes) e os quatro confirmam em 30 s. As duplas dos adversários só aparecem na luta, no Salão da Sede. A guilda que vence ganha {b} de experiência; quem perde não perde nada, e a coroa não muda. Empate e W.O. não rendem, e o servidor segura quantas guerras valem por dia entre as mesmas guildas.</li>', { a: num((JG.Guerra && JG.Guerra.PARIDADE) || 10), b: num((JG.Guerra && JG.Guerra.XP) || 120) }) +
        '</ul>' +
        '<p class="apoio">' + Tx('O tabuleiro da guerra tem mapa próprio: {a}.', { a: link('tabuleiro', 'sede', Tx('O Salão da Sede')) }) + '</p>' : '' }),
      'guilda insignia cofre banco dizimo guerra sede 2x2');

    var M = JG.Mercado;
    if (M) {
      sec('mercadinho', Tx('Mercadinho'),
        '<p>' +
          Tx('No Mercadinho do Acampamento um jogador anuncia uma peça com preço e outro compra. A venda paga {a} de taxa (no mínimo 1 vintém). O preço vai até {b} vinténs. Um mercador-fantasma pendura {c} ofertas por dia.', { a: pct(M.TAXA), b: SITE.num(M.PRECO_MAX), c: num(M.POR_DIA) }) +
          '</p>', 'mercado mercadinho vender comprar taxa vintem');
    }

    // 13/09: as poções da banca do mercador, lidas dos dados do jogo (nenhum número copiado)
    var CONS = D.consumiveis, CR = D.consumiveisRegras || {}, VES = D.vidaEntreSalas || {};
    if (CONS) {
      var linhasCons = Object.keys(CONS).map(function (k) { return CONS[k]; })
        .sort(function (a, b) { return num(a.preco) - num(b.preco); })
        .map(function (c) {
          return '<li>' + Tx('<b>{a}</b>: cura {b} PV · {c} vinténs', { a: SITE.esc(c.name || c.id), b: num(c.cura), c: SITE.num(num(c.preco)) }) + '</li>';
        }).join('');
      sec('consumiveis', Tx('Consumíveis: as poções de vida'),
        Tx('<p>No Mercadinho mora a banca do mercador: poções de vida com estoque sem fim, preço fixo e sem taxa, pagas com os vinténs do saco. Elas ficam em Consumíveis no inventário, até {a} de cada.</p><ul class="wk-defs">{linhasCons}</ul>', { a: num(CR.teto), linhasCons: linhasCons }) +
        // 13/09: a poção saiu da batalha (pedido do dono). 14/09: a vida é uma só por herói, e vale em toda parte
        Tx('<p>Cada herói tem <b>uma vida só</b>, que vale em toda parte: na praça, nas salas do calabouço, no Poço, no grupo e no duelo. Quando uma luta acaba — vitória ou derrota — o herói fica com a vida com que terminou (quem caiu fica com zero), e ela volta sozinha, 1 PV a cada {a} s, até encher. A próxima batalha começa com a vida que ele tiver: quem entra no duelo com a vida na metade luta com a metade.</p>', { a: num((VES.msPorPv || 2000) / 1000) }) +
        Tx('<p>A poção não se bebe na batalha: bebe-se <b>fora da luta</b> — na praça, na sala de espera entre as salas e nas telas de fim. Ela cura na hora, sem passar do PV máximo, para não esperar. Herói sem vida só entra numa batalha quando recuperar pelo menos 1 PV.</p>') +
        // 15/09 (as falhas conhecidas): sair antes do fim não foge da conta
        Tx('<p>Sair da luta antes do fim não salva a vida. Quem <b>desiste do duelo</b> sai com os heróis a zero (e, na Arena e no Campo de PvP, perde a coroa como numa derrota); quem some do duelo e não volta em 60 s também — o servidor confere a queda. Quem fecha o jogo no meio de uma sala continua a luta dali quando voltar: o jogo fecha a sala no ponto em que parou. Abrir outra luta em outro lugar com a de antes ainda aberta faz os heróis dela voltarem do zero.</p>'),
        'pocao pocoes consumivel consumiveis vida cura mercador banca espera antessala praca regenera duelo desistir abandonar');
    }

    var Mi = JG.Missoes;
    if (Mi) {
      sec('missoes', Tx('Missões e conquistas'),
        Tx('<p>Todo dia o quadro do Acampamento sorteia {a} missões, as mesmas para todo mundo, pagas em vinténs:</p><ul class="wk-defs">{b}</ul><p>As conquistas são para sempre e destravam um título, que aparece junto do nome:</p><ul class="wk-defs">{c}</ul>', { a: num(Mi.POR_DIA), b: valores(Mi.DIARIAS || {}).map(function (x) { return '<li>' + Tx('{a} — {b} vinténs', { a: E(x.texto), b: num(x.premio) }) + '</li>'; }).join(''), c: valores(Mi.CONQUISTAS || {}).map(function (x) { return '<li>' + Tx('{a} — {b} vinténs e o título <b>{c}</b>', { a: E(x.texto), b: num(x.premio), c: E(x.titulo) }) + '</li>'; }).join('') }),
        'missao diaria conquista titulo');
    }

    var Br = JG.Brasa;
    if (Br) {
      sec('arena', Tx('Arena e Brasa'),
        '<p>' +
          Tx('Há três jeitos de lutar contra outro jogador. O <b>desafio amistoso</b>: toque em alguém na praça — a luta é no mapa da praça, cada um leva 1 ou 2 heróis escolhidos às cegas, e a coroa não muda. A <b>Arena</b>: inscreva os seus dois heróis no quadro de inscritos (todos veem as classes) e espere um desafio, ou desafie um inscrito com até {a} níveis de diferença; os dois confirmam em 30 s e a luta é numa sala sorteada dos calabouços — vale coroa. O <b>Campo de PvP</b>: só se entra com a coroa ligada, escolhendo dois heróis em ordem (o 1º é a aparência, o 2º é a surpresa); lá dentro qualquer um ataca sem aviso quem estiver a até {b} níveis — também vale coroa.', {
            // 03/10: a Arena é 3 (o dono); o número mora em js/core/grupo.js, que esta página não carrega — o mesmo jeito da guerra
            a: num((JG.Arena && JG.Arena.PARIDADE) || 3), b: num((JG.Duelo && JG.Duelo.PARIDADE_CAMPO) || 10) }) +
          '</p>' +
        '<p class="apoio">' + Tx('O tabuleiro do desafio amistoso tem mapa próprio: {a}.', { a: link('tabuleiro', 'praca', Tx('A Praça')) }) + '</p>' +
        '<p>' +
          Tx('A pontuação é a Brasa: todo mundo começa com {a}, ganhar de quem vale menos paga pouco, perder devolve o que se subiu, e ninguém cai abaixo de {b}. A cada {c} dias a temporada fecha e os pontos voltam para perto do meio.', { a: SITE.num(Br.INICIAL), b: SITE.num(Br.PISO), c: num(Br.TEMPORADA_DIAS) }) +
          '</p>' +
        '<div class="wk-rolagem"><table class="wk-tabela">' +
          Tx('<thead><tr><th>coroa</th><th class="n">a partir de</th></tr></thead><tbody>{a}</tbody>', { a: (Br.TIERS || []).map(function (t) {
            return '<tr><td>' + E(t.nome) + '</td><td class="n">' + SITE.num(t.min) + (t.exigeTopo ? Tx(' e ser o 1º do placar') : '') + '</td></tr>';
          }).join('') }) +
          '</table></div>' +
        Tx('<p class="apoio">Quem decide a coroa é o servidor: ele refaz a luta da Arena e do Campo, confere a diferença de nível e segura quantos duelos valem por dia entre as mesmas duas contas.</p>'),
        'arena duelo brasa coroa pvp temporada desafio amistoso quadro inscricao campo');
    }

    var Po = JG.Poco;
    if (Po) {
      sec('poco', Tx('O Poço sem Fundo'),
        Tx('<p>A torre infinita, com entrada pelo poço da praça, a leste da Árvore-Mundo, para quem desce sozinho. Cada andar é uma sala emprestada dos calabouços, e cada andar a mais deixa os monstros {a} mais duros. A cada {b} andares, um chefe — e um Colosso, girando fogo, água, terra e ar. O recorde da semana fica anotado.</p><p>O chão de cada andar tem perigos à vista desde o começo, e nenhum fere sem aviso: a <b>placa de setas</b> arma quando alguém pisa e atira na linha marcada duas rodadas depois; o <b>chão rachado</b> range uma rodada antes de virar buraco; o <b>jato</b> do elemento marca o chão uma rodada antes de explodir, a cada três rodadas; a <b>runa de exaustão</b> prende o passo e tira PP. Quanto mais fundo, mais perigos. Nenhum nasce na entrada, e nenhum buraco corta o mapa.</p><p class="apoio">De quais salas ele empresta: {c}.</p>', { a: pct(Po.FATOR_POR_ANDAR), b: num(Po.CHEFE_A_CADA), c: link('tabuleiro', 'poco', Tx('O Poço sem Fundo')) }), 'poco torre infinita andar colosso perigo placa setas runa jato rachado');
    }

    sec('dupla', Tx('Em dupla'),
      Tx('<p>Toque noutro jogador na praça para chamar para o grupo, mandar mensagem particular, propor troca ou chamar para um desafio amistoso (na praça, sem coroa). O grupo é de dois: quem chama lidera, escolhe o calabouço e a dificuldade, e os dois descem juntos, cada um com um herói. O saque de cada sala é sorteado uma vez para o grupo. Quem cai da conexão no meio da batalha tem o herói tocado pela máquina até o fim da sala.</p>'),
      'grupo dupla multijogador duelo troca mensagem');

    var PG = D.pergaminhos, BX = D.bonusXp;
    if (PG || BX) {
      sec('loja', Tx('Pergaminhos e bônus'),
        Tx('<ul class="wk-defs">{a}{b}<li><b>Pergaminho da Reescrita</b>: troca um caminho de elemento do herói por outro.</li></ul><p class="apoio">Com um evento de experiência no ar, tudo junto para no teto do evento.</p>', { a: BX ? '<li>' +
          Tx('<b>Bônus de experiência</b>: dias de {a} de experiência para o grupo, vendidos na <a href="loja.html">Loja</a>; comprar de novo soma dias.', { a: mult(BX.fator) }) +
          '</li>' : '', b: PG && PG.xp ? '<li>' +
          Tx('<b>Pergaminho da Sabedoria</b>: {a} de experiência por {b} salas vencidas (até {c} guardadas). Não soma com o bônus por tempo.', { a: mult(PG.xp.fator), b: num(PG.xp.salas), c: num(PG.xp.tetoSalas) }) +
          '</li>' : '' }), 'pergaminho bonus loja sabedoria reescrita');
    }
    return S;
  }
  function sistemas(arg) {
    var S = secoesRegras();
    var h = Tx('<h1>Regras</h1><p class="wk-sub">As regras do jogo, com os números que o jogo usa.</p><ul class="wk-indice">{a}</ul>{b}', { a: S.map(function (s) { return '<li><a href="' + rota('sistemas', s.id) + '">' + E(s.titulo) + '</a></li>'; }).join(''), b: S.map(function (s) { return '<section class="wk-regra" id="r-' + s.id + '"><h2>' + E(s.titulo) + '</h2>' + s.html + '</section>'; }).join('') });
    var alvo = arg && S.some(function (s) { return s.id === arg; }) ? 'r-' + arg : null;
    var t = alvo ? S.filter(function (s) { return s.id === arg; })[0].titulo : Tx('Regras');
    return { titulo: t, html: h, rolarPara: alvo };
  }

  // ------------------------------------------------------------------ busca
  var indice = null;
  function montaIndice() {
    var I = [];
    function add(tipo, nome, extra, href) { I.push({ tipo: tipo, nome: String(nome), href: href, n: norm(nome), x: norm(nome + ' ' + (extra || '')) }); }
    chaves(CLASSES).forEach(function (id) {
      var c = CLASSES[id];
      add(Tx('Classe'), c.name, [PAPEL[c.role], c.description, id].join(' '), rota('classe', id));
      feiticosDaClasse(id).forEach(function (f) {
        add(Tx('Feitiço'), f.sp.name, [c.name, nomeEl(f.el), f.sp.description].join(' '), rota('feitico', f.sp.id));
      });
    });
    chaves(ISPELLS).forEach(function (sid) { add(Tx('Feitiço de Lume'), ISPELLS[sid].name, ISPELLS[sid].description, rota('feitico', sid)); });
    chaves(PSPELLS).forEach(function (sid) { add(Tx('Feitiço de pet'), PSPELLS[sid].name, PSPELLS[sid].description, rota('feitico', sid)); });
    valores(MONSTROS).filter(monstroVisivel).forEach(function (m) {
      add(m.boss ? Tx('Chefe') : Tx('Monstro'), m.name, [m.family, nomeEl(m.element), m.description].join(' '), rota('monstro', m.id));
      (m.spells || []).forEach(function (sid) {
        var sp = MSPELLS[sid];
        if (sp) add(Tx('Golpe de monstro'), sp.name, m.name + ' ' + sp.description, rota('monstro', m.id));
      });
    });
    valores(ITENS).forEach(function (it) {
      add(Tx('Item'), it.name, [RARIDADE[it.rarity], (ESPACO[it.slot] || {}).nome, nomeDg(it.dungeonId), resumoItem(it), it.description].join(' '), rota('item', it.id));
    });
    valores(SETS).forEach(function (s) { add(Tx('Conjunto'), s.name, s.description, rota('conjunto', s.id)); });
    valores(PETS).forEach(function (p) { add(Tx('Pet'), p.name, p.description, rota('pet', p.id)); });
    DGS.forEach(function (d) {
      add(Tx('Calabouço'), d.name, d.description, rota('calabouco', d.id));
      if (aberto(d.id)) (d.rooms || []).forEach(function (s) { add(Tx('Sala'), s.name, d.name, rota('calabouco', d.id)); });
    });
    tabuleiros().forEach(function (t) {
      add(Tx('Tabuleiro'), t.nome, [t.selo, t.resumo].join(' '), rota('tabuleiro', t.id));
      var a = arena(t.id) || especial(t.id);
      if (a) (a.rooms || []).forEach(function (s) { add(Tx('Tabuleiro'), s.name, t.nome + ' ' + t.selo, rota('tabuleiro', t.id)); });
    });
    valores(PEDRAS).forEach(function (p) { add(Tx('Pedra de forja'), p.name, p.description, rota('sistemas', 'forja')); });
    valores(CLIMAS).forEach(function (w) { add(Tx('Clima'), w.name, w.description, rota('sistemas', 'climas')); });
    secoesRegras().forEach(function (s) { add(Tx('Regra'), s.titulo, s.busca, rota('sistemas', s.id)); });
    return I;
  }
  function busca(q) {
    q = String(q || '').trim();
    var campo = $('wk-q');
    if (campo && document.activeElement !== campo) campo.value = q;
    var nq = norm(q);
    if (nq.length < 2) {
      return { titulo: Tx('Busca'), html: Tx('<h1>Busca</h1><p class="wk-sub">Digite pelo menos duas letras no campo da busca.</p>') };
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
    var h = Tx('<h1>Busca: {a}</h1><p class="wk-contagem">{b}</p>{c}', { a: E(q), b: unicos.length ? (unicos.length === 1 ? Tx('{n} resultado', { n: unicos.length }) : Tx('{n} resultados', { n: unicos.length })) +
      (unicos.length > mostra2.length ? ' ' + Tx('(os {length} primeiros)', { length: mostra2.length }) : '') : Tx('Nada encontrado.'), c: mostra2.map(function (e) {
        return '<p class="wk-resultado" data-tipo="' + E(e.tipo) + '"><a href="' + e.href + '">' + E(e.nome) + '</a> <span class="apoio">— ' + E(e.tipo) + '</span></p>';
      }).join('') });
    return { titulo: Tx('Busca'), html: h };
  }

  /* ========================================================================
   * AS ROTAS
   * ====================================================================== */
  var PAGINAS = {
    '': inicio, inicio: inicio, classes: classes, classe: classe, feiticos: feiticos, feitico: feiticoPag,
    calaboucos: calaboucos, calabouco: calabouco, tabuleiro: tabuleiro, bestiario: bestiario, monstro: monstro, itens: itens,
    item: itemPag, conjuntos: conjuntos, conjunto: conjunto, pets: pets, pet: petPag, sistemas: sistemas, busca: busca
  };
  var MENU_DE = { '': 'inicio', inicio: 'inicio', classe: 'classes', feitico: 'feiticos', calabouco: 'calaboucos',
                  tabuleiro: 'calaboucos', monstro: 'bestiario', item: 'itens', conjunto: 'conjuntos', pet: 'pets' };
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
      res = { titulo: Tx('Erro'), html: Tx('<h1>Esta página não abriu</h1><div class="wk-nota">Algo nos dados do jogo não bateu com a wiki. Volte ao <a href="#/">início</a>.</div>') };
    }
    var caixa = $('wk-conteudo');
    caixa.innerHTML = res.html;
    document.title = Tx('{a}Wiki do SOTERRA', { a: res.titulo ? res.titulo + ' — ' : '' });
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
    $('wk-conteudo').innerHTML = Tx('<div class="estado fora">Não deu para ler os dados do jogo (../js/core/data/).</div>');
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
