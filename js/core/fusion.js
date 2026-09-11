var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

/* ============================================================================
 * SOTERRA 2.0 — js/core/fusion.js  (dono: Lógica Combate)
 * Sistema de FUSÃO: dois aliados adjacentes viram uma única unidade com
 * feitiços COMPOSTOS (forma da dupla de classes × mistura da dupla de elementos).
 *
 * API (contrato §4):
 *   Fusion.canFuse(state, uidA, uidB) -> bool
 *   Fusion.declare(state, uidA, uidB) -> bool     (gasta 2 PA de A)
 *   Fusion.resolve(state)                         (fim do turno de A)
 *   Fusion.spellsFor(classPair, elemPair, level) -> [spell…]
 *   Fusion.split(state, uid)                      (morreu: some, não devolve)
 *
 * DECISÕES DE DESIGN (o contrato não fecha estes pontos):
 *  - ADJACÊNCIA = distância de Manhattan 1 (ortogonal), a mesma do movimento.
 *  - A unidade fundida é a PRÓPRIA unidade A, mutada: preserva o uid e a casa
 *    dela na ordem de iniciativa (o contrato manda a fusão ocupar a célula de
 *    A; preservar o uid evita reordenar a batalha em curso, coerente com a
 *    regra v1 de que buff de iniciativa não reordena). B sai do tabuleiro com
 *    `alive:false, offBoard:true`, SEM evento `death` e sem contar derrota.
 *  - "pa = paBase+2 / pp = ppBase+1": a base é o MAIOR dos dois (a fusão herda
 *    o melhor corpo). Aplicado em paMax/ppMax; o turno seguinte já nasce cheio.
 *  - "+50 de escudo" entra como efeito shield permanente (duração 9999).
 *  - Resistências = média aritmética arredondada, elemento a elemento.
 *  - `elemPower` (v2.2) = média arredondada dos dois, valendo para os DOIS
 *    elementos da mistura (via `unit.elements`, lido por Engine.elementalBonus).
 *  - Escala de poder dos feitiços compostos:
 *        fator = (100 + tier*5 + nível*3) / 100
 *    aplicada a min/max de damage/heal/poison/chain e a shield.value. É a
 *    leitura de "poder escala pelo tier e pelo nível da fusão" (contrato §4).
 *  - Se DATA.fusionForms/fusionBlends ainda não existirem (ou não cobrirem a
 *    dupla), a fusão AINDA acontece e a unidade fica com a UNIÃO dos feitiços
 *    dos dois fundidos — nunca com um kit vazio.
 *  - Pets de B passam a acompanhar a fusão.
 * ==========================================================================*/

