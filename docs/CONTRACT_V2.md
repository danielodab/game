# CONTRATO TÉCNICO v2 — leia antes de escrever qualquer linha

Lei do projeto SOTERRA 2.0. Onde este documento e a intuição divergirem, vale este documento.
Visão e sistemas: `PROJETO_V2.md`. O contrato v1 (`CONTRACT.md`) descreve a versão anterior —
serve de referência histórica, **não** de especificação.

## 0. Regras gerais

- HTML5 + JS puro. **Sem ES modules** (o jogo abre por `file://`): apenas `<script>` clássico e globais.
- Todo arquivo começa com:
  ```js
  var JOGO = (typeof window !== 'undefined')
    ? (window.JOGO = window.JOGO || {})
    : (globalThis.JOGO = globalThis.JOGO || {});
  ```
- Arquivos de dados são **aditivos**: `JOGO.DATA = JOGO.DATA || {}; JOGO.DATA.spells = {...}`.
- Texto visível ao jogador em **pt-BR**; identificadores de código em inglês.
- **Nomenclatura obrigatória:** `pa` = Pontos de Ataque, `pp` = Pontos de Passos (o antigo `pm`
  **não existe mais** em nenhum lugar: nem campo, nem texto, nem comentário).
- Nada de `alert`/`prompt`. Zero erro de console. 60 fps alvo, inclusive em celular.
- **Mobile é requisito, não enfeite**: toda interação por toque, alvos ≥ 44 px, layout responsivo
  de 360 px a 1920 px, nenhuma funcionalidade dependente de `hover`.

## 1. Donos de arquivo (NUNCA edite arquivo de outro dono)

| Arquivo | Global | Dono |
|---|---|---|
| `js/core/data/elements.js` | `DATA.elements`, `DATA.weathers` | Criativo Mundo |
| `js/core/data/monsters.js` | `DATA.monsters` | Criativo Mundo |
| `js/core/data/dungeons.js` | `DATA.dungeons`, `DATA.tileEvents`, `DATA.scenery` | Criativo Mundo |
| `js/core/data/classes.js` | `DATA.classes` | Criativo Classes |
| `js/core/data/spells.js` | `DATA.spells` | Criativo Classes |
| `js/core/data/progression.js` | `DATA.leveling`, `DATA.unlockTiers`, `DATA.cards` | Criativo Classes |
| `js/core/data/fusions.js` | `DATA.fusionForms`, `DATA.fusionBlends` | Criativo Fusão |
| `js/core/data/pets.js` | `DATA.pets` | Criativo Fusão |
| `js/core/data/items.js` | `DATA.items` | Criativo Fusão |
| `js/core/engine.js` | `JOGO.Engine` | Lógica Combate |
| `js/core/fusion.js` | `JOGO.Fusion` | Lógica Combate |
| `js/core/ai.js` | `JOGO.AI` | Lógica Combate |
| `js/core/progress.js` | `JOGO.Progress` | Lógica Meta |
| `js/core/game.js` | `JOGO.Game` | Lógica Meta |
| `js/render2d/renderer.js` | `JOGO.Renderer` | Designer Render |
| `js/render2d/fx.js` | `JOGO.FX` | Designer Render |
| `js/render2d/art.js` | `JOGO.Art` | Designer Arte |
| `js/ui/hud.js` | `JOGO.UI` | Designer Arte |
| `css/style.css` | — | Designer Arte |
| `index.html`, `js/main.js` | — | Orquestrador (não mexer) |
| `tests/*` | — | livre (cada agente cria os seus) |

Vendor pronto: `vendor/pixi.min.js` (PixiJS 7.4.2 UMD, global `PIXI`).
A camada v1 (`js/render/*`, `js/render3d/*`) está **congelada**: não editar, não excluir.

## 2. Elementos, clima, esquiva

```js
DATA.elements = ['neutro','fogo','agua','terra','ar'];
DATA.rivals = { fogo:'agua', agua:'fogo', terra:'ar', ar:'terra', neutro:null };

DATA.weathers = { weatherId: { id, name, favors: 'fogo'|…|null, harms: …|null,
                               description, fxKey, palette:{...} } };
// obrigatórios: 'calmo' (favors/harms null), 'chuva'(+agua/−fogo),
// 'estiagem'(+fogo/−agua), 'vendaval'(+ar/−terra), 'tremor'(+terra/−ar)
```

- **Tique de clima**: no início do turno da unidade, `+5` PV se `weather.favors === unit.element`,
  `−5` PV se `weather.harms === unit.element`. Nunca ultrapassa `hpMax`; a perda **pode matar**.
  Emite `weatherTick {uid, amount}`.
