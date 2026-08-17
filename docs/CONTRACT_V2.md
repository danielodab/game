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
    { tier:0|5|12|20|30, formName:'Furacão',            // fragmento nominal (substantivo)
      paCost, cooldown, range:{…}, aoe:{…}, targetSide,
      mechanic:[ Effect… ],        // efeitos SEM elemento definido: use element:'@A' e '@B'
      description, fxShape } , … ] };   // 5 formas por dupla (tiers 0,5,12,20,30)

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
DATA.items = { itemId: { id, name, slot:'pa'|'pp'|'vida'|'especial', rarity:'comum'|'raro'|'epico',
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

## 10. Testes obrigatórios

Cada dono entrega sua página em `tests/` (padrão v1: roda no load, resultado no DOM e em
`window.TEST_RESULTS = {passed, failed, failures[]}`). Cobertura mínima: validação de todos os
dados contra estes esquemas; clima (tiques, mudança, morte por clima); esquiva com os três casos
elementais; fusão (composição de feitiço, soma de vida, bônus, nível médio, cancelamento por
afastamento); pets (age após o dono, respeita distância); eventos de terreno; cronômetro com
acúmulo; desbloqueio por nível e escolha de elemento; itens dos 4 espaços; e um **auto-play IA×IA
em todas as salas dos 6 calabouços** sem exceção.
