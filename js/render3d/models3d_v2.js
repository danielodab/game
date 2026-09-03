var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

// ============================================================================
// JOGO.Models3D2 — catálogo de modelos 3D do SOTERRA 2.0
// Dono: Agente de Migração 3D.  Lei: docs/CONTRACT_V2.md §9 + adendos.
//
// O que este arquivo faz:
//   1. decodifica os GLB embutidos em base64 (JOGO.MODELS, de
//      assets/embedded/models-*.js) — o jogo abre por file://, onde fetch de
//      .glb falha, então NADA é buscado na rede;
//   2. mantém UM banco de animações do KayKit (os 9 personagens dividem o mesmo
//      esqueleto de 41 ossos, então 30 clipes servem para todos) e usa os
//      clipes PRÓPRIOS de cada criatura Quaternius;
//   3. traduz AÇÕES LÓGICAS ('idle','walk','attack','cast','hit','die'…) para o
//      clipe certo de cada modelo — o renderizador nunca cita nome de clipe;
//   4. clona modelos com esqueleto (SkeletonUtils.clone reimplementado — o
//      vendor não traz o utilitário) e tinge o material por classe/elemento;
//   5. resolve `defId -> aparência`: 6 classes, 66 monstros (por família, com
//      exceções por id), 6 chefes, 6 pets e as 15 FUSÕES;
//   6. gera RETRATOS a partir dos próprios modelos (cena offscreen, luz de três
//      pontos) — a HUD ganha retrato de tudo sem arte manual.
//
// API:
//   Models3D2.CELL · load(cb) · isReady()
//   Models3D2.unit(defId, opts) -> THREE.Group        (opts: element, elements, boss, kind, classId)
//   Models3D2.lookFor(defId, opts) -> descrição da aparência
//   Models3D2.portrait(defId, opts) -> HTMLCanvasElement (cacheado)
//   Models3D2.portraitFraming(node) -> câmera do retrato medida na geometria
//   Models3D2.elementColor(e) · attach(group, modelKey, meshName, boneName)
//
// Cada grupo devolvido por `unit` traz em `userData`:
//   { model, mixer, height, radius, bones:{handR,handL,head,chest},
//     play(acao, opts), has(acao), tintMats[], look, procAnimate(st,t,dt) }
// ============================================================================