- **Esquiva/Fixação**: ao sair de célula adjacente a inimigo vivo:
  `chance = clamp(0.10, 0.90, 0.35 + (dodge - lock)*0.02 + bônusElemental)`, onde
  `bônusElemental = +0.30` se o inimigo é do elemento **rival** do fugitivo, `+0.10` se não
  relacionado (um dos dois neutro / pares diferentes), `0` se mesmo elemento.
  Falha: perde todo o PP restante (e 1 PA se `roll < chance/3`). Emite `dodgeFail {uid, lockerUid}`
  ou `dodgeOk {uid}`. `Engine.reachable` considera o risco mas **não** o impede.

## 3. Classes, feitiços e progressão

```js
DATA.classes = { classId: { id, name, role, description, lore,
    palette:{primary,secondary,accent},
    stats:{ hp, pa, pp, initiative, power, dodge, lock,
            resists:{fogo:0,agua:0,terra:0,ar:0,neutro:0} },
    baseSpells:['id','id','id'],                  // exatamente 3, elemento 'neutro'
    paths: { fogo:['id×6'], agua:[…], terra:[…], ar:[…] },  // 6 ids, na ordem dos níveis
    startsUnlocked: bool, cardRarity:'comum'|'raro'|'epico' } };
```
Classes obrigatórias: `sumo` (tanque), `arqueiro` (atirador), `bruxo` (mago),
`espadachim` (assassino), `curandeira` (suporte), `invocador`. Exatamente **2** com
`startsUnlocked: true`.

```js
DATA.unlockTiers = [5,10,12,15,20,30];   // nível de desbloqueio de cada feitiço de caminho
DATA.leveling = { maxLevel:30, xpTable:[…30 entradas acumuladas…],
                  perLevel:{ hp, power }, elementChoiceLevel:5 };
DATA.cards = { classId: { dropWeight, minDungeon } };   // carta que libera a classe
```

### Feitiço

```js
DATA.spells = { spellId: { id, name, element, classId|null, unlockLevel,   // 0 = inicial
    paCost, cooldown, castsPerTurn,                        // 0 = ilimitado
    range:{ min, max, line:bool, los:bool, movable:bool }, // movable: alcance cresce com PP? não — reservado
    aoe:{ shape:'single'|'cross'|'circle'|'line'|'cone'|'ring', size },
    needsEmptyTile:bool, targetSide:'any'|'enemy'|'ally'|'self',
    effects:[ Effect… ], description, flavor, fxKey } };
```

### Vocabulário FECHADO de efeitos

Herdado da v1 (implementado e testado) — mantido igual:
`damage{element,min,max,lifesteal?}` · `heal{min,max}` · `shield{value,duration}` ·
`buff{stat:'pa'|'pp'|'power'|'initiative'|'dodge'|'lock',value,duration}` ·
`resist{element,value,duration}` · `push{tiles}` · `pull{tiles}` · `teleport` · `swap` ·
`poison{element,min,max,duration}` · `regen{min,max,duration}` · `summon{monsterId}` ·
`taunt{duration}` · `invisible{duration}`

**Novos na v2** (a Lógica implementa exatamente estes; o Criativo usa somente estes):
```js
{ type:'root', duration }                       // 0 PP (prende); não impede conjurar
{ type:'mark', value, duration, max }           // marca acumulável: +value% de dano recebido por pilha
{ type:'detonateMarks', mult }                  // consome as marcas do alvo: dano = pilhas*mult
{ type:'trap', trapId, duration }               // arma armadilha na célula (DATA.spells[trapId] dispara ao pisar)
{ type:'weatherShift', weather }                // troca o clima da sala
{ type:'cleanse', kinds:['poison','root',…] }   // remove efeitos dos tipos citados
{ type:'reflect', pct, duration }               // devolve % do dano recebido ao agressor
{ type:'dispelShield' }                          // remove escudo do alvo
{ type:'moveTo', maxTiles }                     // conjurador desliza até a célula alvo (investida)
{ type:'chain', jumps, falloff, element, min, max } // salta entre inimigos próximos
```

**Dano**: `roll(min..max) * (100+power)/100 * (100−resist[element])/100 * (1 + marcas*0.05)`,
arredondado. Escudo absorve antes do PV.

## 4. Fusão — sistema de composição

```js
DATA.fusionForms = { 'classA+classB': [   // chave com as duas classes em ordem alfabética
    { tier:0|5|10|12|15|20|30, formName:'Furacão',      // fragmento nominal (substantivo)
      paCost, cooldown, range:{…}, aoe:{…}, targetSide,
      mechanic:[ Effect… ],        // efeitos SEM elemento definido: use element:'@A' e '@B'
      description, fxShape } , … ] };   // 7 formas por dupla (tiers 0,5,10,12,15,20,30)

DATA.fusionBlends = { 'elemA+elemB': {   // 15 combinações (inclui iguais e neutro)
    affix:'Salgado',                     // fragmento adjetival do nome
    elements:['ar','agua'],              // '@A' vira elements[0], '@B' vira elements[1]
    rider:[ Effect… ],                   // efeito extra característico da mistura
    palette:{…}, fxKey } };
```

