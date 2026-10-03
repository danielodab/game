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
 *  - Escala de poder dos feitiços compostos (Fusion.powerFactor):
 *        fator = (100 + nível*1,2 + tier*1) / 100 × POWER_MULT × tuneDe(dupla, nível)
 *    aplicada a min/max de damage/heal/poison/chain e a shield.value. É a
 *    leitura de "poder escala pelo tier e pelo nível da fusão" (contrato §4);
 *    o coeficiente da dupla varia com o nível desde 03/10 (PAIR_TUNE).
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

  // AJUSTE FINO POR DUPLA, NO NÍVEL DA FUSÃO. Depois de acertar a média com
  // POWER_MULT, sobra dispersão POR DUPLA, porque as formas de fusão de cada par
  // não valem o mesmo em relação aos dois kits de classe que elas substituem.
  // Chave em ORDEM ALFABÉTICA, igual à de DATA.fusionForms; valor = [k5, k12,
  // k30] (ver Fusion.tuneDe).
  //
  // 03/10 — A DIMENSÃO DE NÍVEL (docs/EQUILIBRIO.md §1.3 e §5). O coeficiente
  // era um número só por dupla, e um número só não fecha os dois lados quando
  // a razão fundida/separados muda com o nível: para caber em ±20% no 12 e no
  // 30 era preciso que a razão entre eles fosse ≤ 1,5, e em seis duplas ia de
  // 1,52 a 2,90 (README §7.1, a dívida antiga). Agora são três âncoras, nos
  // níveis 5, 12 e 30, ajustadas por mínimos quadrados (no logaritmo) sobre a
  // medida de tests/equilibrio.js nos níveis 5, 12, 20 e 30 — e CONFERIDAS no 16
  // e no 25, que o ajuste nunca viu. Três parâmetros para quatro pontos não
  // passam por construção, e os dois níveis de fora dizem se a linha entre as
  // âncoras é verdade ou decoreba.
  // A medida é a da bancada nova: três rodadas inteiras de cada lado, um alvo e
  // um grupo de três, as dezesseis misturas de elemento (os quatro defeitos antigos e o
  // quinto — medir um turno só — estão em tests/equilibrio_bancada.js). Ela foi
  // refeita DEPOIS do acerto das classes (o lado "separados" mudou) e depois do
  // conserto do feitiço misto (engine.js, feiticoMisto): o 3,83 do Muro Vivo
  // existia para tapar a Sentinela que matava o próprio ídolo.
  Fusion.PAIR_TUNE = {
    'arqueiro+bruxo':        [0.951, 0.813, 0.641],
    'arqueiro+curandeiro':   [0.917, 0.600, 0.739],
    'arqueiro+espadachim':   [1.832, 1.208, 1.269],
    'arqueiro+invocador':    [0.838, 0.661, 0.669],
    'arqueiro+minotauro':    [1.141, 1.065, 1.008],
    'arqueiro+sumo':         [1.371, 1.014, 0.773],
    'bruxo+curandeiro':      [0.913, 0.677, 0.490],
    'bruxo+espadachim':      [1.236, 0.857, 0.688],
    'bruxo+invocador':       [1.095, 0.900, 0.634],
    'bruxo+minotauro':       [1.131, 0.971, 0.812],
    'bruxo+sumo':            [1.384, 1.184, 0.714],
    'curandeiro+espadachim': [1.432, 0.759, 0.837],
    'curandeiro+invocador':  [0.630, 0.399, 0.595],
    'curandeiro+minotauro':  [2.224, 1.550, 1.295],
    'curandeiro+sumo':       [0.933, 0.722, 1.125],
    'espadachim+invocador':  [1.237, 0.716, 0.540],
    'espadachim+minotauro':  [2.416, 1.911, 1.249],
    'espadachim+sumo':       [1.875, 1.426, 0.963],
    'invocador+minotauro':   [3.138, 1.664, 0.648],
    'invocador+sumo':        [1.046, 0.861, 0.723],
    'minotauro+sumo':        [1.717, 1.296, 0.984]
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
    // 03/10: os ESPINHOS do muro (`fere`) NÃO passam por aqui, de propósito. O fator
    // traz o PAIR_TUNE, que compensa o quanto as formas de uma dupla rendem contra os
    // dois kits separados — chega a 3,1 no nível 5 —, e a pedra da fusão do Minotauro
    // feriria 120 de base onde a dele fere 30. O muro é o verbo DELE: o número é o da
    // classe (MURO_FERE em fusions.js), e o poder da fusão entra na hora de erguer
    // (engine.js, Engine.fereDoMuro), como em qualquer muro.
    return out;
  }

  // "poder escala pelo tier e pelo nível da fusão" (contrato §4). Os números
  // autorais de `mechanic` JÁ crescem com o tier, então o tier entra aqui só
  // como um tempero (1%/tier) e o peso real fica com o nível da fusão (3%/nível)
  // — é o que faz uma forma tier 0 valer a pena numa fusão de nível 30 sem
  // contar o tier duas vezes.
  Fusion.powerFactor = function (tier, level, pairKey) {
    var tune = Fusion.tuneDe(pairKey, level);
    return (100 + (level || 0) * 1.2 + (tier || 0) * 1) / 100 * Fusion.POWER_MULT * tune;
  };

  /* O COEFICIENTE DA DUPLA NO NÍVEL DA FUSÃO (03/10). Um trio [k5, k12, k30]
   * vale k5 até o nível 5, k30 do 30 em diante e anda em linha reta NO
   * LOGARITMO entre os vizinhos (a razão fundida/separados é multiplicativa:
   * o meio do caminho entre 0,8 e 1,25 é 1,0, não 1,025). Um número sozinho
   * vale para todos os níveis (o formato antigo).
   * Por que três pontos e não dois: a razão de várias duplas NÃO anda em linha
   * reta com o nível — no 5 a fusão só tem as formas de degrau 0 e 5, e a
   * dupla que não tem golpe de base repetível despenca ali e se recupera no
   * 12. Com dois pontos o resíduo passava de 50% (medido). Os três são
   * ajustados nos níveis 5, 12, 20 e 30 e CONFERIDOS no 16 e no 25, que o
   * ajuste nunca viu (docs/EQUILIBRIO.md §1.3). */
  Fusion.TUNE_NIVEIS = [5, 12, 30];
  Fusion.tuneDe = function (pairKey, level) {
    var t = pairKey ? Fusion.PAIR_TUNE[pairKey] : null;
    if (t == null) return 1;
    if (typeof t === 'number') return t;
    var N = Fusion.TUNE_NIVEIS, lv = level || 0;
    if (lv <= N[0]) return t[0];
    if (lv >= N[N.length - 1]) return t[t.length - 1];
    for (var i = 1; i < N.length; i++) {
      if (lv <= N[i]) {
        var f = (lv - N[i - 1]) / (N[i] - N[i - 1]);
        return t[i - 1] * Math.pow(t[i] / t[i - 1], f);
      }
    }
    return t[t.length - 1];
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
    // fusão" — o Mestre não funde.
    if (a.classId === 'gm' || b.classId === 'gm') return false;
    /* FUNDIR É COISA DE UM JOGADOR SÓ (12/09, pedido do dono: "dois
     * personagens diferentes jamais podem se fundir… o jogador só pode fundir
     * com seus personagens e não com os do outro jogador").
     *
     * De 11/09 até aqui a fusão ENTRE JOGADORES existia, com os dois
     * aceitando: um pedido viajava pela Rede, o outro dizia sim e o lance `f`
     * carregava esse sim em `state.consentimento`. Isso acabou — a regra agora
     * é absoluta, e por isso ela mora NESTA função e não na UI: o caminho de
     * rede (o lance `f` que chega do outro cliente) passa pela mesma porta, e
     * um cliente alterado que mande `f` com o herói de outro dono não funde
     * nada. `state.consentimento` deixou de existir: ninguém o escreve nem o
     * lê (o `Engine.hash` também não o cita mais).
     *
     * `dono` é o jogador da Rede que controla a unidade; `conta` é a trava de
     * fora da rede, que continua valendo para quem desce sozinho (é
     * 'principal' para quase todo mundo e não separa jogadores). */
    var dA = a.dono || null, dB = b.dono || null;
    if (dA || dB) {
      if (dA !== dB) return false;
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
