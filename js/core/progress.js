var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

/* ============================================================================
 * SOTERRA 2.0 — js/core/progress.js   (dono: Lógica Meta)
 * Progressão persistente: classes, heróis, XP/níveis, caminho elemental,
 * feitiços, inventário ÚNICO de 4 espaços + pet, coleção de cartas com
 * estrelas, conjuntos elementais e forja de itens.
 * LEI: docs/CONTRACT_V2.md §3, §5, §8, §9 e o ADENDO v2.1 (§9-B), que
 * SUBSTITUI o que o contrair.
 * Nomenclatura obrigatória: pa = Pontos de Ataque, pp = Pontos de Passos.
 *
 * ---------------------------------------------------------------------------
 * DECISÕES DE DESIGN (onde o contrato é omisso — todas testadas):
 *
 * [D1] PERSISTÊNCIA. Chave `localStorage['soterra-save-v2']`. O save v1
 *      (`soterra-save-v1`) é IGNORADO — nunca lido, nunca migrado e nunca
 *      apagado (a v1 continua jogável). TODO acesso a storage vive em
 *      try/catch: `file://`, modo privado e headless podem negar. Sem storage
 *      o estado vive só em memória e nenhuma API lança exceção por isso.
 *      Save automático em toda mutação; `load()` nunca grava.
 *
 * [D2] SAVE CORROMPIDO NUNCA QUEBRA O JOGO. `load()` passa o JSON por um
 *      saneador (`sanitize`) que reconstrói campo a campo: tipo errado, classe
 *      inexistente, item/pet/pedra fora de DATA, elemento inválido, slot
 *      trocado, XP negativo, nível de forja fora da faixa — tudo é descartado
 *      ou corrigido. Sobrando lixo irrecuperável, cai em `freshState()`.
 *      O saneador também MIGRA formatos antigos do próprio v2:
 *      `inventory` de strings vira `[{itemId, level}]`; `cards` em array vira
 *      `{classId: n}` (conta as repetições); item equipado que não estava no
 *      inventário é devolvido a ele (modelo novo: equipar não tira do saco).
 *
 * [D3] HERÓI = UMA FICHA POR CLASSE. O contrato não diz de onde vem o
 *      `heroId`; adotamos `heroId === classId` para a ficha padrão, criada
 *      quando a classe é liberada (as `startsUnlocked` de DATA.classes já
 *      nascem com ficha — nada é fixado no código, o dado manda).
 *      `createHero(classId, heroId)` permite fichas extras.
 *
 * [D4] `hero.spells` é CACHE. A fonte da verdade é `spellsFor(heroId)`
 *      (3 base + caminho liberado + `grantsSpell` do item especial); o cache é
 *      regravado a cada mutação para o save e a UI lerem sem recalcular.
 *
 * [D5] NÍVEL DO FEITIÇO DE CAMINHO. Usa `DATA.spells[id].unlockLevel` quando
 *      existir e for > 0; senão cai em `DATA.unlockTiers[i]`.
 *
 * [D6] ELEMENTO. Todo herói nasce 'neutro'. `chooseElement` exige
 *      `level >= DATA.leveling.elementChoiceLevel` (5) e é irreversível DE
 *      GRAÇA: só o Pergaminho da Reescrita (loja do site, Fase C) troca um
 *      caminho depois — `reescreveElemento`, que gasta o pergaminho. Trocar
 *      o ATIVO entre os caminhos liberados continua grátis (`trocaElemento`).
 *
 * [D7] INVENTÁRIO ÚNICO DE CÓPIAS (§9-B + pedido do usuário de 18/ago). Um saco
 *      só para todo o grupo, agora com uma entrada POR CÓPIA:
 *      `{itemId, level, stars}`. Duas botas iguais são DUAS entradas — é o que
 *      permite equipar uma em cada herói e é a matéria-prima das estrelas [D18].
 *      A tela agrupa as cópias idênticas num espaço só com um contador ×N
 *      (`invStacks()` faz o agrupamento; a UI não conta na mão).
 *      EQUIPAR TIRA DO SACO: a cópia sai do inventário e passa a viver no
 *      espaço do herói (`hero.items[slot]` = itemId, `hero.itemVar[slot]` =
 *      `{level, stars}` da cópia em uso). Ela fica presa ali até ser
 *      desequipada, e `unequip` devolve a MESMA cópia ao saco. Foi troca de
 *      modelo: antes o item equipado continuava no saco. O que se perdia com
 *      isso — forjar uma peça em uso — voltou por `upgradeWorn(heroId, slot)`.
 *      Item repetido no saque NÃO vira mais pedra: vira cópia, porque é ela que
 *      alimenta a fusão de estrelas. As pedras continuam caindo dos monstros.
 *      Sanidade do contrato §8: a contribuição de um item de espaço `pa`/`pp`
 *      é limitada a +1 mesmo depois do multiplicador da forja — a forja
 *      engorda vida, poder, resistências e esquiva, nunca a economia de ações.
 *
 * [D8] PETS. Vivem em `state.pets[]` e saem da lista ao serem equipados — um
 *      pet só serve a um herói por vez. Bônus entram em `effectiveStats`
 *      (com o mesmo teto de +1 em pa/pp).
 *
 * [D9] CARTAS ACUMULATIVAS E ESTRELAS (§9-B — substitui o desbloqueio por
 *      carta única da v2.0). `state.cards[classId] = n`, nunca decresce.
 *      Classe liberada quando `n >= unlockCost`; as cartas EXCEDENTES ao
 *      custo sobem estrelas conforme `starCosts` acumulados (máx. 5).
 *      Carta repetida NÃO vira mais XP: agora ela é progresso de estrela.
 *      Só o CHEFE derruba carta, e de forma aleatória: chance 60% (solo) /
 *      50% (dupla); a classe sai da piscina `dungeon.cardDrops` × `dropWeight`
 *      (respeitando `minDungeon` contra o ÍNDICE 0-based do calabouço em
 *      DATA.dungeons — `order` é 1-based e compará-lo faria a carta cara vazar
 *      um andar acima), e a QUANTIDADE cresce com a profundidade:
 *      `1 + floor(índice/2)` cartas —
 *      calabouço fundo compensa o custo alto das classes caras.
 *      Sem `unlockCost` no dado (progression.js ainda por atualizar), usa-se
 *      0 para classe `startsUnlocked` e `UNLOCK_COST_FALLBACK` para as outras.
 *
 * [D10] CONJUNTOS (§9-B). `effectiveStats` soma `DATA.sets[setId].bonuses[k]`
 *       de forma PROGRESSIVA e cumulativa: com 4 peças valem os bônus de 2, 3
 *       e 4. A peça é reconhecida por `item.setId` ou, na falta dele, pela
 *       lista `pieces` do próprio conjunto. Bônus de conjunto e de estrela não
 *       sofrem o multiplicador da forja nem o teto de pa/pp (são fontes
 *       distintas do item).
 *
 * [D11] FORJA (§9-B). `state.stones = {stoneId: n}`. `upgradeItem(invIndex)`
 *       é determinístico: consome `DATA.upgrade.stoneCost[level]` pedras do
 *       ELEMENTO do item (item neutro/sem elemento aceita qualquer pedra —
 *       consome a de maior estoque) e sobe 1 nível, até `maxLevel` (10).
 *       Nunca quebra, nunca regride, nunca consome sem subir.
 *       `effectiveStats` aplica `1 + bonusPerLevel*level` (0,12 ⇒ +10 = 2,2×)
 *       sobre os bônus do item, arredondando por atributo — EXCETO os
 *       atributos de `DATA.upgrade.nonScalingKeys` (pa/pp), que ficam no valor
 *       base: são pontos de ação inteiros e escalá-los furaria o teto do §8
 *       (+1 PA viraria +2 já no +5). A lista vem do DADO, não do código.
 *
 * [D12] SAQUE. `LUCK = 2.4` (solo) / `1.6` (dupla) — grupo agora é de 1 ou 2.
 *       A piscina é montada com os ITENS do calabouço (`DATA.items[*].dungeonId`,
 *       `dropWeight`, `minRoom`), que é a escala em que o Criativo calibrou o
 *       modelo; `dungeon.lootTable` fica como reserva para dados antigos.
 *       Peso efetivo = `dropWeight * LUCK^expoente`, com o expoente vindo de
 *       `DATA.lootWeights.luckExponent`. `minRoom` do item é respeitado
 *       (comum 0 · raro 1 · épico/lendário 2 ⇒ só na sala do chefe).
 *       PESO DE "NADA": `DATA.lootWeights.noDrop[dungeonId]` entra no MESMO
 *       sorteio como resultado vazio e NÃO recebe a Sorte de Saque — é isso que
 *       deixa ~50% dos sorteios secos (descida completa ≈ 2 peças) e que faz
 *       grupo menor tirar mais e melhor. 1 sorteio por sala + 1 extra no chefe.
 *       `rollPet` só no chefe.
 *
 * [D18] ESTRELAS DE ITEM (pedido do usuário, 18/ago). Segunda trilha de poder,
 *       INDEPENDENTE da forja: juntar `FUSE_COPIES` (3) cópias IDÊNTICAS —
 *       mesmo item, mesmo `level` de forja e mesmo `stars` — funde tudo numa
 *       cópia só com uma estrela a mais, até `ITEM_STARS_MAX` (3). Como a
 *       escada é de 3 em 3 sobre o MESMO degrau, um ★3 custa 27 cópias.
 *       Exigir `level` igual é o que impede o truque de forjar uma cópia barata
 *       e herdar o nível na fusão. O ganho entra SOMANDO no multiplicador da
 *       forja (`itemMult`), nunca multiplicando: `1 + 0,12·nível + estrela`,
 *       com estrela em `STAR_BONUS` = 0 / +10% / +25% / +50%. Somar mantém o
 *       teto previsível (★3 +10 = 2,70× contra 2,20× do +10 de hoje); se os
 *       dois eixos se multiplicassem daria 3,30× e a esquiva de conjunto
 *       completo (§9-H) estouraria junto. `nonScalingKeys` (pa/pp) também vale
 *       para as estrelas — nenhuma trilha cria +2 PA.
 *       NÃO CONFUNDIR com as estrelas de CLASSE [D9], que vêm de cartas de
 *       chefe, vão até 5 e vivem em `cardInfo`. São sistemas distintos: aqui a
 *       estrela é de uma PEÇA e nasce de cópias repetidas.
 *
 * [D16] CONJUNTO QUE CONCEDE FEITIÇO. `spellsFor` inclui, além do `grantsSpell`
 *       do Lume, qualquer `DATA.sets[*].bonuses[n].grantsSpell` quando o herói
 *       tiver n peças daquele conjunto equipadas — genérico, sem id fixo.
 *
 * [D13] `effectiveStats` = base da classe + ganho por nível + itens (com forja)
 *       + conjuntos + pet + estrelas da classe. Herói desconhecido devolve null
 *       (o Engine cai nos stats base).
 *
 * [D15] RENDIMENTO DECRESCENTE DE XP (§9-D). `xpMultiplier(herói, calabouço)`:
 *       ×1 até `recommendedLevel + graceLevels`; acima disso, `factorPerLevel`
 *       elevado à diferença, com piso `floor`. É POR HERÓI (cada um tem seu
 *       nível) e entra DEPOIS da divisão da XP pelo tamanho do grupo. Faltando
 *       `recommendedLevel` ou `xpFalloff` no dado, devolve 1 — nunca corta por
 *       engano. Itens, pedras e cartas NÃO sofrem o corte.
 *
 * [D14] GANHO POR NÍVEL ELEMENTAL (§9-C). Todo nível dá `perLevel.hp`. As
 *       subidas ANTES da escolha do elemento (níveis 1→4, isto é
 *       `elementChoiceLevel - 2` subidas) dão `perLevel.power` genérico; as
 *       subidas a partir dali dão `perLevelElement.elemPower` — dano só nos
 *       feitiços do elemento do herói, que o Engine aplica.
 *       O contrato não diz o que fazer com quem passou do nível 5 SEM escolher:
 *       decidimos que essas subidas continuam dando poder genérico (ninguém
 *       perde progressão por adiar a escolha) e passam a valer como elementais
 *       assim que o elemento é escolhido. Sem `perLevelElement` no dado, tudo
 *       vira poder genérico (comportamento da v2.1).
 *       `effectiveStats` devolve `elemPower` e `element`; `battleParty` repassa.
 *
 * [D17] DEFESA DE POSIÇÃO POR NÍVEL (§9-H). `dodge` e `lock` caminham em linha
 *       reta da base da classe (nível 1) até o alvo do PAPEL no nível máximo,
 *       lido em `DATA.leveling.defenseByRole[role]`. A conta entra ANTES dos
 *       itens, dos conjuntos, do pet e das estrelas — tudo isso continua somando
 *       por cima. Sem a tabela no dado, o ganho é 0 e nada muda (a v2.6 volta
 *       inteira). Um alvo ABAIXO da base nunca encolhe a classe: vale 0.
 *       `Progress.defenseAtLevel(classId, nível)` expõe a curva para a UI.
 *
 * [D19] NÍVEL DE USO (10/09, pedido do dono: "esses itens de cada mapa
 *       precisam ter seu nível para uso… os mais fortes são níveis mais altos;
 *       o set especial da roleta é level 30 todas as peças; pets a partir do
 *       lv 10"). A RÉGUA mora no dado (items.js: `DATA.nivelUso` e
 *       `DATA.nivelUsoDe(def)`); aqui só se COBRA, em `equip`/`equipPet` —
 *       `podeUsar`/`podeUsarPet` dão o veredito com motivo pronto para a tela
 *       e a recusa fica em `Progress.ultimaRecusa`. Sem o resolvedor no DATA
 *       (páginas de teste que montam o dado à mão) nada tranca: 0 = sem
 *       exigência. O Mestre (`JOGO.GM.ativo()`) nunca paga. Peça acima do
 *       nível continua caindo, sendo comprada, trocada e guardada — só não
 *       entra no herói. SANEAMENTO: ao carregar, peça vestida acima do nível
 *       do herói volta ao saco (MESMA série, mesmo level/stars) e pet acima
 *       volta à lista — mesmo com o saco cheio, porque é migração única e
 *       perder a peça seria pior que um saco estufado; a lista do que voltou
 *       sai por `devolvidasPorNivel()` para a HUD avisar uma vez, e é ao
 *       ENTREGAR o aviso (`devolvidasPorNivel(true)`) que a migração vai ao
 *       disco — a carga não grava (ver lá). O nível de
 *       um herói só desce se a xpTable mudar (a fusão é de BATALHA — a unidade
 *       fundida tem a média dos níveis, mas não veste nem guarda peça): é esse
 *       o caso que o saneamento cobre.
 *
 * [D20] A QUEBRA (22/09, pedido do dono: "na forja o jogador poderá quebrar
 *       os itens, que darão pedras daquele elemento"). `quebraPeca(invIndex,
 *       n)` desfaz n cópias IDÊNTICAS do saco (mesmo item, forja e ★) em
 *       pedras do ELEMENTO da peça — por `stoneIdForElement`, nunca pelo
 *       `stoneForItem` da forja (para a neutra ele escolhe a pilha maior, e a
 *       pilha maior podia ser a Âncora). A régua e a conta moram no dado
 *       (`DATA.quebra`, items.js, com a tabela de exemplos); `quebraCfg()` lê
 *       campo a campo com `QUEBRA_DEFAULT`, então o mundo de prova sem a
 *       tabela quebra com os números de fábrica. Só o SACO se quebra (a peça
 *       vestida não está nele); a Panóplia do Mestre ('gm-*' / noDrop) nunca;
 *       a Âncora nunca sai daqui. Recusa devolve false sem tocar em nada; o
 *       golpe grava UMA vez. `quebraInfo`/`quebraInfoDe` dão a conta para a
 *       tela antes do golpe; `gastaPedras` é a saída avulsa de pedra (o
 *       mercado). O mesmo golpe corrigiu o `stoneForItem`: a Âncora saiu da
 *       piscina da peça neutra.
 * ==========================================================================*/