**Algoritmo (implementado por `JOGO.Fusion.spellsFor`)**: para a dupla de classes `K`, a dupla de
elementos `E` e o nível `L` da fusão, para cada forma com `tier ≤ L`:
```
nome      = `${form.formName} ${blend.affix}`
efeitos   = form.mechanic (com '@A'/'@B' resolvidos por blend.elements) + blend.rider
poder     = escala pelo tier e pelo nível da fusão
```
Se qualquer fundido tiver `element === 'neutro'` (nível < 5), a mistura usada é a de chave
com `neutro`. O resultado é um objeto de feitiço **no mesmo formato** de `DATA.spells`, com
`id = 'fus:'+K+':'+E+':'+tier` — gerado em memória, nunca gravado em arquivo.

### Regras de fusão (`JOGO.Fusion`)

```js
Fusion.canFuse(state, uidA, uidB) -> bool        // aliados vivos, adjacentes, nenhum já fundido
Fusion.declare(state, uidA, uidB) -> bool        // gasta FUSION_PA_COST (2) de A, marca intenção
Fusion.resolve(state)                            // chamado no fim do turno de A: se ainda adjacentes, funde
Fusion.spellsFor(classPair, elemPair, level) -> [spell…]
Fusion.split(state, uid)                         // desfaz ao morrer: some (não devolve os dois)
```
Ao fundir: `hp = hpA + hpB` (e `hpMax` idem), `pa = paBase+2`, `pp = ppBase+1`, `shield += 50`,
`level = floor((lvA+lvB)/2)`, `initiative = max`, resistências = média, aparência combinada
(`defId = 'fus:'+classA+'+'+classB`). Emite `fusion {uid, from:[uidA,uidB], classPair, elemPair, level}`.
A unidade fundida ocupa a célula de A; B sai do tabuleiro (não conta para derrota).

## 5. Pets

```js
DATA.pets = { petId: { id, name, element, description,
    bonuses:{ hp?, pa?, pp?, power?, initiative?, dodge?, lock?, resists?:{…} },
    behavior:'attack'|'support'|'guard', range, spells:['id'…],
    followDistance,           // máximo de células do dono (padrão 2)
    dropDungeon, dropWeight } };
```
Mínimo **5 pets** com temas distintos. O pet entra na batalha junto do dono como unidade
`kind:'pet'`, `side` do dono, **não conta** para vitória/derrota, não recebe XP e **age
automaticamente logo após o dono encerrar o turno** (`Engine.runPetTurn(state, ownerUid)`),
sempre reposicionando-se para ficar a ≤ `followDistance` do dono.

## 6. Terreno e eventos

```js
// layout de sala: cada linha é uma string do mesmo comprimento (grades de 13×11 a 17×15)
// '.' chão · ',' chão decorado · '#' obstáculo ALTO (bloqueia passagem e visão)
// '=' obstáculo BAIXO (bloqueia passagem, NÃO bloqueia visão) · '~' vazio/buraco
// 'P' spawn de herói (≥3) · letras a–z = spawn de monstro
DATA.scenery = { themeId: { high:['nomeVisual'…], low:[…], floor:[…], props:[…] } };

DATA.tileEvents = { eventId: { id, name, kind:'buff'|'mystery'|'portal'|'drain'|'fountain',
    icon, weight, duration,            // rodadas até sumir
    effects:[ Effect… ] | outcomes:[ {weight, effects:[…], text} ] } };  // outcomes = '?' surpresa
```
`Engine` sorteia até `spawnPerRound` (padrão 1) eventos por rodada em células livres, conforme
`dungeon.tileEventRate`. Pisar na célula dispara e consome o evento (`tileEvent {uid, eventId, text}`).

## 7. Calabouço

```js
DATA.dungeons = [ { id, name, theme, description, difficulty, order,
    palette:{…}, defaultWeather, weatherShiftEveryRounds:0,   // 0 = fixo
    tileEventRate, lootTable:[{itemId,weight,minRoom}], cardDrops:[{classId,weight}],
    rooms:[ { name, weather, layout:[…], monsters:{a:'monsterId'…}, sceneryTheme } ] } ];
```
**6 calabouços**, 3 salas cada (2 + chefe), dificuldade crescente por `order`.

## 8. Itens (4 espaços + pet)

```js
// slots: ver §9-C (punho/passo/casca/lume). Raridades: comum · raro · epico · lendario
// (a 4ª nasceu com o Traje do Coração; a apresentação PRECISA ter cor e rótulo próprios
//  para ela — sem isso a peça mais rara do jogo aparece com a cor de comum).
DATA.items = { itemId: { id, name, slot:'pa'|'pp'|'vida'|'especial', rarity:'comum'|'raro'|'epico'|'lendario',
    dungeonId, bonuses:{…}, grantsSpell:'spellId'|null,   // obrigatório no slot 'especial'
    description, flavor, iconKey } };
```
Sanidade: `slot:'pa'` concede **no máximo +1 PA** (só `epico`); `slot:'pp'` no máximo +1 PP;
`vida` de +10 a +60 PV e resistências; `especial` concede feitiço e **nenhum** bônus de PA/PP.