(function () {
  'use strict';
  if (typeof THREE === 'undefined') {
    if (typeof console !== 'undefined') console.error('[Models3D2] THREE ausente');
    return;
  }

  var M = {};
  JOGO.Models3D2 = M;

  M.CELL = 2.0;
  var UNIT_SCALE = 0.92;

  // ------------------------------------------------------------------ cores
  var ELEMENT_COLORS = {
    neutro: '#d8dee4', fogo: '#ff8c3a', agua: '#57c8ec',
    terra: '#9bd06a', ar: '#c8b6ff'
  };
  M.ELEMENT_COLORS = ELEMENT_COLORS;
  M.elementColor = function (e) { return ELEMENT_COLORS[e] || ELEMENT_COLORS.neutro; };

  function hexInt(c) {
    if (typeof c === 'number') return c;
    if (typeof c !== 'string') return 0xffffff;
    var s = c.charAt(0) === '#' ? c.slice(1) : c;
    if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    var n = parseInt(s, 16);
    return isNaN(n) ? 0xffffff : n;
  }
  M.hexInt = hexInt;
  // three r147 roda em legacyMode: o material do glTF guarda cor LINEAR, mas
  // um hex escrito a mao esta em sRGB. Sem converter, tudo sai lavado.
  function col3(c) { return new THREE.Color(hexInt(c)).convertSRGBToLinear(); }
  M.col3 = col3;
  function hashStr(s) {
    var h = 2166136261; s = String(s || '');
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 16777619) >>> 0; }
    return h >>> 0;
  }
  M.hashStr = hashStr;
  function DATA() { return JOGO.DATA || {}; }

  // ============================================================ AÇÕES LÓGICAS
  // O renderizador pede 'attack'; aqui decidimos qual dos 76–95 clipes do
  // KayKit (ou dos 3–13 do Quaternius) responde por isso naquele modelo.
  var KAYKIT_ACTIONS = {
    idle: 'Idle', walk: 'Walking_A', run: 'Running_A', fly: '',
    attack: '1H_Melee_Attack_Slice_Diagonal', attackAlt: '1H_Melee_Attack_Chop',
    attack2h: '2H_Melee_Attack_Chop', attackSpin: '2H_Melee_Attack_Spin',
    shoot: '1H_Ranged_Shoot', aim: '1H_Ranged_Aiming',
    cast: 'Spellcast_Shoot', castRaise: 'Spellcast_Raise',
    castLoop: 'Spellcasting', castLong: 'Spellcast_Long', summon: 'Spellcast_Summon',
    hit: 'Hit_A', die: 'Death_A', diePose: 'Death_A_Pose',
    cheer: 'Cheer', taunt: 'Taunt', block: 'Block', blocking: 'Blocking',
    dodge: 'Dodge_Backward', punch: 'Unarmed_Melee_Attack_Punch_A',
    throw: 'Throw', use: 'Use_Item', interact: 'Interact',
    jump: 'Jump_Full_Short', pickup: 'PickUp',
    spawn: 'Spawn_Ground', awaken: 'Skeletons_Awaken_Standing'
  };
  // fallback: se a ação não existir no modelo, tenta esta cadeia
  //
  // LOCOMOÇÃO (defeito "os monstros se arrastam"): nem todo bicho do acervo
  // ANDA. O sapo do Quaternius só traz Attack/Death/Idle/Jump — foi feito para
  // se locomover PULANDO; a vespa só traz Attack/Death/Flying. Com a cadeia
  // antiga (`run → walk → idle`) os dois caíam no clipe de PARADO enquanto
  // deslizavam pelo tabuleiro. Agora `walk`/`run` passam por `fly` e `jump`
  // antes de desistir, e só então viram `idle`.
  var ACTION_FALLBACK = {
    run: ['walk', 'fly', 'jump', 'idle'], walk: ['run', 'fly', 'jump', 'idle'],
    fly: ['idle'],
    attackAlt: ['attack'], attack2h: ['attack'], attackSpin: ['attack2h', 'attack'],
    shoot: ['attack'], aim: ['idle'],
    cast: ['attack'], castRaise: ['cast', 'attack'], castLoop: ['idle'],
    castLong: ['castLoop', 'cast'], summon: ['cast'],
    hit: ['idle'], die: ['idle'], diePose: ['die'],
    cheer: ['idle'], taunt: ['idle'], block: ['idle'], blocking: ['idle'],
    dodge: ['jump', 'idle'], punch: ['attack'], throw: ['attack'],
    use: ['interact', 'idle'], interact: ['idle'], jump: ['idle'],
    pickup: ['interact', 'idle'], spawn: ['jump', 'idle'], awaken: ['idle']
  };

  // criaturas Quaternius: cada GLB traz os próprios clipes ('RatArmature|Rat_Run')
  function autoActions(clipNames) {
    var out = {};
    function pick(re, key) {
      if (out[key]) return;
      for (var i = 0; i < clipNames.length; i++) if (re.test(clipNames[i])) { out[key] = clipNames[i]; return; }
    }
    pick(/Idle$|Idle_2$|Flying$/i, 'idle');
    pick(/Walk$|Walk_Cycle$|Swim$|Slither$|Crawl$/i, 'walk');
    pick(/Run$|Gallop$|Sprint$/i, 'run');
    // voar é locomoção E parada ao mesmo tempo (a vespa flutua no lugar): o
    // mesmo clipe entra como `idle` e como `fly`, e a diferença fica no ritmo.
    pick(/Fly$|Flying$|Fly_Cycle$|Hover$/i, 'fly');
    pick(/Attack$|Strike$|Slash$|Cast$/i, 'attack');
    pick(/Death$|^die$|Dying$|Defeat$/i, 'die');
    pick(/Jump$|Jump_ToIdle$/i, 'jump');
    // ESQUIVA propria, quando o acervo traz uma. Ate agora ela so existia como
    // heranca do pulo (ver o fim desta funcao), e num acervo sem pulo o
    // personagem esquivava sem mexer um musculo.
    pick(/^dodge$|Dodge$|Evade$|Roll$|Sidestep$/i, 'dodge');
    // `hit` alem de `HitReact`: o KayKit nomeia HitReact, outros acervos nomeiam
    // hit, Damage ou Impact. Procurar so um nome deixava o Bruxo e o Xama SEM
    // reacao a dano — o jogador batia e o boneco nao piscava. E o pior tipo de
    // falha: nao da erro, so nao acontece nada.
    pick(/HitReact|^hit$|Damage$|Impact$|Flinch$/i, 'hit');
    pick(/Eating$|Idle_2/i, 'interact');
    if (!out.idle && clipNames.length) out.idle = clipNames[0];
    if (out.attack) { out.cast = out.attack; out.shoot = out.attack; out.punch = out.attack; }
    if (out.jump && !out.dodge) out.dodge = out.jump;
    return out;
  }

  // ---------------------------------------------------------------- APARÊNCIA
  // NOTA DE CONCEITO: as aparências mudaram para caber no acervo CC0. A
  // identidade TÁTICA de cada classe está preservada; o visual é novo.
  M.CLASS_LOOK = {
    // BÁRBARO: o usuário pediu "mais forte de músculos" e "cara de feroz".
    // `build` engrossa tronco e ombros e encurta as pernas por escala de OSSO —
    // a razão largura/altura vai de 1,24 para 2,52 sem tocar em geometria.
    // `headTilt` baixa a cabeça (testa à frente, olhar de touro). Ele é POSTURA,
    // aplicado DEPOIS da animação a cada quadro: se fosse gravado no osso, o
    // clipe de andar sobrescreveria e a pose sumiria em movimento.
    // DOIS MACHADOS (pedido do usuario). O machado de duas maos e gramatica de
    // dano; a classe e o TANQUE, e um machado em cada mao le como quem entra e
    // segura. As duas pecas ja estavam dentro do arquivo, desligadas.
    // MODELO NOVO (Meshy, feito pelo usuario). Sem `show`, `build` nem
    // `headSwap`: aquilo era guarda-roupa e escala de osso do KayKit. O corpo
    // novo ja vem com as armas modeladas e a musculatura esculpida, e manter
    // as linhas antigas faria o jogo procurar malha inexistente em silencio.
    sumo: { model: 'meshy_sumo', show: ['1H_Axe', '1H_Axe_Offhand', 'Barbarian_Cape'],
            // 1,28 e nao 1,22: `build` encurta as pernas (perna 0.88), entao o
            // corpo mede ~5% menos do que a escala promete. Medido, nao suposto.
            scale: 1.28, tint: '#d4553f', accent: '#ffd08a', weapon: '1H_Axe',
            // `cabeca` 0,92 -> 0,78: com o tronco a 1,42 a cabeça ficava do mesmo
            // tamanho de antes e, ao lado de um corpo largo, LIA como maior.
            // Quem tem músculo tem a cabeça proporcionalmente MENOR — foi o
            // relato: "ele deve ser grande e forte de corpo, não de cabeça".
            build: { chest: 1.42, ombro: 1.34, braco: 1.38, perna: 0.88, cabeca: 0.78 },
            headTilt: 0.30,
            concept: 'Bárbaro brutamontes de dois machados, capa e cabeça baixa' },
    // CAÇADOR (v3, corpo do Meshy feito pelo usuário). Substitui o Batedor
    // encapuzado do KayKit, que segurava o lugar do `arqueiro` desde o início.
    // Sem `show` nem `weapon`: o corpo já vem com a arma modelada, e pendurar
    // a besta do KayKit no osso da mão só poria arma em cima de arma — foi o
    // mesmo raciocínio do Minotauro e da Curandeira.
    //
    // `scale` fica em 1,00: o corpo mede 2,05 m, que é a altura certa dele na
    // escada de porte do elenco (o Bárbaro acima, o Ladino em 1,75 m abaixo).
    //
    // O `tint` verde é herdado do Batedor e é o mesmo `palette.primary` da
    // classe em `classes.js`. Não mexi: a cor é o que separa a classe das
    // outras no tabuleiro e trocá-la sozinha aqui deixaria HUD e boneco
    // discordando. O casaco do Caçador é castanho, então um dia vale rever as
    // duas juntas.
    arqueiro: { model: 'meshy_arqueiro',
            scale: 1.00, tint: '#4f9d6a', accent: '#d8f0a0',
            concept: 'Caçador barbudo de espingarda, chapéu de aba larga e casaco de pele' },
    // BRUXO: o usuário pediu cabelo e barba BRANCOS, "referência a mais velho e
    // experiente". O modelo do mago não tem barba — quem tem é o Bárbaro, e as
    // bind poses dos 9 humanoides KayKit são idênticas, então a cabeça troca.
    // `headSwap` põe a cabeça barbada no corpo do mago e `headTint` a embranquece.
    // O grimorio fechado estava desligado. O mago segurava so o cajado e a mao
    // esquerda ficava vazia — de longe lia como bengala.
    bruxo: { model: 'meshy_bruxo', show: ['2H_Staff', 'Spellbook', 'Mage_Hat', 'Mage_Cape'],
            // 1,80 m pedidos pelo Daniel. A escala nao e a altura: o corpo mede
            // ~2,05 m vezes ela, entao 1,80 / 2,05 = 0,877.
            scale: 0.877, tint: '#7a5fa0', accent: '#b98cff', weapon: '2H_Staff',
            headSwap: { model: 'barbarian', mesh: 'Barbarian_Head' },
            headTint: '#fbfaf7', headWhite: 0.88,
            concept: 'Mago velho de barba branca, chapéu pontudo e cajado' },
    // LADINO: o usuário pediu máscara preta na boca. O acervo não tem nenhuma
    // peça de rosto além de cabeças, chapéus e um elmo — então a faixa é
    // GEOMETRIA GERADA, presa ao osso da cabeça (ver `poeMascara`).
    // A CAPA estava declarada em CLASS_MARK (e ia para as fusoes) e nunca era
    // mostrada na propria classe: o Ladino era o unico sem silhueta nas costas.
    espadachim: { model: 'meshy_espadachim', show: ['Knife', 'Knife_Offhand', 'Rogue_Cape'],
            // 1,75 m pedidos pelo Daniel: o MENOR do grupo. A classe e esquiva e
            // invisibilidade, e corpo pequeno e o que a silhueta diz sobre isso.
            scale: 0.852, tint: '#2f6f8f', accent: '#9be8ff', weapon: 'Knife',
            // MÁSCARA REMOVIDA a pedido do usuário ("a máscara ficou muito ruim
            // do ladino, pode tirar"). A geometria gerada por `poeMascara`
            // continua no arquivo e volta com uma linha, mas numa cabeça chibi
            // de 40 px no tabuleiro a faixa vira um borrão preto sem leitura.
            // A roupa escura sozinha já separa o Ladino do Caçador.
            // roupa preta: o corpo, braços e pernas do Ladino têm a textura
            // clareada na direção do preto, do mesmo jeito que a barba do Bruxo
            // vai para o branco. Tingir o material não serviria — a cor vem do
            // atlas e multiplicar só escurece de forma suja.
            bodyTint: { cor: '#1b1e24', forca: 0.78,
                        malhas: ['Rogue_Body', 'Rogue_ArmLeft', 'Rogue_ArmRight',
                                 'Rogue_LegLeft', 'Rogue_LegRight'] },
            concept: 'Ladino ágil de adagas gêmeas, roupa preta e máscara' },
    // CURANDEIRA (v3, corpo do Meshy feito pelo usuario). Substitui o cavaleiro
    // KayKit que segurava o lugar desde que a Paladina virou Curandeiro. Sem
    // `show`: o corpo ja vem com o cajado, os frascos no cinto e a capa
    // modelados — emprestar peca do KayKit so poria espada em cima de cajado.
    //
    // O TOM continua dourado, e nao o verde-agua da roupa dela: o Xama ja usa
    // '#3f8f8a', e duas classes de apoio na mesma cor seriam indistinguiveis no
    // tabuleiro, que e onde a cor precisa trabalhar. O dourado esta na arte
    // dela de qualquer forma (todo o filete da roupa e o brilho do cajado).
    curandeiro: { model: 'meshy_curandeiro',
            scale: 0.96, tint: '#e8c46a', accent: '#fff4cf',
            concept: 'Curandeira de cajado com luz, frascos no cinto e roupa verde-clara' },
    // MINOTAURO (v3). Nasce ja com o corpo do Meshy — nao passou pela fase
    // KayKit, entao nao tem `show` nem guarda-roupa a ligar.
    minotauro: { model: 'meshy_minotauro',
            scale: 1.28, tint: '#8a6a4f', accent: '#d9c39a',
            concept: 'Minotauro de escudo enorme, que ergue muro no chao' },
    invocador: { model: 'meshy_invocador', show: ['Spellbook_open', '1H_Wand', 'Mage_Cape'],
            scale: 1.00, tint: '#3f8f8a', accent: '#8ff0d8', weapon: '1H_Wand',
            concept: 'Xamã de grimório aberto e varinha, sem chapéu' },
    // MESTRE DO FUNDO (03/09) — o Cavaleiro Negro do dono, corpo do Meshy.
    // A classe `gm` só existe com a chave (js/core/gm.js); o look é fixo e
    // inofensivo sem ela. O motor normaliza todo herói a 2,05 m ANTES da
    // escala (targetH em finalizaUnidade), então o 1,67 m cru do Meshy não
    // conta: 1,04 leva a ~2,13 m — acima do Caçador (2,05), abaixo do Bárbaro.
    // Impõe sem sair da escada. tint/accent = palette da classe (vinho e ouro).
    gm: { model: 'meshy_gm',
            scale: 1.04, tint: '#8a1f2d', accent: '#c9a227',
            concept: 'Cavaleiro negro de espadão às costas, armadura fechada e olhar de dono' }
  };

  // ------------------------------------------------------- MARCAS DE CLASSE
  // O que cada classe DOA para uma fusão. A regra do usuário: "a classe com
  // características de outras, tipo chapéu, roupa, arma.. mas que dê pra
  // identificar que aquilo foi uma fusão das classes X e Y".
  //
  // Medido: nos 5 modelos KayKit os aderecos (chapeu, elmo, capa, arma, escudo)
  // sao malhas SIMPLES penduradas num osso — nao sao skinned. E os 5 modelos
  // tem os MESMOS 41 ossos com os mesmos nomes (`head`, `chest`, `handslotl`,
  // `handslotr`). Entao a peca de um entra no osso do outro com um `add`, sem
  // reajustar pele nenhuma.
  //
  // `head` e a marca mais legivel de longe (muda a silhueta). `hand` entra
  // SEMPRE na mao esquerda do anfitriao, que fica livre ou carrega o item menos
  // identificador dele — a mao direita, com a arma principal do anfitriao,
  // nunca e tomada. Arqueiro e espadachim nao tem peca de cabeca (o capuz faz
  // parte da malha da cabeca, que e skinned): a arma responde por eles.
  // A arma-assinatura de cada classe: a peca que, sozinha, diz "esta classe
  // esteve aqui". Vai para a mao livre do anfitriao quando ele funde.
  // Sao pecas de UMA mao de proposito: a de duas maos entra atravessada no
  // corpo do anfitriao, que ja segura a propria.
  // `model` diz de QUAL arquivo a peca sai. Enquanto todas as classes usavam
  // KayKit isso era implicito (`look.model`); agora tres delas usam corpo do
  // Meshy, que nao tem guarda-roupa separavel, e sem esta coluna a marca do
  // convidado sumiria da fusao sem erro nenhum.
  M.CLASS_MARK = {
    sumo:       { model: 'barbarian', head: 'Barbarian_Hat', cape: 'Barbarian_Cape', hand: '1H_Axe' },
    // A BESTA NAO E DESCUIDO. O Cacador usa espingarda de dois canos, e a
    // espingarda esta MODELADA no corpo Meshy dele — mas `CLASS_MARK` e o que
    // as FUSOES herdam, e o corpo fundido e do KayKit, cujo acervo tem
    // exatamente cinco armas: machado, machado auxiliar, besta, varinha e
    // cajado. Nao ha arma de fogo nenhuma. A besta e a unica peca de longo
    // alcance que existe, entao ela fica — e fica anotado, para ninguem
    // "consertar" isto depois procurando uma espingarda que o acervo nao tem.
    arqueiro:   { model: 'rogue',     head: null,            cape: 'Rogue_Cape',     hand: '1H_Crossbow' },
    bruxo:      { model: 'mage',      head: 'Mage_Hat',      cape: 'Mage_Cape',      hand: '1H_Wand' },
    espadachim: { model: 'rogue',     head: null,            cape: 'Rogue_Cape',     hand: 'Knife_Offhand' },
    curandeiro: { model: 'knight',    head: 'Knight_Helmet', cape: 'Knight_Cape',    hand: 'Badge_Shield' },
    invocador:  { model: 'mage',      head: null,            cape: 'Mage_Cape',      hand: 'Spellbook_open' },
    // O Minotauro empresta o ESCUDO na fusao — e a peca que diz o verbo dele.
    minotauro:  { model: 'knight',    head: null,            cape: 'Knight_Cape',    hand: 'Spike_Shield' }
  };

  // Monstros — 3 fontes, escolhidas por id/família:
  //   1. `proc:true` → modelo procedural da camada v1 (js/render3d/models3d.js),
  //      feito sob medida para ESTE bestiário (flora, corte afogada, fornalha);
  //   2. esqueletos KayKit (mesma família visual dos heróis) para humanoides;
  //   3. criaturas Quaternius (CC0, animadas) para bichos.
  var MONSTER_LOOK = {
    /* INVOCACOES DE FUSAO. Ate agora as cinco caiam todas no
     * `MONSTER_FALLBACK` — o esqueletinho generico —, entao cinco criaturas
     * diferentes nas regras viravam um boneco so na tela. Esta e a primeira com
     * arte propria; as outras quatro entram aqui quando chegarem.
     *
     * 1,31 x 1,80 m = 2,36 m: mais alto que o heroi de 2,05 e mais baixo que a
     * fusao que o chama. Ele domina o tabuleiro sem competir com o dono.
     */
    'fus-bulwark-idol': { model: 'fus_idolo_escora', scale: 1.31 },
    /* O MURO-VIGIA e do MURO VIVO (Invocador + Minotauro). Mesmo porte do
     * Idolo-Escora, silhueta oposta: um entope a passagem pela LARGURA, o outro
     * e uma parede que anda. As duas nunca dividem tela — fundido, o Xama perde
     * as invocacoes dele —, entao a diferenca serve a quem MODELA, para nao
     * repetir a mesma silhueta duas vezes. */
    'fus-wall-watcher': { model: 'fus_muro_vigia', scale: 1.31 },
    // o idle do totem NAO tem clipe (arquivo veio sem animacao) e esta certo
    // assim: objeto fincado descansa parado; resolve() devolve null sem drama
    'fus-arrow-turret': { model: 'fus_totem_espoleta', scale: 1.31 },
    /* As TRES invocacoes das fusoes do Xama (30/08). Escala pela descricao,
     * como sempre (altura = 1,80 m x escala):
     *   Efigie: boneco de cera — pequeno mas legivel no tabuleiro.
     *   Guarda-Flor: "do tamanho de um cao".
     *   Gemeo de Breu: a sombra da PROPRIA fusao — porte de gente. */
    'fus-hex-effigy':   { model: 'fus_efigie_runica', scale: 0.66 },  // 1,19 m
    'fus-bloom-warden': { model: 'fus_guarda_flor',   scale: 0.58 },  // 1,04 m
    'fus-shade-twin':   { model: 'fus_gemeo_breu',    scale: 1.06 },  // 1,91 m

    // --- Flora Voraz + Enxame (Estufa) — A ARTE E DO USUARIO (v3).
    //
    // Os nove sairam do Meshy, todos humanoides. Antes eram emprestados: sapo,
    // aranha e cobra do Quaternius e um esqueleto mago do KayKit fazendo o
    // papel de toco de arvore. Agora sao as criaturas do bestiario.
    //
    // A ESCALA SAI DA DESCRICAO EM `js/core/data/monsters.js`, nao de gosto.
    // Conta: altura = 1,80 m x escala (chefe: 2,95 m x escala). O metro anotado
    // ao lado de cada linha e o resultado, para conferir sem refazer a conta.
    //
    // Sem `show:` em lugar nenhum: aquilo era guarda-roupa do KayKit, e pedir
    // malha que nao existe falha EM SILENCIO (foi o que pegou o Sumo).
    'thorn-lasher':   { model: 'thorn-lasher',   scale: 1.00 },  // 1,80 m — chicote enraizado, nao sai do lugar
    'dew-strider':    { model: 'dew-strider',    scale: 0.90 },  // 1,62 m — "pernas finissimas"
    'sap-shaman':     { model: 'sap-shaman',     scale: 0.85 },  // 1,53 m — "toco de arvore corcunda"
    'pollen-puff':    { model: 'pollen-puff',    scale: 0.70 },  // 1,26 m — bola de polen com perninhas
    'burr-mother':    { model: 'burr-mother',    scale: 0.60 },  // 1,08 m — "do tamanho de um cao"
    'sprout-feral':   { model: 'sprout-feral',   scale: 0.55 },  // 0,99 m — "muda recem-germinada"
    'lantern-wasp':   { model: 'lantern-wasp',   scale: 0.50 },  // 0,90 m — "do tamanho de um gato"
    'burrlet':        { model: 'burrlet',        scale: 0.34 },  // 0,61 m — "metade" da Mae
    // A JARDINEIRA CAI DE 5,16 m PARA 2,95 m, e isso e conserto: a descricao
    // dela diz "um vulto de TRES METROS", e o 1,75 antigo era compensacao por
    // `q_mushnub` ser um cogumelo pequeno demais para o papel. Com modelo feito
    // sob medida a compensacao nao faz falta. Os outros chefes seguem em 1,75
    // porque ainda usam arte emprestada e ainda precisam do estirao.
    'boss-gardener':  { model: 'boss-gardener',  scale: 1.00 },  // 2,95 m — "um vulto de tres metros"
    // --- Corte Afogada (Cisterna) — A ARTE E DO USUARIO (30/08).
    //
    // Os nove sairam do Meshy, Baronesa inclusa. Antes eram emprestados (cobra,
    // sapo, aranha, esqueletos). A escala sai da DESCRICAO em monsters.js, conta
    // de sempre: altura = 1,80 m x escala (chefe: 2,95 m x escala).
    'drowned-porter': { model: 'drowned-porter', scale: 1.03 },  // 1,85 m — carregador inchado de agua
    'moray-piper':    { model: 'moray-piper',    scale: 1.11 },  // 2,00 m — "enguia de dois metros"
    'lantern-jelly':  { model: 'lantern-jelly',  scale: 0.78 },  // 1,40 m — "do tamanho de um lustre"
    'brine-golem':    { model: 'brine-golem',    scale: 1.44 },  // 2,59 m — "um colosso de sal"
    'fat-drop':       { model: 'fat-drop',       scale: 0.72 },  // 1,30 m — "do tamanho de um barril"
    'droplet':        { model: 'droplet',        scale: 0.44 },  // 0,79 m — "pequena, redonda, indignada"
    'sump-crab':      { model: 'sump-crab',      scale: 0.67 },  // 1,21 m — "do tamanho de uma mesa"
    'mist-warbler':   { model: 'mist-warbler',   scale: 0.72 },  // 1,30 m — passaro de vapor
    'boss-baroness':  { model: 'boss-baroness',  scale: 1.00 },  // 2,95 m — o vestido de baile e a sala e dele
    // --- Prole da Fornalha (Fecho de Brasa)
    'ember-imp':      { model: 'skeleton_minion', scale: 0.82 },
    'walking-anvil':  { model: 'q_bull',         scale: 1.05 },
    'ash-wraith':     { model: 'skeleton_mage',  scale: 1.00 },
    'slag-mound':     { model: 'q_frog',         scale: 1.05 },
    'faceless-smith': { model: 'skeleton_warrior', show: ['Skeleton_Axe'], scale: 1.15 },
    'quench-hound':   { model: 'q_wolf',         scale: 0.85 },
    'chain-hauler':   { model: 'skeleton_warrior', show: ['Skeleton_Axe'], scale: 1.20 },
    'spark-whelp':    { model: 'q_velociraptor', scale: 0.70 },
    'slag-bit':       { model: 'q_frog',         scale: 0.50 },
    'boss-heartforge':{ model: 'q_bluedemon',   scale: 1.85 },   // era T-Rex
    // --- Coro dos Andaimes (Andaimes do Vento)
    'plank-shrike':   { model: 'q_wasp',         scale: 0.95 },
    'gust-gremlin':   { model: 'skeleton_minion', scale: 0.85 },
    'rope-hanger':    { model: 'skeleton_rogue', scale: 1.00 },
    'kite-serpent':   { model: 'q_snake',        scale: 1.15 },
    'ballast-golem':  { model: 'skeleton_warrior', show: ['Skeleton_Shield_Large_B'], scale: 1.30 },
    'whistle-choir':  { model: 'skeleton_mage',  show: ['Skeleton_Staff'], scale: 1.00 },
    'mote-swarm':     { model: 'q_wasp',         scale: 0.70 },
    'mote-bit':       { model: 'q_wasp',         scale: 0.50 },
    'nail-sprite':    { model: 'q_wasp',         scale: 0.60 },
    'boss-windwright':{ model: 'q_alpaking',    scale: 1.76 },   // era esqueleto guerreiro
    // --- Turno da Noite (Mina Tremula)
    'pick-revenant':  { model: 'skeleton_warrior', show: ['Skeleton_Axe'], scale: 1.00 },
    'firedamp-wisp':  { model: 'q_wasp',         scale: 0.70 },
    'cave-jaw':       { model: 'q_velociraptor', scale: 0.90 },
    'crystal-chanter':{ model: 'skeleton_mage',  show: ['Skeleton_Staff'], scale: 1.05 },
    'sinkhole-worm':  { model: 'q_snake',        scale: 1.30 },
    'ore-tumbler':    { model: 'q_frog',         scale: 0.90 },
    'ore-chip':       { model: 'q_frog',         scale: 0.55 },
    'shaft-bat':      { model: 'q_wasp',         scale: 0.75 },
    'damp-seeper':    { model: 'q_frog',         scale: 0.80 },
    'boss-deepknock': { model: 'q_yeti',        scale: 1.75 },   // era triceratops DEITADO: dizia 3,84 m e media 1,81 m de pe.
                                                                //  o golem que eu tinha escolhido reprovou: largo e baixo
    // --- Guarda do Coracao (Coracao Partido)
    'cinder-herald':  { model: 'skeleton_warrior', show: ['Skeleton_Blade'], scale: 1.10 },
    'tide-herald':    { model: 'skeleton_mage',  show: ['Skeleton_Staff'], scale: 1.10 },
    'stone-herald':   { model: 'skeleton_warrior', show: ['Skeleton_Shield_Large_A'], scale: 1.15 },
    'gale-herald':    { model: 'skeleton_rogue', show: ['Skeleton_Crossbow'], scale: 1.05 },
    'null-warden':    { model: 'skeleton_warrior', show: ['Skeleton_Shield_Small_A', 'Skeleton_Blade'], scale: 1.20 },
    'mirror-twin':    { model: 'skeleton_rogue', scale: 1.00 },
    'mirror-sliver':  { model: 'skeleton_rogue', scale: 0.70 },
    'weather-mote':   { model: 'q_wasp',         scale: 0.60 },
    'heartroot':      { model: 'q_snake',        scale: 1.00 },
    'boss-riftheart': { model: 'q_ghostskull',  scale: 1.75 },   // era o MESMO T-Rex do heartforge
    // --- Rebanho do Invocador (invocacoes)
    'sporeling':          { model: 'q_frog',   scale: 0.62 },
    // Seis das sete estavam erradas no CONCEITO — cao de brasa era um lobo,
    // ninfa da mare um esqueleto mago, falcao da tempestade uma vespa — e duas
    // dividiam o MESMO modelo: colosso de magma e golem da montanha eram o
    // mesmo boi, um laranja e outro verde.
    // O REBANHO DO INVOCADOR PASSA A SER DO USUARIO (v3).
    //
    // As nove sairam do Meshy, todas humanoides — a biblioteca de animacao dele
    // e de esqueleto humanoide, e um bicho de quatro patas so teria clipe de
    // andar. As escalas abaixo saem do briefing (`docs/ARTE_REBANHO_XAMA.html`)
    // e a conta e sempre a mesma: altura em jogo = 1,80 m x escala. Os numeros
    // consertam de passagem um defeito antigo — o "Colosso" media 1,71 m e o
    // "Golem da Montanha" 1,30 m, os dois MENORES que um heroi de 2,05 m.
    'sum-familiar':       { model: 'sum_familiar',       scale: 0.61 },  // 1,10 m
    'sum-ember-hound':    { model: 'sum_ember_hound',    scale: 0.67 },  // 1,20 m
    'sum-magma-colossus': { model: 'sum_magma_colossus', scale: 1.58 },  // 2,85 m
    'sum-tide-nymph':     { model: 'sum_tide_nymph',     scale: 0.72 },  // 1,30 m
    // Os dois Golelings foram REPROVADOS de olho: pelo nome eu esperava pedra e
    // sao criaturas verdes de orelha grande, cara de goblin. Foi o mesmo erro de
    // escolher pelo nome que ja tinha me pegado antes. O pacote nao tem criatura
    // de pedra nenhuma; estas duas sao as mais minerais que ele oferece.
    'sum-stone-sentinel': { model: 'sum_stone_sentinel', scale: 1.17 },  // 2,10 m
    'sum-mountain-golem': { model: 'sum_mountain_golem', scale: 1.61 },  // 2,90 m
    'sum-storm-falcon':   { model: 'sum_storm_falcon',   scale: 0.64 },  // 1,15 m
    // as duas novas, que fecham o buraco de nivel 30 na Agua e no Ar
    'sum-drowned-cistern': { model: 'sum_drowned_cistern', scale: 1.44 }, // 2,60 m
    'sum-storm-eye':       { model: 'sum_storm_eye',       scale: 1.50 }  // 2,70 m
  };

  // Familias: rede de seguranca quando um id novo aparecer nos dados.
  M.FAMILY_LOOK = {
    'Flora Voraz':          { model: 'q_spider',         scale: 0.95 },
    'Enxame da Estufa':     { model: 'q_wasp',           scale: 0.85 },
    'Corte Afogada':        { model: 'skeleton_mage',    scale: 1.00 },
    'Prole da Fornalha':    { model: 'skeleton_warrior', scale: 1.00 },
    'Coro dos Andaimes':    { model: 'skeleton_rogue',   scale: 1.00 },
    'Turno da Noite':       { model: 'skeleton_minion',  scale: 1.00 },
    'Guarda do Coração':    { model: 'skeleton_warrior', scale: 1.10 },
    'Rebanho do Invocador': { model: 'skeleton_minion',  scale: 0.90 }
  };
  M.MONSTER_FALLBACK = { model: 'skeleton_minion', scale: 1.0 };

  // OS PETS SÃO DO USUÁRIO (31/08) — os seis do Meshy aposentam o
  // velociraptor, a cobra, a vespa, o sapo, a aranha e a raposa
  // emprestados. A regra do dono: "o pet precisa ser pequeno, menor que os
  // personagens" — todos entre 0,61 e 0,80 m (herói: 2,05 m).
  // ATENÇÃO À CONTA: a base de PET no unit() é 1,20 m, não os 1,80 dos
  // monstros (linha do targetH) — altura = 1,20 m × escala. A primeira
  // leva usou 1,80 e três pets bateram no PISO de medição de 0,60 m.
  M.PET_LOOK = {
    'pet-emberling':  { model: 'pet-emberling',  scale: 0.57 },  // 0,68 m — "gato gordo"
    'pet-snapvine':   { model: 'pet-snapvine',   scale: 0.66 },  // 0,79 m — o vaso e a bocarra
    'pet-galehawk':   { model: 'pet-galehawk',   scale: 0.64 },  // 0,77 m — águia em voo baixo
    'pet-dewling':    { model: 'pet-dewling',    scale: 0.63 },  // 0,76 m — "cão sentado"
    'pet-lodestone':  { model: 'pet-lodestone',  scale: 0.51 },  // 0,61 m — filhote atarracado
    'pet-heartshard': { model: 'pet-heartshard', scale: 0.57 }   // 0,68 m — raposinha de vidro
  };

  // ------------------------------------------------------------ decodificação
  var raw = {};            // chave -> {scene, clips:{nome->clip}, actions:{acao->nome}, kind}
  var bankClips = {};      // nome -> AnimationClip (banco KayKit)
  var loading = false, ready = false, failed = false;
  var waiters = [];

  function b64ToArrayBuffer(b64) {
    var bin = atob(b64), len = bin.length;
    var buf = new Uint8Array(len);
    for (var i = 0; i < len; i++) buf[i] = bin.charCodeAt(i);
    return buf.buffer;
  }
  M.isReady = function () { return ready; };
  M.failed = function () { return failed; };

  M.load = function (cb) {
    if (ready) { if (cb) cb(null); return; }
    if (cb) waiters.push(cb);
    if (loading) return;
    loading = true;

    var src = JOGO.MODELS || {};
    var keys = Object.keys(src);
    if (!keys.length) { finish(new Error('JOGO.MODELS vazio: inclua assets/embedded/models-*.js')); return; }
    if (typeof THREE.GLTFLoader !== 'function') { finish(new Error('THREE.GLTFLoader ausente')); return; }

    var loader = new THREE.GLTFLoader();
    var pending = keys.length, firstErr = null;
    keys.forEach(function (key) {
      var ab;
      try { ab = b64ToArrayBuffer(src[key]); }
      catch (e) { firstErr = firstErr || e; step(); return; }
      try {
        loader.parse(ab, '', function (gltf) {
          if (key === '_anims') {
            for (var i = 0; i < gltf.animations.length; i++) bankClips[gltf.animations[i].name] = gltf.animations[i];
          } else {
            prepScene(gltf.scene);
            var clips = {}, names = [];
            for (var j = 0; j < (gltf.animations || []).length; j++) {
              clips[gltf.animations[j].name] = gltf.animations[j];
              names.push(gltf.animations[j].name);
            }
            raw[key] = {
              scene: gltf.scene, clips: clips,
              actions: names.length ? autoActions(names) : null,   // null = usa o banco KayKit
              own: names.length > 0,
              natural: naturalHeight(gltf.scene),
              yaw: measureYaw(gltf.scene)
            };
          }
          step();
        }, function (err) { firstErr = firstErr || err; step(); });
      } catch (e2) { firstErr = firstErr || e2; step(); }
    });

    function step() { if (--pending <= 0) finish(firstErr); }
    function finish(err) {
      ready = true; loading = false;
      failed = !!err && !Object.keys(raw).length;
      var q = waiters.slice(); waiters.length = 0;
      for (var i = 0; i < q.length; i++) { try { q[i](err); } catch (e) {} }
    }
  };

  // ------------------------------------------------ ORIENTAÇÃO DE NASCENÇA
  // O renderizador assume que todo bicho olha para +Z (é o rig do KayKit e o
  // que `FACE_OFF = 0` diz). Nem todo acervo combina: a vespa do Quaternius
  // nasce olhando para +X e atravessava o tabuleiro DE LADO — parte do relato
  // "os monstros não viram quando andam".
  //
  // Em vez de uma lista de exceções por id, MEDIMOS: o osso da cabeça contra o
  // centro do corpo dá o eixo da frente. Só corrigimos quando o desvio passa de
  // 45° (arredondamos para o quarto de volta mais próximo), então um modelo já
  // correto continua em 0. Bípede não tem frente mensurável — a cabeça fica em
  // cima do quadril —, e o limiar de deslocamento o deixa em 0 também.
  function skinBox(scene) {
    scene.updateMatrixWorld(true);
    var box = new THREE.Box3(), tmp = new THREE.Box3(), found = false;
    scene.traverse(function (n) {
      if (!n.isSkinnedMesh || !n.geometry) return;
      if (!n.geometry.boundingBox) n.geometry.computeBoundingBox();
      tmp.copy(n.geometry.boundingBox).applyMatrix4(n.matrixWorld);
      if (!found) { box.copy(tmp); found = true; } else box.union(tmp);
    });
    return found ? box : null;
  }
  function measureYaw(scene) {
    var head = null;
    scene.traverse(function (n) { if (!head && n.isBone && /^head$/i.test(n.name)) head = n; });
    if (!head) return 0;
    var box = skinBox(scene);
    if (!box) return 0;
    var c = new THREE.Vector3(); box.getCenter(c);
    var sz = new THREE.Vector3(); box.getSize(sz);
    var hp = new THREE.Vector3(); head.getWorldPosition(hp);
    var dx = hp.x - c.x, dz = hp.z - c.z;
    var span = Math.max(sz.x, sz.z) || 1;
    if (Math.sqrt(dx * dx + dz * dz) < span * 0.18) return 0;   // sem frente medível
    var ang = Math.atan2(dx, dz);
    var snap = Math.round(ang / (Math.PI / 2)) * (Math.PI / 2);
    return -snap;                        // gira o modelo até a frente cair em +Z
  }
  M.modelYaw = function (key) { return raw[key] ? (raw[key].yaw || 0) : 0; };

  // altura natural do modelo (para normalizar o porte entre acervos diferentes)
  /* Altura do corpo em pose de repouso, para normalizar todo mundo ao mesmo
   * porte.
   *
   * Mede a caixa da MALHA. Isso vale enquanto a malha estiver no tamanho final,
   * que e o caso do KayKit — mas nao de todo rig. Os personagens do Meshy vem
   * com o esqueleto feito em CENTIMETROS (o osso `Hips` tem 1226 de comprimento)
   * e um armature que encolhe por 0,01: a malha em repouso mede 0,02, e quem
   * carrega o tamanho de verdade sao os ossos.
   *
   * Com 0,02 a normalizacao calculava escala de 135x e aplicava por cima de um
   * esqueleto que ja estava certo — o personagem virava uma mancha gigante fora
   * do quadro. E o teste passava, porque conferia peca e marca, nao tamanho.
   *
   * Entao: se a malha vier degenerada, a altura sai da extensao dos OSSOS. */


  function naturalHeight(scene) {
    scene.updateMatrixWorld(true);
    var box = new THREE.Box3(), tmp = new THREE.Box3(), found = false;
    scene.traverse(function (n) {
      if (!n.isSkinnedMesh || !n.geometry) return;
      if (!n.geometry.boundingBox) n.geometry.computeBoundingBox();
      tmp.copy(n.geometry.boundingBox).applyMatrix4(n.matrixWorld);
      if (!found) { box.copy(tmp); found = true; } else box.union(tmp);
    });
    if (found && (box.max.y - box.min.y) < 0.2) {
      // mesma regra de visibleBodyBox: quando a malha em bind vem degenerada,
      // o tamanho mora nos ossos
      var porOsso = caixaPelosOssos(scene);
      if (porOsso && (porOsso.max.y - porOsso.min.y) > 0.2) {
        return porOsso.max.y - porOsso.min.y;
      }
    }
    if (!found) box.setFromObject(scene);
    var h = box.max.y - box.min.y;
    return (isFinite(h) && h > 0.01) ? h : 1.8;
  }



  function prepScene(scene) {
    scene.traverse(function (n) {
      if (!n.isMesh && !n.isSkinnedMesh) return;
      n.castShadow = true; n.receiveShadow = true;
      n.frustumCulled = false;
      var mats = Array.isArray(n.material) ? n.material : [n.material];
      for (var i = 0; i < mats.length; i++) {
        var m = mats[i];
        if (!m) continue;
        if (m.map) { m.map.magFilter = THREE.NearestFilter; m.map.minFilter = THREE.LinearMipmapLinearFilter; }
        m.roughness = 0.84; m.metalness = 0.02;
      }
    });
  }

  M.clipNames = function (key) {
    if (key && raw[key] && raw[key].own) return Object.keys(raw[key].clips);
    return Object.keys(bankClips);
  };
  M.modelKeys = function () { return Object.keys(raw); };
  /* Acesso CRU ao gltf carregado. Existe para o inventario de pecas: `M.unit`
   * espera um id de CLASSE e monta o look pronto, entao nao serve para varrer o
   * guarda-roupa que cada arquivo traz escondido dentro de si. */
  M.rawScene = function (k) { return raw[k] ? raw[k].scene : null; };
  M.hasModel = function (k) { return !!raw[k]; };
  M.clips = function () { var o = []; for (var k in bankClips) o.push(bankClips[k]); return o; };

  // --------------------------------------------------------- clone esqueletal
  function cloneSkinned(source) {
    var srcLookup = new Map(), cloneLookup = new Map();
    var clone = source.clone();
    parallelTraverse(source, clone, function (a, b) { srcLookup.set(b, a); cloneLookup.set(a, b); });
    clone.traverse(function (node) {
      if (!node.isSkinnedMesh) return;
      var srcMesh = srcLookup.get(node);
      var srcBones = srcMesh.skeleton.bones;
      node.skeleton = srcMesh.skeleton.clone();
      node.bindMatrix.copy(srcMesh.bindMatrix);
      node.skeleton.bones = srcBones.map(function (b) { return cloneLookup.get(b); });
      node.bind(node.skeleton, node.bindMatrix);
    });
    return clone;
  }
  function parallelTraverse(a, b, cb) {
    cb(a, b);
    for (var i = 0; i < a.children.length; i++) parallelTraverse(a.children[i], b.children[i], cb);
  }
  M.cloneSkinned = cloneSkinned;

  // ------------------------------------------------------------- tint/material
  function tintMaterials(root, color, strength, emissive, emiI) {
    var out = [];
    var col = col3(color);
    root.traverse(function (n) {
      if (!n.isMesh && !n.isSkinnedMesh) return;
      var mats = Array.isArray(n.material) ? n.material : [n.material];
      var cloned = [];
      for (var i = 0; i < mats.length; i++) {
        var m = mats[i];
        if (!m) { cloned.push(m); continue; }
        var c = m.clone();
        c.color = c.color ? c.color.clone() : new THREE.Color(0xffffff);
        c.color.lerp(col, strength == null ? 0.45 : strength);
        if (emissive != null) {
          c.emissive = col3(emissive);
          c.emissiveIntensity = emiI == null ? 0.10 : emiI;
          c.__baseEmiI = c.emissiveIntensity;
          c.__baseEmiHex = c.emissive.getHex();
        }
        c.__baseOpacity = c.opacity != null ? c.opacity : 1;
        cloned.push(c); out.push(c);
      }
      n.material = Array.isArray(n.material) ? cloned : cloned[0];
    });
    return out;
  }
  M.tintMaterials = tintMaterials;

  // ------------------------------------------------------- resolução de aparência
  var BULK = { sumo: 5, curandeiro: 4, invocador: 3, bruxo: 3, arqueiro: 2, espadachim: 1 };

  function classLook(classId) { return M.CLASS_LOOK[classId] || null; }

  // FUSÃO — SISTEMA, não 15 casos escritos à mão (§4):
  //   corpo = classe de silhueta dominante · arma = adereço-assinatura da outra
  //   cor   = mistura das duas paletas · aura = mistura dos dois elementos
  //   porte = maior (a unidade soma a vida das duas)
  // As pecas que o CONVIDADO leva para dentro da fusao.
  // ------------------------------------------------------ PORTE POR ESCALA DE OSSO
  // Engrossa tronco/ombros e encurta pernas. Três armadilhas, todas de HERANÇA
  // de escala, que custaram três tentativas até sair certo:
  //   · a arma pende de `handslot*` e crescia junto (machado maior que o boneco);
  //   · a cabeça pende do peito e ACHATAVA num disco largo;
  //   · a capa pende do peito e virava um balão cobrindo o corpo.
  // Por isso cada peça pendurada num osso desfaz a escala do pai no fim.
  function aplicaPorte(node, b) {
    if (!b) { desfazHerancaDeOsso(node); return; }
    // `tronco` e `pernaAlt` controlam ALTURA, e sao o que separa um boneco chibi
    // de um heroico. Sem eles so dava para engordar: a altura do tronco era fixa
    // em 1 e a da perna vinha grudada na grossura. O padrao mantem o
    // comportamento antigo, entao nenhum porte ja ajustado muda.
    var ty = b.tronco || 1;                    // altura do tronco
    var py = b.pernaAlt || b.perna;            // altura da perna, separada da grossura
    node.traverse(function (o) {
      if (!o.isBone) return;
      var nm = (o.name || '').toLowerCase();
      if (nm === 'chest' || nm === 'spine') o.scale.set(b.chest, ty, b.chest * 0.9);
      else if (/^upperarm/.test(nm)) o.scale.set(b.ombro, b.bracoAlt || 1, b.ombro);
      else if (/^lowerarm/.test(nm)) o.scale.set(b.braco, b.bracoAlt || 1, b.braco);
      else if (/^upperleg/.test(nm)) o.scale.set(b.perna * 1.1, py, b.perna * 1.1);
      else if (/^lowerleg/.test(nm)) o.scale.set(1, b.canela || 1, 1);
      else if (nm === 'head') {
        // a cabeca herda a escala do chest nos DOIS eixos; para ela ficar no
        // tamanho absoluto pedido e preciso desfazer os dois
        var kh = b.cabeca / Math.max(0.001, b.chest);
        o.scale.set(kh, b.cabeca / Math.max(0.001, ty), kh / 0.9);
      } else if (/^handslot/.test(nm)) {
        var k = 1 / Math.max(0.001, b.ombro * b.braco);
        o.scale.set(k, 1 / Math.max(0.001, b.bracoAlt || 1), k);
      }
    });
    desfazHerancaDeOsso(node);
  }

  /* Desfaz a heranca de escala nas pecas presas a osso. Ver o comentario longo
   * abaixo: e o conserto do chapeu gigante da fusao. */
  function desfazHerancaDeOsso(node) {
    // ---- desfaz a heranca de escala nas pecas presas a osso
    // Chapeu, elmo, capa e arma sao malhas SIMPLES penduradas num osso, e osso
    // passa escala para os filhos. Esta compensacao tinha dois furos:
    //
    //   1. desfazia so o osso IMEDIATO. O chapeu mora em `head`, mas acima de
    //      head esta `chest`, que o porte do Barbaro infla para 1,42 — e esse
    //      1,42 sobrava. Dai o Mage_Hat da fusao sair com 5,73 m de largura,
    //      mais largo do que o corpo que o carrega e alto.
    //   2. SOBRESCREVIA a escala da peca em vez de dividi-la, entao um adereco
    //      que ja vinha menor ou maior do dono original perdia o proprio porte.
    //
    // Agora desfaz a cadeia INTEIRA, ate a raiz do modelo, e parte sempre da
    // escala original guardada — o que torna a passagem repetivel sem acumular.
    node.traverse(function (o) {
      if (!o.isMesh || o.isSkinnedMesh) return;
      var p = o.parent;
      if (!p || !p.isBone) return;
      if (!o.userData.escalaBase) o.userData.escalaBase = o.scale.clone();
      var base = o.userData.escalaBase;
      var ax = 1, ay = 1, az = 1;
      for (var n = p; n && n !== node; n = n.parent) {
        if (!n.scale) continue;
        ax *= n.scale.x; ay *= n.scale.y; az *= n.scale.z;
      }
      o.scale.set(base.x / Math.max(0.001, ax), base.y / Math.max(0.001, ay),
                  base.z / Math.max(0.001, az));
    });
    node.updateMatrixWorld(true);
  }

  // ------------------------------------------------------------ TROCA DE CABEÇA
  // Os 9 humanoides do KayKit partilham ordem de juntas e inverseBindMatrices,
  // então uma cabeça skinned de um monta no esqueleto do outro: basta reapontar
  // o skeleton e o bindMatrix. É assim que o mago ganha barba — o modelo dele
  // não tem, e o do Bárbaro tem.
  function trocaCabeca(model, swap) {
    var src = raw[swap.model];
    if (!src) return null;
    var nova = meshByName(src.scene, swap.mesh);
    if (!nova || !nova.isSkinnedMesh) return null;
    var alvo = null;
    model.traverse(function (o) {
      if (!alvo && o.isSkinnedMesh && /_Head/.test(o.name || '')) alvo = o;
    });
    if (!alvo) return null;
    var c = nova.clone();
    c.name = alvo.name;                       // mantém o nome para quem procura por ele
    c.material = alvo.material;               // material do dono, para não trocar o atlas
    if (nova.material && nova.material.map) c.material = nova.material.clone();
    c.skeleton = alvo.skeleton;
    c.bindMatrix.copy(alvo.bindMatrix);
    c.bind(alvo.skeleton, alvo.bindMatrix);
    c.visible = true;
    alvo.parent.add(c);
    alvo.visible = false;
    // tinta FORTE: a 0,72 a barba castanha do Bárbaro saía cor de areia,
    // não branca. Aqui a leitura de "velho" depende inteira da cor.
    return c;
  }

  // ------------------------------------------------------------- MÁSCARA DE ROSTO
  // O acervo KayKit não tem máscara nenhuma: só cabeças, chapéus e um elmo. A
  // faixa é geometria gerada — uma casca que acompanha o terço inferior da
  // cabeça, um fio à frente dela para não brigar por profundidade.
  // Fica presa ao OSSO da cabeça, então acompanha toda animação sem custo.
  function poeMascara(model, cfg) {
    var cab = null, osso = null;
    model.traverse(function (o) {
      if (!cab && o.isSkinnedMesh && /_Head/.test(o.name || '')) cab = o;
      if (!osso && o.isBone && (o.name || '').toLowerCase() === 'head') osso = o;
    });
    if (!cab || !osso) return null;
    if (!cab.geometry.boundingBox) cab.geometry.computeBoundingBox();
    var bb = cab.geometry.boundingBox;
    var largura = (bb.max.x - bb.min.x), altura = (bb.max.y - bb.min.y);
    var fundo = (bb.max.z - bb.min.z);

    // Casca sobre a METADE DA FRENTE do terço inferior do rosto. A primeira
    // tentativa usou a calota do FUNDO da esfera (phi perto de PI) e ela nasceu
    // sob o queixo, escondida dentro da cabeça — invisível. O que cobre a boca é
    // uma FAIXA no meio-baixo (phi ~0,52PI a ~0,78PI), e só na frente
    // (theta meia-volta), senão vira um capuz dando a volta no crânio.
    var raio = Math.max(largura, fundo) * 0.5 * (1 + (cfg.avanco || 0.06));
    var alt = cfg.altura || 0.26;
    var geo = new THREE.SphereGeometry(raio, 20, 14,
      -Math.PI / 2, Math.PI,                    // só a metade da frente
      Math.PI * 0.62, Math.PI * alt);
    var mat = new THREE.MeshStandardMaterial({
      color: col3(cfg.cor || '#15181c'), roughness: 0.85, metalness: 0.0
    });
    var m = new THREE.Mesh(geo, mat);
    m.name = 'Rogue_FaceMask';
    m.castShadow = true;

    // posiciona no espaço do OSSO: a caixa da cabeça está no espaço de bind da
    // malha, então convertemos pelo mundo e voltamos para o local do osso.
    model.updateMatrixWorld(true);
    var centro = new THREE.Vector3(
      (bb.min.x + bb.max.x) / 2,
      (bb.min.y + bb.max.y) / 2,        // centro do crânio: a faixa desce dele
      (bb.min.z + bb.max.z) / 2
    );
    cab.localToWorld(centro);
    osso.worldToLocal(centro);
    m.position.copy(centro);
    osso.add(m);
    return m;
  }

  // Clareia a TEXTURA de uma malha, puxando cada pixel para a cor pedida.
  // Cacheado por (textura, cor, força) — senão cada unidade redesenharia
  // 1024x1024 no carregamento.
  var texClara = {};
  function clareiaCabeca(mesh, cor, forca) {
    var mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (var i = 0; i < mats.length; i++) {
      var m = mats[i];
      if (!m || !m.map || !m.map.image) continue;
      var img = m.map.image;
      var chave = (m.map.uuid || 'x') + '|' + cor + '|' + forca;
      var tex = texClara[chave];
      if (!tex) {
        var cv = document.createElement('canvas');
        cv.width = img.width; cv.height = img.height;
        var g = cv.getContext('2d');
        g.drawImage(img, 0, 0);
        var dados = g.getImageData(0, 0, cv.width, cv.height);
        var d = dados.data;
        var alvo = col3(cor);
        var ar = alvo.r * 255, ag = alvo.g * 255, ab = alvo.b * 255;
        for (var p = 0; p < d.length; p += 4) {
          d[p]     = d[p]     + (ar - d[p])     * forca;
          d[p + 1] = d[p + 1] + (ag - d[p + 1]) * forca;
          d[p + 2] = d[p + 2] + (ab - d[p + 2]) * forca;
        }
        g.putImageData(dados, 0, 0);
        tex = new THREE.CanvasTexture(cv);
        tex.flipY = m.map.flipY;
        tex.colorSpace = m.map.colorSpace;
        tex.wrapS = m.map.wrapS; tex.wrapT = m.map.wrapT;
        tex.needsUpdate = true;
        texClara[chave] = tex;
      }
      var novo = m.clone();
      novo.map = tex;
      novo.color = new THREE.Color(0xffffff);   // a cor agora vem da textura
      mats[i] = novo;
    }
    mesh.material = Array.isArray(mesh.material) ? mats : mats[0];
  }

  function marksOf(classId, look, corDoConvidado) {
    var mk = M.CLASS_MARK[classId] || {};
    var out = [];
    var mm = mk.model || look.model;   // de onde a peca sai — ver CLASS_MARK
    if (mk.head) out.push({ model: mm, mesh: mk.head, bone: 'head', tint: corDoConvidado });
    // A CAPA e a "roupa" do convidado. Arqueiro e espadachim nao tem peca de
    // cabeca (o capuz faz parte da malha skinned), entao sem a capa eles
    // entrariam na fusao so por uma arma pequena e some. A capa muda a cor e a
    // silhueta das costas, que le de longe.
    if (mk.cape) out.push({ model: mm, mesh: mk.cape, bone: 'chest',
                            hidesHostCape: true, tint: corDoConvidado });
    // A arma do convidado vai para a mao ESQUERDA, e a peca que o anfitriao
    // carrega naquela mao sai de cena — senao as duas ocupam o mesmo punho e
    // aparecem atravessadas uma na outra. Foi o que aconteceu assim que o
    // Barbaro passou a usar as duas maos e o Ladino ganhou a segunda adaga.
    var arma = mk.hand || look.weapon;
    if (arma) out.push({ model: mm, mesh: arma, bone: 'handslotl',
                         tint: corDoConvidado, hidesHostOffhand: true });
    return out;
  }

  /* DUPLAS COM CORPO PROPRIO — arte do Daniel, nao composicao.
   *
   * A chave e o par de classes em ordem ALFABETICA (contrato §4), que e a mesma
   * que `Fusion.pairKey` monta. As duplas que NAO estiverem aqui continuam
   * compostas pelo caminho de sempre, logo abaixo.
   */
  var FUSION_MODEL = {
    'arqueiro+sumo':    'fus_arqueiro_sumo',
    'bruxo+sumo':       'fus_bruxo_sumo',
    'curandeiro+sumo':  'fus_curandeiro_sumo',
    'espadachim+sumo':  'fus_espadachim_sumo',
    'invocador+sumo':   'fus_invocador_sumo',
    'arqueiro+minotauro':   'fus_arqueiro_minotauro',
    'bruxo+minotauro':      'fus_bruxo_minotauro',
    'curandeiro+minotauro': 'fus_curandeiro_minotauro',
    'espadachim+minotauro': 'fus_espadachim_minotauro',
    'invocador+minotauro':  'fus_invocador_minotauro',
    'minotauro+sumo':       'fus_minotauro_sumo',
    'arqueiro+bruxo':       'fus_arqueiro_bruxo',
    'arqueiro+curandeiro':  'fus_arqueiro_curandeiro',
    'arqueiro+espadachim':  'fus_arqueiro_espadachim',
    'arqueiro+invocador':   'fus_arqueiro_invocador',
    'bruxo+curandeiro':     'fus_bruxo_curandeiro',
    'curandeiro+espadachim': 'fus_curandeiro_espadachim',
    'bruxo+espadachim':     'fus_bruxo_espadachim',
    // as TRES do Xama (30/08) — com estas, as 21 duplas tem corpo proprio
    'bruxo+invocador':      'fus_bruxo_invocador',
    'curandeiro+invocador': 'fus_curandeiro_invocador',
    'espadachim+invocador': 'fus_espadachim_invocador'
  };

  function fusionLook(defId) {
    var pair = String(defId).slice(4).split('+');
    var a = pair[0], b = pair[1];
    /* A chave de FUSION_MODEL é ALFABÉTICA (contrato §4, o mesmo que
     * Fusion.pairKey monta) — mas nem todo chamador manda o par ordenado: a
     * galeria de testes pergunta na ordem das classes ('fus:sumo+arqueiro') e
     * TODA a fileira do Bárbaro saía composta em silêncio, meses depois do
     * corpo próprio existir. Ordenar aqui blinda qualquer chamador. */
    if (a > b) { var tr0 = a; a = b; b = tr0; }

    /* CORPO PROPRIO, quando existe. Entra ANTES da composicao e devolve um look
     * limpo: sem `grafts`, sem `show`, sem `build`. Aquilo era guarda-roupa e
     * escala de osso do KayKit, e pedir malha que nao existe falha EM SILENCIO
     * — foi o que pegou o Sumo quando ele trocou de modelo.
     *
     * `scale: 1.00` porque o alvo de porte da fusao (3,00 m) ja e a altura que
     * estes corpos devem ter. A composicao usa 1,26 porque precisa esticar um
     * corpo de heroi ate parecer fusao; um corpo modelado como fusao nao precisa.
     */
    var proprio = FUSION_MODEL[a + '+' + b];
    if (proprio && (JOGO.MODELS || {})[proprio]) {
      var lpa = classLook(a), lpb = classLook(b);
      return {
        model: proprio, scale: 1.00, fusion: true,
        hostClass: a, guestClass: b,
        tint: lpa ? lpa.tint : null,
        accent: lpb ? lpb.accent : (lpa ? lpa.accent : null),
        mixTint: lpb ? lpb.tint : null,
        grafts: [],
        concept: 'corpo de fusao proprio (' + a + ' + ' + b + ')'
      };
    }

    var la = classLook(a), lb = classLook(b);
    if (!la && !lb) return null;
    if (!la) { la = lb; a = b; lb = null; }
    var host = a, guest = b;
    if (lb && (BULK[b] || 0) > (BULK[a] || 0)) { host = b; guest = a; }
    var lh = classLook(host), lg = classLook(guest);
    return {
      // `show` opcional aqui tambem: o anfitriao pode ser um corpo do Meshy,
      // que nao tem malha para ligar ou desligar (ver classLook).
      // 1,26 -> 1,00: a fusao COMPOSTA passa a medir os mesmos 3,00 m que a de
      // corpo proprio. Com 1,26 ela saia em 3,78 m, e o resultado era invertido:
      // a fusao do BARBARO — a maior classe do jogo, 2,62 m — era a MENOR de
      // todas, porque foi a primeira a ganhar corpo modelado no porte certo.
      //
      // 3,00 m e o alvo declarado em `targetH` e o numero para o qual o Daniel
      // modelou; multiplicar por 1,26 em cima dele desfazia a propria regra.
      // As compostas sao provisorias e somem conforme a arte chega — quem manda
      // e o numero que a arte respeita.
      model: lh.model, show: (lh.show || []).slice(), scale: 1.00,
      build: lh.build || null, headTilt: lh.headTilt || 0,
      tint: lh.tint, accent: lg ? lg.accent : lh.accent,
      mixTint: lg ? lg.tint : null,
      grafts: lg ? marksOf(guest, lg, lg.tint) : [],
      fusion: true, hostClass: host, guestClass: guest,
      concept: lg ? (lh.concept + ' + marcas de ' + guest) : lh.concept
    };
  }

  function monsterLook(defId) {
    var D = DATA();
    var md = (D.monsters && D.monsters[defId]) || null;
    var base = MONSTER_LOOK[defId] ||
               (md && md.family && M.FAMILY_LOOK[md.family]) ||
               M.MONSTER_FALLBACK;
    var boss = !!(md && md.boss);
    return {
      model: base.model, show: (base.show || []).slice(),
      proc: !!base.proc, procId: defId,
      scale: (base.scale || 1),          // o porte de chefe ja vem da altura-alvo
      tint: M.elementColor((md && md.element) || 'neutro'),
      accent: M.elementColor((md && md.element) || 'neutro'),
      family: md && md.family, boss: boss
    };
  }
  function petLook(defId) {
    var D = DATA();
    var pd = (D.pets && D.pets[defId]) || null;
    var base = M.PET_LOOK[defId] || { model: 'q_fox', scale: 0.55 };
    return {
      model: base.model, show: [], scale: base.scale || 0.55,
      tint: M.elementColor((pd && pd.element) || 'neutro'), pet: true
    };
  }

  M.lookFor = function (defId, opts) {
    opts = opts || {};
    var id = String(defId || '');
    if (id.indexOf('fus:') === 0) return fusionLook(id);
    var cl = classLook(opts.classId || id);
    if (cl) {
      // ATENÇÃO: este objeto é remontado campo a campo, então TODO campo novo do
      // CLASS_LOOK precisa ser copiado aqui — senão ele some sem erro nenhum.
      // Foi o que aconteceu com `build` e `headTilt`: estavam definidos e o
      // Bárbaro continuava magro, sem uma linha de aviso.
      // `show` e OPCIONAL desde que ha modelos com guarda-roupa embutido: os
      // personagens do Meshy ja vem com a arma modelada no corpo e nao tem
      // malha para ligar ou desligar. Antes isto era `cl.show.slice()` direto e
      // estourava assim que a primeira classe deixou de declarar a lista.
      return { model: cl.model, show: (cl.show || []).slice(), scale: cl.scale || 1,
               tint: cl.tint, accent: cl.accent, weapon: cl.weapon,
               build: cl.build || null, headTilt: cl.headTilt || 0,
               faceMask: cl.faceMask || null, bodyTint: cl.bodyTint || null,
               headSwap: cl.headSwap || null, headTint: cl.headTint || null,
               classId: opts.classId || id, concept: cl.concept };
    }
    var D = DATA();
    if (opts.kind === 'pet' || (D.pets && D.pets[id])) return petLook(id);
    return monsterLook(id);
  };

  // ------------------------------------------------------------------- unidade
  function sanit(name) { return String(name).replace(/[\.\[\]:\/]/g, ''); }
  /* Onde cada osso do KayKit mora nos OUTROS esqueletos.
   *
   * O jogo nasceu falando o vocabulario do KayKit — `head`, `chest`,
   * `handslotl`. Os personagens novos do Meshy usam o padrao Mixamo — `Head`,
   * `Spine02`, `LeftHand`. Sem tradutor o enxerto da fusao simplesmente nao
   * acha o osso e a marca do convidado some, SEM ERRO NENHUM: foi assim que as
   * dez fusoes com corpo novo sairam sem chapeu, sem capa e sem arma.
   *
   * Traduzir aqui, num lugar so, e melhor que espalhar `if (meshy)` por todo
   * lado — e o proximo esqueleto que chegar so acrescenta uma linha. */
  var OSSO_EQUIV = {
    head:      ['Head', 'head', 'mixamorigHead'],
    chest:     ['Spine02', 'Spine2', 'chest', 'mixamorigSpine2'],
    spine:     ['Spine01', 'Spine1', 'spine', 'mixamorigSpine1'],
    hips:      ['Hips', 'hips', 'mixamorigHips'],
    handslotl: ['LeftHand', 'handslotl', 'mixamorigLeftHand'],
    handslotr: ['RightHand', 'handslotr', 'mixamorigRightHand'],
    upperarml: ['LeftArm', 'upperarml', 'mixamorigLeftArm'],
    upperarmr: ['RightArm', 'upperarmr', 'mixamorigRightArm'],
    lowerarml: ['LeftForeArm', 'lowerarml'],
    lowerarmr: ['RightForeArm', 'lowerarmr'],
    upperlegl: ['LeftUpLeg', 'upperlegl'],
    upperlegr: ['RightUpLeg', 'upperlegr'],
    lowerlegl: ['LeftLeg', 'lowerlegl'],
    lowerlegr: ['RightLeg', 'lowerlegr']
  };

  function findBone(root, name) {
    var direto = root.getObjectByName(name) || root.getObjectByName(sanit(name));
    if (direto) return direto;
    var alt = OSSO_EQUIV[String(name).toLowerCase()];
    for (var i = 0; alt && i < alt.length; i++) {
      var o = root.getObjectByName(alt[i]);
      if (o) return o;
    }
    return null;
  }
  M.findBone = findBone;
  M.aplicaPorte = aplicaPorte;   // exposto para as folhas de variante
  function meshByName(root, name) {
    var clean = sanit(name), found = null;
    root.traverse(function (n) { if (!found && (n.name === name || n.name === clean)) found = n; });
    return found;
  }
  /* Caixa do corpo pelos OSSOS.
   *
   * `Box3.setFromObject` nao aplica skinning: mede a geometria em pose de bind.
   * Para o KayKit tanto faz, porque a malha ja esta no tamanho final. Para um
   * rig cujo TAMANHO VIVE NOS OSSOS — como os personagens do Meshy, feitos em
   * centimetros com um armature que encolhe por 0,01 — ela responde a pergunta
   * errada: devolve 0,02 para um corpo que renderiza com metros.
   *
   * Aqui a caixa sai da posicao de MUNDO de cada osso, que e o que a GPU usa
   * para deformar a malha. Alarga um pouco em X e Z porque osso e uma linha no
   * meio do corpo e a carne fica em volta. */
  function caixaPelosOssos(root) {
    root.updateMatrixWorld(true);
    var v = new THREE.Vector3(), box = new THREE.Box3(), n = 0;
    root.traverse(function (o) {
      if (!o.isBone) return;
      o.getWorldPosition(v);
      if (!n) box.min.copy(v), box.max.copy(v);
      else box.expandByPoint(v);
      n++;
    });
    if (n < 2) return null;
    // o cranio passa do osso `Head` e os pes passam do `Foot`
    var alt = box.max.y - box.min.y;
    box.max.y += alt * 0.12;
    var folga = alt * 0.16;
    box.min.x -= folga; box.max.x += folga;
    box.min.z -= folga; box.max.z += folga;
    return box;
  }

  function visibleBodyBox(root) {
    root.updateMatrixWorld(true);
    var box = new THREE.Box3(), tmp = new THREE.Box3(), found = false;
    root.traverse(function (n) {
      if (!n.isSkinnedMesh || !n.visible || !n.geometry) return;
      if (!n.geometry.boundingBox) n.geometry.computeBoundingBox();
      tmp.copy(n.geometry.boundingBox).applyMatrix4(n.matrixWorld);
      if (!found) { box.copy(tmp); found = true; } else box.union(tmp);
    });
    if (!found) box.setFromObject(root);
    // 0,2 de altura nao e corpo nenhum: e malha em pose de bind de um rig cujo
    // tamanho esta nos ossos. Vai medir onde o tamanho realmente mora.
    if ((box.max.y - box.min.y) < 0.2) {
      var porOsso = caixaPelosOssos(root);
      if (porOsso && (porOsso.max.y - porOsso.min.y) > 0.2) return porOsso;
    }
    return box;
  }

  // modelo procedural da camada v1 (bestiário desenhado para o SOTERRA)
  function procUnit(defId, look, opts) {
    var V1 = JOGO.Models3D;
    if (!V1 || !V1.isReady || !V1.isReady() || !V1.buildUnit) return null;
    var ids = V1.unitIds ? V1.unitIds() : [];
    if (ids.indexOf(defId) < 0) return null;
    var built;
    try { built = V1.buildUnit(defId); } catch (e) { return null; }
    if (!built || !built.group) return null;
    var group = new THREE.Group();
    group.name = 'unit:' + defId;
    group.add(built.group);
    var scale = (look.scale || 1) * (opts.boss ? 1.15 : 1);
    built.group.scale.setScalar(scale);
    var box = new THREE.Box3().setFromObject(built.group);
    var height = Math.max(0.7, box.max.y - box.min.y);
    var radius = Math.max(0.25, Math.min(1.1, Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * 0.4));
    group.userData = {
      defId: defId, look: look, model: built.group, mixer: null, proc: built,
      height: height, radius: radius, scale: scale, tintMats: null,
      bones: {}, procState: { moving: 0, castK: 0, flash: 0, deathK: 0, invis: false },
      play: function () { return null; }, has: function () { return true; },
      locomotion: function () { return { action: 'proc', clip: 'proc', dur: 0, cycle: true, found: true }; },
      clipFor: function () { return 'proc'; }, clipDur: function () { return 0; },
      currentName: function () { return null; },
      procAnimate: function (st, t, dt) { try { built.animate(st, t, dt); } catch (e) {} }
    };
    return group;
  }

  M.unit = function (defId, opts) {
    opts = opts || {};
    if (!ready) return null;
    var look = opts.look || M.lookFor(defId, opts);
    if (!look) return null;

    if (look.proc) {
      var pu = procUnit(look.procId || defId, look, opts);
      if (pu) return pu;
    }

    var src = raw[look.model] || raw[M.MONSTER_FALLBACK.model];
    if (!src) return null;

    var group = new THREE.Group();
    group.name = 'unit:' + defId;
    var model = cloneSkinned(src.scene);
    group.add(model);

    // adereços: só os citados em `show` ficam visíveis (o corpo é skinned)
    if (!src.own) {
      var showSet = {};
      for (var i = 0; i < (look.show || []).length; i++) showSet[look.show[i]] = true;
      model.traverse(function (n) {
        if (!n.isMesh || n.isSkinnedMesh) return;
        n.visible = !!showSet[n.name];
      });
    }

    // ENXERTO DA FUSÃO: as MARCAS da outra classe entram no corpo do anfitrião.
    // Antes entrava só a arma, num osso com nome errado ('handslot.l' em vez de
    // 'handslotl'), e por isso as cinco fusões do sumô saíam idênticas: o
    // convidado não aparecia em lugar nenhum. Agora vem o adereço de cabeça
    // (que muda a silhueta e lê de longe) e a arma-assinatura.
    if (look.grafts && look.grafts.length) {
      group.userData_grafts = [];
      for (var gi = 0; gi < look.grafts.length; gi++) {
        var gf = look.grafts[gi];
        var gsrc = raw[gf.model];
        if (!gsrc) continue;
        var gm = meshByName(gsrc.scene, gf.mesh);
        var bone = findBone(model, gf.bone);
        if (!gm || !bone) continue;
        var g2 = gm.clone();
        g2.visible = true; g2.castShadow = true;
        g2.position.set(0, 0, 0); g2.rotation.set(0, 0, 0); g2.scale.set(1, 1, 1);
        // a peça guarda a pose que tinha no dono original; sem copiar, o chapéu
        // nasce no centro do osso e afunda na cabeça
        if (gm.parent && gm.parent.isBone) {
          g2.position.copy(gm.position);
          g2.quaternion.copy(gm.quaternion);
          g2.scale.copy(gm.scale);
        }
        // a capa do anfitriao sai de cena para a do convidado nao empilhar
        if (gf.hidesHostCape) {
          model.traverse(function (n) {
            if (n !== g2 && n.isMesh && /_Cape$/.test(n.name || '')) n.visible = false;
          });
        }
        // Esvazia a mao que vai receber a arma do convidado. Sem isto as duas
        // pecas ocupam o mesmo punho e aparecem atravessadas — o que passou a
        // acontecer assim que o Barbaro ganhou o segundo machado e o Ladino a
        // segunda adaga: antes o anfitriao tinha a esquerda vazia por acaso.
        if (gf.hidesHostOffhand) {
          var punho = findBone(model, gf.bone);
          if (punho) {
            for (var pi = punho.children.length - 1; pi >= 0; pi--) {
              var f = punho.children[pi];
              if (f !== g2 && f.isMesh) f.visible = false;
            }
          }
        }
        // A peca entra com a COR DA CLASSE QUE A DOOU. O acervo so tem 4 capas e
        // 3 pecas de cabeca para 6 classes — arqueiro e espadachim dividem a capa
        // de ladino, bruxo e invocador a de mago. Sem a tinta, essas duplas
        // ficariam indistinguiveis; com ela, uma entra verde e a outra azul.
        // Tinta FORTE (0,92) so nas pecas doadas. No corpo, tingir forte lava o
        // atlas e apaga o desenho — por isso o heroi leva so 0,30. Aqui e o
        // contrario: a peca e pequena e precisa GRITAR de quem veio; perder o
        // detalhe da textura numa capa de 20 px nao custa nada, e a 0,55 o
        // verde do arqueiro saia #6c6246, um marrom indistinguivel do azul do
        // espadachim (#664b57).
        if (gf.tint) { try { tintMaterials(g2, gf.tint, 0.92); } catch (e) {} }
        bone.add(g2);
        group.userData_grafts.push(g2);
      }
      group.userData_graft = group.userData_grafts[0] || null;
    }

    var elems = (opts.elements && opts.elements.length) ? opts.elements : [opts.element || 'neutro'];
    var eCol = M.elementColor(elems[0]);
    var baseTint = look.tint || eCol;
    // O material do KayKit nao tem baseColorFactor: TODA a cor vem do atlas de
    // textura. Tingir forte multiplica o atlas por uma cor chapada e lava o
    // desenho. Heroi recebe so um verniz (a identidade vem do anel e da aura);
    // monstro recebe mais, porque a leitura do ELEMENTO e tatica.
    var strength = look.classId ? 0.30 : (look.fusion ? 0.42 : 0.52);
    var mats = tintMaterials(model, baseTint, strength,
                             eCol, elems[0] === 'neutro' ? 0.03 : 0.08);
    if (look.fusion && look.mixTint) {
      var mix = col3(look.mixTint);
      for (var mi = 0; mi < mats.length; mi++) mats[mi].color.lerp(mix, 0.28);
    }
    // CABEÇA TROCADA por último: o tingimento geral acima reclona TODOS os
    // materiais do modelo, então pintar a cabeça antes dele não sobrevive.
    // E `tintMaterials` sozinho NÃO basta aqui: ele mexe em `material.color`,
    // que MULTIPLICA o atlas — e como a cor real vem da textura, a barba
    // castanha continuava castanha por mais que subíssemos a força. Para
    // embranquecer de verdade é preciso clarear a TEXTURA da cabeça.
    if (cabecaTrocada && look.headTint) {
      try { clareiaCabeca(cabecaTrocada, look.headTint, look.headWhite || 0.88); } catch (e) {}
    }
    // ROUPA ESCURA. Aqui `tintMaterials` SERVE, ao contrário da barba branca:
    // ele mexe em `material.color`, que MULTIPLICA a textura — e multiplicar só
    // sabe escurecer. Para clarear precisou reescrever a textura; para escurecer
    // a multiplicação é a ferramenta certa e custa nada.
    if (look.bodyTint) {
      var bt = look.bodyTint;
      model.traverse(function (o) {
        if (!o.isMesh && !o.isSkinnedMesh) return;
        if (bt.malhas && bt.malhas.indexOf(o.name) < 0) return;
        try { tintMaterials(o, bt.cor, bt.forca); } catch (e) {}
      });
    }
    if (elems.length > 1) {
      var e2 = col3(M.elementColor(elems[1]));
      for (var mj = 0; mj < mats.length; mj++) {
        mats[mj].emissive.lerp(e2, 0.5);
        mats[mj].emissiveIntensity = 0.16;
        mats[mj].__baseEmiI = 0.16;
      }
    }

    // PORTE NORMALIZADO: cada acervo nasce numa escala diferente; medimos a
    // altura natural e ajustamos para a altura-alvo do papel. Assim um lobo do
    // Quaternius e um esqueleto do KayKit convivem sem um virar brinquedo.
    // A ESCADA DE PORTE. Heroi 2,05 m vezes a escala da classe, e a escala e
    // que faz a leitura: o Minotauro sobe a 2,62 m e o Sumo a 2,50 m, os dois
    // guardas do grupo; a Curandeira desce a 1,97 m e o Ladino a 1,99 m.
    //
    // A FUSAO subiu de 2,55 para 3,00 m junto com eles, e nao por capricho: com
    // o Minotauro a 2,62 m, um corpo fundido de 2,55 m ficaria MENOR que a
    // metade dele que entrou na fusao. Fundir tem de ser visivelmente maior que
    // qualquer um dos dois sozinho — e essa era a regra que estava a ponto de
    // quebrar. Chefe nao muda: 2,95 m vezes a escala propria dele (1,7 a 1,85)
    // ja poe os chefes em 5,0 a 5,5 m, muito acima de tudo isto.
    var targetH = look.classId ? 2.05 : (look.pet ? 1.20 : (look.fusion ? 3.00 : 1.80));
    if (opts.boss || look.boss) targetH = 2.95;
    var natural = src.natural || 1.8;
    var scale = (targetH / natural) * (look.scale || 1) * (opts.scale || 1);
    model.scale.setScalar(scale);

    // PORTE por escala de osso (o brutamontes do Bárbaro). Antes de medir a
    // caixa, senão altura e raio sairiam do corpo magro.
    if (look.build) aplicaPorte(model, look.build);
    var cabecaTrocada = look.headSwap ? trocaCabeca(model, look.headSwap) : null;
    if (look.faceMask) poeMascara(model, look.faceMask);

    var box = visibleBodyBox(model);
    var height = Math.max(0.6, (box.max.y - box.min.y) || 1.7);
    var radius = Math.max(0.22, Math.min(1.2,
      Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * (src.own ? 0.5 : 0.34)));

    // ------------------------------------------------------------- animação
    var mixer = new THREE.AnimationMixer(model);
    var actionMap = src.own ? src.actions : KAYKIT_ACTIONS;
    var clipSrc = src.own ? src.clips : bankClips;
    var cache = {}, current = null, currentAct = '';

    function resolve(name, depth) {
      if (depth > 4) return null;
      var clipName = actionMap[name];
      if (clipName && clipSrc[clipName]) return clipSrc[clipName];
      var fb = ACTION_FALLBACK[name];
      for (var i = 0; fb && i < fb.length; i++) {
        var r = resolve(fb[i], (depth || 0) + 1);
        if (r) return r;
      }
      if (name !== 'idle') return resolve('idle', 5);
      return null;
    }
    function action(name) {
      if (cache[name] !== undefined) return cache[name];
      var clip = resolve(name, 0);
      cache[name] = clip ? mixer.clipAction(clip) : null;
      return cache[name];
    }
    function has(name) {
      var clipName = actionMap[name];
      return !!(clipName && clipSrc[clipName]);
    }
    // ------------------------------------------------------------ LOCOMOÇÃO
    // QUAL ação responde por "está se deslocando" NESTE modelo, e com que
    // ritmo. É aqui — e não no renderizador — porque a resposta depende do
    // acervo, e o mesmo caminho serve monstro, chefe, pet e herói. Nunca por id.
    //   corrida > caminhada > voo > pulo, e `idle` só como derrota declarada.
    var locoCache = null;
    var LOCO_ORDER = ['run', 'walk', 'fly', 'jump'];
    function locomotion() {
      if (locoCache) return locoCache;
      for (var i = 0; i < LOCO_ORDER.length; i++) {
        var nm = LOCO_ORDER[i];
        if (!has(nm)) continue;
        var c = resolve(nm, 0);
        if (!c) continue;
        locoCache = {
          action: nm, clip: c.name, dur: c.duration || 0,
          // o pulo é um ARCO ÚNICO, não um ciclo: quem toca precisa encaixar
          // um pulo por célula andada, senão o bicho fica agachado no ar.
          cycle: nm !== 'jump', found: true
        };
        return locoCache;
      }
      var idl = resolve('idle', 0);
      locoCache = { action: 'idle', clip: idl ? idl.name : null,
                    dur: idl ? idl.duration : 0, cycle: true, found: false };
      return locoCache;
    }
    function play(name, o) {
      o = o || {};
      var a = action(name);
      if (!a) return null;
      if (current === a && !o.restart) {
        if (o.timeScale != null) a.timeScale = o.timeScale;
        currentAct = name;
        return a;
      }
      a.reset();
      a.timeScale = o.timeScale == null ? 1 : o.timeScale;
      a.setLoop(o.loop === false ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
      a.clampWhenFinished = o.loop === false;
      a.enabled = true;
      a.setEffectiveWeight(1);
      if (current && current !== a) { a.crossFadeFrom(current, o.fade == null ? 0.16 : o.fade, false); a.play(); }
      else { a.fadeIn(o.fade == null ? 0.10 : o.fade); a.play(); }
      current = a; currentAct = name;
      return a;
    }

    group.userData = {
      defId: defId, look: look, model: model, mixer: mixer,
      height: height, radius: radius, scale: scale, tintMats: mats,
      own: src.own,
      bones: {
        handR: findBone(model, 'handslot.r'), handL: findBone(model, 'handslot.l'),
        head: findBone(model, 'head'), chest: findBone(model, 'chest')
      },
      play: play, has: has, locomotion: locomotion,
      // POSTURA: aplicada DEPOIS do mixer, a cada quadro. Gravar a inclinação no
      // osso não adianta — o clipe de animação reescreve a rotação a cada
      // atualização e a pose sumiria em movimento. O renderizador chama isto
      // logo após `mixer.update`.
      postura: function () {
        var t = look.headTilt || 0;
        if (!t) return;
        var h = findBone(model, 'head');
        if (!h) return;
        // SOMAR a cada quadro fazia a cabeça GIRAR sem parar: quando o clipe em
        // curso não anima o osso da cabeça, o mixer não reescreve a rotação e a
        // soma se acumula. Guardamos o que deixamos no quadro anterior; se o
        // valor continuar igual, o mixer não mexeu e desfazemos antes de somar.
        if (h.__tiltOut !== undefined && h.rotation.x === h.__tiltOut) {
          h.rotation.x -= t;
        }
        h.rotation.x += t;
        h.__tiltOut = h.rotation.x;
      },
      // introspecção (teste/depuração): QUAL clipe a cadeia de fallback escolheu
      clipFor: function (name) { var c = resolve(name, 0); return c ? c.name : null; },
      clipDur: function (name) { var c = resolve(name, 0); return c ? c.duration : 0; },
      currentName: function () { return currentAct; },
      stopAll: function () { mixer.stopAllAction(); current = null; }
    };
    group.userData.play('idle', { fade: 0 });
    // Confere se o boneco esta de pe DEPOIS de posado, e nao na pose de bind.
    //
    // Os personagens do Meshy tem a pose de bind correta e o CLIPE invertido:
    // sem animar eles ficam perfeitos, e assim que o mixer toca `idle` viram de
    // ponta-cabeca. Medir antes da animacao — que era o que eu fazia — nao ve
    // nada de errado e deixa passar.
    //
    // A correcao e por MEDIDA, nao por lista de modelo: se a cabeca esta abaixo
    // do quadril depois de posado, o corpo esta invertido. Serve para qualquer
    // arquivo futuro sem precisar cadastrar nome nenhum.
    return group;
  };

  /* Pendura uma peca de OUTRO modelo num osso deste.
   *
   * Fazia duas coisas de menos, e as duas apareceram quando esta funcao virou a
   * base da recombinacao de pecas do kit:
   *
   *   1. Nao copiava a pose LOCAL que a peca tem no dono original. O machado
   *      nasce deslocado e girado em relacao ao osso da mao; sem copiar isso,
   *      ele aparecia no centro do punho, atravessado no corpo. E o mesmo
   *      cuidado que o enxerto da fusao ja tomava — aqui faltava.
   *   2. Nao desfazia a escala herdada da cadeia de ossos. No corpo do Barbaro,
   *      que tem `build` inflado, a peca saia ate 1,75x maior.
   *
   * Devolve a peca, ou null dizendo por que nao deu (o chamador precisa saber
   * a diferenca entre "modelo errado" e "malha errada"). */
  M.attach = function (group, modelKey, meshName, boneName) {
    var src = raw[modelKey];
    if (!src) return null;
    var model = group && group.userData ? group.userData.model : null;
    if (!model) return null;
    var mesh = meshByName(src.scene, meshName);
    var bone = findBone(model, boneName);
    if (!mesh || !bone) return null;

    var c = mesh.clone();
    c.visible = true; c.castShadow = true;
    c.position.set(0, 0, 0); c.rotation.set(0, 0, 0); c.scale.set(1, 1, 1);
    // a peca guarda a pose que tinha no osso do dono; sem ela nasce no centro
    if (mesh.parent && mesh.parent.isBone) {
      c.position.copy(mesh.position);
      c.quaternion.copy(mesh.quaternion);
      c.scale.copy(mesh.scale);
    }
    c.userData.escalaBase = c.scale.clone();
    bone.add(c);

    // desfaz a escala acumulada do anfitriao, do osso ate a raiz do modelo
    var ax = 1, ay = 1, az = 1;
    for (var n = bone; n && n !== model; n = n.parent) {
      if (!n.scale) continue;
      ax *= n.scale.x; ay *= n.scale.y; az *= n.scale.z;
    }
    var b = c.userData.escalaBase;
    c.scale.set(b.x / Math.max(0.001, ax), b.y / Math.max(0.001, ay),
                b.z / Math.max(0.001, az));
    return c;
  };

  // ================================================================ RETRATOS
  // Cena offscreen com luz de três pontos e fundo em gradiente do elemento.
  // Serve retrato para TUDO (6 classes, 66 monstros, 6 chefes, 6 pets, 15
  // fusões) com consistência de estilo e sem arte manual.
  var portCache = {}, portRenderer = null, portScene = null, portCam = null;
  var PORT_ANG = 0.62;    // azimute do 3/4 — o mesmo para todo mundo
  var PORT_FOV = 30;
  // Enquadramento em unidades de CABEÇA (ver portraitFraming): manter em cabeças
  // é o que faz o rosto do Bárbaro, do Xamã e de um chefe saírem do mesmo porte.
  // (os bonecos do acervo são chibi: o crânio dá ~metade da altura do corpo,
  //  por isso o busto mede menos de duas cabeças)
  var TOP_AIR = 0.20;     // ar acima do crânio, em cabeças
  var GEAR_ROOM = 0.75;   // teto do adereço de cabeça (chapéu/elmo/chifre), em cabeças
  var BUST_HEADS = 1.60;  // altura do busto, em cabeças
  var GEAR_GROW = 0.50;   // parte do espaço do adereço que ALARGA o quadro…
                          // …o resto sai do tronco, senão o rosto encolhe demais

  function portraitRig(size) {
    if (portRenderer) return;
    portRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    portRenderer.setSize(size, size, false);
    portRenderer.setPixelRatio(1);
    if (THREE.sRGBEncoding != null) portRenderer.outputEncoding = THREE.sRGBEncoding;
    portRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    portRenderer.toneMappingExposure = 0.94;
    portScene = new THREE.Scene();
    portCam = new THREE.PerspectiveCamera(PORT_FOV, 1, 0.1, 60);
    // três pontos com CONTRALUZ forte: a figura clara (Paladina) precisa de um
    // fio de luz na silhueta para não derreter no fundo.
    var key = new THREE.DirectionalLight(0xfff0d0, 1.85); key.position.set(2.4, 2.6, 3.2);
    var fill = new THREE.DirectionalLight(0x9ec8ff, 0.62); fill.position.set(-3.0, 0.9, 1.6);
    var rim = new THREE.DirectionalLight(0xffffff, 2.60); rim.position.set(-1.6, 2.4, -3.4);
    var rim2 = new THREE.DirectionalLight(0xdfe8ff, 1.30); rim2.position.set(2.2, 1.6, -3.0);
    portScene.add(key, fill, rim, rim2, new THREE.AmbientLight(0xffffff, 0.20));
  }

  // FUNDO: escurecido por REGRA (não por classe). Ele nasce da cor de
  // identidade, mas a luminância é decidida pela FIGURA JÁ RENDERIZADA: quanto
  // mais clara a figura, mais fundo o fundo. Sem isso, a armadura creme da
  // Paladina derretia num fundo creme.
  function darkenBg(hex, figLuma) {
    var c = new THREE.Color(hexInt(hex));
    var hsl = { h: 0, s: 0, l: 0 };
    c.getHSL(hsl);
    var sat = Math.min(0.72, Math.max(0.34, hsl.s));
    var f = (figLuma == null ? 0.5 : Math.max(0, Math.min(1, figLuma)));
    var lc = Math.max(0.10, Math.min(0.32, 0.44 - 0.34 * f));    // centro
    var a = new THREE.Color().setHSL(hsl.h, sat, lc);
    var b = new THREE.Color().setHSL(hsl.h, Math.min(0.85, sat * 1.1), lc * 0.34);
    return ['#' + a.getHexString(), '#' + b.getHexString()];
  }
  // luminância média da FIGURA (só pixels opacos) — 0..1
  function figureLuma(ctx, size) {
    var d;
    try { d = ctx.getImageData(0, 0, size, size).data; } catch (e) { return null; }
    var sum = 0, n = 0;
    for (var i = 0; i < d.length; i += 16) {          // amostra 1 a cada 4 pixels
      if (d[i + 3] < 128) continue;
      sum += (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 255;
      n++;
    }
    return n ? sum / n : null;
  }
  function gradientBg(cv, colorA, colorB) {
    var c = cv.getContext('2d'), s = cv.width;
    var g = c.createRadialGradient(s * 0.5, s * 0.40, s * 0.05, s * 0.5, s * 0.5, s * 0.74);
    g.addColorStop(0, colorA); g.addColorStop(1, colorB);
    c.fillStyle = g; c.fillRect(0, 0, s, s);
    // vinheta
    var v = c.createRadialGradient(s * 0.5, s * 0.5, s * 0.26, s * 0.5, s * 0.5, s * 0.74);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.62)');
    c.fillStyle = v; c.fillRect(0, 0, s, s);
  }
  // ------------------------------------------------- medida da POSE (retrato)
  // Box3.setFromObject mede a malha em BIND POSE e engole TUDO que estiver
  // pendurado no osso: era o cajado do Bruxo inflando a altura (e encolhendo o
  // busto do Xamã), e a caixa de bind pose empurrando a cabeça do Bárbaro para
  // fora do quadro. Aqui medimos os vértices DEPOIS do skinning e separamos:
  //   · pele  (o corpo de verdade, na pose de parado)
  //   · crânio (vértices cujo peso dominante é o osso da cabeça ou filhos dele)
  //   · adereço de cabeça (chapéu/elmo: malha presa ao osso da cabeça)
  //   · arma de mão (presa a handslot/wrist) — FORA do enquadramento
  function isUnder(node, anc) {
    for (var p = node; p; p = p.parent) if (p === anc) return true;
    return false;
  }
  function findHeadBone(root) {
    var exact = null, loose = null;
    root.traverse(function (n) {
      if (!n.isBone) return;
      if (!exact && /^head$/i.test(n.name)) exact = n;
      else if (!loose && /head/i.test(n.name) && !/ik|pole|control|target/i.test(n.name)) loose = n;
    });
    return exact || loose;
  }
  function propSlot(o, headBone) {
    for (var p = o.parent; p; p = p.parent) {
      if (headBone && p === headBone) return 'head';
      if (p.isBone) {
        if (/hand|wrist|slot|weapon|finger/i.test(p.name)) return 'hand';
        if (headBone && isUnder(p, headBone)) return 'head';
        return 'body';
      }
    }
    return 'body';
  }
  // BufferAttribute do r147 não tem getComponent
  function attrComp(a, i, k) {
    return k === 0 ? a.getX(i) : k === 1 ? a.getY(i) : k === 2 ? a.getZ(i) : a.getW(i);
  }
  function measurePose(node) {
    node.updateMatrixWorld(true);
    var headBone = findHeadBone(node);
    var out = {
      pts: [], skin: new THREE.Box3(), head: new THREE.Box3(),
      gear: new THREE.Box3(), any: new THREE.Box3(), headBone: headBone
    };
    out.skin.makeEmpty(); out.head.makeEmpty(); out.gear.makeEmpty(); out.any.makeEmpty();
    var v = new THREE.Vector3(), c = new THREE.Vector3();
    node.traverse(function (o) {
      if (!o.isMesh && !o.isSkinnedMesh) return;
      for (var p = o; p; p = p.parent) if (!p.visible) return;
      if (!o.geometry) return;
      var at = o.geometry.attributes || {};
      if (o.isSkinnedMesh && at.position && at.skinIndex && at.skinWeight && o.boneTransform) {
        var n = at.position.count;
        if (!n) return;
        var step = Math.max(1, Math.ceil(n / 2600));   // amostra: caixa não precisa de tudo
        var bones = (o.skeleton && o.skeleton.bones) || [];
        var headOf = null;
        if (headBone && bones.length) {
          headOf = [];
          for (var b = 0; b < bones.length; b++) headOf[b] = isUnder(bones[b], headBone);
        }
        for (var i = 0; i < n; i += step) {
          // ATENÇÃO: no three r147 `boneTransform(idx, alvo)` recebe a posição de
          // bind JÁ no alvo e devolve nele a posição deformada (a assinatura só
          // passou a ler o atributo sozinha em revisões posteriores).
          v.fromBufferAttribute(at.position, i);
          try { o.boneTransform(i, v); } catch (e) { v.fromBufferAttribute(at.position, i); }
          v.applyMatrix4(o.matrixWorld);
          if (!isFinite(v.x) || !isFinite(v.y) || !isFinite(v.z)) continue;  // vértice sem peso de osso
          out.pts.push(v.x, v.y, v.z);
          out.skin.expandByPoint(v); out.any.expandByPoint(v);
          if (headOf) {
            var best = -1, bw = 0;
            for (var k = 0; k < 4; k++) {
              var w = attrComp(at.skinWeight, i, k);
              if (w > bw) { bw = w; best = attrComp(at.skinIndex, i, k); }
            }
            if (best >= 0 && headOf[best]) out.head.expandByPoint(v);
          }
        }
      } else {
        var slot = propSlot(o, headBone);
        if (slot === 'hand') return;                   // arma não manda no quadro
        var bb = new THREE.Box3().setFromObject(o);
        if (bb.isEmpty() || !isFinite(bb.min.y) || !isFinite(bb.max.y)) return;
        for (var q = 0; q < 8; q++) {
          c.set((q & 1) ? bb.max.x : bb.min.x, (q & 2) ? bb.max.y : bb.min.y, (q & 4) ? bb.max.z : bb.min.z);
          out.pts.push(c.x, c.y, c.z);
          out.any.expandByPoint(c);
        }
        if (slot === 'head') out.gear.union(bb);
        else if (out.skin.isEmpty()) out.skin.union(bb);  // unidade procedural (sem esqueleto)
      }
    });
    return out;
  }

  // Devolve a câmera do retrato a partir da GEOMETRIA — nunca do id.
  //   bípede de pé   -> busto medido em CABEÇAS (mesmo porte de rosto em todos,
  //                     adereço de cabeça ganha teto, membros soltos ficam fora)
  //   bicho/voador   -> corpo inteiro com a mesma margem
  M.portraitFraming = function (node, corpoInteiro) {
    var m = measurePose(node);
    var box = m.skin.isEmpty() ? m.any : m.skin;
    if (box.isEmpty()) return null;
    var sz = new THREE.Vector3(); box.getSize(sz);
    var H = Math.max(1e-4, sz.y);
    var hasHead = !m.head.isEmpty();
    var hH = hasHead ? Math.max(1e-4, m.head.max.y - m.head.min.y) : 0;
    // "de pé" é uma pergunta de geometria: cabeça no alto da silhueta E corpo
    // mais alto do que largo/comprido. Quadrúpede e inseto reprovam no segundo.
    // (mede-se pelo CENTRO do crânio: nesses bonecos chibi o queixo desce da
    //  metade da altura, e um corte por `head.min` reprovaria o Bruxo.)
    // Terceira condição: o crânio tem de ser o PONTO ALTO da silhueta. A vespa
    // fica de pé e tem cabeça, mas quem encosta no teto são as asas — busto ali
    // decapitaria o bicho. (Humanoide: head.max == box.max, sempre.)
    var headMid = hasHead ? (m.head.min.y + m.head.max.y) / 2 : 0;
    var upright = hasHead && (headMid > box.min.y + H * 0.45) &&
                  (m.head.max.y >= box.max.y - H * 0.10) &&
                  (H >= 1.15 * Math.max(sz.x, sz.z));

    var top, bottom;
    // `corpoInteiro` força o caminho de corpo inteiro mesmo em bípede: os
    // cartões da tela de escolha e a ficha do herói mostram a FIGURA toda, não
    // um busto. Sem isto, `Art.unit` receberia um retrato cortado no peito.
    if (upright && !corpoInteiro) {
      var want = m.head.max.y + hH * TOP_AIR;
      top = want;
      if (!m.gear.isEmpty() && m.gear.max.y > top) {
        top = Math.min(m.gear.max.y + hH * 0.08, m.head.max.y + hH * GEAR_ROOM);
      }
      var extra = top - want;
      bottom = want - hH * BUST_HEADS + extra * (1 - GEAR_GROW);
      if (bottom < box.min.y) bottom = box.min.y;
    } else {
      var pad = H * 0.06;
      top = Math.max(box.max.y, m.any.max.y) + pad;
      bottom = Math.min(box.min.y, m.any.min.y) - pad;
    }

    // largura e profundidade REAIS da faixa escolhida (a mão que sobra embaixo
    // não entra na conta porque está fora da faixa)
    var ca = Math.cos(PORT_ANG), sa = Math.sin(PORT_ANG);
    var uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
    var P = m.pts;
    for (var i = 0; i < P.length; i += 3) {
      var y = P[i + 1];
      if (y < bottom || y > top) continue;
      var u = P[i] * ca - P[i + 2] * sa, w = P[i] * sa + P[i + 2] * ca;
      if (u < uMin) uMin = u; if (u > uMax) uMax = u;
      if (w < vMin) vMin = w; if (w > vMax) vMax = w;
    }
    if (uMin > uMax) { uMin = uMax = 0; vMin = vMax = 0; }

    var halfH = (top - bottom) / 2;
    var cy = (top + bottom) / 2, cu = (uMin + uMax) / 2, cv = (vMin + vMax) / 2;
    var tanH = Math.tan(PORT_FOV * Math.PI / 360);

    // Segunda passada: distância EXATA. Um ponto cabe no quadro quando
    //   dist >= |desvio lateral| / tan(fov/2) + profundidade dele.
    // Sem o termo de profundidade, o que está mais perto da câmera (o focinho
    // da cobra, adiantado no 3/4) projeta maior e escapa pela borda.
    // Do QUEIXO PARA CIMA nada é cortado (cabeça, chapéu, mandíbula da cobra);
    // do queixo para baixo o ombro pode sangrar, que é o corte normal de um
    // busto. Sem essa distinção, ou a cobra perde a bocarra ou o humanoide sai
    // pequeno demais para caber ombro e braço.
    var chin = hasHead ? (m.head.min.y + hH * 0.08) : (top - (top - bottom) * 0.45);
    var dBust = 0, dFull = 0;
    for (var j = 0; j < P.length; j += 3) {
      var y2 = P[j + 1];
      if (y2 < bottom || y2 > top) continue;
      var u2 = P[j] * ca - P[j + 2] * sa, w2 = P[j] * sa + P[j + 2] * ca;
      var du = Math.abs(u2 - cu), dy = Math.abs(y2 - cy), dp = w2 - cv;
      var db = Math.max(du * (y2 >= chin ? 1 : 0.80), dy) / tanH + dp;
      if (db > dBust) dBust = db;
      var df = Math.max(du * 0.92, dy) / tanH + dp;   // corpo inteiro: 8% de sangria
      if (df > dFull) dFull = df;
    }

    // a altura da faixa é a COMPOSIÇÃO pedida; as contas acima só impedem corte
    var dist = halfH / tanH + (vMax - cv) * 0.9;
    dist = Math.max(dist, (upright ? dBust : dFull) * 1.02);
    var half = dist * tanH;   // meia-altura visível no plano do alvo
    return {
      half: half, cy: cy, upright: upright, headH: hH, dist: dist,
      tx: cu * ca + cv * sa, tz: -cu * sa + cv * ca,
      // caixas medidas — expostas para inspeção (teste/depuração do quadro)
      box: box, head: m.head, gear: m.gear, top: top, bottom: bottom
    };
  };

  M.portrait = function (defId, opts) {
    opts = opts || {};
    var size = opts.size || 192;
    var key = defId + '|' + (opts.element || '') + '|' + (opts.elements ? opts.elements.join(',') : '') +
              '|' + size + (opts.corpoInteiro ? '|inteiro' : '');
    if (portCache[key]) return portCache[key];
    if (!ready) return null;

    var look = M.lookFor(defId, opts);
    if (!look) return null;
    var node = null;
    try { node = M.unit(defId, { element: opts.element, elements: opts.elements, kind: opts.kind, classId: opts.classId, boss: opts.boss }); }
    catch (e) { node = null; }
    if (!node) return null;

    portraitRig(size);
    portRenderer.setSize(size, size, false);
    portScene.add(node);
    // pose de parado, um quadro à frente para sair do bind pose
    if (node.userData.mixer) { node.userData.play('idle', { fade: 0 }); node.userData.mixer.update(0.6); }
    if (node.userData.procAnimate) node.userData.procAnimate({ moving: 0, castK: 0 }, 0.6, 0.016);
    node.updateMatrixWorld(true);

    // ENQUADRAMENTO PELA GEOMETRIA (§ portraitFraming): sem isto, altura e
    // distância fixas decapitavam o Bárbaro e encolhiam o Xamã.
    var f = M.portraitFraming(node, opts.corpoInteiro);
    if (!f) { portScene.remove(node); return null; }
    var ca = Math.cos(PORT_ANG), sa = Math.sin(PORT_ANG);
    portCam.position.set(f.tx + sa * f.dist, f.cy, f.tz + ca * f.dist);
    portCam.lookAt(f.tx, f.cy, f.tz);
    portCam.near = Math.max(0.02, f.dist - f.half * 5);
    portCam.far = f.dist + f.half * 10;
    portCam.updateProjectionMatrix();

    portRenderer.setClearColor(0x000000, 0);
    portRenderer.clear();
    portRenderer.render(portScene, portCam);

    // a figura vai primeiro para um canvas 2D: é dele que sai a medida de
    // luminância que decide o quanto o fundo escurece
    var fig = document.createElement('canvas');
    fig.width = fig.height = size;
    var fgc = fig.getContext('2d');
    fgc.drawImage(portRenderer.domElement, 0, 0, size, size);
    var luma = figureLuma(fgc, size);

    var cv = document.createElement('canvas');
    cv.width = cv.height = size;
    var base = look.tint || look.accent ||
               (opts.element && M.elementColor(opts.element)) || '#8a8a92';
    var duo = darkenBg(base, luma);
    gradientBg(cv, duo[0], duo[1]);
    var g2 = cv.getContext('2d');
    // halo escuro pela SILHUETA (sombra do canal alfa): separa figura e fundo
    // mesmo quando as duas cores baterem.
    g2.save();
    g2.shadowColor = 'rgba(0,0,0,0.62)';
    g2.shadowBlur = Math.max(4, size * 0.055);
    g2.drawImage(fig, 0, 0);
    g2.drawImage(fig, 0, 0);
    g2.restore();
    g2.drawImage(fig, 0, 0);

    portScene.remove(node);
    portCache[key] = cv;
    return cv;
  };
  M.clearPortraits = function () { portCache = {}; };

  // --------------------------------------------------------- peças de cenário
  var geoCache = {};
  function geo(key, make) { if (!geoCache[key]) geoCache[key] = make(); return geoCache[key]; }
  M.geo = geo;
  M.floorGeo = function () { return geo('floor', function () { return new THREE.BoxGeometry(M.CELL, 0.4, M.CELL); }); };
  M.highGeo = function () { return geo('high', function () { return new THREE.BoxGeometry(M.CELL * 0.96, M.CELL * 1.55, M.CELL * 0.96); }); };
  M.lowGeo = function () { return geo('low', function () { return new THREE.BoxGeometry(M.CELL * 0.94, M.CELL * 0.46, M.CELL * 0.94); }); };
  M.lowTopGeo = function () { return geo('lowtop', function () { return new THREE.BoxGeometry(M.CELL * 0.98, M.CELL * 0.30, M.CELL * 0.98); }); };
  M.tileFlatGeo = function () {
    return geo('flat', function () {
      var g = new THREE.PlaneGeometry(M.CELL, M.CELL);
      g.rotateX(-Math.PI / 2);
      return g;
    });
  };
})();