(function () {
  'use strict';

  var Fusion = {};
  JOGO.Fusion = Fusion;

  Fusion.FUSION_PA_COST = 2;
  Fusion.BONUS_PA = 4;
  Fusion.BONUS_PP = 1;
  Fusion.BONUS_SHIELD = 50;
  Fusion.POWER_MULT = 1.144;

  // AJUSTE FINO POR DUPLA. Depois de acertar a media com POWER_MULT, sobra
  // dispersao POR DUPLA, porque as formas de fusao de cada par nao valem o mesmo
  // em relacao aos dois kits de classe que elas substituem. O coeficiente abaixo
  // e medido em tests/equilibrio_fusao.html — cada dupla puxada para 100%.
  // Chave em ORDEM ALFABETICA, igual a de DATA.fusionForms.
  //
  // RECALIBRADO (v2.8) depois que a area passou a mirar o CHAO (engine.js,
  // `validTargetCell`). A recalibragem so foi possivel porque o banco de medicao
  // tinha quatro defeitos que se anulavam, todos consertados agora:
  //   1. a fusao era medida com 4 PA — a sobra da declaracao — contra dois
  //      herois com 6+6=12 PA. Os coeficientes antigos (ate 1,656) existiam em
  //      boa parte para tapar isso.
  //   2. o feitico era mirado na primeira celula da varredura, o canto do
  //      alcance: com area mirando o chao, media zero.
  //   3. o instantaneo nao restaurava efeitos nem a semente, entao marcas de um
  //      feitico inflavam o seguinte (27% de diferenca so por ordem).
  //   4. o turno usava um feitico so, repetido; com `castsPerTurn: 1` em 92 das
  //      106 formas, a fusao gastava 4 dos 10 PA dela.
  // Medido o banco corrigido, a fusao estava ~2,4x acima, e POWER_MULT desceu de
  // 2,30 para 1,144 — o valor antigo carregava, junto com os coeficientes, a
  // compensacao daquele handicap de PA. A mudanca foi uma RENORMALIZACAO: o
  // produto POWER_MULT x coeficiente ficou o mesmo (desvio maximo 0,07%), e com
  // ela cada coeficiente volta a se ler como desvio em torno de 1,0, que e o que
  // este bloco diz que ele e.
  //
  // LIMITE CONHECIDO: um coeficiente CONSTANTE por dupla nao fecha as duas
  // pontas quando a razao muda muito com o nivel. Para caber em +-20% nos dois
  // niveis e preciso razaoMax/razaoMin <= 1,5 (de k*max<=1,2 e k*min>=0,8).
  // Seis duplas passam disso — de 1,52 (bruxo+espadachim) a 2,90
  // (espadachim+invocador) — e ficam fora por construcao, nao por falta de
  // ajuste. A inclinacao tambem troca de sinal entre duplas (arqueiro+curandeiro
  // rende MAIS fundida no 30, espadachim+invocador rende MENOS), entao nenhum
  // valor global de POWER_MULT nem do peso de nivel em `powerFactor` conserta:
  // so um coeficiente que varie COM O NIVEL, por dupla, fecharia — e isso seria
  // ajustar dois parametros a dois pontos medidos, ou seja, o teste passaria por
  // construcao. Fica registrado em vez de escondido.
  Fusion.PAIR_TUNE = {
    'arqueiro+bruxo':        1.091,
    'arqueiro+curandeiro':   0.697,
    'arqueiro+espadachim':   1.251,
    'arqueiro+invocador':    1.219,
    'arqueiro+minotauro':    1.682,
    'arqueiro+sumo':         0.755,
    'bruxo+curandeiro':      1.007,
    'bruxo+espadachim':      1.245,
    'bruxo+invocador':       1.607,
    'bruxo+minotauro':       0.888,
    'bruxo+sumo':            1.013,
    'curandeiro+espadachim': 0.569,
    'curandeiro+invocador':  1.500,
    'curandeiro+minotauro':  1.159,
    'curandeiro+sumo':       0.638,
    'espadachim+invocador':  1.112,
    'espadachim+minotauro':  1.027,
    'espadachim+sumo':       0.454,
    'invocador+minotauro':   3.830,
    'invocador+sumo':        1.080,
    'minotauro+sumo':        1.104
  };

  function E() { return JOGO.Engine; }
  function DATA() { return JOGO.DATA || {}; }
  function manhattan(x0, y0, x1, y1) { return Math.abs(x1 - x0) + Math.abs(y1 - y0); }

  function isFusable(u) {
    return !!u && u.alive && !u.offBoard &&
      u.kind !== 'pet' && u.kind !== 'summon' && u.kind !== 'fusion';
  }

  // ------------------------------------------------------------ chaves
  function pairKey(a, b) {
    var arr = [a || 'neutro', b || 'neutro'];
    arr.sort();
    return arr[0] + '+' + arr[1];
  }
  Fusion.pairKey = pairKey;

  // A chave de MISTURA respeita a ORDEM DOS DOIS FUNDIDOS (A, B) — nunca a
  // ordem alfabética. `DATA.fusionBlends` traz as 15 chaves canônicas MAIS as
  // 10 espelhadas (com `elements` invertido), justamente para que '@A' e '@B'
  // resolvam no elemento certo qualquer que seja a ordem. Só a chave de CLASSES
  // é alfabética (contrato §4).
  // "Se qualquer fundido tiver element === 'neutro', a mistura usada é a de
  //  chave com neutro": satisfeito automaticamente, pois o par carrega o neutro.
  function normalizeElemPair(eA, eB) {
    return [eA || 'neutro', eB || 'neutro'];
  }
  Fusion.normalizeElemPair = normalizeElemPair;

  function splitKey(key) {
    if (Object.prototype.toString.call(key) === '[object Array]') return key.slice();
    return String(key).split('+');
  }

  function lookupBlend(elemPair) {
    var blends = DATA().fusionBlends || {};
    var parts = splitKey(elemPair);
    var k1 = parts[0] + '+' + parts[1];
    var k2 = parts[1] + '+' + parts[0];
    var k3 = pairKey(parts[0], parts[1]);
    return blends[k1] || blends[k2] || blends[k3] || null;
  }
  function lookupForms(classPair) {
    var forms = DATA().fusionForms || {};
    var parts = splitKey(classPair);
    var k1 = parts[0] + '+' + parts[1];
    var k2 = parts.length > 1 ? (parts[1] + '+' + parts[0]) : k1;
    var k3 = parts.length > 1 ? pairKey(parts[0], parts[1]) : k1;
    return forms[k1] || forms[k2] || forms[k3] || null;
  }

  // ------------------------------------------------- composição de feitiços
  // Resolve '@A'/'@B' em qualquer campo string (inclusive dentro de arrays).
  function resolveTokens(value, elements) {
    if (typeof value === 'string') {
      if (value === '@A') return elements[0];
      if (value === '@B') return elements[1];
      return value;
    }
    if (Object.prototype.toString.call(value) === '[object Array]') {
      var arr = [];
      for (var i = 0; i < value.length; i++) arr.push(resolveTokens(value[i], elements));
      return arr;
    }
    if (value && typeof value === 'object') {
      var out = {};
      for (var k in value) {
        if (Object.prototype.hasOwnProperty.call(value, k)) {
          out[k] = resolveTokens(value[k], elements);
        }
      }
      return out;
    }
    return value;
  }

  var SCALED_MINMAX = { damage: 1, heal: 1, poison: 1, chain: 1 };

  // ELEMENTO PURO — o bônus de fundir dois heróis do MESMO elemento.
  //
  // A regra do jogo tem duas metades e elas se equilibram: mistura dá
  // FLEXIBILIDADE (dois elementos batendo, então a resistência do bicho só
  // segura metade do golpe), elemento puro dá FORÇA BRUTA (um elemento só, mas
  // maior). Sem esta metade, fundir dois piromantes não valia nada: os dois
  // tokens viravam 'fogo' e o golpe saía igual ao de qualquer outra dupla,
  // enquanto o bicho resistente a fogo segurava o golpe INTEIRO. Era a pior
  // combinação possível — menos flexível E não mais forte.
  //
  // Vale só para o DANO daquele elemento: cura e escudo não são elementais, e
  // multiplicá-los faria do elemento puro a escolha certa para tudo.
  var PURO_MULT = 1.25;

  function bonusPureza(elements) {
    return (elements && elements.length > 1 && elements[0] === elements[1]) ? PURO_MULT : 1;
  }
  Fusion.PURO_MULT = PURO_MULT;

  function scaleEffect(eff, factor, puro) {
    var out = {};
    for (var k in eff) if (Object.prototype.hasOwnProperty.call(eff, k)) out[k] = eff[k];
    // O bônus de pureza só toca o que FERE, e só na cor certa.
    if (puro && puro > 1 && (out.type === 'damage' || out.type === 'poison' || out.type === 'chain')) {
      factor = factor * puro;
    }
    if (SCALED_MINMAX[out.type]) {
      if (typeof out.min === 'number') out.min = Math.max(1, Math.round(out.min * factor));
      if (typeof out.max === 'number') out.max = Math.max(out.min || 1, Math.round(out.max * factor));
    }
    if (out.type === 'shield' && typeof out.value === 'number') {
      out.value = Math.round(out.value * factor);
    }
    return out;
  }

  // "poder escala pelo tier e pelo nível da fusão" (contrato §4). Os números
  // autorais de `mechanic` JÁ crescem com o tier, então o tier entra aqui só
  // como um tempero (1%/tier) e o peso real fica com o nível da fusão (3%/nível)
  // — é o que faz uma forma tier 0 valer a pena numa fusão de nível 30 sem
  // contar o tier duas vezes.
  Fusion.powerFactor = function (tier, level, pairKey) {
    var tune = (pairKey && Fusion.PAIR_TUNE[pairKey]) || 1;
    return (100 + (level || 0) * 1.2 + (tier || 0) * 1) / 100 * Fusion.POWER_MULT * tune;
  };

  Fusion.spellsFor = function (classPair, elemPair, level) {
    var forms = lookupForms(classPair);
    if (!forms || !forms.length) return [];
    var parts = splitKey(elemPair);
    var norm = normalizeElemPair(parts[0], parts[1]);
    var blend = lookupBlend(norm);
    if (!blend) return [];
    var elements = blend.elements && blend.elements.length ? blend.elements : norm;
    var K = splitKey(classPair);
    var kKey = K.length > 1 ? pairKey(K[0], K[1]) : String(classPair);
    var eKey = norm[0] + '+' + norm[1];      // ordem dos fundidos, não alfabética
    var lv = level || 0;

    var out = [];
    for (var f = 0; f < forms.length; f++) {
      var form = forms[f];
      var tier = form.tier || 0;
      if (tier > lv) continue;
      var factor = Fusion.powerFactor(tier, lv, kKey);
      var effects = [];
      var mech = form.mechanic || [];
      var i;
      var puro = bonusPureza(elements);
      for (i = 0; i < mech.length; i++) {
        effects.push(scaleEffect(resolveTokens(mech[i], elements), factor, puro));
      }
      // Formas de apoio (alvo aliado/próprio) usam `blend.riderSupport`: o rider
      // ofensivo da mistura cairia sobre o próprio aliado curado.
      var rider = (form.riderMode === 'support' && blend.riderSupport)
        ? blend.riderSupport : (blend.rider || []);
      for (i = 0; i < rider.length; i++) {
        effects.push(scaleEffect(resolveTokens(rider[i], elements), factor, puro));
      }
      out.push({
        id: 'fus:' + kKey + ':' + eKey + ':' + tier,
        name: form.formName + ' ' + blend.affix,
        element: elements[0] || 'neutro',
        elements: elements.slice(),
        classId: null,
        unlockLevel: tier,
        tier: tier,
        paCost: form.paCost || 0,
        cooldown: form.cooldown || 0,
        castsPerTurn: form.castsPerTurn || 0,
        range: form.range || { min: 1, max: 1, line: false, los: true },
        aoe: form.aoe || { shape: 'single', size: 0 },
        needsEmptyTile: !!form.needsEmptyTile,
        targetSide: form.targetSide || 'any',
        effects: effects,
        description: form.description || '',
        flavor: blend.flavor || form.flavor || '',
        // Quem decide o DESENHO e a FORMA; a mistura decide o sabor elemental.
        // Estava ao contrario (blend.fxKey primeiro) e as 16 misturas cobriam as
        // 107 formas: toda fusao do mesmo par de elementos saia com o mesmo
        // efeito, fosse escudo, meteoro ou gancho. O `fxBlend` sobra para quem
        // quiser tingir o efeito com a cor da mistura.
        fxKey: form.fxShape || blend.fxKey || 'slam',
        fxBlend: blend.fxKey || null,
        fusion: true
      });
    }
    return out;
  };

  // ------------------------------------------------------------ regras
  Fusion.canFuse = function (state, uidA, uidB) {
    if (!state || state.phase !== 'playing') return false;
    if (!uidA || !uidB || uidA === uidB) return false;
    var a = E().findUnit(state, uidA), b = E().findUnit(state, uidB);
    if (!isFusable(a) || !isFusable(b)) return false;
    if (a.side !== b.side) return false;
    // 03/09, pedido do dono: "com o GM jamais pode dar a possibilidade de
    // fusão" e "usuário só pode fundir com seus personagens" — o Mestre não
    // funde, e duas unidades de CONTAS diferentes (co-op, um dia) tampouco.
    // A conta viaja do grupo (Progress.battleParty) para a unidade.
    if (a.classId === 'gm' || b.classId === 'gm') return false;
    // 11/09 (multijogador): com DONO na unidade (o jogador da Rede que a
    // controla), quem decide é ele — e entre donos DIFERENTES a fusão só sai
    // com os DOIS aceitando, o que o lance `f` registra em
    // `state.consentimento` {a, b, T} no turno em que é declarada. A trava da
    // CONTA vale entre unidades sem dono (fora de rede, como sempre): a conta
    // é 'principal' para quase todo mundo e não separa jogadores.
    var dA = a.dono || null, dB = b.dono || null;
    if (dA || dB) {
      if (dA !== dB) {
        var cs = state.consentimento;
        if (!cs || cs.a !== uidA || cs.b !== uidB || cs.T !== (state.turno || 0)) return false;
      }
    } else if ((a.conta || null) !== (b.conta || null)) return false;
    if (manhattan(a.x, a.y, b.x, b.y) !== 1) return false;
    if (state.pendingFusion) return false;
    if (a.fusionIntent || b.fusionIntent) return false;
    return true;
  };

  Fusion.declare = function (state, uidA, uidB) {
    if (!Fusion.canFuse(state, uidA, uidB)) return false;
    var a = E().findUnit(state, uidA), b = E().findUnit(state, uidB);
    if (a.pa < Fusion.FUSION_PA_COST) return false;
    a.pa -= Fusion.FUSION_PA_COST;
    a.fusionIntent = uidB;
    state.pendingFusion = { a: uidA, b: uidB };
    E().emit({ type: 'fusionDeclared', a: uidA, b: uidB });
    E().log(a.name + ' se prepara para fundir com ' + b.name + '.');
    return true;
  };

  Fusion.cancel = function (state, reason) {
    var p = state.pendingFusion;
    if (!p) return false;
    var a = E().findUnit(state, p.a);
    if (a) a.fusionIntent = null;
    state.pendingFusion = null;
    E().emit({ type: 'fusionFailed', a: p.a, b: p.b, reason: reason || 'cancelada' });
    return true;
  };

  Fusion.resolve = function (state) {
    var p = state.pendingFusion;
    if (!p) return false;
    var a = E().findUnit(state, p.a), b = E().findUnit(state, p.b);
    state.pendingFusion = null;
    if (a) a.fusionIntent = null;

    if (!a || !a.alive || a.offBoard || !b || !b.alive || b.offBoard) {
      E().emit({ type: 'fusionFailed', a: p.a, b: p.b, reason: 'morte' });
      E().log('A fusão se desfaz.');
      return false;
    }
    if (manhattan(a.x, a.y, b.x, b.y) !== 1) {
      E().emit({ type: 'fusionFailed', a: p.a, b: p.b, reason: 'afastamento' });
      E().log(a.name + ' e ' + b.name + ' se afastaram: a fusão falha.');
      return false;
    }
    return doFuse(state, a, b);
  };

  function avgResists(a, b) {
    var out = {};
    var els = DATA().elements || ['neutro', 'fogo', 'agua', 'terra', 'ar'];
    var k;
    for (var i = 0; i < els.length; i++) {
      k = els[i];
      out[k] = Math.round((((a.resists && a.resists[k]) || 0) +
                           ((b.resists && b.resists[k]) || 0)) / 2);
    }
    for (k in (a.resists || {})) if (out[k] === undefined) {
      out[k] = Math.round((a.resists[k] + ((b.resists && b.resists[k]) || 0)) / 2);
    }
    for (k in (b.resists || {})) if (out[k] === undefined) {
      out[k] = Math.round((b.resists[k] + ((a.resists && a.resists[k]) || 0)) / 2);
    }
    return out;
  }

  function doFuse(state, a, b) {
    var classA = a.classId || a.defId;
    var classB = b.classId || b.defId;
    var kKey = Fusion.pairKey(classA, classB);
    var elemPair = normalizeElemPair(
      (E().unitElements(a) || [])[0], (E().unitElements(b) || [])[0]);
    var eKey = elemPair[0] + '+' + elemPair[1];   // ordem A,B (chaves espelhadas)
    var level = Math.floor(((a.level || 1) + (b.level || 1)) / 2);

    // ---- feitiços compostos
    var spells = Fusion.spellsFor(kKey, eKey, level);
    var ids = [];
    for (var i = 0; i < spells.length; i++) {
      E().registerSpell(spells[i]);
      if (ids.indexOf(spells[i].id) < 0) ids.push(spells[i].id);
    }
    if (!ids.length) {                       // rede de segurança: nunca kit vazio
      ids = a.spells.slice();
      for (var s = 0; s < b.spells.length; s++) {
        if (ids.indexOf(b.spells[s]) < 0) ids.push(b.spells[s]);
      }
    }

    // ---- números da fusão
    var fromUids = [a.uid, b.uid];
    var hpMax = a.hpMax + b.hpMax;
    var hp = a.hp + b.hp;
    a.hpMax = hpMax;
    a.hp = Math.min(hp, hpMax);
    a.paMax = Math.max(a.paMax, b.paMax) + Fusion.BONUS_PA;
    a.ppMax = Math.max(a.ppMax, b.ppMax) + Fusion.BONUS_PP;
    a.initiative = Math.max(a.initiative, b.initiative);
    a.power = Math.max(a.power, b.power);
    // v2.2 (contrato §9-C): `elemPower` da fusão = MÉDIA dos dois, e vale para os
    // DOIS elementos da mistura. A segunda metade da regra é resolvida por
    // `a.elements` logo abaixo: `Engine.elementalBonus` compara o elemento do
    // feitiço com `Engine.unitElements`, que devolve os dois da fusão.
    a.elemPower = Math.round(((a.elemPower || 0) + (b.elemPower || 0)) / 2);
    a.dodge = Math.round(((a.dodge || 0) + (b.dodge || 0)) / 2);
    a.lock = Math.round(((a.lock || 0) + (b.lock || 0)) / 2);
    a.resists = avgResists(a, b);
    a.level = level;
    // o `dono` e o `ia` de A ficam: a fusão é de quem a pediu e pagou os 2 PA
    // (11/09 — em grupo, até o fim da sala)
    a.kind = 'fusion';
    // `defId = 'fus:'+classA+'+'+classB` (contrato §4) com o MESMO critério
    // alfabético da chave de DATA.fusionForms: assim a aparência da fusão é
    // uma só, independentemente de quem declarou.
    a.defId = 'fus:' + kKey;
    a.name = a.name + ' + ' + b.name;
    a.classPair = kKey;
    a.elemPair = eKey;
    a.elements = elemPair.slice();
    a.element = elemPair[0];
    a.spells = ids;
    a.cooldowns = {};
    a.castsThisTurn = {};
    a.fusedFrom = fromUids.slice();

    // escudo de fusão (permanente)
    a.effects.push({ type: 'shield', value: Fusion.BONUS_SHIELD,
                     remaining: Fusion.BONUS_SHIELD, duration: 9999, sourceUid: a.uid });
    var sh = 0;
    for (var e = 0; e < a.effects.length; e++) {
      if (a.effects[e].type === 'shield') sh += a.effects[e].remaining;
    }
    a.shield = sh;

    // ---- B sai do tabuleiro: não é morte, não conta para derrota
    b.alive = false;
    b.offBoard = true;
    b.hp = 0;
    b.fusedInto = a.uid;

    // pets de B passam a acompanhar a fusão
    for (var u = 0; u < state.units.length; u++) {
      if (state.units[u].kind === 'pet' && state.units[u].ownerUid === b.uid) {
        state.units[u].ownerUid = a.uid;
      }
    }

    /* AS INVOCAÇÕES DOS DOIS SAEM DO TABULEIRO.
     *
     * Sem isto o Invocador enchia o campo com as nove dele e só então fundia —
     * a fusão herdava tudo mais a invocação própria, e fundir deixava de ser
     * troca para virar acúmulo. A ficção bate com o equilíbrio: a invocação
     * existe porque alguém a sustenta, e os dois conjuradores acabaram de
     * deixar de existir como seres separados.
     *
     * SAEM, NÃO MORREM, e a diferença não é de gosto. `processDeath` dispara os
     * traços de morte, e o CÃO DE BRASA tem `explodeOnDeath` — 20 de fogo em
     * raio 1. Matar de verdade faria fundir ao lado do próprio cão queimar o
     * próprio time, numa jogada que o jogador escolheu e por um motivo que ele
     * não tem como deduzir. Então saem como a metade B já sai: sem evento de
     * morte, sem XP, sem traço disparado. Na tela o bicho some do mesmo jeito.
     *
     * PET NÃO ENTRA NISTO (ver o laço acima): pet acompanha o dono, invocação é
     * sustentada por ele. São coisas diferentes e continuam diferentes.
     */
    var saiu = 0;
    for (var v = 0; v < state.units.length; v++) {
      var iv = state.units[v];
      if (!iv || iv.kind !== 'summon' || !iv.alive || iv.offBoard) continue;
      // `summonerUid`, NAO `ownerUid`. Quem invoca grava em `summonerUid`
      // (ver `spawnMonsterUnit` em engine.js); `ownerUid` e do PET. Escrevi
      // `ownerUid` de primeira, copiando o laço dos pets logo acima, e o teste
      // mostrou as duas invocações vivas depois de fundir.
      if (iv.summonerUid !== a.uid && iv.summonerUid !== b.uid) continue;
      iv.alive = false;
      iv.offBoard = true;
      iv.hp = 0;
      saiu++;
      E().emit({ type: 'death', uid: iv.uid });   // o desenho precisa retirá-la
    }
    if (saiu) {
      E().log(saiu === 1 ? 'A invocação se desfaz com a fusão.'
                           : ('As ' + saiu + ' invocações se desfazem com a fusão.'));
    }

    E().emit({ type: 'fusion', uid: a.uid, from: fromUids, classPair: kKey,
               elemPair: eKey, level: level, defId: a.defId, spells: ids.slice() });
    E().emit({ type: 'shield', uid: a.uid, amount: Fusion.BONUS_SHIELD });
    E().log(a.name + ' surge da fusão!');
    return true;
  }

  // Morte da fusão: some de vez. Os dois fundidos NÃO voltam.
  Fusion.split = function (state, uid) {
    var f = E().findUnit(state, uid);
    if (!f || f.kind !== 'fusion') return false;
    var from = f.fusedFrom || [];
    for (var i = 0; i < from.length; i++) {
      var src = E().findUnit(state, from[i]);
      if (src && src !== f) { src.alive = false; src.offBoard = true; src.hp = 0; }
    }
    E().emit({ type: 'fusionEnd', uid: uid, from: from.slice() });
    return true;
  };

  // Utilidade para a UI: com quem esta unidade pode se fundir agora.
  Fusion.candidates = function (state, uid) {
    var out = [];
    for (var i = 0; i < state.units.length; i++) {
      var u = state.units[i];
      if (u.uid === uid) continue;
      if (Fusion.canFuse(state, uid, u.uid)) out.push(u.uid);
    }
    return out;
  };
})();