## 9. APIs

### `JOGO.Engine` (Lógica Combate)
Tudo da v1 (`createBattle/reachable/path/move/castTargets/aoeTiles/cast/endTurn/activeUnit/unitAt/events`)
com as extensões: `state.weather`, `state.tileEventsActive[]`, teste de esquiva no `move`,
tique de clima no `turnStart`, `Engine.runPetTurn(state, ownerUid)`, `Engine.triggerTrap(state, uid, x, y)`.
`createBattle(dungeonId, roomIndex, party)` onde `party = [{heroId, classId, element, level, spells, pet, items}]`
vem de `Progress.battleParty()`.

**Novos eventos**: `weatherTick{uid,amount}` · `weatherShift{weather}` · `dodgeFail{uid,lockerUid}` ·
`dodgeOk{uid}` · `fusion{…}` · `petAct{uid,action}` · `tileEvent{uid,eventId,text}` ·
`trapTriggered{uid,trapId}` · `markStack{uid,stacks}` · `timerTick{remaining,banked}`.

### `JOGO.Progress` (Lógica Meta)
v1 mais: `state.unlockedClasses[]`, `state.heroes[heroId] = {classId, element, xp, level, spells[], items{pa,pp,vida,especial}, pet}`,
`Progress.chooseElement(heroId, element)` (só no nível ≥ 5, irreversível),
`Progress.spellsFor(heroId)` (3 base + desbloqueados + `grantsSpell` do item especial),
`Progress.unlockClass(classId)`, `Progress.rollCards(dungeonId, roomIndex, partySize)`,
`Progress.equipPet(heroId, petId)`, `Progress.battleParty(heroIds)`.
Save `localStorage['soterra-save-v2']`, migrando/ignorando o v1 com segurança.

### `JOGO.Game` (Lógica Meta)
v1 mais: **cronômetro** — `Game.turnTime` (30 s), `Game.banked` (acumulado), `Game.timeLeft()`,
expiração encerra o turno automaticamente; `Game.declareFusion(uidA, uidB)`;
`Game.selectSpell` com **cancelamento**: clique fora da zona válida ⇒ desmarca o feitiço e
devolve o modo de movimento (nunca gasta a ação).

### `JOGO.Renderer` (Designer Render) — PixiJS
`init(canvasOuContainer)` · `render(dt)` · `handleEvent(ev)` · `isBusy()` · `project(x,y)` ·
`setCamera({zoom,panX,panY})`. Isométrico fixo; **arrastar = deslocar (pan)**, pinça/roda = zoom,
toque curto = ação na célula. Entrada por `pointerdown/move/up` (mouse e toque no mesmo caminho).
Overlays: alcance, caminho, alvos, área, eventos de terreno, zona do pet, aviso de esquiva.

### `JOGO.UI` (Designer Arte)
v1 mais: escolha de elemento no nível 5, árvore de feitiços por caminho, painel de 4 espaços +
pet, cartas de personagem ganhas, cronômetro do turno, botão de **Fusão** quando disponível,
e layout que funciona em **retrato de celular**.

## 9-B. ADENDO v2.1 — Grupo de 2, coleção de cartas, estrelas, conjuntos e forja

Esta seção **substitui** o que a contrariar nas seções anteriores.

### Grupo: 1 ou 2 heróis (não mais 3)
`Game.startRun` e `Progress.battleParty` aceitam **1 ou 2**. Sorte de saque: `LUCK = 2.4` (solo) · `1.6` (dupla).
Consequência de design: com 2 heróis, **a fusão transforma a dupla numa única unidade** — troca de economia
de ações por poder concentrado. Layouts continuam válidos (spawns 'P' sobrando são ignorados).

### Classes iniciais
Começam liberadas **`sumo` (tanque)** e **`curandeira` (cura)**. `arqueiro` passa a ser desbloqueável.

### Cartas acumulativas e estrelas

```js
DATA.cards = { classId: { unlockCost, dropWeight, minDungeon, starCosts:[5,15,30,55,90] } };
DATA.stars = { max:5, bonuses: { 1:{hp:15}, 2:{power:8}, 3:{pp:1}, 4:{hp:25,dodge:10}, 5:{pa:1} } };
```
- **Custo de desbloqueio (fixado pelo usuário)**: `sumo` 0 · `curandeira` 0 · `invocador` 10 · `bruxo` 10 ·
  `espadachim` 20 · `arqueiro` 25. Cartas caem **aleatoriamente** dos chefes; repetidas **acumulam**.
- `Progress.state.cards[classId] = n` (total acumulado, nunca decresce).
- Classe **liberada** quando `cards[classId] >= unlockCost` (as iniciais já nascem liberadas).
- **Estrelas** (máx. 5) por classe: contadas sobre as cartas **excedentes** ao custo de desbloqueio,
  conforme `starCosts` acumulados. Os bônus de estrela são **fixos e permanentes**, somados em
  `Progress.effectiveStats` — `pp` e `pa` de estrela são somas inteiras ao máximo da unidade.