(function () {
  'use strict';

  var Progress = {};
  JOGO.Progress = Progress;

  /* A chave é DA CONTA DA JANELA (contas.js, carregado antes): 'principal'
   * usa a nua de sempre, as outras ganham ':<id>' — dois jogadores na mesma
   * máquina são duas janelas com contas diferentes, cada uma com seu save.
   * Sem o Banco de Contas (páginas de teste), a chave nua. */
  var KEY = (JOGO.Contas && JOGO.Contas.chaveSave)
    ? JOGO.Contas.chaveSave() : 'soterra-save-v2';
  // §9-C: os 4 espaços ganharam nome próprio (nada de nomes de planilha)
  var SLOTS = ['punho', 'passo', 'casca', 'lume'];
  // saves antigos (v2.0/v2.1) guardavam os ids velhos — migração automática
  var SLOT_ALIASES = { pa: 'punho', pp: 'passo', vida: 'casca', especial: 'lume' };
  var SPELL_SLOT = 'lume';                 // o espaço que concede feitiço
  var STAT_KEYS = ['hp', 'pa', 'pp', 'power', 'initiative', 'dodge', 'lock'];
  var DEFAULT_ELEMENT = 'neutro';

  // expoente da Sorte de Saque por raridade — só vale se o dado não trouxer
  // `DATA.lootWeights.luckExponent` (lendário divide o expoente do épico: com
  // ×LUCK³ o solo trivializaria o troféu)
  var RARITY_DEGREE = { comum: 0, raro: 1, epico: 2, lendario: 2,
                        common: 0, rare: 1, epic: 2, legendary: 2 };
  var NO_DROP = ' nada';    // entrada virtual de "nenhum item" no sorteio
  // chance de o chefe derrubar carta, por tamanho do grupo (1 ou 2) [D9]
  var CARD_CHANCE = [0.60, 0.60, 0.50];
  var PET_CHANCE = 0.25;                 // chance base de pet no chefe [D12] (LEGADO: o jogo usa cartas)
  // ---- PETS COM NÍVEL E CARTAS (03/09, pedido do dono): "conforme seu level,
  // seu bônus e dano/buff aumenta"; "o drop deve ser difícil e deve dropar
  // CARTAS dos pets"; "dropou 5 cartas pega o pet; gastando 10 fica com 1
  // estrela; +15 duas; +20 três"; "até o level 10 no máximo". A régua
  // inteira mora aqui, como a das estrelas de item.
  var PET_MAX_LEVEL = 10;
  // XP ACUMULADA por nível (1..10) = 60% da tabela do herói nos mesmos
  // degraus — e o pet recebe 60% do XP do dono: sobe NO MESMO RITMO do dono
  // até o 10 (acompanha, não corre na frente).
  var PET_XP_TABLE = [0, 9, 24, 45, 75, 117, 177, 261, 369, 507];
  var PET_XP_SHARE = 0.6;
  var PET_UNLOCK_COST = 5;               // 5 cartas: o pet é seu
  var PET_STAR_COSTS = [10, 25, 45];     // excedentes acumulados: +10, +15, +20
  var PET_MAX_STARS = 3;
  var PET_CARD_CHANCE = 0.12;            // por chefe, × sorte do grupo, teto 0,5
  var PET_LEVEL_STEP = 0.10;             // bônus ao dono: +10% por nível acima do 1
  var PET_STAR_STEP = 0.15;              // e +15% por estrela
  var PET_POWER_PER_LEVEL = 10;          // poder do CORPO em batalha (dano/cura/buff)
  var PET_POWER_PER_STAR = 15;
  var PA_ITEM_CAP = 1, PP_ITEM_CAP = 1;  // sanidade do contrato §8 [D7]
  var UNLOCK_COST_FALLBACK = 10;         // dado ainda sem `unlockCost` [D9]

  // ---- estrelas de ITEM [D18] — a régua inteira mora nestas três linhas.
  // Trocar o custo (3 cópias por degrau) ou a curva de ganho é mexer aqui e em
  // mais lugar nenhum; `DATA.upgrade` pode sobrescrever sem tocar no código.
  var ITEM_STARS_MAX = 3;                     // ★ máximo de uma peça
  var FUSE_COPIES = 3;                        // cópias idênticas por degrau (★3 = 27)
  var STAR_BONUS = [0, 0.08, 0.18, 0.30];
  /* Curva medida, nao chutada. A forja sozinha ja vale 2,2x no +10
   * (0,12 por nivel), e forja e estrela SOMAM. Com a curva inicial de
   * 0,10/0,25/0,50 um item ★3 +10 chegava a 2,7x o item cru — acima do teto de
   * ~2x que eu mesmo tinha posto. Com esta, o topo do jogo fica em 2,5x.
   * A estrela vale menos que a forja de proposito: as 27 copias de um ★3 caem
   * sozinhas de tanto jogar, enquanto pedra o jogador cava. */     // somado ao multiplicador da forja
  var MAX_COPIES = 99;                        // teto por variante ao sanear save

  /* A INSTÂNCIA (10/09): cada cópia de item carrega um `iid` — o número de
   * série que o cartório (servidor/api.py) registra na primeira gravação e
   * nunca mais aceita em dois lugares, nem de volta depois de consumido. É o
   * que impede "copiar o save e ficar com dois". Toda cópia NOVA passa por
   * `cunha` (com a origem que o servidor conhece); o que já existia no disco
   * ganha carimbo 'legado' no saneamento, uma vez só. `nascimentos` é a fila
   * do que nasceu e o servidor ainda não viu — a Nuvem (nuvem.js) esvazia. */
  var IID_ORIGENS = { saque: 1, roleta: 1, mercador: 1, caixa: 1, forja: 1, troca: 1, banco: 1, legado: 1 };
  var NASC_TETO = 400;
  function novoIid() {
    var r = '';
    try {
      var c = (typeof crypto !== 'undefined' && crypto.getRandomValues) ? crypto : null;
      if (c) { var b = new Uint32Array(2); c.getRandomValues(b); r = b[0].toString(36) + b[1].toString(36); }
    } catch (e) { r = ''; }
    if (!r) r = Math.floor(Math.random() * 2147483647).toString(36) + Math.floor(Math.random() * 2147483647).toString(36);
    return 'j' + Date.now().toString(36) + '-' + r;
  }
  function registraNascimento(st, iid, itemId, origem) {
    if (!st) return;
    if (!isArray(st.nascimentos)) st.nascimentos = [];
    st.nascimentos.push({ iid: iid, itemId: itemId, origem: IID_ORIGENS[origem] ? origem : 'legado', t: Date.now() });
    if (st.nascimentos.length > NASC_TETO) st.nascimentos.splice(0, st.nascimentos.length - NASC_TETO);
  }
  /* A cópia nova, já com número de série e registrada na fila. */
  function cunha(st, itemId, origem, level, stars) {
    var e = { itemId: itemId, level: Math.max(0, Math.floor(num(level, 0))),
              stars: Math.max(0, Math.floor(num(stars, 0))), iid: novoIid() };
    registraNascimento(st, e.iid, itemId, origem);
    return e;
  }
  /* O número de série de uma variante já existente — ou um carimbo 'legado'
   * quando ela veio de antes da instância. */
  function serieDe(v, itemId) {
    if (v && typeof v.iid === 'string' && v.iid) return v.iid;
    var id = novoIid();
    registraNascimento(Progress.state, id, itemId, 'legado');
    return id;
  }

  // Padrões do ADENDO v2.1, usados enquanto os arquivos de dados não chegam.
  var STAR_COSTS_DEFAULT = [5, 15, 30, 55, 90];
  var STARS_DEFAULT = {
    max: 5,
    bonuses: { 1: { hp: 15 }, 2: { power: 8 }, 3: { pp: 1 }, 4: { hp: 25, dodge: 10 }, 5: { pa: 1 } }
  };
  var UPGRADE_DEFAULT = {
    maxLevel: 10,
    tiers: [{ from: 0, to: 2, name: 'Comum' }, { from: 3, to: 5, name: 'Raro' },
            { from: 6, to: 9, name: 'Supremo' }, { from: 10, to: 10, name: 'Magnífico' }],
    bonusPerLevel: 0.12,
    stoneCost: [2, 3, 4, 6, 8, 10, 13, 16, 20, 25],
    nonScalingKeys: ['pa', 'pp']
  };
  // A QUEBRA [D20]: os mesmos números de DATA.quebra (items.js), para o mundo
  // que não traz a tabela. Mudar a régua é lá; aqui é só a rede de segurança.
  var QUEBRA_DEFAULT = {
    base: { comum: 1, raro: 3, epico: 8, lendario: 15 },
    degrauNivel: 10,
    porEstrela: 3,
    reembolsoForja: 0.5,
    minimo: 1
  };
  var QUEBRA_MAX_N = 99;                 // cópias por golpe (o juiz cobra o mesmo teto)
  // raridade em inglês (dado antigo das provas) cai na régua em português
  var RARIDADE_PT = { common: 'comum', rare: 'raro', epic: 'epico', legendary: 'lendario' };

  Progress.SAVE_KEY = KEY;
  Progress.SLOTS = SLOTS;
  Progress.state = null;

  // =========================================================== storage seguro
  function getStorage() {
    try {
      if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
    } catch (e) { /* acesso negado (file://, modo privado, headless) */ }
    return null;
  }

  // ================================================================ utilidades
  function isArray(v) { return Object.prototype.toString.call(v) === '[object Array]'; }
  function isObj(v) { return !!v && typeof v === 'object' && !isArray(v); }
  function num(v, def) { return (typeof v === 'number' && isFinite(v)) ? v : def; }
  function clone(o) { var out = {}, k; for (k in o) if (o.hasOwnProperty(k)) out[k] = o[k]; return out; }
  function indexOf(arr, v) {
    for (var i = 0; i < arr.length; i++) if (arr[i] === v) return i;
    return -1;
  }
  function keys(o) {
    var out = [], k;
    for (k in o) if (o.hasOwnProperty(k)) out.push(k);
    return out;
  }
  function pickWeighted(pool) { // pool: [{id, w}]
    var total = 0, i;
    for (i = 0; i < pool.length; i++) total += pool[i].w;
    if (total <= 0) return null;
    var pick = Math.random() * total, acc = 0;
    for (i = 0; i < pool.length; i++) {
      acc += pool[i].w;
      if (pick < acc) return pool[i].id;
    }
    return pool[pool.length - 1].id;
  }

  // ============================================================ leitura DATA
  // (tudo defensivo: os arquivos de dados são escritos em paralelo)
  function D() { return (JOGO && JOGO.DATA) || {}; }

  function leveling() {
    var lv = D().leveling;
    if (!lv || !isArray(lv.xpTable) || !lv.xpTable.length) {
      return { maxLevel: 1, xpTable: [0], perLevel: { hp: 0, power: 0 }, elementChoiceLevel: 5 };
    }
    return {
      maxLevel: num(lv.maxLevel, lv.xpTable.length),
      xpTable: lv.xpTable,
      perLevel: lv.perLevel || { hp: 0, power: 0 },
      perLevelElement: isObj(lv.perLevelElement) ? lv.perLevelElement : null,   // §9-C [D14]
      xpFalloff: isObj(lv.xpFalloff) ? lv.xpFalloff : null,                     // §9-D [D15]
      defenseByRole: isObj(lv.defenseByRole) ? lv.defenseByRole : null,         // §9-H [D17]
      elementChoiceLevel: num(lv.elementChoiceLevel, 5)
    };
  }

  /* [D17] §9-H — DEFESA DE POSIÇÃO POR NÍVEL.
   * Esquiva e fixação caminham em linha reta da base da classe (nível 1) até o alvo
   * do PAPEL no nível máximo. Sem `defenseByRole` no dado, devolve 0: a curva é
   * aditiva e o motor continua funcionando com os valores de antes. Nunca encolhe
   * uma base — um alvo abaixo da base é lido como "essa classe não cresce nisso". */
  function defenseGain(classId, level, stat, base) {
    var lv = leveling();
    var tbl = lv.defenseByRole;
    if (!tbl) return 0;
    var def = classDef(classId);
    var role = def && def.role;
    var row = role ? tbl[role] : null;
    if (!isObj(row)) return 0;
    var target = num(row[stat], null);
    if (target === null) return 0;
    var span = target - num(base, 0);
    if (span <= 0) return 0;
    var top = Math.max(2, num(lv.maxLevel, 30));
    var steps = Math.max(0, Math.min(num(level, 1), top) - 1);
    return Math.round(span * steps / (top - 1));
  }
  /* Exposto para a UI e para os testes mostrarem a curva sem montar um herói. */
  Progress.defenseAtLevel = function (classId, level) {
    var def = classDef(classId);
    var base = (def && isObj(def.stats)) ? def.stats : {};
    var d = num(base.dodge, 0), l = num(base.lock, 0);
    return {
      dodge: d + defenseGain(classId, level, 'dodge', d),
      lock: l + defenseGain(classId, level, 'lock', l)
    };
  };
  function unlockTiers() {
    var t = D().unlockTiers;
    return isArray(t) && t.length ? t : [5, 10, 12, 15, 20, 30];
  }
  function classes() { return D().classes || {}; }
  function classDef(classId) { return classes()[classId] || null; }
  function spellDef(id) { var s = D().spells; return (s && s[id]) || null; }
  function itemDef(id) { var i = D().items; return (i && i[id]) || null; }
  function petDef(id) { var p = D().pets; return (p && p[id]) || null; }
  function cardDef(classId) { var c = D().cards; return (c && c[classId]) || null; }
  function setDefs() { return D().sets || {}; }
  function stoneDefs() { return D().stones || {}; }
  function starsCfg() {
    var s = D().stars;
    if (!isObj(s) || !isObj(s.bonuses)) return STARS_DEFAULT;
    // `elementSlots` (30/08): a cópia campo a campo engoliria a tabela das
    // vagas de caminho — a mesma armadilha do sanitize, do lado do DATA
    return { max: num(s.max, 5), bonuses: s.bonuses,
             elementSlots: isObj(s.elementSlots) ? s.elementSlots : null };
  }
  function upgradeCfg() {
    var u = D().upgrade;
    if (!isObj(u) || !isArray(u.stoneCost) || !u.stoneCost.length) return UPGRADE_DEFAULT;
    return {
      maxLevel: num(u.maxLevel, u.stoneCost.length),
      tiers: isArray(u.tiers) ? u.tiers : UPGRADE_DEFAULT.tiers,
      bonusPerLevel: num(u.bonusPerLevel, UPGRADE_DEFAULT.bonusPerLevel),
      stoneCost: u.stoneCost,
      // atributos que NÃO escalam com o nível de forja (§9-B / items.js) [D11]
      nonScalingKeys: isArray(u.nonScalingKeys) ? u.nonScalingKeys : UPGRADE_DEFAULT.nonScalingKeys,
      // A FORJA ARRISCADA — cópia campo a campo: TODO campo novo do
      // DATA.upgrade precisa entrar AQUI, senão some sem erro nenhum (foi o
      // que engoliu riskFrom/chances/guardStone no dia em que nasceram; o
      // teste da forja pegou — mesmo golpe do CLASS_LOOK e do titulo).
      riskFrom: num(u.riskFrom, 99),
      chances: isObj(u.chances) ? u.chances : {},
      guardStone: (typeof u.guardStone === 'string') ? u.guardStone : null
    };
  }

  /* ---- régua das estrelas de ITEM [D18]. O dado pode mandar (`DATA.upgrade`
   * .maxStars / .fuseCopies / .starBonus); sem ele valem as constantes daqui. */
  function starItemCfg() {
    var u = D().upgrade;
    var b = (isObj(u) && isArray(u.starBonus) && u.starBonus.length) ? u.starBonus : STAR_BONUS;
    var mx = (isObj(u) && num(u.maxStars, null) !== null) ? Math.floor(num(u.maxStars, ITEM_STARS_MAX))
                                                          : ITEM_STARS_MAX;
    var cp = (isObj(u) && num(u.fuseCopies, null) !== null) ? Math.floor(num(u.fuseCopies, FUSE_COPIES))
                                                            : FUSE_COPIES;
    return {
      max: Math.max(0, Math.min(mx, b.length - 1)),
      copies: Math.max(2, cp),
      bonus: b
    };
  }
  Progress.starCfg = starItemCfg;        // a UI lê o custo e a curva daqui

  /* ---- a régua da QUEBRA [D20]. Cópia campo a campo com padrão — a mesma
   * lição do upgradeCfg: campo novo em DATA.quebra precisa entrar AQUI, senão
   * some calado. Raridade nova no dado entra junto (o laço de baixo copia
   * qualquer chave numérica de `base`). */
  function quebraCfg() {
    var q = isObj(D().quebra) ? D().quebra : {};
    var b = isObj(q.base) ? q.base : {};
    var base = clone(QUEBRA_DEFAULT.base), r;
    for (r in b) {
      if (b.hasOwnProperty(r) && num(b[r], null) !== null) base[r] = Math.max(0, b[r]);
    }
    return {
      base: base,
      degrauNivel: Math.max(1, num(q.degrauNivel, QUEBRA_DEFAULT.degrauNivel)),
      porEstrela: Math.max(1, num(q.porEstrela, QUEBRA_DEFAULT.porEstrela)),
      // acima de 1 o reembolso pagaria mais do que a forja custou: vira laço
      reembolsoForja: Math.max(0, Math.min(1, num(q.reembolsoForja, QUEBRA_DEFAULT.reembolsoForja))),
      minimo: Math.max(0, Math.floor(num(q.minimo, QUEBRA_DEFAULT.minimo))),
      maxN: QUEBRA_MAX_N
    };
  }
  Progress.quebraCfg = quebraCfg;        // a tela da forja mostra a régua daqui
  function clampLevel(v) {
    return Math.max(0, Math.min(num(upgradeCfg().maxLevel, 10), Math.floor(num(v, 0))));
  }
  function clampStars(v) {
    return Math.max(0, Math.min(starItemCfg().max, Math.floor(num(v, 0))));
  }
  function starBonusOf(stars) {
    var cfg = starItemCfg();
    var s = Math.max(0, Math.min(Math.floor(num(stars, 0)), cfg.bonus.length - 1));
    return num(cfg.bonus[s], 0);
  }
  function elements() {
    var e = D().elements;
    return isArray(e) && e.length ? e : ['neutro', 'fogo', 'agua', 'terra', 'ar'];
  }
  function dungeonList() { var d = D().dungeons; return isArray(d) ? d : []; }
  function dungeonDef(dungeonId) {
    var ds = dungeonList();
    for (var i = 0; i < ds.length; i++) if (ds[i] && ds[i].id === dungeonId) return ds[i];
    // 03/10: o calabouço ESPECIAL (o Santuário dos Elementos, js/core/data/santuario.js) não mora
    // em DATA.dungeons. Sem isto a sala do "chefe" dele seria a terceira (o padrão de quem não acha
    // o calabouço), o corte de XP por nível não valeria e o saque dele não teria de onde sair.
    return (typeof D().especial === 'function') ? (D().especial(dungeonId) || null) : null;
  }
  /* Profundidade do calabouço como ÍNDICE 0-BASED (0 = o mais raso).
   * ATENÇÃO: `DATA.cards[*].minDungeon` é 0-based ("0 = o primeiro"), enquanto
   * `dungeon.order` é 1-BASED — comparar com `order` faria a carta cara vazar
   * um andar acima do previsto. Aqui vale sempre a posição em DATA.dungeons. */
  function dungeonIndex(dungeonId) {
    var ds = dungeonList();
    for (var i = 0; i < ds.length; i++) if (ds[i] && ds[i].id === dungeonId) return i;
    return 0;
  }
  function isBossRoom(dungeonId, roomIndex) {
    var d = dungeonDef(dungeonId);
    var last = (d && isArray(d.rooms) && d.rooms.length) ? d.rooms.length - 1 : 2;
    return num(roomIndex, 0) >= last;
  }
  function luckFor(partySize) {          // [D12] grupo de 1 ou 2
    return num(partySize, 2) <= 1 ? 2.4 : 1.6;
  }

  // pedra do elemento pedido (fallback: o próprio nome do elemento como id)
  function stoneIdForElement(element) {
    var el = element || DEFAULT_ELEMENT;
    var defs = stoneDefs();
    for (var id in defs) {
      if (defs.hasOwnProperty(id) && defs[id] && defs[id].element === el) return id;
    }
    return el;
  }
  // conjunto ao qual o item pertence (`setId` do item ou busca em DATA.sets)
  function setIdOf(itemId) {
    var it = itemDef(itemId);
    if (it && it.setId) return it.setId;
    var sets = setDefs();
    for (var sid in sets) {
      if (!sets.hasOwnProperty(sid)) continue;
      var pieces = sets[sid] && sets[sid].pieces;
      if (isArray(pieces) && indexOf(pieces, itemId) >= 0) return sid;
    }
    return null;
  }

  // ============================================================ XP e níveis
  function levelForXp(xp) {
    var lv = leveling();
    var table = lv.xpTable;
    var top = Math.min(lv.maxLevel, table.length);
    for (var i = top - 1; i >= 0; i--) if (xp >= table[i]) return i + 1;
    return 1;
  }
  function maxLevel() {
    var lv = leveling();
    return Math.min(lv.maxLevel, lv.xpTable.length);
  }
  function maxXp() {
    var lv = leveling();
    return lv.xpTable[maxLevel() - 1];
  }

  // ============================================================ estado
  function emptyItems() { return { punho: null, passo: null, casca: null, lume: null }; }
  // [D7] a variante (forja e estrelas) da CÓPIA que está em cada espaço
  function emptyVars() { return { punho: null, passo: null, casca: null, lume: null }; }

  function newHero(classId) {
    return {
      classId: classId, element: DEFAULT_ELEMENT, xp: 0, level: 1,
      spells: [], items: emptyItems(), itemVar: emptyVars(), pet: null
    };
  }

  function freshState() {
    var st = { version: 22, unlockedClasses: [], heroes: {}, inventory: [], pets: [], cards: {}, stones: {},
               petCards: {}, petXp: {}, nascimentos: [] };
    var cs = classes(), id;
    for (id in cs) {
      if (!cs.hasOwnProperty(id)) continue;
      if (cs[id] && cs[id].startsUnlocked) {     // o DADO manda [D3]
        st.unlockedClasses.push(id);
        st.heroes[id] = newHero(id);
      }
    }
    return st;
  }

  // o fim do bônus de XP por tempo (loja 2) é epoch em SEGUNDOS: acima disto
  // (o ano de 2096) é lixo — o sanitize e o Progress usam o mesmo teto
  var BONUS_TETO_S = 4e9;

  // ------------------------------------------------------ saneamento [D2]
  function sanitize(raw) {
    if (!isObj(raw)) return null;
    var st = { version: 22, unlockedClasses: [], heroes: {}, inventory: [], pets: [], cards: {}, stones: {},
               petCards: {}, petXp: {}, nascimentos: [] };
    var cs = classes(), i, id;
    var hasClasses = keys(cs).length > 0;
    var up = upgradeCfg();

    function classOk(cid) { return typeof cid === 'string' && (!hasClasses || !!cs[cid]); }

    // ---- classes liberadas
    var seenClass = {};
    if (isArray(raw.unlockedClasses)) {
      for (i = 0; i < raw.unlockedClasses.length; i++) {
        var cid = raw.unlockedClasses[i];
        if (classOk(cid) && !seenClass[cid]) { seenClass[cid] = true; st.unlockedClasses.push(cid); }
      }
    }
    for (id in cs) {
      if (cs.hasOwnProperty(id) && cs[id] && cs[id].startsUnlocked && !seenClass[id]) {
        seenClass[id] = true; st.unlockedClasses.push(id);
      }
    }

    /* ---- inventário: UMA entrada por cópia [D7].
     * Aceita as três formas já gravadas em disco: string solta (v2.0),
     * `{itemId, level}` (v2.1, uma entrada por item) e `{itemId, level, stars,
     * count}` (a de agora). `count` existe para o save não inchar quando o
     * jogador acumular 27 cópias mirando uma ★3. */
    if (isArray(raw.nascimentos)) {
      for (i = 0; i < raw.nascimentos.length; i++) {
        var nb = raw.nascimentos[i];
        if (isObj(nb) && typeof nb.iid === 'string' && nb.iid && typeof nb.itemId === 'string') {
          st.nascimentos.push({ iid: nb.iid, itemId: nb.itemId,
                                origem: IID_ORIGENS[nb.origem] ? nb.origem : 'legado', t: num(nb.t, 0) });
        }
      }
      if (st.nascimentos.length > NASC_TETO) st.nascimentos.splice(0, st.nascimentos.length - NASC_TETO);
    }
    /* O NÚMERO DE SÉRIE (10/09): a cópia sem iid é de antes da instância e
     * ganha carimbo 'legado' (uma vez — o próximo save já o traz). A cópia com
     * série REPETIDA some: é o "copiar a linha do saco" feito à mão, e
     * lavá-la com série nova seria abrir a porta que o cartório fecha. */
    var iidVistos = {};
    function serieLegado(itemId) {
      var id = novoIid();
      registraNascimento(st, id, itemId, 'legado');
      return id;
    }
    function pushItem(itemId, level, stars, count, iid) {
      if (typeof itemId !== 'string' || !itemDef(itemId)) return;
      var lv = clampLevel(level);
      var sr = clampStars(stars);
      var n = Math.max(1, Math.min(MAX_COPIES, Math.floor(num(count, 1))));
      var serie = (typeof iid === 'string' && iid) ? iid : null;
      if (serie && iidVistos[serie]) return;                    // série repetida: some
      for (var c = 0; c < n; c++) {
        var s = (c === 0 && serie) ? serie : serieLegado(itemId);
        iidVistos[s] = true;
        st.inventory.push({ itemId: itemId, level: lv, stars: sr, iid: s });
      }
    }
    if (isArray(raw.inventory)) {
      for (i = 0; i < raw.inventory.length; i++) {
        var entry = raw.inventory[i];
        if (typeof entry === 'string') pushItem(entry, 0, 0, 1, null);
        else if (isObj(entry)) pushItem(entry.itemId, entry.level, entry.stars, entry.count, entry.iid);
      }
    }
    /* Tira do saco a melhor cópia de um item (mais estrelas, depois mais forja).
     * É como o save ANTIGO migra: lá o item equipado também aparecia no saco, e
     * as duas linhas descreviam UMA peça só — deixar as duas viraria duplicação. */
    function takeFromBag(itemId) {
      var best = -1;
      for (var k = 0; k < st.inventory.length; k++) {
        var e = st.inventory[k];
        if (e.itemId !== itemId) continue;
        if (best < 0 || e.stars > st.inventory[best].stars ||
            (e.stars === st.inventory[best].stars && e.level > st.inventory[best].level)) best = k;
      }
      if (best < 0) return null;
      var taken = st.inventory.splice(best, 1)[0];
      return { level: taken.level, stars: taken.stars, iid: taken.iid };
    }

    // ---- heróis
    var els = elements();
    var equippedSeen = {};
    if (isObj(raw.heroes)) {
      for (var hid in raw.heroes) {
        if (!raw.heroes.hasOwnProperty(hid)) continue;
        var src = raw.heroes[hid];
        if (!isObj(src)) continue;
        var cls = classOk(src.classId) ? src.classId : (classOk(hid) ? hid : null);
        if (!cls) continue;
        var h = newHero(cls);
        h.xp = Math.max(0, Math.floor(num(src.xp, 0)));
        if (maxXp() > 0) h.xp = Math.min(h.xp, maxXp());
        h.level = levelForXp(h.xp);
        if (typeof src.element === 'string' && src.element !== DEFAULT_ELEMENT) {
          var def = classDef(cls);
          var pathOk = !def || !def.paths || isArray(def.paths[src.element]);
          if (indexOf(els, src.element) >= 0 && pathOk &&
              h.level >= leveling().elementChoiceLevel) {
            h.element = src.element;
          }
        }
        // os CAMINHOS LIBERADOS por estrela (30/08) — campo novo: a cópia
        // campo a campo engoliria a lista calada (a armadilha de sempre).
        // Só entram elementos válidos com caminho na classe; o ativo, quando
        // escolhido, sempre faz parte.
        if (h.element !== DEFAULT_ELEMENT) {
          h.elements = [h.element];
          if (isArray(src.elements)) {
            var defE = classDef(cls);
            for (var se = 0; se < src.elements.length; se++) {
              var elx = src.elements[se];
              if (typeof elx !== 'string' || elx === DEFAULT_ELEMENT) continue;
              if (indexOf(els, elx) < 0) continue;
              if (indexOf(h.elements, elx) >= 0) continue;
              if (defE && defE.paths && !isArray(defE.paths[elx])) continue;
              h.elements.push(elx);
            }
          }
        }
        if (isObj(src.items)) {
          var srcVars = isObj(src.itemVar) ? src.itemVar : null;
          for (var rawSlot in src.items) {
            if (!src.items.hasOwnProperty(rawSlot)) continue;
            var slot = SLOT_ALIASES[rawSlot] || rawSlot;   // migra pa/pp/vida/especial
            if (indexOf(SLOTS, slot) < 0) continue;
            var itId = src.items[rawSlot];
            if (typeof itId !== 'string') continue;
            var it = itemDef(itId);
            if (!it || it.slot !== slot) continue;
            /* `itemVar` é o carimbo do modelo NOVO: quem o tem descreve uma
             * cópia que já saiu do saco ao ser equipada, e por isso não desconta
             * nada. Sem ele o save é antigo (equipado morava no saco também):
             * vale a exclusividade de então — um dono por item — e a cópia
             * correspondente sai do saco para não virar duas peças. */
            var v = srcVars && isObj(srcVars[rawSlot] || srcVars[slot])
                  ? (srcVars[rawSlot] || srcVars[slot]) : null;
            if (v) {
              var serieV = (typeof v.iid === 'string' && v.iid) ? v.iid : null;
              if (serieV && iidVistos[serieV]) continue;          // série repetida: some
              if (!serieV) serieV = serieLegado(itId);
              iidVistos[serieV] = true;
              h.items[slot] = itId;
              h.itemVar[slot] = { level: clampLevel(v.level), stars: clampStars(v.stars), iid: serieV };
            } else {
              if (equippedSeen[itId]) continue;    // exclusividade do modelo antigo
              equippedSeen[itId] = true;
              h.items[slot] = itId;
              h.itemVar[slot] = takeFromBag(itId) || { level: 0, stars: 0, iid: serieLegado(itId) };
            }
          }
        }
        if (typeof src.pet === 'string' && petDef(src.pet)) h.pet = src.pet;
        /* TRAJES (25/08): fotos do equipamento por herói (itemIds por
         * espaço). Campo NOVO do herói — sem esta cópia ele sumiria calado
         * no load (a armadilha do campo a campo, mais uma vez). */
        if (isObj(src.trajes)) {
          var tj = {};
          for (var tnome in src.trajes) {
            if (!src.trajes.hasOwnProperty(tnome) || !isObj(src.trajes[tnome])) continue;
            var foto = {}, temFoto = false;
            for (var ts in src.trajes[tnome]) {
              if (!src.trajes[tnome].hasOwnProperty(ts)) continue;
              var tslot = SLOT_ALIASES[ts] || ts;
              var tid = src.trajes[tnome][ts];
              if (indexOf(SLOTS, tslot) < 0 || typeof tid !== 'string') continue;
              var tdef = itemDef(tid);
              if (!tdef || tdef.slot !== tslot) continue;
              foto[tslot] = tid;
              temFoto = true;
            }
            if (temFoto) tj[tnome] = foto;
          }
          h.trajes = tj;
        }
        st.heroes[hid] = h;
        if (!seenClass[cls]) { seenClass[cls] = true; st.unlockedClasses.push(cls); }
      }
    }
    for (i = 0; i < st.unlockedClasses.length; i++) {
      var c2 = st.unlockedClasses[i];
      if (!st.heroes[c2]) st.heroes[c2] = newHero(c2);
    }

    // ---- pets soltos
    if (isArray(raw.pets)) {
      for (i = 0; i < raw.pets.length; i++) {
        if (typeof raw.pets[i] === 'string' && petDef(raw.pets[i]) &&
            indexOf(st.pets, raw.pets[i]) < 0) st.pets.push(raw.pets[i]);
      }
    }
    // ---- cartas e XP dos PETS (03/09) — a armadilha da cópia campo a campo:
    // sem estas linhas o saneamento engoliria nível e cartas no 1º reload
    if (isObj(raw.petCards)) {
      for (id in raw.petCards) {
        if (!raw.petCards.hasOwnProperty(id) || !petDef(id)) continue;
        var npc = Math.floor(num(raw.petCards[id], 0));
        if (npc > 0) st.petCards[id] = npc;
      }
    }
    if (isObj(raw.petXp)) {
      for (id in raw.petXp) {
        if (!raw.petXp.hasOwnProperty(id) || !petDef(id)) continue;
        var npx = Math.floor(num(raw.petXp[id], 0));
        if (npx > 0) st.petXp[id] = Math.min(npx, PET_XP_TABLE[PET_XP_TABLE.length - 1]);
      }
    }
    // pet que já é seu (no saco ou vestido — saves de antes das cartas) conta
    // como as 5 cartas pagas: a régua das estrelas parte do mesmo zero
    (function () {
      var seus = st.pets.slice();
      for (var hid2 in st.heroes) {
        if (st.heroes.hasOwnProperty(hid2) && st.heroes[hid2].pet) seus.push(st.heroes[hid2].pet);
      }
      for (var k2 = 0; k2 < seus.length; k2++) {
        if (num(st.petCards[seus[k2]], 0) < PET_UNLOCK_COST) st.petCards[seus[k2]] = PET_UNLOCK_COST;
      }
    })();

    // ---- cartas: objeto {classId:n} ou array antiga (conta repetições)
    if (isArray(raw.cards)) {
      for (i = 0; i < raw.cards.length; i++) {
        var ci = raw.cards[i];
        if (classOk(ci)) st.cards[ci] = (st.cards[ci] || 0) + 1;
      }
    } else if (isObj(raw.cards)) {
      for (id in raw.cards) {
        if (!raw.cards.hasOwnProperty(id) || !classOk(id)) continue;
        var n = Math.floor(num(raw.cards[id], 0));
        if (n > 0) st.cards[id] = n;
      }
    }

    // ---- pedras de forja
    if (isObj(raw.stones)) {
      var sd = stoneDefs(), hasStones = keys(sd).length > 0;
      for (id in raw.stones) {
        if (!raw.stones.hasOwnProperty(id)) continue;
        if (hasStones && !sd[id] && indexOf(elements(), id) < 0) continue;
        var q = Math.floor(num(raw.stones[id], 0));
        if (q > 0) st.stones[id] = q;
      }
    }

    // ---- os SELOS dos chefes (25/08) — campo novo: a cópia campo a campo
    // engoliria calada sem estas linhas (a armadilha de sempre)
    st.selos = {};
    if (isObj(raw.selos)) {
      var els2 = elements();
      for (id in raw.selos) {
        if (!raw.selos.hasOwnProperty(id)) continue;
        if (indexOf(els2, id) < 0) continue;
        var qs = Math.floor(num(raw.selos[id], 0));
        if (qs > 0) st.selos[id] = qs;
      }
    }
    if (raw.petSelosDado === true) st.petSelosDado = true;
    if (typeof raw.seloElemento === 'string' &&
        indexOf(elements(), raw.seloElemento) >= 0) {
      st.seloElemento = raw.seloElemento;
    }
    // ---- a INSÍGNIA DE FUNDAÇÃO (30/08) — a mesma armadilha: sem esta
    // linha o sanitize engoliria o saldo calado no primeiro reload
    var qi = Math.floor(num(raw.insignias, 0));
    if (qi > 0) st.insignias = qi;
    // ---- os TÍTULOS DO ECO PRIMORDIAL (02/10) — o prêmio do pódio da semana (servidor/supremo.py),
    // para sempre. A mesma armadilha: sem estas linhas o título sumiria calado no primeiro reload. Só
    // passa o que está no catálogo (JOGO.Titulos.ECO); a conta sem nenhum guarda o mesmo estado (e o
    // mesmo hash da economia) de antes do Eco.
    var te = tituloEcoValido;
    if (Object.prototype.toString.call(raw.titulosEco) === '[object Array]') {
      var tes = [];
      for (var ti = 0; ti < raw.titulosEco.length; ti++) {
        if (te(raw.titulosEco[ti]) && indexOf(tes, raw.titulosEco[ti]) < 0) tes.push(raw.titulosEco[ti]);
      }
      if (tes.length) st.titulosEco = tes;
    }
    // ---- as POÇÕES DE VIDA da banca do mercador (13/09) — a mesma armadilha: sem estas
    // linhas o saldo sumiria calado no primeiro reload. Só existe com alguma poção: a conta
    // sem nenhuma guarda o mesmo estado (e o mesmo hash) de antes das poções.
    var consSan = saneiaConsumiveis(raw.consumiveis);
    if (consSan) st.consumiveis = consSan;
    // ---- os PERGAMINHOS da loja do site e as cargas ativas do da Sabedoria
    // (Fase C, 10/09) — a mesma armadilha: sem estas linhas o saldo e as
    // cargas somem calados no primeiro reload. Só as chaves conhecidas, só
    // inteiros positivos, e cada um preso no seu teto.
    if (isObj(raw.pergaminhos)) {
      var cfgPg = pergCfg(), tiposPg = pergTipos(), pgs = {}, algumPg = false;
      for (var ip = 0; ip < tiposPg.length; ip++) {
        var qp = Math.floor(num(raw.pergaminhos[tiposPg[ip]], 0));
        if (qp > 0) { pgs[tiposPg[ip]] = Math.min(cfgPg.teto, qp); algumPg = true; }
      }
      if (algumPg) st.pergaminhos = pgs;
    }
    if (isObj(raw.bonusXp)) {
      var sx = Math.floor(num(raw.bonusXp.salas, 0));
      if (sx > 0) st.bonusXp = { salas: Math.min(pergCfg().tetoSalas, sx) };
    }
    // ---- o BÔNUS DE XP POR TEMPO (loja 2, 10/09): o fim do prazo, em
    // SEGUNDOS do relógio do servidor. A mesma armadilha: sem esta linha o
    // load apagaria calado o bônus comprado. Só número finito entre 0 e o
    // teto (guardado inteiro). O vencido FICA: quem decide se ele vale é o
    // relógio do servidor na hora da recompensa, nunca o da máquina no load.
    var bxa = num(raw.bonusXpAte, 0);
    if (bxa > 0 && bxa < BONUS_TETO_S) st.bonusXpAte = Math.floor(bxa);

    // ---- NÍVEL DE USO [D19]: peça vestida acima do nível do herói volta ao
    // saco (MESMA série, mesmo level/stars) e pet acima volta à lista. É
    // migração única, por isso ignora o fundo do saco: perder a peça seria
    // pior que um saco estufado. O Mestre não paga. A lista fica para a HUD.
    if (!ehMestre()) {
      for (var hidN in st.heroes) {
        if (!st.heroes.hasOwnProperty(hidN)) continue;
        var hN = st.heroes[hidN];
        var nivelN = Math.max(1, Math.floor(num(hN.level, 1)));
        for (var sN = 0; sN < SLOTS.length; sN++) {
          var slotN = SLOTS[sN], idN = hN.items[slotN];
          if (!idN) continue;
          var precisaN = nivelUsoDe(idN);
          if (precisaN <= nivelN) continue;
          var vN = isObj(hN.itemVar[slotN]) ? hN.itemVar[slotN] : null;
          st.inventory.push({ itemId: idN, level: vN ? clampLevel(vN.level) : 0,
                              stars: vN ? clampStars(vN.stars) : 0,
                              iid: (vN && typeof vN.iid === 'string' && vN.iid) ? vN.iid : serieLegado(idN) });
          hN.items[slotN] = null;
          hN.itemVar[slotN] = null;
          devolvidasNivel.push({ heroId: hidN, itemId: idN, precisa: precisaN, nivel: nivelN });
        }
        if (hN.pet) {
          var precisaP = nivelUsoDe(hN.pet);
          if (precisaP > nivelN) {
            if (indexOf(st.pets, hN.pet) < 0) st.pets.push(hN.pet);
            devolvidasNivel.push({ heroId: hidN, petId: hN.pet, precisa: precisaP, nivel: nivelN });
            hN.pet = null;
          }
        }
      }
    }
    return st;
  }

  // ficha existente ou criada sob demanda
  function ensureHero(heroId) {
    var st = Progress.state;
    if (!st) return null;
    var h = st.heroes[heroId];
    if (isObj(h) && typeof h.classId === 'string') {
      if (!isObj(h.items)) h.items = emptyItems();
      if (!isObj(h.itemVar)) h.itemVar = emptyVars();
      if (typeof h.element !== 'string') h.element = DEFAULT_ELEMENT;
      if (typeof h.xp !== 'number' || !isFinite(h.xp)) h.xp = 0;
      if (typeof h.level !== 'number' || !isFinite(h.level)) h.level = levelForXp(h.xp);
      if (!isArray(h.spells)) h.spells = [];
      return h;
    }
    if (classDef(heroId) || !keys(classes()).length) {
      st.heroes[heroId] = newHero(heroId);
      syncSpells(heroId);
      return st.heroes[heroId];
    }
    return null;
  }

  // =========================================================== load/save/reset
  /* Ids de classe que mudaram de nome, e o que era antes.
   *
   * O save guarda o `classId` de cada heroi. Quando um id muda, o heroi salvo
   * aponta para uma classe que nao existe mais — e SOME da lista sem aviso, que
   * e o pior jeito de perder o progresso de alguem.
   *
   * `curandeira` virou `curandeiro` quando a Paladina passou a ser o Curandeiro
   * (ver docs/CLASSES_V3.md). A migracao roda na carga e e idempotente. */
  var CLASSE_RENOMEADA = { curandeira: 'curandeiro' };

  function migraClasses(save) {
    if (!save || !save.heroes) return 0;
    var n = 0;
    for (var id in save.heroes) {
      if (!save.heroes.hasOwnProperty(id)) continue;
      var h = save.heroes[id];
      var novo = h && CLASSE_RENOMEADA[h.classId];
      if (novo) { h.classId = novo; n++; }
    }
    return n;
  }

  Progress.load = function () {
    var st = null;
    devolvidasNivel = [];                  // [D19] só o que ESTA carga devolveu
    var s = getStorage();
    if (s) {
      try {
        var rawText = s.getItem(KEY);
        if (rawText) st = sanitize(JSON.parse(rawText));
      } catch (e) { st = null; }
    }
    if (!st || !isObj(st.heroes)) st = freshState();
    // ANTES de qualquer coisa ler o heroi: id de classe renomeado precisa virar
    // o novo, senao `syncSpells` abaixo procura uma classe que nao existe e o
    // heroi some da lista sem aviso.
    migraClasses(st);
    Progress.state = st;
    for (var hid in st.heroes) if (st.heroes.hasOwnProperty(hid)) syncSpells(hid);
    syncUnlocksFromCards();
    aplicaSeloElemento();          // o elemento escolhido do Traje volta a valer
    return Progress.state;
  };

  Progress.save = function () {
    var s = getStorage();
    if (!s) return false;
    try {
      s.setItem(KEY, JSON.stringify(Progress.state));
      return true;
    } catch (e) { return false; }
  };

  Progress.reset = function () {
    Progress.state = freshState();
    for (var hid in Progress.state.heroes) {
      if (Progress.state.heroes.hasOwnProperty(hid)) syncSpells(hid);
    }
    Progress.save();
    return Progress.state;
  };

  // ================================================================ consultas
  Progress.hero = function (heroId) {
    return (Progress.state && Progress.state.heroes[heroId]) || null;
  };
  Progress.heroIds = function () {
    return Progress.state ? keys(Progress.state.heroes) : [];
  };
  Progress.isClassUnlocked = function (classId) {
    return !!Progress.state && indexOf(Progress.state.unlockedClasses, classId) >= 0;
  };

  // ============================================ cartas, desbloqueio e estrelas
  function unlockCostFor(classId) {
    var def = classDef(classId);
    if (def && def.startsUnlocked) return 0;
    var cfg = cardDef(classId);
    var c = cfg ? num(cfg.unlockCost, null) : null;
    if (c === null || c < 0) return UNLOCK_COST_FALLBACK;   // dado ainda por atualizar
    return Math.floor(c);
  }
  function starCostsFor(classId) {
    var cfg = cardDef(classId);
    if (cfg && isArray(cfg.starCosts) && cfg.starCosts.length) return cfg.starCosts;
    return STAR_COSTS_DEFAULT;
  }
  function cardsOwned(classId) {
    if (!Progress.state || !isObj(Progress.state.cards)) return 0;
    return Math.max(0, Math.floor(num(Progress.state.cards[classId], 0)));
  }

  Progress.cardInfo = function (classId) {
    var def = classDef(classId);
    var cost = unlockCostFor(classId);
    var owned = cardsOwned(classId);
    var costs = starCostsFor(classId);
    var maxStars = num(starsCfg().max, 5);
    var surplus = Math.max(0, owned - cost);
    var stars = 0;
    for (var i = 0; i < costs.length && i < maxStars; i++) {
      if (surplus >= num(costs[i], Infinity)) stars = i + 1;
    }
    var next = null;
    if (stars < Math.min(maxStars, costs.length)) {
      next = { star: stars + 1, faltam: Math.max(0, num(costs[stars], 0) - surplus) };
    }
    return {
      classId: classId,
      name: (def && def.name) || classId,
      cards: owned,
      unlocked: Progress.isClassUnlocked(classId),
      unlockCost: cost,
      stars: stars,
      next: next
    };
  };

  // soma dos bônus fixos das estrelas conquistadas pela classe [D9]
  function starBonuses(classId) {
    var stars = Progress.cardInfo(classId).stars;
    var cfg = starsCfg();
    var out = null;
    for (var s = 1; s <= stars; s++) {
      var b = cfg.bonuses[s] || cfg.bonuses[String(s)];
      if (!isObj(b)) continue;
      if (!out) out = { resists: {} };
      for (var k in b) {
        if (!b.hasOwnProperty(k)) continue;
        if (k === 'resists') {
          for (var e in b.resists) {
            if (b.resists.hasOwnProperty(e)) out.resists[e] = num(out.resists[e], 0) + num(b.resists[e], 0);
          }
        } else out[k] = num(out[k], 0) + num(b[k], 0);
      }
    }
    return out;
  }

  function syncUnlocksFromCards() {
    var st = Progress.state;
    if (!st) return;
    for (var classId in st.cards) {
      if (!st.cards.hasOwnProperty(classId)) continue;
      if (cardsOwned(classId) >= unlockCostFor(classId)) Progress.unlockClass(classId);
    }
  }

  Progress.unlockClass = function (classId) {
    var st = Progress.state;
    if (!st || typeof classId !== 'string') return false;
    if (keys(classes()).length && !classDef(classId)) return false;
    if (indexOf(st.unlockedClasses, classId) >= 0) return false;
    st.unlockedClasses.push(classId);
    if (!st.heroes[classId]) {
      st.heroes[classId] = newHero(classId);
      syncSpells(classId);
    }
    Progress.save();
    return true;
  };

  /* Soma cartas de uma classe (nunca decresce) e libera a classe ao atingir o
   * custo. Devolve o `cardInfo` resultante. */
  Progress.addCards = function (classId, n) {
    var st = Progress.state;
    if (!st || typeof classId !== 'string') return null;
    if (keys(classes()).length && !classDef(classId)) return null;
    var amount = Math.floor(num(n, 0));
    if (amount > 0) {
      st.cards[classId] = cardsOwned(classId) + amount;
      if (st.cards[classId] >= unlockCostFor(classId)) Progress.unlockClass(classId);
      Progress.save();
    }
    return Progress.cardInfo(classId);
  };

  Progress.createHero = function (classId, heroId) {
    var st = Progress.state;
    if (!st || !classDef(classId)) return null;
    if (!Progress.isClassUnlocked(classId)) return null;
    var id = heroId || classId;
    if (st.heroes[id]) {
      var n = 2;
      while (st.heroes[classId + '#' + n]) n++;
      id = classId + '#' + n;
    }
    st.heroes[id] = newHero(classId);
    syncSpells(id);
    Progress.save();
    return id;
  };

  /* Cartas do chefe [D9]. Devolve
   * [{classId, name, amount, cards, unlocked, stars, starUp}] (0 ou 1 entrada). */
  Progress.rollCards = function (dungeonId, roomIndex, partySize) {
    if (!Progress.state) Progress.load();
    var dungeon = dungeonDef(dungeonId);
    if (!dungeon) return [];
    if (!isBossRoom(dungeonId, roomIndex)) return [];

    // profundidade 0-based: `minDungeon` é 0-based, `order` é 1-based
    var depth = dungeonIndex(dungeonId);
    // `cardDrops` ausente = dado ainda não escrito (piscina geral);
    // `cardDrops: []` = decisão explícita de não derrubar carta nenhuma.
    var entries = isArray(dungeon.cardDrops) ? dungeon.cardDrops : null;
    var pool = [], i, classId, card, w;

    if (entries) {
      for (i = 0; i < entries.length; i++) {
        var e = entries[i];
        if (!isObj(e)) continue;
        classId = e.classId;
        card = cardDef(classId);
        if (!card || num(card.dropWeight, 0) <= 0) continue;
        if (depth < num(card.minDungeon, 0)) continue;
        w = Math.max(0, num(e.weight, 1)) * num(card.dropWeight, 0);
        if (w > 0) pool.push({ id: classId, w: w });
      }
    }
    if (!pool.length && entries === null) {
      var all = D().cards || {};
      for (classId in all) {
        if (!all.hasOwnProperty(classId)) continue;
        card = all[classId];
        if (!card || num(card.dropWeight, 0) <= 0) continue;
        if (depth < num(card.minDungeon, 0)) continue;
        pool.push({ id: classId, w: num(card.dropWeight, 0) });
      }
    }
    if (!pool.length) return [];

    var size = Math.max(1, Math.min(2, Math.round(num(partySize, 2))));
    if (Math.random() >= CARD_CHANCE[size]) return [];

    var chosen = pickWeighted(pool);
    if (!chosen) return [];

    var antes = Progress.cardInfo(chosen);
    var amount = 1 + Math.floor(Math.max(0, depth) / 2);   // fundo dá mais cartas
    var depois = Progress.addCards(chosen, amount);
    return [{
      classId: chosen,
      name: depois.name,
      amount: amount,
      cards: depois.cards,
      unlockCost: depois.unlockCost,
      unlocked: depois.unlocked,
      novaClasse: !antes.unlocked && depois.unlocked,
      stars: depois.stars,
      starUp: depois.stars - antes.stars,
      next: depois.next
    }];
  };

  // ============================================================ XP / níveis
  Progress.addXp = function (heroId, amount) {
    var h = ensureHero(heroId);
    if (!h) return 0;
    var amt = num(amount, 0);
    amt = isFinite(amt) ? Math.floor(amt) : 0;
    if (amt <= 0) return 0;
    var before = h.level;
    h.xp = Math.min(h.xp + amt, maxXp());
    h.level = levelForXp(h.xp);
    if (h.level !== before) syncSpells(heroId);
    Progress.save();
    return h.level - before;
  };

  /* Rendimento decrescente de XP em conteúdo fácil (§9-D) [D15].
   * Aceita heroId ou o nível cru. Devolve 1 quando faltar dado — nunca corta
   * por engano. Vale SÓ para XP: item, pedra e carta seguem sua raridade. */
  Progress.xpMultiplier = function (heroOrLevel, dungeonId) {
    var level = null;
    if (typeof heroOrLevel === 'number' && isFinite(heroOrLevel)) level = heroOrLevel;
    else {
      var h = Progress.hero(heroOrLevel);
      if (h) level = h.level;
    }
    if (level === null) return 1;
    var d = dungeonDef(dungeonId);
    var rec = d ? num(d.recommendedLevel, null) : null;
    var cfg = leveling().xpFalloff;
    if (rec === null || !isObj(cfg)) return 1;          // dado ausente: sem corte
    var acima = level - (rec + num(cfg.graceLevels, 0));
    if (acima <= 0) return 1;                            // dentro da faixa de graça
    var m = Math.pow(num(cfg.factorPerLevel, 1), acima); // queda geométrica
    return Math.max(num(cfg.floor, 0), m);               // com piso
  };

  Progress.xpInfo = function (heroId) {
    var h = ensureHero(heroId);
    if (!h) return null;
    var lv = leveling();
    var top = maxLevel();
    if (h.level >= top) return { level: h.level, xp: h.xp, xpNext: null, pct: 1 };
    var cur = lv.xpTable[h.level - 1];
    var next = lv.xpTable[h.level];
    var pct = next > cur ? (h.xp - cur) / (next - cur) : 1;
    return { level: h.level, xp: h.xp, xpNext: next, pct: Math.max(0, Math.min(1, pct)) };
  };

  // ==================================================== caminho elemental [D6]
  Progress.pendingElementChoice = function (heroId) {
    var h = Progress.hero(heroId);
    if (!h) return false;
    return h.element === DEFAULT_ELEMENT && h.level >= leveling().elementChoiceLevel;
  };

  Progress.pendingElementChoices = function (heroIds) {
    var ids = isArray(heroIds) ? heroIds : Progress.heroIds();
    var out = [];
    for (var i = 0; i < ids.length; i++) if (Progress.pendingElementChoice(ids[i])) out.push(ids[i]);
    return out;
  };

  Progress.chooseElement = function (heroId, element) {
    var h = Progress.hero(heroId);
    if (!h) return false;
    if (h.element !== DEFAULT_ELEMENT) return false;
    if (h.level < leveling().elementChoiceLevel) return false;
    if (typeof element !== 'string' || element === DEFAULT_ELEMENT) return false;
    if (indexOf(elements(), element) < 0) return false;
    var def = classDef(h.classId);
    if (def && def.paths && !isArray(def.paths[element])) return false;
    h.element = element;
    h.elements = [element];              // o 1º caminho da lista de liberados
    syncSpells(heroId);
    Progress.save();
    return true;
  };

  /* ============================== ELEMENTOS EXTRAS POR ESTRELA (30/08) [D6b]
   * "Da terceira estrela em diante o jogador poderá escolher outro elemento":
   * ★3 libera o 2º caminho, ★4 o 3º, ★5 o 4º (DATA.stars.elementSlots). A
   * lista de caminhos liberados mora em `hero.elements`; `hero.element`
   * continua sendo o ATIVO — os feitiços derivam dele, então trocar o ativo
   * troca o caminho inteiro na hora (spellsFor é dinâmico). Liberação é
   * permanente; a troca do ativo é livre entre os liberados (no Acampamento,
   * pela ficha — em batalha ninguém chama isto). */
  function elementosDe(h) {
    if (!isArray(h.elements)) {
      h.elements = (h.element && h.element !== DEFAULT_ELEMENT) ? [h.element] : [];
    }
    return h.elements;
  }
  Progress.elementSlots = function (heroId) {
    var h = Progress.hero(heroId);
    if (!h) return 0;
    var tabela = starsCfg().elementSlots || {};
    var stars = Progress.cardInfo(h.classId || heroId).stars;
    return Math.max(1, Math.floor(num(tabela[stars], 1)));
  };
  Progress.heroElements = function (heroId) {
    var h = Progress.hero(heroId);
    return h ? elementosDe(h).slice() : [];
  };
  Progress.liberaElemento = function (heroId, element) {
    var h = Progress.hero(heroId);
    if (!h) return false;
    var lista = elementosDe(h);
    if (!lista.length) return false;           // o 1º vem do chooseElement (nv5)
    if (typeof element !== 'string' || element === DEFAULT_ELEMENT) return false;
    if (indexOf(elements(), element) < 0) return false;
    if (indexOf(lista, element) >= 0) return false;
    if (lista.length >= Progress.elementSlots(heroId)) return false;
    var def = classDef(h.classId);
    if (def && def.paths && !isArray(def.paths[element])) return false;
    lista.push(element);
    Progress.save();
    return true;
  };
  Progress.trocaElemento = function (heroId, element) {
    var h = Progress.hero(heroId);
    if (!h) return false;
    if (indexOf(elementosDe(h), element) < 0) return false;
    if (h.element === element) return true;
    h.element = element;
    syncSpells(heroId);
    Progress.save();
    return true;
  };

  // ============================================================ feitiços [D4][D5]
  function pathUnlockLevel(spellId, tierIndex) {
    var def = spellDef(spellId);
    var lvl = def ? num(def.unlockLevel, 0) : 0;
    if (lvl > 0) return lvl;
    return num(unlockTiers()[tierIndex], 99);
  }

  /* Quantas peças de cada conjunto o herói está usando: {setId: n}.
   * Usado tanto pelos bônus de conjunto quanto pelo feitiço de conjunto. */
  function equippedSetCounts(h) {
    var counts = {};
    if (!h || !isObj(h.items)) return counts;
    for (var i = 0; i < SLOTS.length; i++) {
      var itId = h.items[SLOTS[i]];
      if (!itId) continue;
      var sid = setIdOf(itId);
      if (sid) counts[sid] = (counts[sid] || 0) + 1;
    }
    return counts;
  }

  Progress.spellsFor = function (heroId) {
    var h = Progress.hero(heroId);
    if (!h) return [];
    var def = classDef(h.classId);
    var out = [], i;
    // O GAME MASTER (31/08): o grimório do dono substitui base+caminho — ele
    // escolhe QUALQUER feitiço do jogo na ficha do GM, e o Julgamento vai
    // sempre junto. Sem a chave do GM, este ramo não existe (classe 'gm'
    // sem def não chega aqui). Itens/conjunto continuam somando abaixo.
    if (h.classId === 'gm' && JOGO.GM && JOGO.GM.ativo && JOGO.GM.ativo()) {
      out = JOGO.GM.grimorio();
    } else {
      if (def && isArray(def.baseSpells)) {
        for (i = 0; i < def.baseSpells.length; i++) out.push(def.baseSpells[i]);
      }
      if (def && def.paths && h.element !== DEFAULT_ELEMENT && isArray(def.paths[h.element])) {
        var path = def.paths[h.element];
        for (i = 0; i < path.length; i++) {
          if (h.level >= pathUnlockLevel(path[i], i)) out.push(path[i]);
        }
      }
    }
    var lume = h.items && h.items[SPELL_SLOT];      // o espaço 'lume' concede feitiço
    if (lume) {
      var it = itemDef(lume);
      if (it && it.grantsSpell && indexOf(out, it.grantsSpell) < 0) out.push(it.grantsSpell);
    }
    // CONJUNTO que concede feitiço [D16]: qualquer `bonuses[n].grantsSpell`
    // vale quando o herói tem n peças daquele conjunto (genérico, sem id fixo).
    var counts = equippedSetCounts(h);
    var sets = setDefs();
    for (var sid in counts) {
      if (!counts.hasOwnProperty(sid)) continue;
      var sdef = sets[sid];
      if (!sdef || !isObj(sdef.bonuses)) continue;
      for (var need = 2; need <= counts[sid]; need++) {
        var b = sdef.bonuses[need] || sdef.bonuses[String(need)];
        if (b && b.grantsSpell && indexOf(out, b.grantsSpell) < 0) out.push(b.grantsSpell);
      }
    }
    return out;
  };

  function syncSpells(heroId) {
    var h = Progress.hero(heroId);
    if (h) h.spells = Progress.spellsFor(heroId);
    return h ? h.spells : [];
  }

  // ================================= inventário único, uma entrada por cópia [D7]
  Progress.invIndexOf = function (itemId) {
    if (!Progress.state) return -1;
    var inv = Progress.state.inventory;
    for (var i = 0; i < inv.length; i++) if (inv[i].itemId === itemId) return i;
    return -1;
  };
  Progress.invEntry = function (itemId) {
    var i = Progress.invIndexOf(itemId);
    return i >= 0 ? Progress.state.inventory[i] : null;
  };
  /* Cópias LIVRES no saco (o que a grade mostra como ×N). */
  Progress.invCount = function (itemId) {
    if (!Progress.state) return 0;
    var inv = Progress.state.inventory, n = 0;
    for (var i = 0; i < inv.length; i++) if (inv[i].itemId === itemId) n++;
    return n;
  };
  /* Cópias que o jogador tem no mundo: as do saco mais as vestidas. */
  Progress.ownedCount = function (itemId) {
    return Progress.invCount(itemId) + Progress.equippedByAll(itemId).length;
  };
  /* A variante que está num espaço do herói: {itemId, level, stars} ou null. */
  Progress.equippedVar = function (heroId, slot) {
    var h = Progress.hero(heroId);
    if (!h || indexOf(SLOTS, slot) < 0 || !h.items[slot]) return null;
    var v = (isObj(h.itemVar) && isObj(h.itemVar[slot])) ? h.itemVar[slot] : null;
    return { itemId: h.items[slot], level: v ? num(v.level, 0) : 0, stars: v ? num(v.stars, 0) : 0 };
  };
  /* Melhor cópia CONHECIDA do item (saco ou vestida) — usada só para exibição;
   * quem calcula stat lê a variante do próprio espaço [D18]. */
  Progress.itemLevel = function (itemId) {
    var best = 0, i, hid;
    var st = Progress.state;
    if (!st) return 0;
    for (i = 0; i < st.inventory.length; i++) {
      if (st.inventory[i].itemId === itemId) best = Math.max(best, num(st.inventory[i].level, 0));
    }
    for (hid in st.heroes) {
      if (!st.heroes.hasOwnProperty(hid)) continue;
      for (i = 0; i < SLOTS.length; i++) {
        var v = Progress.equippedVar(hid, SLOTS[i]);
        if (v && v.itemId === itemId) best = Math.max(best, v.level);
      }
    }
    return best;
  };
  Progress.itemStars = function (itemId) {
    var best = 0, i, hid;
    var st = Progress.state;
    if (!st) return 0;
    for (i = 0; i < st.inventory.length; i++) {
      if (st.inventory[i].itemId === itemId) best = Math.max(best, num(st.inventory[i].stars, 0));
    }
    for (hid in st.heroes) {
      if (!st.heroes.hasOwnProperty(hid)) continue;
      for (i = 0; i < SLOTS.length; i++) {
        var v = Progress.equippedVar(hid, SLOTS[i]);
        if (v && v.itemId === itemId) best = Math.max(best, v.stars);
      }
    }
    return best;
  };
  /* FUNDIR TRÊS IGUAIS NUMA ESTRELA [D19].
   * Regra do usuário: "juntando 3 itens iguais ela ganha uma estrela e assim
   * indo até 3 estrelas", e ele escolheu o caminho caro — 3 peças de ★N viram
   * uma ★N+1, então um ★3 custa 27 cópias.
   * Consome do INVENTÁRIO apenas: peça equipada não some do herói sem aviso.
   * Devolve {ok, stars, usadas} ou {ok:false, motivo}. */
  Progress.canMergeItem = function (itemId, stars) {
    var st = Progress.state;
    if (!st) return { ok: false, motivo: 'sem save' };
    var cfg = starItemCfg();
    var alvo = num(stars, 0);
    if (alvo >= num(cfg.max, 3)) return { ok: false, motivo: 'já está no máximo' };
    var precisa = num(cfg.copies, 3);
    var tem = 0;
    for (var i = 0; i < st.inventory.length; i++) {
      if (st.inventory[i].itemId === itemId && num(st.inventory[i].stars, 0) === alvo &&
          num(st.inventory[i].level, 0) === 0) tem++;
    }
    return tem >= precisa
      ? { ok: true, tem: tem, precisa: precisa }
      : { ok: false, motivo: 'faltam ' + (precisa - tem), tem: tem, precisa: precisa };
  };
  /* `stars` é o degrau DE ONDE se funde: 0 junta três sem estrela e devolve ★1. */
  Progress.mergeItem = function (itemId, stars) {
    var st = Progress.state;
    var alvo = num(stars, 0);
    var pode = Progress.canMergeItem(itemId, alvo);
    if (!pode.ok) return pode;
    var cfg = starItemCfg();
    var precisa = num(cfg.copies, 3);
    var usadas = 0;
    // consome de trás para frente para não embaralhar os índices
    for (var i = st.inventory.length - 1; i >= 0 && usadas < precisa; i--) {
      var e = st.inventory[i];
      if (e.itemId === itemId && num(e.stars, 0) === alvo && num(e.level, 0) === 0) {
        st.inventory.splice(i, 1);
        usadas++;
      }
    }
    // a peça que sobe é uma nova entrada, sem forja (a forja não se herda:
    // as três consumidas tinham de estar em +0, cobrado no `canMergeItem`)
    st.inventory.push(cunha(st, itemId, 'forja', 0, alvo + 1));
    Progress.save();
    return { ok: true, stars: alvo + 1, usadas: usadas };
  };

  /* Multiplicador de bônus de uma peça: forja e estrelas SOMAM [D18]. */
  Progress.itemMult = function (level, stars) {
    return 1 + num(upgradeCfg().bonusPerLevel, 0.12) * Math.max(0, num(level, 0)) +
           starBonusOf(stars);
  };
  Progress.equippedBy = function (itemId) {
    var all = Progress.equippedByAll(itemId);
    return all.length ? all[0] : null;
  };
  /* TODOS os heróis usando uma cópia deste item (com 2 cópias, podem ser 2). */
  Progress.equippedByAll = function (itemId) {
    var st = Progress.state, out = [];
    if (!st) return out;
    for (var hid in st.heroes) {
      if (!st.heroes.hasOwnProperty(hid)) continue;
      var it = st.heroes[hid].items;
      for (var i = 0; i < SLOTS.length; i++) {
        if (it[SLOTS[i]] === itemId) { out.push(hid); break; }
      }
    }
    return out;
  };

  /* Cópias do saco agrupadas para a tela: um espaço por variante, com ×N.
   * A UI NÃO conta na mão — pediria o mesmo laço em três lugares. */
  Progress.invStacks = function () {
    var st = Progress.state;
    if (!st) return [];
    var out = [], mapa = {};
    for (var i = 0; i < st.inventory.length; i++) {
      var e = st.inventory[i];
      var chave = e.itemId + '|' + num(e.level, 0) + '|' + num(e.stars, 0);
      if (mapa.hasOwnProperty(chave)) { mapa[chave].count++; mapa[chave].indices.push(i); continue; }
      var stack = { itemId: e.itemId, level: num(e.level, 0), stars: num(e.stars, 0),
                    count: 1, index: i, indices: [i] };
      mapa[chave] = stack;
      out.push(stack);
    }
    return out;
  };

  /* Índice da melhor cópia livre: mais estrelas, depois mais forja. */
  function bestFreeIndex(itemId) {
    var inv = Progress.state.inventory, best = -1;
    for (var i = 0; i < inv.length; i++) {
      if (inv[i].itemId !== itemId) continue;
      if (best < 0 || inv[i].stars > inv[best].stars ||
          (inv[i].stars === inv[best].stars && inv[i].level > inv[best].level)) best = i;
    }
    return best;
  }

  /* O FUNDO DO SACO (pedido do usuário, 25/08): limite de UNIDADES que
   * cresce com as classes liberadas — limite = base + perClass × liberadas
   * (DATA.bag). Quem barra é cada porta de ENTRADA (addItem, unequip, troca,
   * banco, mercado); equipar e fundir nunca precisam de vaga, porque o
   * líquido deles é zero ou negativo. */
  Progress.bagLimit = function () {
    var cfg = D().bag || {};
    var n = (Progress.state && isArray(Progress.state.unlockedClasses))
          ? Progress.state.unlockedClasses.length : 0;
    return num(cfg.base, 40) + num(cfg.perClass, 20) * n;
  };
  Progress.bagFree = function (quantas) {
    if (!Progress.state) return false;
    return Progress.state.inventory.length + (quantas || 1) <= Progress.bagLimit();
  };

  /* Entra no saco único. Repetido agora vira CÓPIA (matéria da fusão) [D7]. */
  Progress.addItem = function (itemId, origem) {
    if (!Progress.state || typeof itemId !== 'string') return false;
    if (!itemDef(itemId)) return false;
    if (!Progress.bagFree(1)) return false;             // o saco tem fundo
    Progress.state.inventory.push(cunha(Progress.state, itemId, origem || 'saque', 0, 0));
    Progress.save();
    return true;
  };

  /* A INSTÂNCIA para quem está fora deste arquivo (Caixa do Mestre, cofre,
   * balcão, troca): a cópia nova já numerada e na fila de nascimentos —
   * quem chama a põe onde quiser (o saco, o cofre). */
  Progress.novaCopia = function (itemId, origem, level, stars) {
    if (!Progress.state || typeof itemId !== 'string' || !itemDef(itemId)) return null;
    return cunha(Progress.state, itemId, origem, level, stars);
  };
  /* Carimba uma cópia que CHEGOU de fora: mantém o número de série que ela
   * traz (cofre, oferta do jogador, troca) ou cunha um com a origem dada
   * (banca do mercador-fantasma, cofre da guilda). */
  Progress.carimba = function (entrada, origem) {
    if (!Progress.state || !entrada || typeof entrada.itemId !== 'string') return null;
    if (typeof entrada.iid === 'string' && entrada.iid) {
      return { itemId: entrada.itemId, level: Math.max(0, Math.floor(num(entrada.level, 0))),
               stars: Math.max(0, Math.floor(num(entrada.stars, 0))), iid: entrada.iid };
    }
    return cunha(Progress.state, entrada.itemId, origem || 'legado', entrada.level, entrada.stars);
  };
  Progress.nascimentos = function () {
    var st = Progress.state;
    return (st && isArray(st.nascimentos)) ? st.nascimentos.slice() : [];
  };
  /* Tira da fila o que o cartório já registrou (NÃO salva: a Nuvem grava
   * pelo save cru para não disparar outra subida). */
  Progress.limpaNascimentos = function (iids) {
    var st = Progress.state;
    if (!st || !isArray(st.nascimentos) || !isArray(iids)) return 0;
    var fora = {};
    for (var i = 0; i < iids.length; i++) fora[iids[i]] = true;
    var antes = st.nascimentos.length;
    st.nascimentos = st.nascimentos.filter(function (n) { return !fora[n.iid]; });
    return antes - st.nascimentos.length;
  };
  /* Poda: nascimento cujo iid não está mais em lugar nenhum (nem no save,
   * nem nos lugares que `vivos` lista — cofre, balcão) morreu antes de o
   * cartório o ver, e não precisa subir. É o que mantém a fila curta. */
  Progress.podaNascimentos = function (vivos) {
    var st = Progress.state;
    if (!st || !isArray(st.nascimentos)) return 0;
    var fica = {};
    var k;
    if (isObj(vivos)) for (k in vivos) if (vivos.hasOwnProperty(k) && vivos[k]) fica[k] = true;
    var meus = Progress.iidsNoSave();
    for (k = 0; k < meus.length; k++) fica[meus[k].iid] = true;
    var antes = st.nascimentos.length;
    st.nascimentos = st.nascimentos.filter(function (n) { return !!fica[n.iid]; });
    return antes - st.nascimentos.length;
  };
  /* Todo número de série que o save carrega: saco e espaços dos heróis
   * (o cofre e o balcão moram no DB — a Nuvem soma). */
  Progress.iidsNoSave = function () {
    var st = Progress.state, fora = [];
    if (!st) return fora;
    var i;
    for (i = 0; i < (st.inventory || []).length; i++) {
      var e = st.inventory[i];
      if (e && typeof e.iid === 'string' && e.iid) fora.push({ iid: e.iid, itemId: e.itemId, onde: 'saco' });
    }
    for (var hid in st.heroes) {
      if (!st.heroes.hasOwnProperty(hid)) continue;
      var h = st.heroes[hid];
      if (!h || !isObj(h.itemVar)) continue;
      for (var slot in h.itemVar) {
        var v = h.itemVar[slot];
        if (h.itemVar.hasOwnProperty(slot) && isObj(v) && typeof v.iid === 'string' && v.iid) {
          fora.push({ iid: v.iid, itemId: h.items ? h.items[slot] : null, onde: hid + '.' + slot });
        }
      }
    }
    return fora;
  };

  Progress.addPet = function (petId) {
    if (!Progress.state || typeof petId !== 'string' || !petDef(petId)) return false;
    if (indexOf(Progress.state.pets, petId) >= 0) return false;
    for (var hid in Progress.state.heroes) {
      if (Progress.state.heroes.hasOwnProperty(hid) && Progress.state.heroes[hid].pet === petId) return false;
    }
    Progress.state.pets.push(petId);
    Progress.save();
    return true;
  };

  // ================================================ NÍVEL DE USO [D19] (10/09)
  /* A régua é do dado (items.js); aqui só se cobra. `nivelUsoDe` aceita o id
   * de item ou de pet, ou a própria definição; 0 = sem exigência. Sem
   * `DATA.nivelUsoDe` (dado montado à mão nas provas) nunca tranca. */
  var devolvidasNivel = [];              // o que o saneamento devolveu nesta carga
  function ehMestre() {
    try { return !!(JOGO.GM && JOGO.GM.ativo && JOGO.GM.ativo()); } catch (e) { return false; }
  }
  function nivelUsoDe(x) {
    var def = isObj(x) ? x : (typeof x === 'string' ? (itemDef(x) || petDef(x)) : null);
    if (!def) return 0;
    var fn = D().nivelUsoDe;
    if (typeof fn !== 'function') return 0;
    var n;
    try { n = fn(def); } catch (e) { n = 0; }
    n = Math.floor(num(n, 0));
    return n > 0 ? n : 0;
  }
  function nivelDoHeroi(heroId) {
    var h = Progress.hero(heroId);
    if (!h) return 1;
    var lv = Math.floor(num(h.level, 0));
    return lv >= 1 ? lv : levelForXp(num(h.xp, 0));
  }
  /* { ok, nivel (do herói), precisa, motivo } — motivo pronto para a tela. */
  function veredito(heroId, precisa, motivo) {
    var nivel = nivelDoHeroi(heroId);
    var ok = precisa <= 0 || nivel >= precisa || ehMestre();
    return { ok: ok, nivel: nivel, precisa: precisa, motivo: ok ? '' : motivo };
  }
  Progress.nivelUsoDe = nivelUsoDe;
  Progress.podeUsar = function (heroId, itemId) {
    var n = nivelUsoDe(itemId);
    return veredito(heroId, n, 'precisa do nível ' + n);
  };
  Progress.podeUsarPet = function (heroId, petId) {
    var n = nivelUsoDe(petId);
    return veredito(heroId, n, 'pets a partir do nível ' + n);
  };
  /* A última recusa de equip/equipPet, para quem chamou mostrar o motivo
   * ({heroId, itemId|petId, precisa, nivel, motivo}); sucesso limpa. */
  Progress.ultimaRecusa = null;
  function recusa(heroId, campo, id, r) {
    var out = { heroId: heroId, precisa: r.precisa, nivel: r.nivel, motivo: r.motivo };
    out[campo] = id;
    Progress.ultimaRecusa = out;
    return false;
  }
  /* O que o saneamento da última carga devolveu por nível
   * ([{heroId, itemId|petId, precisa, nivel}]). `limpar` = o aviso foi
   * ENTREGUE (a HUD mostrou o toast): esvazia a lista e GRAVA a migração, para
   * a próxima abertura não achar a peça vestida de novo nem repetir o aviso.
   * A carga em si não grava: no ar, a conta do Mestre pode carregar antes de
   * a Nuvem conferir a marca dele (confereConta recarrega a página), e aí o
   * sanitize já tirou o herói 'gm' e a Panóplia da memória — gravar na carga
   * tornaria essa perda permanente. Até o aviso sair nada se perde: toda
   * carga saneia de novo (mesma série, sem duplicar). */
  Progress.devolvidasPorNivel = function (limpar) {
    var out = devolvidasNivel.slice();
    if (limpar) {
      devolvidasNivel = [];
      if (out.length) Progress.save();     // enganchado, o save da Nuvem sobe o saneado
    }
    return out;
  };

  /* Equipar TIRA a cópia do saco [D7]. `invIndex` escolhe qual cópia (a grade
   * manda o índice do espaço tocado); sem ele vai a melhor livre. O que estava
   * no espaço volta para o saco na hora. */
  Progress.equip = function (heroId, itemId, invIndex) {
    var it = itemDef(itemId);
    if (!it || indexOf(SLOTS, it.slot) < 0) return false;
    var h = ensureHero(heroId);
    if (!h) return false;
    if (h.items[it.slot] === itemId &&
        (typeof invIndex !== 'number' || invIndex < 0)) return true;   // já está nele
    var pu = Progress.podeUsar(heroId, itemId);                        // [D19]
    if (!pu.ok) return recusa(heroId, 'itemId', itemId, pu);
    var inv = Progress.state.inventory;
    var idx = (typeof invIndex === 'number' && inv[invIndex] && inv[invIndex].itemId === itemId)
            ? invIndex : bestFreeIndex(itemId);
    if (idx < 0) return false;                                   // nenhuma cópia livre
    var copia = inv.splice(idx, 1)[0];
    if (!isObj(h.itemVar)) h.itemVar = emptyVars();
    devolveAoSaco(h, it.slot);                                   // o anterior fica livre
    h.items[it.slot] = itemId;
    h.itemVar[it.slot] = { level: num(copia.level, 0), stars: num(copia.stars, 0), iid: serieDe(copia, itemId) };
    syncSpells(heroId);
    Progress.ultimaRecusa = null;
    Progress.save();
    premioDoColecionador();              // o Traje fechado concede o pet (1x)
    return true;
  };

  /* Devolve ao saco a cópia que está num espaço (sem salvar — quem chama salva). */
  function devolveAoSaco(h, slot) {
    var itId = h.items[slot];
    if (!itId) return false;
    var v = (isObj(h.itemVar) && isObj(h.itemVar[slot])) ? h.itemVar[slot] : null;
    Progress.state.inventory.push({
      itemId: itId, level: v ? num(v.level, 0) : 0, stars: v ? num(v.stars, 0) : 0,
      iid: serieDe(v, itId)
    });
    h.items[slot] = null;
    if (isObj(h.itemVar)) h.itemVar[slot] = null;
    return true;
  }

  /* TRAJES (pedido 25/08, "conjuntos de equipamento"): a foto dos 4 espaços
   * do herói, guardada por número (t1/t2). Vestir usa o equip de sempre —
   * a troca espaço a espaço não precisa de vaga; só "ficar sem nada num
   * espaço" pede lugar no saco, e o unequip barra sozinho. */
  Progress.saveTraje = function (heroId, n) {
    var h = ensureHero(heroId);
    if (!h || (n !== 1 && n !== 2)) return false;
    if (!isObj(h.trajes)) h.trajes = {};
    var foto = {};
    for (var i = 0; i < SLOTS.length; i++) {
      if (h.items[SLOTS[i]]) foto[SLOTS[i]] = h.items[SLOTS[i]];
    }
    h.trajes['t' + n] = foto;
    Progress.save();
    return true;
  };
  Progress.wearTraje = function (heroId, n) {
    var h = ensureHero(heroId);
    var foto = h && isObj(h.trajes) ? h.trajes['t' + n] : null;
    if (!foto) return null;
    var trocas = 0, faltas = 0, porNivel = 0, recusas = [];
    for (var i = 0; i < SLOTS.length; i++) {
      var slot = SLOTS[i];
      var alvo = foto[slot] || null;
      if ((h.items[slot] || null) === alvo) continue;
      Progress.ultimaRecusa = null;
      var ok = alvo ? Progress.equip(heroId, alvo)     // melhor cópia livre
                    : Progress.unequip(heroId, slot);  // pede vaga no saco
      if (ok) trocas++;
      else {
        faltas++;                                      // por nível também é falta
        if (alvo && Progress.ultimaRecusa && Progress.ultimaRecusa.itemId === alvo) {
          porNivel++; recusas.push(Progress.ultimaRecusa);
        }
      }
    }
    return { trocas: trocas, faltas: faltas, porNivel: porNivel, recusas: recusas };
  };

  Progress.unequip = function (heroId, slot) {
    if (indexOf(SLOTS, slot) < 0) return false;
    var h = ensureHero(heroId);
    if (!h || !h.items[slot]) return false;
    if (!Progress.bagFree(1)) return false;              // sem vaga, fica vestida
    devolveAoSaco(h, slot);                                      // a MESMA cópia volta
    syncSpells(heroId);
    Progress.save();
    return true;
  };

  // ================================================ estrelas de item (fusão) [D18]
  /* Situação da fusão da variante que está em `invIndex`: quantas cópias
   * idênticas existem, quantas faltam e se dá para fundir agora. */
  /* A fusão aceita níveis de forja MISTOS desde 24/08 (pedido do usuário):
   * a regra antiga (três cópias no MESMO nível) era a guarda contra herdar
   * forja de graça, mas virou parede com a forja arriscada — três +10 a 5%
   * cada é pedir três lendas. A guarda agora é a MATEMÁTICA: o resultado sai
   * na MÉDIA dos três, arredondada para baixo (um +10 com dois +0 vira +3 —
   * a média cobra o contrabando sozinha).
   *
   * A escolha das três: a cópia CLICADA entra sempre (clicou, é ela) e as
   * duas de MAIOR nível entre as demais completam — o melhor negócio para o
   * jogador, sem consumir nada que ele não veja: a ficha mostra a conta. */
  Progress.fuseInfo = function (invIndex) {
    var st = Progress.state;
    if (!st) return null;
    var alvo = st.inventory[invIndex];
    if (!isObj(alvo)) return null;
    var cfg = starItemCfg();
    var stars = num(alvo.stars, 0), level = num(alvo.level, 0);
    var outras = [];
    for (var i = 0; i < st.inventory.length; i++) {
      if (i === invIndex) continue;
      var e = st.inventory[i];
      if (e.itemId === alvo.itemId && num(e.stars, 0) === stars) {
        outras.push({ index: i, level: num(e.level, 0) });
      }
    }
    outras.sort(function (a, b) { return b.level - a.level; });
    var escolhidas = [{ index: invIndex, level: level }]
      .concat(outras.slice(0, Math.max(0, cfg.copies - 1)));
    var copias = outras.length + 1;
    var maxed = stars >= cfg.max;
    var pode = !maxed && copias >= cfg.copies;
    var nivelResultado = level;
    if (pode) {
      var soma = 0;
      for (var k2 = 0; k2 < cfg.copies; k2++) soma += escolhidas[k2].level;
      nivelResultado = Math.floor(soma / cfg.copies);
    }
    return {
      itemId: alvo.itemId, level: level, stars: stars,
      copias: copias, precisa: cfg.copies,
      faltam: maxed ? 0 : Math.max(0, cfg.copies - copias),
      maxed: maxed,
      proxima: maxed ? stars : stars + 1,
      pode: pode,
      escolhidas: pode ? escolhidas.slice(0, cfg.copies) : [],
      niveisEscolhidos: pode ? escolhidas.slice(0, cfg.copies).map(function (c) {
        return c.level; }) : [],
      nivelResultado: nivelResultado
    };
  };

  /* Consome as três ESCOLHIDAS (a clicada + as duas melhores) e cria a peça
   * com +1 estrela no nível da média para baixo. Devolve a cópia nova. */
  Progress.fuseItem = function (invIndex) {
    var info = Progress.fuseInfo(invIndex);
    if (!info || !info.pode) return null;
    var st = Progress.state;
    var indices = info.escolhidas.map(function (c) { return c.index; });
    indices.sort(function (a, b) { return b - a; });
    for (var k = 0; k < indices.length; k++) st.inventory.splice(indices[k], 1);
    var nova = cunha(st, info.itemId, 'forja', info.nivelResultado, info.stars + 1);
    st.inventory.push(nova);
    Progress.save();
    return { itemId: nova.itemId, level: nova.level, stars: nova.stars,
             index: st.inventory.length - 1 };
  };

  Progress.equipPet = function (heroId, petId) {
    if (!petDef(petId)) return false;
    var h = ensureHero(heroId);
    if (!h) return false;
    if (h.pet !== petId) {                                             // [D19]
      var pp = Progress.podeUsarPet(heroId, petId);                    // vale também na transferência
      if (!pp.ok) return recusa(heroId, 'petId', petId, pp);
    }
    var pets = Progress.state.pets;
    var idx = indexOf(pets, petId);
    if (idx < 0) {
      var owner = null;
      for (var hid in Progress.state.heroes) {
        if (Progress.state.heroes.hasOwnProperty(hid) && Progress.state.heroes[hid].pet === petId) {
          owner = hid; break;
        }
      }
      if (owner === null) return false;
      if (owner === heroId) return true;
      Progress.state.heroes[owner].pet = null;                   // transferência [D8]
    } else {
      pets.splice(idx, 1);
    }
    if (h.pet) pets.push(h.pet);
    h.pet = petId;
    Progress.ultimaRecusa = null;
    Progress.save();
    return true;
  };

  Progress.unequipPet = function (heroId) {
    var h = ensureHero(heroId);
    if (!h || !h.pet) return false;
    Progress.state.pets.push(h.pet);
    h.pet = null;
    Progress.save();
    return true;
  };

  // ============================================================ forja [D11]
  Progress.addStones = function (stoneId, n) {
    var st = Progress.state;
    if (!st || typeof stoneId !== 'string') return false;
    var amount = Math.floor(num(n, 0));
    if (amount <= 0) return false;
    if (!isObj(st.stones)) st.stones = {};
    st.stones[stoneId] = Math.max(0, Math.floor(num(st.stones[stoneId], 0))) + amount;
    Progress.save();
    return true;
  };
  Progress.stoneCount = function (stoneId) {
    var st = Progress.state;
    if (!st || !isObj(st.stones)) return 0;
    return Math.max(0, Math.floor(num(st.stones[stoneId], 0)));
  };
  /* A SAÍDA AVULSA de pedra [D20] — o espelho do addStones, para quem paga
   * com pedra fora da forja (o mercado). Tudo ou nada: `n` inteiro ≥ 1, a
   * pedra tem de existir em DATA.stones (quando o dado as traz) e o estoque
   * tem de cobrir. Recusa devolve false sem tocar em nada. */
  Progress.gastaPedras = function (stoneId, n) {
    var st = Progress.state;
    if (!st || typeof stoneId !== 'string' || !stoneId) return false;
    if (typeof n !== 'number' || !isFinite(n) || Math.floor(n) !== n || n < 1) return false;
    var sd = stoneDefs();
    if (keys(sd).length && !sd.hasOwnProperty(stoneId)) return false;
    var tem = Progress.stoneCount(stoneId);
    if (tem < n) return false;
    if (!isObj(st.stones)) st.stones = {};
    st.stones[stoneId] = tem - n;
    Progress.save();
    return true;
  };

  // ========================================== os SELOS do Colecionador (25/08)
  /* A moeda dos chefes: uma por elemento, só chefe derruba (game.js rola a
   * chance de DATA.selos). 10 de cada = um giro na roleta = UMA peça do
   * Traje do Colecionador. Fechar as 4 vestidas concede o pet exclusivo, uma
   * vez por conta (petSelosDado). */
  Progress.addSelo = function (elemento, n) {
    var st = Progress.state;
    if (!st || indexOf(elements(), elemento) < 0) return false;
    var amount = Math.floor(num(n, 1));
    if (amount <= 0) return false;
    if (!isObj(st.selos)) st.selos = {};
    st.selos[elemento] = Math.max(0, Math.floor(num(st.selos[elemento], 0))) + amount;
    Progress.save();
    return true;
  };
  /* OS TÍTULOS DO ECO PRIMORDIAL (02/10): o pódio da semana (1º ao 3º) ganha o título pela fila de
   * entregas da loja (loja.js, 'premio-eco'), e ele é da conta para sempre — como os de chefe, não como
   * os de ranking (js/core/titulos.js). Só o que o catálogo conhece. */
  function tituloEcoValido(t) {
    var T = JOGO.Titulos, lista = (T && T.ECO) || [];
    for (var i = 0; i < lista.length; i++) if (lista[i] && lista[i].titulo === t) return true;
    return false;
  }
  Progress.addTituloEco = function (titulo) {
    var st = Progress.state;
    if (!st || !tituloEcoValido(titulo)) return false;
    if (Object.prototype.toString.call(st.titulosEco) !== '[object Array]') st.titulosEco = [];
    if (indexOf(st.titulosEco, titulo) < 0) st.titulosEco.push(titulo);
    Progress.save();
    return true;
  };
  Progress.titulosEco = function () {
    var st = Progress.state;
    return (st && Object.prototype.toString.call(st.titulosEco) === '[object Array]') ? st.titulosEco.slice() : [];
  };
  Progress.selosVer = function () {
    var st = Progress.state;
    var fora = {}, els = elements();
    for (var i = 0; i < els.length; i++) {
      fora[els[i]] = (st && isObj(st.selos)) ? Math.floor(num(st.selos[els[i]], 0)) : 0;
    }
    return fora;
  };
  /* A REGRA DO GIRO (03/09, aprovada pelo dono depois da medição: "pode
   * manter esses 10 giros"): o giro custa `porGiro` selos DE QUALQUER
   * ELEMENTO (somados), pagos das pilhas maiores primeiro — e a roleta NUNCA
   * repete uma peça que você já tem (no saco ou vestida) até fechar as 4;
   * com as 4 fechadas, a repetida vira matéria de estrela. Antes eram 10 de
   * CADA elemento e sorteio cego: ~800 descidas para fechar o traje. */
  Progress.roletaSaldo = function () {
    var cfg = D().selos || {};
    var precisa = Math.max(1, Math.floor(num(cfg.porGiro, 10)));
    var tem = Progress.selosVer(), els = elements(), total = 0;
    for (var i = 0; i < els.length; i++) total += tem[els[i]];
    return { total: total, precisa: precisa, faltam: Math.max(0, precisa - total),
             giros: Math.floor(total / precisa) };
  };
  Progress.roletaPronta = function () {
    return Progress.roletaSaldo().faltam === 0;
  };
  /* as peças do traje que você AINDA NÃO tem — a roleta sorteia entre elas */
  Progress.roletaFaltamPecas = function () {
    var st = Progress.state;
    var cfg = D().selos || {};
    var sd = (D().sets || {})[cfg.setId];
    if (!st || !sd || !isArray(sd.pieces)) return [];
    var tem = {};
    for (var i = 0; i < st.inventory.length; i++) tem[st.inventory[i].itemId] = true;
    for (var hid in st.heroes) {
      if (!st.heroes.hasOwnProperty(hid)) continue;
      var h = st.heroes[hid];
      for (var s = 0; s < SLOTS.length; s++) if (h.items && h.items[SLOTS[s]]) tem[h.items[SLOTS[s]]] = true;
    }
    return sd.pieces.filter(function (pid) { return !tem[pid]; });
  };
  /* seam de teste, como o da forja: injete para tirar o acaso da roleta */
  Progress._roletaRng = null;
  Progress.giraRoleta = function () {
    var st = Progress.state;
    var cfg = D().selos || {};
    var sd = (D().sets || {})[cfg.setId];
    if (!st || !sd || !isArray(sd.pieces) || !sd.pieces.length) return null;
    if (!Progress.roletaPronta()) return null;
    if (!Progress.bagFree(1)) return null;              // o prêmio precisa caber
    var precisa = Progress.roletaSaldo().precisa;
    // paga ANTES de girar: das pilhas maiores primeiro, de qualquer elemento
    var els = elements().slice().sort(function (a, b) {
      return num(st.selos[b], 0) - num(st.selos[a], 0);
    });
    var resta = precisa;
    for (var i = 0; i < els.length && resta > 0; i++) {
      var tira = Math.min(resta, Math.max(0, Math.floor(num(st.selos[els[i]], 0))));
      st.selos[els[i]] = Math.max(0, Math.floor(num(st.selos[els[i]], 0))) - tira;
      resta -= tira;
    }
    var candidatas = Progress.roletaFaltamPecas();
    var fechou = candidatas.length === 0;
    if (fechou) candidatas = sd.pieces.slice();          // as 4 fechadas: repetida vira estrela
    var rnd = (typeof Progress._roletaRng === 'function') ? Progress._roletaRng() : Math.random();
    var itemId = candidatas[Math.min(candidatas.length - 1, Math.floor(rnd * candidatas.length))];
    st.inventory.push(cunha(st, itemId, 'roleta', 0, 0));
    Progress.save();
    return { itemId: itemId, repetida: fechou };
  };

  // ==================================== a INSÍGNIA DE FUNDAÇÃO (30/08)
  /* A moeda que funda GUILDAS: só chefe derruba (game.js rola a chance de
   * DATA.insignias, o mesmo funil dos selos) e 10 delas pagam a fundação
   * (JOGO.Guilda.criar cobra daqui). Contador ÚNICO, não por elemento —
   * uma guilda não tem elemento. */
  Progress.addInsignia = function (n) {
    var st = Progress.state;
    if (!st) return false;
    var amount = Math.floor(num(n, 1));
    if (amount <= 0) return false;
    st.insignias = Math.max(0, Math.floor(num(st.insignias, 0))) + amount;
    Progress.save();
    return true;
  };
  /* ---- AS POÇÕES DE VIDA (13/09, a banca do mercador; DATA.consumiveis)
   * Contadores por tipo, como as pedras: `state.consumiveis = {pocaoId: n}`, só com n > 0,
   * e o objeto some quando esvazia. Cada tipo preso no teto (consumiveisRegras.teto). Sem
   * os dados carregados (uma página velha que não lê consumiveis.js), o saldo passa como
   * está em vez de ser jogado fora. Comprar é da banca (JOGO.Mercado.comprarPocao, que
   * paga e chama poeConsumivel); gastar é do Game ao beber e do juiz ao fechar a sala.
   * Nenhuma das duas é op do jogador por si: a compra sobe pela op comprarPocao, o gasto
   * sobe nos lances da sala. */
  function consumivelDefs() { return D().consumiveis || null; }
  function consumivelTeto() {
    var t = (D().consumiveisRegras || {}).teto;
    return (typeof t === 'number' && isFinite(t) && t > 0) ? Math.floor(t) : 20;
  }
  function saneiaConsumiveis(raw) {
    if (!isObj(raw)) return null;
    var defs = consumivelDefs(), teto = consumivelTeto(), out = {}, algum = false, id;
    for (id in raw) {
      if (!raw.hasOwnProperty(id)) continue;
      if (defs && !defs.hasOwnProperty(id)) continue;
      var n = Math.min(teto, Math.floor(num(raw[id], 0)));
      if (n > 0) { out[id] = n; algum = true; }
    }
    return algum ? out : null;
  }
  Progress.consumivelTeto = consumivelTeto;
  Progress.consumiveisVer = function () {
    var st = Progress.state, out = {}, id;
    if (!st || !isObj(st.consumiveis)) return out;
    for (id in st.consumiveis) {
      if (st.consumiveis.hasOwnProperty(id)) out[id] = Math.max(0, Math.floor(num(st.consumiveis[id], 0)));
    }
    return out;
  };
  Progress.consumivelVer = function (id) {
    var st = Progress.state;
    if (!st || !isObj(st.consumiveis) || typeof id !== 'string' || !st.consumiveis.hasOwnProperty(id)) return 0;
    return Math.max(0, Math.floor(num(st.consumiveis[id], 0)));
  };
  // põe n de uma poção; recusa (false) a desconhecida e o que passaria do teto
  Progress.poeConsumivel = function (id, n) {
    var st = Progress.state, defs = consumivelDefs();
    n = Math.floor(num(n, 0));
    if (!st || n <= 0 || typeof id !== 'string' || !defs || !defs.hasOwnProperty(id)) return false;
    var tem = Progress.consumivelVer(id);
    if (tem + n > consumivelTeto()) return false;
    if (!isObj(st.consumiveis)) st.consumiveis = {};
    st.consumiveis[id] = tem + n;
    Progress.save();
    return true;
  };
  // tira n de uma poção; recusa (false) se não tem todas
  Progress.gastaConsumivel = function (id, n) {
    var st = Progress.state;
    n = Math.floor(num(n, 0));
    var tem = Progress.consumivelVer(id);
    if (!st || n <= 0 || tem < n) return false;
    if (tem - n > 0) st.consumiveis[id] = tem - n;
    else {
      delete st.consumiveis[id];
      if (!keys(st.consumiveis).length) delete st.consumiveis;
    }
    Progress.save();
    return true;
  };

  Progress.insigniasVer = function () {
    var st = Progress.state;
    return st ? Math.max(0, Math.floor(num(st.insignias, 0))) : 0;
  };
  Progress.gastaInsignias = function (n) {
    var st = Progress.state;
    var preco = Math.floor(num(n, 0));
    if (!st || preco <= 0) return false;
    var tem = Math.max(0, Math.floor(num(st.insignias, 0)));
    if (tem < preco) return false;
    st.insignias = tem - preco;
    Progress.save();
    return true;
  };

  // ======================= os PERGAMINHOS da loja do site (Fase C, 10/09)
  /* Dois pergaminhos chegam da loja de vinténs do site (js/core/loja.js
   * entrega; o preço mora só no servidor):
   *   xp        o da SABEDORIA — chega GUARDADO e o jogador LÊ quando quiser
   *             (`lePergaminhoXp`): cada leitura soma DATA.pergaminhos.xp.salas
   *             cargas, até tetoSalas. Cada sala VENCIDA em que ele acrescentou
   *             XP gasta uma (game.js computeRewards, `gastaCargaXp`). Derrota e
   *             abandono não gastam, e o relógio do cliente não entra.
   *   elemento  o da REESCRITA — troca UM caminho elemental por outro que o
   *             herói ainda não tem (`reescreveElemento`).
   * `state.pergaminhos = {xp, elemento}` (só as chaves com saldo) e
   * `state.bonusXp = {salas}` (só com carga): o sanitize conhece os dois. */
  function pergTipos() { return ['xp', 'elemento']; }
  function pergCfg() {
    var c = isObj(D().pergaminhos) ? D().pergaminhos : {};
    var x = isObj(c.xp) ? c.xp : {};
    return {
      fator: Math.max(1, num(x.fator, 1.5)),
      salas: Math.max(1, Math.floor(num(x.salas, 9))),
      tetoSalas: Math.max(1, Math.floor(num(x.tetoSalas, 27))),
      teto: Math.max(1, Math.floor(num(c.tetoInventario, 99)))
    };
  }
  function pergSaldo(tipo) {
    var st = Progress.state;
    return (st && isObj(st.pergaminhos)) ? Math.max(0, Math.floor(num(st.pergaminhos[tipo], 0))) : 0;
  }
  // grava o saldo de um tipo; a chave zerada sai (e o objeto vazio também)
  function pergPoe(tipo, n) {
    var st = Progress.state;
    if (!isObj(st.pergaminhos)) st.pergaminhos = {};
    if (n > 0) st.pergaminhos[tipo] = n;
    else delete st.pergaminhos[tipo];
    if (!keys(st.pergaminhos).length) delete st.pergaminhos;
  }
  function salasXp() {
    var st = Progress.state;
    return (st && isObj(st.bonusXp)) ? Math.max(0, Math.floor(num(st.bonusXp.salas, 0))) : 0;
  }
  Progress.addPergaminho = function (tipo, n) {
    var st = Progress.state;
    if (!st || indexOf(pergTipos(), tipo) < 0) return false;
    var amount = Math.floor(num(n, 1));
    if (amount <= 0) return false;
    var tem = pergSaldo(tipo);
    if (tem + amount > pergCfg().teto) return false;       // teto por tipo: não entra pela metade
    pergPoe(tipo, tem + amount);
    Progress.save();
    return true;
  };
  Progress.pergaminhos = function () {
    return { xp: pergSaldo('xp'), elemento: pergSaldo('elemento'), salasXp: salasXp() };
  };
  /* LER o da Sabedoria: gasta 1 e soma as salas. Recusa com motivo:
   * 'sem' (nenhum guardado) ou 'cheio' (passaria do teto de cargas). */
  Progress.lePergaminhoXp = function () {
    var st = Progress.state;
    var cfg = pergCfg(), salas = salasXp();
    if (!st || pergSaldo('xp') < 1) return { ok: false, salas: salas, motivo: 'sem' };
    if (salas + cfg.salas > cfg.tetoSalas) return { ok: false, salas: salas, motivo: 'cheio' };
    pergPoe('xp', pergSaldo('xp') - 1);
    st.bonusXp = { salas: salas + cfg.salas };
    Progress.save();
    return { ok: true, salas: st.bonusXp.salas, motivo: null };
  };
  Progress.fatorPergaminhoXp = function () {
    return salasXp() > 0 ? pergCfg().fator : 1;
  };
  // tira UMA carga (a sala em que o pergaminho acrescentou XP); devolve as que restam
  Progress.gastaCargaXp = function () {
    var st = Progress.state;
    var salas = salasXp();
    if (!st || salas <= 0) return 0;
    salas -= 1;
    if (salas > 0) st.bonusXp = { salas: salas };
    else delete st.bonusXp;
    Progress.save();
    return salas;
  };

  // ======================= o BÔNUS DE XP POR TEMPO (loja 2, 10/09)
  /* 1, 3 ou 7 dias de +50% de XP (DATA.bonusXp.fator), comprados na loja do
   * site (js/core/loja.js entrega; o preço mora só no servidor).
   * `state.bonusXpAte` é o FIM do prazo em SEGUNDOS do relógio do SERVIDOR
   * (só existe depois de uma compra; o sanitize o conhece — não confundir com
   * `state.bonusXp = {salas}`, as cargas do Pergaminho da Sabedoria). A
   * entrega traz o `agora` do servidor no instante da retirada: o prazo corre
   * a partir da ENTREGA, e comprar de novo SOMA dias —
   * ate = max(agora, ateAtual) + dias × 86400. Quem pergunta se vale é o
   * game.js (computeRewards), com o relógio do servidor que a agenda mede. */
  function bonusCfg() {
    var c = isObj(D().bonusXp) ? D().bonusXp : {};
    return { fator: Math.max(1, num(c.fator, 1.5)) };
  }
  Progress.bonusXpAte = function () {
    var st = Progress.state;
    var v = st ? num(st.bonusXpAte, 0) : 0;
    return (v > 0 && v < BONUS_TETO_S) ? Math.floor(v) : 0;
  };
  /* soma `dias` (inteiro 1..366) a partir de `agoraS` (segundos do servidor)
   * ou do fim atual, o que vier depois → {ok, ate} | {ok:false, motivo} */
  Progress.addBonusXpDias = function (dias, agoraS) {
    var st = Progress.state;
    if (!st) return { ok: false, motivo: 'sem-save' };
    if (!(typeof dias === 'number' && isFinite(dias) && Math.floor(dias) === dias && dias >= 1 && dias <= 366)) {
      return { ok: false, motivo: 'dias' };
    }
    if (!(typeof agoraS === 'number' && isFinite(agoraS) && agoraS > 0 && agoraS < BONUS_TETO_S)) {
      return { ok: false, motivo: 'relogio' };
    }
    var ate = Math.max(Math.floor(agoraS), Progress.bonusXpAte()) + dias * 86400;
    if (ate >= BONUS_TETO_S) return { ok: false, motivo: 'teto' };
    st.bonusXpAte = ate;
    Progress.save();
    return { ok: true, ate: ate };
  };
  /* o fator no instante `tsMs` (MILISSEGUNDOS do relógio do servidor; sem
   * ele, o desta máquina): DATA.bonusXp.fator dentro do prazo, senão 1 */
  Progress.fatorBonusXp = function (tsMs) {
    var ate = Progress.bonusXpAte();
    if (!ate) return 1;
    var t = (typeof tsMs === 'number' && isFinite(tsMs)) ? tsMs : Date.now();
    return (t / 1000 < ate) ? bonusCfg().fator : 1;
  };

  /* A REESCRITA: um caminho da lista sai e outro, que o herói não tem, entra
   * NO MESMO LUGAR — o tamanho da lista não muda e as vagas continuam vindo
   * das estrelas (elementSlots). Se o que sai era o ativo, o novo assume.
   * Nada mais migra: XP, nível, elemPower (conta níveis, não elemento),
   * itens, pet e estrelas ficam; os feitiços do caminho, a fusão e a
   * aparência se ajustam sozinhos (derivam do ativo). O herói neutro escolhe
   * de graça pelo chooseElement (o pergaminho fica guardado), e a classe sem
   * `paths` (o gm, que já tem os 4) fica fora. Só fora de descida: a HUD só
   * oferece no Acampamento, e aqui a batalha e a antessala recusam.
   * `podeReescrever` é a checagem (para a interface); `reescreveElemento`
   * gasta 1 pergaminho SÓ no sucesso, no mesmo save da troca. */
  function emDescida() {
    var G = JOGO.Game;
    return !!(G && (G.screen === 'battle' || G.screen === 'antessala'));
  }
  // a lista como o sanitize a deixaria: o ativo sempre dentro (na frente, se faltava)
  function listaDeCaminhos(h) {
    var lista = isArray(h.elements) ? h.elements.slice() : [];
    if (typeof h.element === 'string' && h.element !== DEFAULT_ELEMENT &&
        indexOf(lista, h.element) < 0) lista.unshift(h.element);
    return lista;
  }
  Progress.podeReescrever = function (heroId, velho, novo) {
    var h = Progress.hero(heroId);
    if (!h) return { ok: false, motivo: 'heroi' };
    if (pergSaldo('elemento') < 1) return { ok: false, motivo: 'sem' };
    if (emDescida()) return { ok: false, motivo: 'descida' };
    if (typeof h.element !== 'string' || h.element === DEFAULT_ELEMENT) return { ok: false, motivo: 'neutro' };
    if (num(h.level, 1) < leveling().elementChoiceLevel) return { ok: false, motivo: 'nivel' };
    var def = classDef(h.classId);
    if (!def || !isObj(def.paths)) return { ok: false, motivo: 'classe' };
    if (typeof novo !== 'string' || novo === DEFAULT_ELEMENT || indexOf(elements(), novo) < 0) {
      return { ok: false, motivo: 'elemento' };
    }
    if (!isArray(def.paths[novo])) return { ok: false, motivo: 'caminho' };
    var lista = listaDeCaminhos(h);
    if (indexOf(lista, novo) >= 0) return { ok: false, motivo: 'ja-tem' };
    if (typeof velho !== 'string' || indexOf(lista, velho) < 0) return { ok: false, motivo: 'velho' };
    return { ok: true, motivo: null };
  };
  Progress.reescreveElemento = function (heroId, velho, novo) {
    if (!Progress.podeReescrever(heroId, velho, novo).ok) return false;
    var h = Progress.hero(heroId);
    var lista = listaDeCaminhos(h);
    lista[indexOf(lista, velho)] = novo;
    h.elements = lista;
    if (h.element === velho) h.element = novo;
    syncSpells(heroId);
    pergPoe('elemento', pergSaldo('elemento') - 1);
    Progress.save();
    return true;
  };

  /* O ELEMENTO DO TRAJE é ESCOLHA DA CONTA (pedido 25/08: "esse set raro
   * poderá escolher o elemento dele"). A escolha reescreve os DEFS do traje
   * NESTA janela: set e peças respondem pelo elemento escolhido — filtro por
   * elemento, pedra de forja e as resists de peça nascidas 'neutro' vão
   * re-chaveadas juntas. Os bônus de conjunto já são pentaelementais e não
   * mudam. Persistida no save; reaplicada no load. */
  Progress.seloElemento = function () {
    return (Progress.state && Progress.state.seloElemento) || 'neutro';
  };
  Progress.escolheSeloElemento = function (elemento) {
    var st = Progress.state;
    if (!st || indexOf(elements(), elemento) < 0) return false;
    st.seloElemento = elemento;
    Progress.save();
    aplicaSeloElemento();
    return true;
  };
  function aplicaSeloElemento() {
    var cfg = D().selos;
    var sd = cfg && (D().sets || {})[cfg.setId];
    if (!sd) return;
    var alvo = Progress.seloElemento();
    sd.element = alvo;
    for (var i = 0; i < sd.pieces.length; i++) {
      var it = (D().items || {})[sd.pieces[i]];
      if (!it) continue;
      it.element = alvo;
      if (it.bonuses && it.bonuses.resists) {
        if (!it.__resistsBase) it.__resistsBase = it.bonuses.resists;
        var novo = {}, base = it.__resistsBase;
        for (var k in base) {
          if (!base.hasOwnProperty(k)) continue;
          novo[k === 'neutro' ? alvo : k] = base[k];
        }
        it.bonuses.resists = novo;
      }
    }
  }
  Progress._aplicaSeloElemento = aplicaSeloElemento;   // o load chama; o teste espia

  /* O TRAJE FECHADO concede o pet (uma vez): chamado pelo equip. */
  function premioDoColecionador() {
    var st = Progress.state;
    var cfg = D().selos || {};
    var sd = (D().sets || {})[cfg.setId];
    if (!st || st.petSelosDado || !sd || !sd.pet || !petDef(sd.pet)) return;
    var vestidas = 0;
    for (var i = 0; i < sd.pieces.length; i++) {
      var pid = sd.pieces[i];
      for (var hid in st.heroes) {
        if (!st.heroes.hasOwnProperty(hid)) continue;
        var h = st.heroes[hid];
        var achou = false;
        for (var s = 0; s < SLOTS.length; s++) {
          if (h.items && h.items[SLOTS[s]] === pid) achou = true;
        }
        if (achou) { vestidas++; break; }
      }
    }
    if (vestidas < sd.pieces.length) return;
    st.petSelosDado = true;                    // marca ANTES: o addPet pode recusar
    // as 5 cartas pagas de uma vez: o pet entra no saco pela mesma porta dos
    // outros (03/09) — e a régua das estrelas dele parte do mesmo zero
    Progress.addPetCards(sd.pet, PET_UNLOCK_COST);
    Progress.save();
  }

  function tierNameFor(level) {
    var tiers = upgradeCfg().tiers;
    for (var i = 0; i < tiers.length; i++) {
      var t = tiers[i];
      if (level >= num(t.from, 0) && level <= num(t.to, 0)) return t.name;
    }
    return tiers.length ? tiers[tiers.length - 1].name : '';
  }

  // pedra usada por um item: a do elemento dele; neutro usa a de maior estoque
  function stoneForItem(def) {
    var el = (def && def.element) || DEFAULT_ELEMENT;
    if (el !== DEFAULT_ELEMENT) return stoneIdForElement(el);
    var st = Progress.state;
    var best = stoneIdForElement(DEFAULT_ELEMENT), bestN = -1;
    var pool = keys(stoneDefs());
    if (!pool.length && st && isObj(st.stones)) pool = keys(st.stones);
    // a ÂNCORA não é pedra de forjar (22/09, achado da quebra [D20]): quem
    // juntasse mais âncoras que lascas via a peça neutra comê-las como pedra
    var guarda = upgradeCfg().guardStone;
    for (var i = 0; i < pool.length; i++) {
      if (guarda && pool[i] === guarda) continue;
      var n = Progress.stoneCount(pool[i]);
      if (n > bestN) { bestN = n; best = pool[i]; }
    }
    return best;
  }

  /* Núcleo da forja: o que custa subir esta peça deste nível, seja ela do saco
   * ou já vestida. `upgradeInfo` (saco) e `upgradeInfoWorn` (vestida) só dizem
   * DE ONDE vêm o item e o nível. */
  function forgeInfo(itemId, rawLevel, stars) {
    var def = itemDef(itemId);
    if (!def) return null;
    var up = upgradeCfg();
    var level = Math.max(0, Math.floor(num(rawLevel, 0)));
    var maxLv = num(up.maxLevel, 10);
    var stoneId = stoneForItem(def);
    var estrelas = Math.max(0, Math.floor(num(stars, 0)));
    if (level >= maxLv) {
      return { itemId: itemId, level: level, stars: estrelas, tierName: tierNameFor(level),
               custo: 0, stoneId: stoneId, temPedras: false, maxed: true };
    }
    var custo = Math.max(0, Math.floor(num(up.stoneCost[level], 0)));
    // O RISCO da batida: até riskFrom-1 é seguro; dali em diante a chance
    // vem da tabela e a falha REGRIDE — a menos que a Âncora vá junto.
    var riskFrom = num(up.riskFrom, 99);
    var arriscado = level >= riskFrom;
    var chance = arriscado
      ? Math.max(0.05, Math.min(1, num((up.chances || {})[level], 0.25)))
      : 1;
    var guardaId = up.guardStone || null;
    return {
      itemId: itemId, level: level, stars: estrelas, tierName: tierNameFor(level),
      custo: custo, stoneId: stoneId,
      temPedras: Progress.stoneCount(stoneId) >= custo, maxed: false,
      arriscado: arriscado, chance: chance,
      guardaId: guardaId,
      guardas: guardaId ? Progress.stoneCount(guardaId) : 0
    };
  }

  /* O DADO da forja, com o seam para o teste cravar o resultado. */
  Progress._forjaRng = null;
  function rolaForja() {
    var fn = Progress._forjaRng || Math.random;
    return fn();
  }
  /* Consome a Âncora quando ela vai junto (batida arriscada + escolha). */
  function pagaGuarda(info, usarGuarda) {
    if (!info.arriscado || !usarGuarda) return { usou: false, ok: true };
    if (!info.guardaId || info.guardas < 1) return { usou: false, ok: false };
    var st = Progress.state;
    if (!isObj(st.stones)) st.stones = {};
    st.stones[info.guardaId] = Progress.stoneCount(info.guardaId) - 1;
    return { usou: true, ok: true };
  }
  /* O desfecho de uma batida: subiu, segurou (âncora) ou caiu. */
  function desfecho(info, usarGuarda) {
    var guarda = pagaGuarda(info, usarGuarda);
    if (!guarda.ok) return null;                       // pediu âncora sem ter
    if (!info.arriscado || rolaForja() < info.chance) {
      return { resultado: 'subiu', nivel: info.level + 1 };
    }
    return guarda.usou
      ? { resultado: 'segurou', nivel: info.level }
      : { resultado: 'caiu', nivel: Math.max(0, info.level - 1) };
  }

  Progress.upgradeInfo = function (invIndex) {
    var st = Progress.state;
    if (!st) return null;
    var entry = st.inventory[invIndex];
    if (!isObj(entry)) return null;
    return forgeInfo(entry.itemId, entry.level, entry.stars);
  };
  /* Forjar sem desequipar: a peça em uso também sobe [D7]. */
  Progress.upgradeInfoWorn = function (heroId, slot) {
    var v = Progress.equippedVar(heroId, slot);
    return v ? forgeInfo(v.itemId, v.level, v.stars) : null;
  };
  function pagaPedras(info) {
    if (!info || info.maxed || !info.temPedras) return false;
    var st = Progress.state;
    if (!st) return false;
    if (!isObj(st.stones)) st.stones = {};
    st.stones[info.stoneId] = Progress.stoneCount(info.stoneId) - info.custo;
    return true;
  }
  Progress.upgradeWorn = function (heroId, slot, usarGuarda) {
    var h = Progress.hero(heroId);
    var info = Progress.upgradeInfoWorn(heroId, slot);
    if (!h || !info) return false;
    // a Âncora se valida ANTES de cobrar as pedras: recusar depois de pagar
    // seria cobrar a batida que não houve (o teste pegou a ordem errada)
    if (usarGuarda && info.arriscado && (!info.guardaId || info.guardas < 1)) return false;
    if (!pagaPedras(info)) return false;
    var fim = desfecho(info, usarGuarda);
    if (!fim) return false;
    if (!isObj(h.itemVar)) h.itemVar = emptyVars();
    var v = isObj(h.itemVar[slot]) ? h.itemVar[slot] : { level: 0, stars: 0 };
    h.itemVar[slot] = { level: fim.nivel, stars: num(v.stars, 0), iid: serieDe(v, h.items[slot]) };
    Progress.save();
    return fim;
  };

  Progress.upgradeItem = function (invIndex, usarGuarda) {
    var info = Progress.upgradeInfo(invIndex);
    if (!info) return false;
    if (usarGuarda && info.arriscado && (!info.guardaId || info.guardas < 1)) return false;
    if (!pagaPedras(info)) return false;
    var fim = desfecho(info, usarGuarda);
    if (!fim) return false;
    Progress.state.inventory[invIndex].level = fim.nivel;
    Progress.save();
    return fim;
  };

  // ============================================================ a QUEBRA [D20]
  /* A pedra que a quebra PAGA: a do elemento, e só se ela existir de verdade.
   * A Âncora nunca (é a guarda da forja, não matéria de peça); sem
   * DATA.stones (mundo de prova) vale o próprio nome do elemento, que é o que
   * o saneamento aceita como pedra. */
  function pedraDaQuebra(stoneId) {
    var guarda = upgradeCfg().guardStone;
    if (!stoneId || (guarda && stoneId === guarda)) return false;
    var sd = stoneDefs();
    if (keys(sd).length) return sd.hasOwnProperty(stoneId) && isObj(sd[stoneId]);
    return indexOf(elements(), stoneId) >= 0;
  }
  function ehDoMestre(itemId, def) {
    return !!(def && def.noDrop) || /^gm-/.test(String(itemId));
  }
  function mesmaVariante(a, b) {
    return isObj(a) && isObj(b) && a.itemId === b.itemId &&
           num(a.level, 0) === num(b.level, 0) && num(a.stars, 0) === num(b.stars, 0);
  }

  /* A CONTA de uma peça, sem saco e sem estado — pura (a tela pode perguntar
   * por qualquer variante). A régua e o porquê de cada andar: DATA.quebra.
   *   pedras = max(minimo, floor(base × degrau × estrelas) + forja)
   * com `partes.estrelas` já o MULTIPLICADOR (porEstrela^★) e `partes.forja`
   * o reembolso em pedras. Devolve null para item desconhecido; `pode:false`
   * vem com `motivo` 'mestre' (Panóplia) ou 'sem-pedra' (elemento sem pedra). */
  function quebraInfoDe(itemId, level, stars) {
    var def = itemDef(itemId);
    if (!def) return null;
    var cfg = quebraCfg(), up = upgradeCfg();
    var lv = clampLevel(level), sr = clampStars(stars);
    var rar = RARIDADE_PT[def.rarity] || def.rarity;
    var base = cfg.base.hasOwnProperty(rar) ? cfg.base[rar] : num(cfg.base.comum, 1);
    var nivelUso = nivelUsoDe(def);
    // o "nível do item": 1 · 2 · 3 com a régua de 10; 0 (sem régua) vale 1
    var degrau = Math.max(1, Math.ceil(nivelUso / cfg.degrauNivel));
    var mult = Math.pow(cfg.porEstrela, sr);
    var nominal = 0;
    for (var i = 0; i < lv && i < up.stoneCost.length; i++) {
      nominal += Math.max(0, Math.floor(num(up.stoneCost[i], 0)));
    }
    var forja = Math.floor(cfg.reembolsoForja * nominal);
    var pedras = Math.max(cfg.minimo, Math.floor(base * degrau * mult) + forja);
    var stoneId = stoneIdForElement(def.element || DEFAULT_ELEMENT);
    var motivo = ehDoMestre(itemId, def) ? 'mestre'
               : (!pedraDaQuebra(stoneId) ? 'sem-pedra' : null);
    return {
      itemId: itemId, level: lv, stars: sr, rarity: rar, nivelUso: nivelUso,
      stoneId: stoneId, pedras: pedras,
      partes: { base: base, degrau: degrau, estrelas: mult, forja: forja },
      pode: motivo === null, motivo: motivo
    };
  }
  Progress.quebraInfoDe = quebraInfoDe;

  /* A conta de quebrar `n` cópias da variante que está em `invIndex` — a
   * clicada e mais n-1 IDÊNTICAS a ela (mesmo item, forja e ★). Acrescenta ao
   * `quebraInfoDe` a posição, a série, quantas cópias iguais há no saco e o
   * total. Recusa própria: motivo 'n' (n fora de 1..99 ou não inteiro) e
   * 'copias' (pediu mais do que tem). null sem estado ou sem entrada. */
  Progress.quebraInfo = function (invIndex, n) {
    var st = Progress.state;
    if (!st || !isArray(st.inventory)) return null;
    if (typeof invIndex !== 'number' || Math.floor(invIndex) !== invIndex) return null;
    var alvo = st.inventory[invIndex];
    if (!isObj(alvo)) return null;
    var info = quebraInfoDe(alvo.itemId, alvo.level, alvo.stars);
    if (!info) return null;
    var qn = (n === undefined || n === null) ? 1 : n;
    var nOk = typeof qn === 'number' && isFinite(qn) && Math.floor(qn) === qn &&
              qn >= 1 && qn <= QUEBRA_MAX_N;
    var copias = 0;
    for (var i = 0; i < st.inventory.length; i++) {
      if (mesmaVariante(st.inventory[i], alvo)) copias++;
    }
    info.index = invIndex;
    info.iid = (typeof alvo.iid === 'string' && alvo.iid) ? alvo.iid : null;
    info.n = qn;
    info.copias = copias;
    info.total = nOk ? info.pedras * qn : 0;
    if (info.pode && !nOk) { info.pode = false; info.motivo = 'n'; }
    else if (info.pode && qn > copias) { info.pode = false; info.motivo = 'copias'; }
    return info;
  };

  /* O GOLPE: tira do saco a cópia de `invIndex` e mais n-1 idênticas (as de
   * índice MAIS ALTO primeiro — as mais novas), soma as pedras e grava UMA
   * vez. Os splices vão do índice maior para o menor para um não embaralhar
   * o outro. Recusa (o mesmo veredito do quebraInfo) devolve false e não
   * toca em nada. Peça vestida não está no saco: nunca é quebrada por aqui.
   * Devolve { itemId, level, stars, n, stoneId, pedras (o total), iids }.
   *
   * A TRAVA (22/09, da revisão): `trava = { iid, evita }`, as duas opcionais.
   *  · `iid` — a série da peça que o jogador VIU na bancada. Posição sozinha
   *    não basta: se o estado do servidor for adotado entre a confirmação e a
   *    op (a fila que sobe antes, um 409), o mesmo índice aponta para OUTRA
   *    peça — e quebra não tem volta. Série diferente em `invIndex` = false.
   *  · `evita` — séries que não podem sair do saco (as cópias emprestadas do
   *    banco da guilda: o juiz passa `contexto.bloqueados`). Cópias iguais
   *    são intercambiáveis para o jogador, então o golpe escolhe as dele e
   *    deixa a emprestada — em vez de recusar tudo por causa dela. */
  Progress.quebraPeca = function (invIndex, n, trava) {
    var info = Progress.quebraInfo(invIndex, n);
    if (!info || !info.pode) return false;
    var st = Progress.state;
    var alvo = st.inventory[invIndex];
    var tv = isObj(trava) ? trava : {};
    if (typeof tv.iid === 'string' && tv.iid && alvo.iid !== tv.iid) return false;
    var evita = {};
    if (isArray(tv.evita)) {
      for (var e = 0; e < tv.evita.length; e++) {
        if (typeof tv.evita[e] === 'string') evita[tv.evita[e]] = true;
      }
    }
    function livre(k) {
      var s = st.inventory[k] && st.inventory[k].iid;
      return !(typeof s === 'string' && evita.hasOwnProperty(s));
    }
    var escolhidas = livre(invIndex) ? [invIndex] : [];
    for (var i = st.inventory.length - 1; i >= 0 && escolhidas.length < info.n; i--) {
      if (i !== invIndex && mesmaVariante(st.inventory[i], alvo) && livre(i)) escolhidas.push(i);
    }
    if (escolhidas.length < info.n) return false;          // faltou cópia livre
    var iids = escolhidas.map(function (k) {
      var s = st.inventory[k].iid;
      return (typeof s === 'string' && s) ? s : null;
    });
    var ordem = escolhidas.slice().sort(function (a, b) { return b - a; });
    for (var k = 0; k < ordem.length; k++) st.inventory.splice(ordem[k], 1);
    if (!isObj(st.stones)) st.stones = {};
    st.stones[info.stoneId] = Progress.stoneCount(info.stoneId) + info.total;
    Progress.save();
    return { itemId: info.itemId, level: info.level, stars: info.stars, n: info.n,
             stoneId: info.stoneId, pedras: info.total, iids: iids };
  };

  // ======================================================== stats efetivos [D13]
  function addStat(out, k, v, capPaPp) {
    if (!v) return;
    if (capPaPp && k === 'pa') v = Math.min(v, PA_ITEM_CAP);
    if (capPaPp && k === 'pp') v = Math.min(v, PP_ITEM_CAP);
    out[k] += v;
  }
  /* Soma um bloco de bônus. `mult` é o multiplicador da forja: só vale para os
   * atributos FORA de `nonScalingKeys` — pa/pp nunca escalam [D11]. */
  function applyBonuses(out, bonuses, capPaPp, mult) {
    if (!isObj(bonuses)) return;
    var m = (typeof mult === 'number' && isFinite(mult)) ? mult : 1;
    var noScale = upgradeCfg().nonScalingKeys || [];
    for (var i = 0; i < STAT_KEYS.length; i++) {
      var k = STAT_KEYS[i];
      var v = num(bonuses[k], 0);
      if (!v) continue;
      var val = (indexOf(noScale, k) >= 0) ? v : Math.round(v * m);
      addStat(out, k, val, capPaPp);
    }
    if (isObj(bonuses.resists)) {
      var mr = (indexOf(noScale, 'resists') >= 0) ? 1 : m;
      for (var e in bonuses.resists) {
        if (!bonuses.resists.hasOwnProperty(e)) continue;
        out.resists[e] = num(out.resists[e], 0) + Math.round(num(bonuses.resists[e], 0) * mr);
      }
    }
  }

  /* A FOTO de um estado de stats (só os números; `resists` copiado à parte). */
  function fotoStats(o) {
    var f = {}, i;
    for (i = 0; i < STAT_KEYS.length; i++) f[STAT_KEYS[i]] = num(o[STAT_KEYS[i]], 0);
    f.resists = {};
    for (var e in o.resists) if (o.resists.hasOwnProperty(e)) f.resists[e] = num(o.resists[e], 0);
    return f;
  }

  /* `_etapas` (11/09) é um vetor opcional em que esta função deixa uma FOTO
   * depois de cada fonte de bônus — base+nível, itens, conjuntos, pet,
   * estrelas. É como `Progress.statsBreakdown` responde "o que o equipamento
   * está me dando" sem duplicar a conta aqui embaixo. Quem não passa o vetor
   * não paga nada: nenhuma foto é tirada. */
  Progress.effectiveStats = function (heroId, _etapas) {
    var h = Progress.hero(heroId);
    if (!h) return null;
    var def = classDef(h.classId);
    if (!def || !isObj(def.stats)) return null;
    var base = def.stats;
    var out = { hp: 0, pa: 0, pp: 0, power: 0, elemPower: 0, initiative: 0, dodge: 0, lock: 0,
                element: h.element || DEFAULT_ELEMENT, resists: {} };
    var i, k;
    for (i = 0; i < STAT_KEYS.length; i++) { k = STAT_KEYS[i]; out[k] = num(base[k], 0); }
    if (isObj(base.resists)) {
      for (k in base.resists) if (base.resists.hasOwnProperty(k)) out.resists[k] = num(base.resists[k], 0);
    }

    // ---- níveis [D14]: todo nível dá PV; o poder vira ELEMENTAL depois da escolha
    var lv = leveling();
    var per = lv.perLevel || {};
    var perEl = lv.perLevelElement || null;
    var ups = Math.max(0, h.level - 1);
    // subidas antes da escolha (níveis 1→4, ou seja `elementChoiceLevel - 2` subidas)
    var genericUps = Math.min(ups, Math.max(0, num(lv.elementChoiceLevel, 5) - 2));
    var elementalUps = ups - genericUps;
    var hasElement = (h.element && h.element !== DEFAULT_ELEMENT);

    // §9-H [D17]: esquiva e fixação também sobem com o nível, no ritmo do PAPEL
    out.dodge += defenseGain(h.classId, h.level, 'dodge', out.dodge);
    out.lock += defenseGain(h.classId, h.level, 'lock', out.lock);

    out.hp += num(per.hp, 0) * genericUps +
              num(perEl && perEl.hp, num(per.hp, 0)) * elementalUps;
    out.power += num(per.power, 0) * genericUps;
    if (hasElement && perEl) {
      out.elemPower += num(perEl.elemPower, 0) * elementalUps;   // dano no elemento do herói
    } else {
      // sem elemento escolhido (ou dado antigo sem `perLevelElement`): poder genérico
      out.power += num(per.power, 0) * elementalUps;
    }

    if (_etapas) _etapas.push({ fonte: 'base', stats: fotoStats(out) });

    // ---- itens equipados (com o multiplicador da forja) e contagem de conjuntos
    var setCount = equippedSetCounts(h);
    for (i = 0; i < SLOTS.length; i++) {
      var itId = h.items[SLOTS[i]];
      if (!itId) continue;
      var it = itemDef(itId);
      if (!it) continue;
      // a variante da CÓPIA em uso manda: forja e estrelas daquela peça [D7][D18]
      var vv = (isObj(h.itemVar) && isObj(h.itemVar[SLOTS[i]])) ? h.itemVar[SLOTS[i]] : null;
      var mult = Progress.itemMult(vv ? vv.level : 0, vv ? vv.stars : 0);
      applyBonuses(out, it.bonuses, true, mult);
    }

    if (_etapas) _etapas.push({ fonte: 'itens', stats: fotoStats(out) });

    // ---- conjuntos: progressivo e cumulativo (4 peças valem 2+3+4) [D10]
    var sets = setDefs();
    for (var sid2 in setCount) {
      if (!setCount.hasOwnProperty(sid2)) continue;
      var sdef = sets[sid2];
      if (!sdef || !isObj(sdef.bonuses)) continue;
      for (var need = 2; need <= setCount[sid2]; need++) {
        var b = sdef.bonuses[need] || sdef.bonuses[String(need)];
        if (isObj(b)) applyBonuses(out, b, false, 1);
      }
    }

    if (_etapas) _etapas.push({ fonte: 'conjuntos', stats: fotoStats(out) });

    // ---- pet
    if (h.pet) {
      var pd = petDef(h.pet);
      // o nível e as estrelas do pet MULTIPLICAM o que ele dá ao dono (03/09)
      if (pd) applyBonuses(out, pd.bonuses, true, Progress.petMult(h.pet));
    }

    if (_etapas) _etapas.push({ fonte: 'pet', stats: fotoStats(out) });

    // ---- estrelas da classe (fixas e permanentes) [D9]
    applyBonuses(out, starBonuses(h.classId), false, 1);
    if (_etapas) _etapas.push({ fonte: 'estrelas', stats: fotoStats(out) });

    out.hp = Math.max(1, Math.round(out.hp));
    out.pa = Math.max(0, Math.round(out.pa));
    out.pp = Math.max(0, Math.round(out.pp));
    out.elemPower = Math.max(0, Math.round(out.elemPower));
    out.dodge = Math.max(0, Math.round(out.dodge));
    out.lock = Math.max(0, Math.round(out.lock));
    return out;
  };

  /* O EXTRATO DOS STATS (11/09 — a ficha do personagem: "o que seu
   * equipamento dá de vantagens"). Roda a MESMA conta de `effectiveStats`
   * e devolve, por fonte, quanto cada uma somou:
   *
   *   { total, base, fontes: { itens, conjuntos, pet, estrelas } }
   *
   * `base` é o corpo nu no nível atual; cada fonte é a DIFERENÇA que ela
   * trouxe. Somar base + todas as fontes dá o total (o arredondamento final
   * do effectiveStats pode mexer uma unidade no PV — a conta interna é
   * fracionária de propósito). */
  Progress.statsBreakdown = function (heroId) {
    var etapas = [];
    var total = Progress.effectiveStats(heroId, etapas);
    if (!total || !etapas.length) return null;
    var fontes = {}, i, k;
    for (i = 1; i < etapas.length; i++) {
      var de = etapas[i - 1].stats, para = etapas[i].stats, d = { resists: {} };
      var algo = false;
      for (var si = 0; si < STAT_KEYS.length; si++) {
        k = STAT_KEYS[si];
        var v = Math.round(num(para[k], 0) - num(de[k], 0));
        if (v) { d[k] = v; algo = true; }
      }
      for (var e in para.resists) {
        if (!para.resists.hasOwnProperty(e)) continue;
        var vr = Math.round(num(para.resists[e], 0) - num(de.resists[e], 0));
        if (vr) { d.resists[e] = vr; algo = true; }
      }
      if (algo) fontes[etapas[i].fonte] = d;
    }
    var base = {};
    for (i = 0; i < STAT_KEYS.length; i++) {
      base[STAT_KEYS[i]] = Math.round(num(etapas[0].stats[STAT_KEYS[i]], 0));
    }
    base.resists = etapas[0].stats.resists;
    return { total: total, base: base, fontes: fontes };
  };

  // ============================================================ saque [D12]
  // expoente da Sorte de Saque para uma raridade (o DADO manda) [D12]
  function luckExponent(rarity) {
    var LW = D().lootWeights;
    if (isObj(LW) && isObj(LW.luckExponent)) return num(LW.luckExponent[rarity], 0);
    return num(RARITY_DEGREE[rarity], 0);
  }

  /* Piscina de saque de um calabouço [D12].
   * Preferência: os próprios itens de `DATA.items` daquele calabouço, com
   * `dropWeight` e `minRoom` calibrados pelo Criativo — é essa escala que o
   * peso de "nada" (`lootWeights.noDrop`) acompanha. Só na ausência deles cai
   * na `dungeon.lootTable` da v2.1 (e aí, sem "nada", para não desequilibrar). */
  /* O VAZAMENTO DOS PORTAIS FECHADOS (08/09): as peças de um calabouço
   * trancado (DATA.portaisFechados) caem nos calabouços ABERTOS, com metade
   * do peso e as mesmas regras de sala (épico/lendário só no chefe). A
   * chance de sair peça não muda — o rollDrops engorda o "nada" na mesma
   * proporção — só o que sai fica mais variado. Abriu o portal, o vazamento
   * dele para sozinho. */
  var VAZAMENTO = 0.5;
  /* O SAQUE EMPRESTADO (03/10, o Santuário dos Elementos). O calabouço especial não tem peça
   * própria: `saqueDe` diz de qual dos seis ele sorteia (o Coração Partido — é o outro fim de jogo),
   * com o MESMO peso de "nada" de lá. As salas comuns dele sorteiam como a última sala comum da
   * fonte (comum e raro) e a sala que fecha a descida — o Altar — como a do chefe: épico e lendário
   * e dois sorteios. Sem `saqueDe`, a fonte é o próprio calabouço e nada muda. */
  function fonteDoSaque(dungeonId, roomIndex) {
    var d = dungeonDef(dungeonId);
    var de = (d && typeof d.saqueDe === 'string') ? d.saqueDe : null;
    if (!de) return { id: dungeonId, room: num(roomIndex, 0) };
    var fonte = dungeonDef(de);
    var ult = (fonte && isArray(fonte.rooms) && fonte.rooms.length) ? fonte.rooms.length - 1 : 2;
    return { id: de, room: isBossRoom(dungeonId, roomIndex) ? ult : Math.max(0, ult - 1) };
  }
  function lootPool(dungeonId, roomIndex, luck) {
    var fonte = fonteDoSaque(dungeonId, roomIndex);
    dungeonId = fonte.id;
    var room = fonte.room;
    var items = D().items || {};
    var pool = [], usouItens = false, id, it, w;
    var proprio = 0, vazado = 0;
    var fechado = D().portalFechado || function () { return false; };
    var estouFechado = fechado(dungeonId);
    for (id in items) {
      if (!items.hasOwnProperty(id)) continue;
      it = items[id];
      if (!it || !it.dungeonId) continue;
      var meu = it.dungeonId === dungeonId;
      var vaza = !meu && !estouFechado && fechado(it.dungeonId);
      if (!meu && !vaza) continue;
      if (num(it.dropWeight, 0) <= 0) continue;
      if (meu) usouItens = true;
      if (room < num(it.minRoom, 0)) continue;          // épico/lendário: só no chefe
      w = num(it.dropWeight, 0) * Math.pow(luck, luckExponent(it.rarity));
      if (vaza) w *= VAZAMENTO;
      if (w > 0) {
        pool.push({ id: id, w: w, vazado: vaza });
        if (vaza) vazado += w; else proprio += w;
      }
    }
    if (usouItens) return { pool: pool, itemBased: true, proprio: proprio, vazado: vazado };

    var dungeon = dungeonDef(dungeonId);
    var table = dungeon && dungeon.lootTable;
    if (!isArray(table)) return { pool: [], itemBased: false };
    for (var i = 0; i < table.length; i++) {
      var entry = table[i];
      if (!isObj(entry)) continue;
      it = itemDef(entry.itemId);
      var minRoom = Math.max(num(entry.minRoom, 0), num(it && it.minRoom, 0));
      if (room < minRoom) continue;
      w = Math.max(0, num(entry.weight, 0)) * Math.pow(luck, luckExponent(it && it.rarity));
      if (w > 0) pool.push({ id: entry.itemId, w: w });
    }
    return { pool: pool, itemBased: false };
  }

  Progress.lootPoolInfo = function (dungeonId, roomIndex, partySize) {
    var b0 = lootPool(dungeonId, roomIndex, luckFor(partySize));
    return { itens: b0.pool.map(function (e) { return { id: e.id, w: e.w, vazado: !!e.vazado }; }),
             proprio: b0.proprio || 0, vazado: b0.vazado || 0 };
  };
  Progress.rollDrops = function (dungeonId, roomIndex, partySize, multDrop) {
    if (!Progress.state) Progress.load();
    var luck = luckFor(partySize);
    var built = lootPool(dungeonId, roomIndex, luck);
    var pool = built.pool;
    if (!pool.length) return [];

    // PESO DE "NADA": entra no mesmo sorteio das peças e é o que faz o saque
    // doer (~50% dos sorteios saem vazios). Não recebe a Sorte de Saque — é
    // justamente por isso que grupo menor tira mais e melhor. [D12]
    if (built.itemBased) {
      var LW = D().lootWeights;
      // 03/10: o "nada" é o do calabouço de onde as peças saem (fonteDoSaque)
      var nd = (isObj(LW) && isObj(LW.noDrop)) ? num(LW.noDrop[fonteDoSaque(dungeonId, roomIndex).id], 0) : 0;
      /* A DIFICULDADE MEXE NO PESO DE "NADA", e nao no numero de sorteios.
       *
       * Este peso E a taxa de drop: ele e o que faz ~metade dos sorteios sairem
       * vazios. Dividi-lo por 1,5 e exatamente "50% mais drop", e a conta
       * continua valendo para toda a tabela de raridade — as pecas boas
       * continuam raras em relacao as ruins, so sai "nada" com menos frequencia.
       *
       * Somar sorteios teria sido a saida obvia e estaria errada: 1,5 sorteio
       * nao existe, e arredondar para 2 daria +100% em vez de +50%. */
      var md = (typeof multDrop === 'number' && isFinite(multDrop) && multDrop > 0) ? multDrop : 1;
      if (md !== 1 && nd > 0) nd = nd / md;
      // o VAZAMENTO não muda a chance de sair peça: o "nada" cresce junto
      if (nd > 0 && built.vazado > 0 && built.proprio > 0) nd *= (built.proprio + built.vazado) / built.proprio;
      if (nd > 0) pool = pool.concat([{ id: NO_DROP, w: nd }]);
    }

    var rolls = isBossRoom(dungeonId, roomIndex) ? 2 : 1;
    var drops = [];
    for (var r = 0; r < rolls; r++) {
      var chosen = pickWeighted(pool);
      if (!chosen || chosen === NO_DROP) continue;      // saiu "nada"
      if (Progress.addItem(chosen)) {      // repetido vira CÓPIA (fusão) [D7][D18]
        drops.push(chosen);
      } else {
        // o saco encheu no meio da descida: a peça fica para trás, e a lista
        // viaja como propriedade do array para a tela de recompensa AVISAR
        drops.perdidos = (drops.perdidos || []).concat([chosen]);
      }
    }
    Progress.save();
    return drops;
  };

  Progress.rollPet = function (dungeonId, roomIndex, partySize) {
    if (!Progress.state) Progress.load();
    if (!isBossRoom(dungeonId, roomIndex)) return null;
    var all = D().pets || {};
    var depth = dungeonIndex(dungeonId);
    var owned = {}, hid, id, i;
    for (i = 0; i < Progress.state.pets.length; i++) owned[Progress.state.pets[i]] = true;
    for (hid in Progress.state.heroes) {
      if (Progress.state.heroes.hasOwnProperty(hid) && Progress.state.heroes[hid].pet) {
        owned[Progress.state.heroes[hid].pet] = true;
      }
    }
    var pool = [];
    for (id in all) {
      if (!all.hasOwnProperty(id) || owned[id]) continue;
      var p = all[id];
      if (!p || num(p.dropWeight, 0) <= 0) continue;
      var dd = p.dropDungeon;
      if (typeof dd === 'string' && dd !== dungeonId) continue;
      if (typeof dd === 'number' && depth < dd) continue;
      pool.push({ id: id, w: num(p.dropWeight, 0) });
    }
    if (!pool.length) return null;
    if (Math.random() >= Math.min(0.9, PET_CHANCE * luckFor(partySize))) return null;
    var chosen = pickWeighted(pool);
    if (!chosen) return null;
    Progress.addPet(chosen);
    return chosen;
  };

  // ============================================ PETS: nível, cartas e estrelas (03/09)
  /* "Quero melhorar para os pets terem levels também e conforme seu level, seu
   * bônus e dano/buff aumenta" + "o esquema de liberação igual de personagem":
   * cartas que caem do chefe (só do pet daquele calabouço, e é difícil), 5
   * cartas = o pet, e as excedentes viram estrela (10 / +15 / +20, ★ máx 3).
   * O nível vem de XP: o pet vestido recebe uma fatia do XP do dono a cada
   * vitória, até o 10. Nível e estrelas MULTIPLICAM os bônus ao dono
   * (petMult) e dão poder ao CORPO em batalha (petPower: dano, cura e buff
   * dos feitiços do pet). Tudo vive em state.petCards e state.petXp. */
  function petOwned(petId) {
    var st = Progress.state;
    if (!st) return false;
    if (indexOf(st.pets, petId) >= 0) return true;
    for (var hid in st.heroes) {
      if (st.heroes.hasOwnProperty(hid) && st.heroes[hid].pet === petId) return true;
    }
    return false;
  }
  function petCardsOwned(petId) {
    var st = Progress.state;
    return (st && isObj(st.petCards)) ? Math.max(0, Math.floor(num(st.petCards[petId], 0))) : 0;
  }
  function petXpOf(petId) {
    var st = Progress.state;
    return (st && isObj(st.petXp)) ? Math.max(0, Math.floor(num(st.petXp[petId], 0))) : 0;
  }
  function petLevelForXp(xp) {
    var lv = 1;
    for (var i = 0; i < PET_XP_TABLE.length && i < PET_MAX_LEVEL; i++) {
      if (xp >= PET_XP_TABLE[i]) lv = i + 1;
    }
    return lv;
  }
  function petStarsOf(petId) {
    var surplus = Math.max(0, petCardsOwned(petId) - PET_UNLOCK_COST);
    var stars = 0;
    for (var i = 0; i < PET_STAR_COSTS.length && i < PET_MAX_STARS; i++) {
      if (surplus >= PET_STAR_COSTS[i]) stars = i + 1;
    }
    return stars;
  }
  Progress.PET_MAX_LEVEL = PET_MAX_LEVEL;
  Progress.PET_MAX_STARS = PET_MAX_STARS;
  Progress.PET_UNLOCK_COST = PET_UNLOCK_COST;
  Progress.PET_STAR_COSTS = PET_STAR_COSTS.slice();
  Progress.PET_XP_TABLE = PET_XP_TABLE.slice();
  Progress.petOwned = function (petId) {
    return typeof petId === 'string' && !!petDef(petId) && petOwned(petId);
  };
  Progress.petLevel = function (petId) {
    return petDef(petId) ? petLevelForXp(petXpOf(petId)) : 1;
  };
  /* As estrelas do pet (0 a 3). Já eram a conta de `petCardInfo`; viraram
   * função própria porque o CORPO passou a crescer com elas (11/09): o
   * desenho não tem por que montar a ficha inteira das cartas só para saber
   * de quantas estrelas é o bicho. */
  Progress.petStars = function (petId) {
    return petDef(petId) ? petStarsOf(petId) : 0;
  };
  Progress.petXpInfo = function (petId) {
    if (!petDef(petId)) return null;
    var xp = petXpOf(petId), level = petLevelForXp(xp);
    var max = level >= PET_MAX_LEVEL;
    var base = PET_XP_TABLE[level - 1], next = max ? null : PET_XP_TABLE[level];
    return { petId: petId, xp: xp, level: level, max: max, maxLevel: PET_MAX_LEVEL,
             next: next, faltam: max ? 0 : Math.max(0, next - xp),
             frac: max ? 1 : Math.max(0, Math.min(1, (xp - base) / Math.max(1, next - base))) };
  };
  /* Soma XP a um pet que é seu; devolve quantos níveis subiu (teto 10). */
  Progress.addPetXp = function (petId, amount) {
    var st = Progress.state;
    if (!st || !petDef(petId) || !petOwned(petId)) return 0;
    var amt = Math.floor(num(amount, 0));
    if (!(amt > 0)) return 0;
    if (!isObj(st.petXp)) st.petXp = {};
    var before = petLevelForXp(petXpOf(petId));
    st.petXp[petId] = Math.min(petXpOf(petId) + amt, PET_XP_TABLE[PET_MAX_LEVEL - 1]);
    Progress.save();
    return petLevelForXp(st.petXp[petId]) - before;
  };
  /* O pet vestido recebe uma FATIA do XP que o dono acabou de ganhar. Devolve
   * {petId, xp, niveis, novoNivel} ou null (sem pet / sem ganho). */
  Progress.addPetXpFromOwner = function (heroId, ownerXp) {
    var h = Progress.hero(heroId);
    if (!h || !h.pet) return null;
    var fatia = Math.floor(num(ownerXp, 0) * PET_XP_SHARE);
    if (fatia <= 0) return null;
    var niveis = Progress.addPetXp(h.pet, fatia);
    return { petId: h.pet, xp: fatia, niveis: niveis, novoNivel: Progress.petLevel(h.pet) };
  };
  Progress.petCardInfo = function (petId) {
    var pd = petDef(petId);
    if (!pd) return null;
    var cards = petCardsOwned(petId), stars = petStarsOf(petId);
    var surplus = Math.max(0, cards - PET_UNLOCK_COST);
    var next = null;
    if (stars < Math.min(PET_MAX_STARS, PET_STAR_COSTS.length)) {
      next = { star: stars + 1, faltam: Math.max(0, PET_STAR_COSTS[stars] - surplus) };
    }
    return { petId: petId, name: pd.name, cards: cards, unlocked: petOwned(petId),
             unlockCost: PET_UNLOCK_COST, stars: stars, maxStars: PET_MAX_STARS, next: next,
             level: Progress.petLevel(petId), mult: Progress.petMult(petId) };
  };
  /* Soma cartas de um pet (nunca decresce); ao chegar em 5 o pet entra no
   * saco de bichos. Devolve o petCardInfo resultante. */
  Progress.addPetCards = function (petId, n) {
    var st = Progress.state;
    if (!st || !petDef(petId)) return null;
    var amount = Math.floor(num(n, 0));
    if (amount > 0) {
      if (!isObj(st.petCards)) st.petCards = {};
      st.petCards[petId] = petCardsOwned(petId) + amount;
      if (st.petCards[petId] >= PET_UNLOCK_COST && !petOwned(petId)) Progress.addPet(petId);
      Progress.save();
    }
    return Progress.petCardInfo(petId);
  };
  /* O multiplicador dos BÔNUS que o pet dá ao dono: nível e estrelas. */
  Progress.petMult = function (petId) {
    if (!petDef(petId)) return 1;
    var lv = Progress.petLevel(petId), s = petStarsOf(petId);
    return +((1 + PET_LEVEL_STEP * (lv - 1)) * (1 + PET_STAR_STEP * s)).toFixed(4);
  };
  /* O poder extra do CORPO do pet em batalha (dano, cura e buff dos feitiços
   * dele): +10 por nível acima do 1, +15 por estrela. */
  Progress.petPower = function (petId) {
    if (!petDef(petId)) return 0;
    return PET_POWER_PER_LEVEL * (Progress.petLevel(petId) - 1) +
           PET_POWER_PER_STAR * petStarsOf(petId);
  };
  /* Cartas de PET do chefe: só o chefe, só o pet DAQUELE calabouço, chance
   * baixa de propósito ("o drop deve ser difícil"). Devolve [] ou
   * [{petId, name, amount, cards, unlockCost, unlocked, novoPet, stars,
   * starUp, next}]. Substitui o rollPet, que entregava o bicho inteiro. */
  Progress.rollPetCards = function (dungeonId, roomIndex, partySize) {
    if (!Progress.state) Progress.load();
    if (!isBossRoom(dungeonId, roomIndex)) return [];
    var all = D().pets || {}, depth = dungeonIndex(dungeonId), pool = [];
    for (var id in all) {
      if (!all.hasOwnProperty(id)) continue;
      var p = all[id];
      if (!p || num(p.dropWeight, 0) <= 0) continue;
      var dd = p.dropDungeon;
      if (typeof dd === 'string' && dd !== dungeonId) continue;
      if (typeof dd === 'number' && depth < dd) continue;
      if (petStarsOf(id) >= PET_MAX_STARS) continue;   // ★3: carta não tem para onde ir
      pool.push({ id: id, w: num(p.dropWeight, 0) });
    }
    if (!pool.length) return [];
    if (Math.random() >= Math.min(0.5, PET_CARD_CHANCE * luckFor(partySize))) return [];
    var chosen = pickWeighted(pool);
    if (!chosen) return [];
    var antes = Progress.petCardInfo(chosen);
    var depois = Progress.addPetCards(chosen, 1);
    return [{ petId: chosen, name: depois.name, amount: 1, cards: depois.cards,
              unlockCost: depois.unlockCost, unlocked: depois.unlocked,
              novoPet: !antes.unlocked && depois.unlocked,
              stars: depois.stars, starUp: depois.stars - antes.stars, next: depois.next }];
  };

  // ========================================================= grupo de batalha
  /* Formato consumido por Engine.createBattle. Grupo de 1 ou 2 (§9-B):
   * heróis inválidos são ignorados e o excedente é cortado. */
  Progress.battleParty = function (heroIds) {
    var ids = isArray(heroIds) ? heroIds : Progress.heroIds();
    var out = [];
    for (var i = 0; i < ids.length && out.length < 2; i++) {
      var heroId = ids[i];
      var h = Progress.hero(heroId);
      if (!h) continue;
      var stats = Progress.effectiveStats(heroId);
      out.push({
        heroId: heroId,
        classId: h.classId,
        element: h.element || DEFAULT_ELEMENT,
        level: h.level,
        spells: Progress.spellsFor(heroId),
        // a CONTA dona do herói (03/09): a fusão só é permitida entre
        // unidades da mesma conta — hoje sempre a desta janela
        conta: (JOGO.Contas && JOGO.Contas.ativa) ? JOGO.Contas.ativa() : 'principal',
        pet: h.pet || null,
        petLevel: h.pet ? Progress.petLevel(h.pet) : 0,   // 03/09: o corpo do pet escala
        petStars: h.pet ? Progress.petStars(h.pet) : 0,   // 11/09: e cresce por estrela
        petMult: h.pet ? Progress.petMult(h.pet) : 1,
        petPower: h.pet ? Progress.petPower(h.pet) : 0,
        items: clone(h.items),
        itemVar: clone(h.itemVar || {}),          // forja e ★ da cópia em uso [D18]
        stars: Progress.cardInfo(h.classId).stars,
        elemPower: stats ? stats.elemPower : 0,   // §9-C: o motor consome na fórmula de dano
        stats: stats
      });
    }
    return out;
  };

  // inicializa ao carregar o script (os arquivos de DATA já rodaram)
  Progress.load();
})();