- API: `Progress.addCards(classId, n)` · `Progress.cardInfo(classId) -> {cards, unlocked, unlockCost, stars, next:{star,faltam}}`.

### Inventário ÚNICO e conjuntos elementais

- **Um inventário só, compartilhado por todos os personagens** (`Progress.state.inventory`).
  Um item equipado por um herói **não pode** estar equipado em outro ao mesmo tempo
  (`Progress.equip` recusa e informa quem o está usando).
- Item ganha `setId` e `element`. O **elemento do conjunto vem do elemento do monstro** que o derruba.
```js
DATA.sets = { setId: { id, name, element, dungeonId, pieces:['itemId'…],   // 4 peças (pa/pp/vida/especial)
                       bonuses:{ 2:{…}, 3:{…}, 4:{…} } } };                // progressivo
```
`Progress.effectiveStats` soma os bônus de conjunto conforme quantas peças do mesmo `setId` estão equipadas.
Itens raros têm peso de saque menor (a raridade já existente controla isso).

### Forja: pedras e evolução até +10

```js
DATA.stones = { stoneId: { id, name, element, description, iconKey } };   // 5: uma por elemento
DATA.upgrade = {
  maxLevel: 10,
  tiers: [ {from:0,to:2,name:'Comum'}, {from:3,to:5,name:'Raro'},
           {from:6,to:9,name:'Supremo'}, {from:10,to:10,name:'Magnífico'} ],
  bonusPerLevel: 0.12,          // +12% dos bônus base por nível ⇒ +10 = 2,2× o item
  stoneCost: [2,3,4,6,8,10,13,16,20,25]   // custo em pedras do nível 1..10
};
```
- Monstros derrubam **pedras do próprio elemento** (`monster.stoneDrop = {chance, min, max}`).
- Melhorar um item **consome pedras do elemento do item** (item neutro aceita qualquer pedra).
- Evolução é **determinística** (nunca quebra nem regride).
- `Progress.state.stones = {stoneId: n}`; item no inventário vira `{itemId, level}` (compatível: string = nível 0).
- API: `Progress.upgradeItem(invIndex)` · `Progress.upgradeInfo(invIndex) -> {level, tierName, custo, temPedras}`
  · `Progress.addStones(stoneId, n)`. `effectiveStats` aplica `1 + bonusPerLevel*level` aos bônus do item.

### UI correspondente (Designer Arte)
Tela de **Coleção** (cartas por classe com progresso `n/custo` e trilha de 5 estrelas), **Inventário único**
(itens com raridade, nível `+N`, tier e conjunto; indicação de quem está usando cada peça), **Forja**
(pedras por elemento, custo, prévia do ganho) e seleção de **1 ou 2 heróis**.

## 9-C. ADENDO v2.2 — Espaços com identidade e ganho elemental por nível

Esta seção **substitui** o que a contrariar nas anteriores.

### Os 4 espaços de equipamento ganham nome próprio
Os ids `pa`/`pp`/`vida`/`especial` são **substituídos** (nada de nomes de planilha, e nada que
imite o Dofus). Novos ids de `slot`, em todo o projeto:

| slot (id) | Nome exibido | O que é | Bônus que carrega |
|---|---|---|---|
| `punho` | **Punho** | o que golpeia: manopla, garra, empunhadura | PA (máx. +1, só épico) |
| `passo` | **Passo** | o que anda: botas, esporas, grevas | PP (máx. +1) |
| `casca` | **Casca** | o que protege: couraça, carapaça, manto | Vida (+10 a +60) e resistências |
| `lume` | **Lume** | a relíquia acesa que se carrega no escuro | concede um feitiço (`grantsSpell`), sem PA/PP |

Afeta: `DATA.items[*].slot`, `DATA.sets[*].pieces` (4 peças, uma por espaço),
`Progress.state.heroes[*].items = {punho, passo, casca, lume}`, `Progress.equip/unequip`,
`DATA.upgrade.nonScalingKeys` continua `['pa','pp']` (são nomes de **bônus**, não de espaço),
e os rótulos da UI. O espaço de **pet** continua separado dos quatro.

### Ganho por nível ligado ao elemento

```js
DATA.leveling.perLevel        = { hp: 5, power: 3 };        // níveis 1→4, antes de escolher
DATA.leveling.perLevelElement = { hp: 5, elemPower: 3 };    // a partir da escolha (nível 5+)
```
- **Todo nível dá +5 PV.**
- Antes de escolher o elemento: cada nível dá **+3 de poder genérico**.
- A partir da escolha: cada nível dá **+3 de dano naquele elemento** (`elemPower`), acumulando.
- `Progress.effectiveStats` devolve, além de `power`, o campo **`elemPower`** e o `element` do herói.
- **Fórmula de dano (atualiza §3)**: o bônus elemental só entra quando o feitiço é do elemento
  do conjurador —
  `roll(min..max) * (100 + power + (spell.element === unit.element ? elemPower : 0))/100 * (100 − resist[element])/100 * (1 + marcas*0.05)`.
- A unidade em batalha carrega `elemPower` (0 quando não há). Na **fusão**, `elemPower` é a média
  dos dois e vale para os dois elementos da mistura.

## 9-D. ADENDO v2.3 — Subir de nível custa, e a profundidade paga

Pedido do usuário: *"para upar também não pode ser tão fácil; conforme vai para calabouço com
níveis mais altos vai dificultando e dando a XP mais alta"*. Duas engrenagens:

### 1. Cada calabouço tem faixa de nível e paga proporcional
```js
DATA.dungeons[i].recommendedLevel = n;   // 1:3 · 2:7 · 3:11 · 4:16 · 5:22 · 6:28
```
O `xp` dos monstros cresce com a profundidade de modo que **uma descida completa (3 salas), no
nível recomendado, renda aproximadamente 1 nível no começo do jogo e cerca de 1/3 de nível a
partir do nível 25** — a XP absoluta sobe muito, mas a exigência sobe mais.

### 2. Rendimento decrescente ao repetir conteúdo fácil
Ao ganhar XP, aplica-se um multiplicador conforme a distância entre o nível do herói e o nível
recomendado do calabouço:
```js
DATA.leveling.xpFalloff = { graceLevels: 4, factorPerLevel: 0.75, floor: 0.10 };
// nivel <= recommended+4  ⇒ ×1.0
// cada nível acima disso  ⇒ ×0.75 acumulativo, nunca abaixo de ×0.10
```
Isso torna **descer mais fundo o único caminho eficiente** para subir, sem bloquear ninguém:
moer o primeiro calabouço continua possível, só deixa de compensar. O mesmo multiplicador **não**
se aplica a itens, pedras nem cartas (essas seguem suas próprias regras de raridade).
`Game` informa o multiplicador aplicado no pacote de recompensa (`xpMult`) para a UI poder
explicar ao jogador por que ganhou menos.

## 9-E. ADENDO v2.4 — Rotação de câmera em 90°

O tabuleiro isométrico 2D ganha **rotação em quatro posições fixas** (0°, 90°, 180°, 270°) — não
é órbita livre (impossível com arte 2D em 4 direções), e sim o giro de quarto de volta dos
isométricos clássicos.

- `Renderer.setCamera({ rot: 0|1|2|3, zoom, panX, panY })` e `Renderer.rotate(+1|-1)`.
- Ao girar: a projeção de `(x,y)` roda o quarto de volta correspondente, a ordenação por
  profundidade acompanha, e **a direção aparente de cada unidade muda** — a arte já entrega as 4
  direções (SE/SW/NE/NW), então a vista mostrada é `(facingMundo + rot) mod 4`.
- Transição **animada** (~250 ms) entre as posições, com a célula central preservada.
- Controles: botão na HUD (dois: girar horário/anti-horário) e **gesto de dois dedos girando** no
  celular. Nunca por arrasto simples — arrastar continua sendo pan.
- **Valor tático**: obstáculos ALTOS escondem o que está atrás; girar revela. `Game.onTileClicked`
  continua recebendo coordenadas do MUNDO — a conversão é interna ao renderizador (o raycast/hit
  test precisa inverter a rotação atual).
- A HUD indica a orientação atual (uma bússola simples ou marca no canto), para o jogador não se
  perder.

## 9-F. ADENDO v2.5 — Salas maiores, mapa fixo

- **Tamanho das salas**: a faixa passa de 13×11–17×15 para **17×15 a 23×19**, crescendo com a
  profundidade do calabouço; a sala do chefe é a maior do seu calabouço.
- **Divisórias temáticas**: o espaço extra precisa virar estrutura, não vazio — corredores, salões,
  gargalos, coberturas baixas (`=`) para atirar por cima e rotas alternativas, tudo com a linguagem
  visual do tema (canteiros e treliças, canais e comportas, fornalhas e trilhos, andaimes e vãos,
  vagonetes e escoras, fendas e pilares partidos).
- **Ritmo preservado**: com PP 3–4, spawns em cantos opostos viram caminhada morta. Spawns mais
  próximos do miolo, monstros em 2–3 grupos, eventos de terreno espalhando o movimento.
  Densidade de obstáculos entre **12% e 30%** das células; distância média entre os heróis e o
  grupo inimigo mais próximo entre **4 e 7 células**.
- **O MAPA É FIXO; QUEM SE MOVE É A CÂMERA.** Pivô de órbita fixo no centro, sem deriva ao arrastar;
  chão estendido até as bordas da tela com névoa ao longe; ambiente ancorado no mundo (nada preso à
  tela além da UI). A sensação-alvo é *"eu ando ao redor do campo"*, nunca *"o campo gira na minha mão"*.
- **Enquadramento**: a câmera nasce mostrando o grupo e o primeiro grupo inimigo — não a sala inteira
  reduzida. No celular, a célula nunca fica abaixo de ~44 px: a câmera aproxima em vez de mostrar tudo.

## 9-G. ADENDO v2.6 — A escada da fusão passa a bater com a das classes

**Como estava.** A classe ganhava feitiço nos níveis 5, 10, 12, 15, 20 e 30. A fusão ganhava
forma nos níveis 0, 5, 12, 20 e 30. Consequência medida na página `tests/liberacao.html`: entre
o nível 12 e o 19 uma dupla fundida não ganhava **nada**, enquanto cada um dos dois heróis
separados ganhava dois feitiços no mesmo intervalo. Fundir ficava pior quanto mais se subia.

**Como fica.** `DATA.fusionForms[dupla]` passa a ter **7 formas**, nos tiers
`0, 5, 10, 12, 15, 20, 30` — as mesmas marcas da progressão de classe, mais o tier 0 que
existe desde o instante da fusão. São 15 duplas × 7 formas = **105 formas autorais** e
15 × 25 × 7 = **2.625 composições**.

**Regras que os degraus novos respeitam** (as mesmas de antes, já cobradas por
`tests/validate_fusion.html`):

- todo `formName` continua substantivo masculino singular, e continua **único em todo o sistema**;
- toda forma `riderMode:'offense'` carrega `'@A'` ou `'@B'` na mecânica — senão a mistura
  elemental não pinta nada nela;
- em **qualquer** nível, o conjunto de formas disponíveis mantém pelo menos
  `min(2, ceil(n/2))` ofensivas: uma dupla fundida luta sozinha em campo e não pode ficar
  só com apoio na mão;
- forma de alvo aliado precisa ter `range.min === 0`, para servir ao próprio corpo fundido.

**Novidade mecânica.** Os degraus 10 e 15 são os únicos que usam as áreas `cross`, `cone` e
`ring` do motor — implementadas em `Engine` desde a v2 e até aqui nunca aproveitadas pela fusão.
O `ring` é coroa vazada: acerta a distância exata e **poupa quem está colado**, o que dá à
fusão uma ferramenta de posicionamento que ela não tinha.

**Contagem que os testes cobram** deixa de ser um número cravado e passa a nascer do dado
(`duplas × TIERS.length`): o "75 formName únicos" cravado no teste virou falha sozinho no dia
em que a escada mudou.

## 9-H. ADENDO v2.7 — A esquiva deixa de ser estatística morta

Pedido do usuário: *"subir com o nível dependendo da classe sobe mais. por exemplo o arqueiro e
assassino tem mais esquiva e o tank já prende mais.. ou pode ser por equipamento também"*.

**Como estava.** `dodge` e `lock` saíam de `DATA.classes[*].stats` e **nunca mais mudavam**:
nenhum nível, nenhum caminho elemental, nenhum feitiço os tocava. O Bárbaro tinha esquiva 5 no
nível 1 e esquiva 5 no nível 30. Do outro lado, a fixação dos monstros vai de 4 (bicho fraco) a
55 (chefe final), e a Vergasta — **segunda sala do primeiro calabouço** — já prende com 26.
Com a fórmula do §2 (`0,35 + (esquiva − fixação)×0,02`, entre 0,10 e 0,90), o resultado medido
era: contra a Vergasta o Bárbaro falhava 90% das vezes; contra qualquer chefe, 90%; e o nível 30
era **idêntico** ao nível 1. A punição do §2 é dura de propósito (falhar custa TODO o PP do turno
e a unidade não sai do lugar), mas o jogador não tinha nenhuma alavanca para responder a ela.

### 1. A curva por nível, com ritmo por PAPEL

`DATA.leveling.defenseByRole` (novo) dá a cada `role` um **destino no nível máximo**. A base
continua sendo o nível 1, e a caminhada é reta:

```js
efetivo = base + round((alvo − base) × (nível − 1) / (maxLevel − 1))
```

| papel | classe | esquiva nv1 → nv30 | fixação nv1 → nv30 |
|---|---|---|---|
| `assassino` | Ladino (espadachim) | 30 → **40** | 10 → 16 |
| `atirador` | Batedor (arqueiro) | 25 → **38** | 10 → 16 |
| `suporte` | Paladina (curandeira) | 20 → 28 | 5 → 12 |
| `mago` | Bruxo | 15 → 24 | 5 → 10 |
| `invocador` | Xamã | 12 → 20 | 15 → 30 |
| `tanque` | Bárbaro (sumo) | 5 → 10 | 40 → **70** |

- **Nível 1 é exatamente a base** — a regra de fixação precisa morder cedo, é assim que o jogador
  aprende que encostar num inimigo é um compromisso. A curva não alivia o começo do jogo.
- A chave é o **papel**, não o id da classe: uma sétima classe herda o ritmo do papel que escolher.
- Alvo **igual ou abaixo** da base vale ganho 0 — a curva nunca encolhe uma classe.
- A conta entra **antes** dos itens, conjuntos, pet e estrelas, que continuam somando por cima.
- Vive em dois lugares que têm de concordar: `Progress.effectiveStats` (caminho oficial) e
  `Engine.heroStats` (rede de quem chama `createBattle` sem `stats`). `Progress.defenseAtLevel(classId, nível)`
  expõe a curva para a UI sem precisar montar herói.

**Por que estes números e não outros.** A janela útil da fórmula do §2 tem só **40 pontos**
(de −12,5 a +27,5 em `esquiva − fixação` é o que separa o piso de 10% do teto de 90%), e a
fixação dos monstros ocupa 51 pontos. Não cabe uma curva que seja generosa contra o bicho fraco
e relevante contra o chefe: escolhemos calibrar pela **fixação mediana do último calabouço (20)**
e pela **fixação do chefe final (55)**. Sem equipamento, no nível 30 e no caso elemental mais
comum: atirador 81% · assassino 85% · suporte 61% · mago 53% · invocador 45% · **tanque 25%**;
e contra o chefe, **todos entre 10% e 15%**. O tanque continuar ruim de fugir é o desenho, não
uma sobra.

**Uma base mudou.** `espadachim.stats.dodge` caiu de **40 para 30**. 40 era o teto do esquema de
`validate_classes` e não deixava espaço nenhum para curva: a classe mais escorregadia do jogo era
a única sem para onde crescer. Ela continua a maior esquiva base do elenco em todos os níveis, e
o alvo do papel `assassino` devolve o 40 no nível 30. Nenhuma outra base foi tocada.

**A fixação vista do outro lado.** `lock` é o que o herói faz *com* o inimigo, e é aí que o tanque
recebe o prêmio de identidade: de 40 para 70. O monstro mais escorregadio do jogo (Arauta da
Rajada, esquiva 36) escapava dele 37% das vezes e passa a escapar **10%** — o piso — a partir do
nível 15. Ele não corre; ele impede que corram.

### 2. O espaço **Passo** é onde a esquiva se compra

Toda peça de `slot: 'passo'` passa a conceder **esquiva** — é o único espaço que concede, e
completa a resposta do usuário ("ou pode ser por equipamento também"). Três das doze peças não
davam nada (Escarpins da Baronesa, Solados de Escória, Grevas de Minério).

- Escada por **profundidade**: 8/10 na Estufa · 10/12 na Cisterna · 12/14 nos Andaimes e no
  Fecho · 12 na Mina · 10/16 no Coração Partido.
- Dentro do **mesmo calabouço**, o mais raro leva **+2** — pequena exceção à lei do `items.js`
  ("raridade não é poder"), sem a qual o "raro" do espaço vira downgrade.
- As três peças que também carregam **fixação** (Grilhões de Forja, Grevas de Minério,
  Tornozeleiras de Cinza) ficam um degrau abaixo em esquiva: pagaram no outro lado.
- **Teto de 16 por peça.** Acima disso o herói de nível 30 escapa do chefe com moeda honesta e a
  sala de chefe deixa de ser um compromisso.

### 3. O que NÃO mudou, de propósito

- **O chefe continua segurando.** Sem equipamento, nenhuma classe passa de 15% contra a fixação
  55, em nenhum nível. Isso é temático e fica.
- A `xpTable` e o `xp` dos monstros continuam **congelados** (§9-D) — nada aqui os toca.
- A fórmula do §2, o bônus elemental (0 / +0,10 / +0,30) e a punição da falha continuam iguais.
- **Ressalva registrada:** o teto do fim de jogo continua sendo o *equipamento*, não o nível. Um
  Ladino de nível 30 com a bota lendária chega a 56 de esquiva e escapa do chefe final em 47% —
  na v2.6 esse mesmo caso já dava 43%, então o adendo mexeu 4 pontos. Quem realmente estoura a
  conta são os **conjuntos** (um conjunto de ar completo soma +44 de esquiva, cumulativo por
  peça) e a estrela ★4 (+10). Se um dia isso incomodar, o conserto é lá — não na curva de nível.

## 10. Testes obrigatórios

Cada dono entrega sua página em `tests/` (padrão v1: roda no load, resultado no DOM e em
`window.TEST_RESULTS = {passed, failed, failures[]}`). Cobertura mínima: validação de todos os
dados contra estes esquemas; clima (tiques, mudança, morte por clima); esquiva com os três casos
elementais; fusão (composição de feitiço, soma de vida, bônus, nível médio, cancelamento por
afastamento); pets (age após o dono, respeita distância); eventos de terreno; cronômetro com
acúmulo; desbloqueio por nível e escolha de elemento; itens dos 4 espaços; e um **auto-play IA×IA
em todas as salas dos 6 calabouços** sem exceção.
