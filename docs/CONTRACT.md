# CONTRATO TÉCNICO DO PROJETO — leia antes de escrever qualquer código

Jogo tático por turnos em grade isométrica, focado em calabouços (sem mundo aberto).
100% HTML5 + JavaScript puro (sem bibliotecas externas, sem imagens — toda arte é desenhada em canvas por código).
O jogo deve abrir direto via `file://` (sem servidor), portanto **NÃO usar ES modules** — apenas scripts clássicos e globais.

Idioma de todo texto visível ao jogador: **português (pt-BR)**. Identificadores de código: inglês.

## Namespace global

Todo arquivo JS começa com:

```js
var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});
```

Módulos e donos (NUNCA edite arquivo de outro dono):

| Arquivo | Global | Dono |
|---|---|---|
| `js/core/data.js` | `JOGO.DATA` | Agente Criativo |
| `js/core/engine.js` | `JOGO.Engine` | Agente de Lógica |
| `js/core/ai.js` | `JOGO.AI` | Agente de Lógica |
| `js/core/game.js` | `JOGO.Game` | Agente de Lógica |
| `js/render/sprites.js` | `JOGO.Sprites` | Agente Designer |
| `js/render/fx.js` | `JOGO.FX` | Agente Designer |
| `js/render/renderer.js` | `JOGO.Renderer` | Agente Designer |
| `js/ui/hud.js` | `JOGO.UI` | Agente Designer |
| `css/style.css` | — | Agente Designer |
| `index.html`, `js/main.js` | — | Orquestrador (não mexer) |
| `tests/*` | — | livre (cada agente cria os seus) |

`index.html` carrega os scripts na ordem da tabela acima e fornece `<canvas id="game-canvas">` e `<div id="ui-root">`.
`js/main.js` roda o loop: a cada frame drena `JOGO.Engine.events` chamando `Renderer.handleEvent`, `FX.handleEvent`, `UI.handleEvent`, `Game.handleEvent` (as que existirem), depois `Game.update(dt)`, `UI.update(dt)`, `Renderer.render(dt)`.

## Regras do jogo (fixas)

- Jogador escolhe **3 heróis** dentre 5 (um por raça). Combate: time do jogador vs monstros.
- Turnos por iniciativa. Cada unidade tem **PA** (pontos de ação, gasto em feitiços) e **PM** (pontos de movimento, 1 por célula). PA/PM renovam no início do turno da unidade.
- Movimento ortogonal (sem diagonal), sem atravessar paredes, buracos ou unidades.
- Calabouço = sequência de **3 salas** (2 normais + chefe). Vitória na sala → próxima sala (heróis curam 50% do HP perdido e limpam efeitos). Derrota → tela de derrota.
- Elementos: `fire`, `water`, `earth`, `air`, `light`, `shadow`, `neutral`.
- Dano = `roll(min..max) * (100 + power) / 100 * (100 - resist[element]) / 100`, arredondado.

## Esquemas de dados (`JOGO.DATA`)

```js
JOGO.DATA = {
  gameTitle: 'string', gameSubtitle: 'string',
  races: [ { id, name, description, lore, palette: { primary, secondary, accent }, trait: 'texto do traço racial' } ],  // exatamente 5
  heroes: [ { id, raceId, name, title, description,
              stats: { hp, pa, pm, initiative, power, resists: {fire:0,water:0,earth:0,air:0,light:0,shadow:0,neutral:0} },
              spells: ['spellId', ...] } ],  // exatamente 5 heróis, 1 por raça, 5 feitiços cada
  spells: { spellId: { id, name, element, paCost, cooldown,            // cooldown 0 = sem
                       castsPerTurn,                                    // 0 = ilimitado
                       range: { min, max, line: bool, los: bool },      // line = só em linha reta; los = exige linha de visão
                       aoe: { shape: 'single'|'cross'|'circle'|'line', size },  // size = raio/comprimento (single ignora)
                       needsEmptyTile: bool,                            // true para teleporte/invocação
                       effects: [ Effect, ... ],
                       description, fxKey } },
  monsters: { monsterId: { id, name, family, description,
                           stats: {…igual heroes…}, spells: [...], ai: 'melee'|'ranged'|'support'|'boss',
                           traits: [ Trait, ... ], boss: bool, summonOnly: bool } },
  dungeons: [ { id, name, theme, description, palette: { primary, secondary, accent, floor1, floor2, wall },
                rooms: [ { name, layout: ['strings'], monsters: { 'a': 'monsterId', ... } } ] } ]  // exatamente 3 dungeons × 3 salas
}
```

### Vocabulário FECHADO de efeitos (Effect) — a engine implementa exatamente estes, o criativo usa SOMENTE estes

```js
{ type:'damage', element, min, max, lifesteal?: bool }
{ type:'heal', min, max }
{ type:'shield', value, duration }                       // absorve dano
{ type:'buff', stat:'pa'|'pm'|'power'|'initiative', value, duration }   // value negativo = debuff
{ type:'resist', element, value, duration }              // value negativo = vulnerabilidade
{ type:'push', tiles }                                   // empurra para longe do conjurador; colisão: 10 de dano/célula bloqueada
{ type:'pull', tiles }                                   // puxa em direção ao conjurador
{ type:'teleport' }                                      // conjurador vai à célula alvo (needsEmptyTile: true)
{ type:'swap' }                                          // troca de lugar com a unidade alvo
{ type:'poison', element, min, max, duration }           // dano no INÍCIO do turno da vítima
{ type:'regen', min, max, duration }                     // cura no início do turno
{ type:'summon', monsterId }                             // invoca na célula alvo (needsEmptyTile: true); herda lado do conjurador
{ type:'taunt', duration }                               // IA inimiga é forçada a alvejar o provocador
{ type:'invisible', duration }                           // IA não consegue alvejar; quebra ao conjurar dano
```

### Vocabulário FECHADO de traços de monstro (Trait)

```js
{ type:'explodeOnDeath', element, damage, radius }
{ type:'split', monsterId, count }        // ao morrer divide-se em N cópias menores (células livres adjacentes)
{ type:'enrage', hpPct, power }           // abaixo de hpPct*hpMax ganha +power
{ type:'pushImmune' }
{ type:'regenAura', value, radius }       // cura aliados próximos no início do próprio turno
// 02/10 — os quatro dos COLOSSOS DO POÇO. A regra deles mora em js/core/poco.js
// (Poco.regras) e só vale com ele carregado; o colosso só nasce no Poço:
{ type:'rastroBrasa', spellId, duration } // as casas por onde passa viram armadilha do lado dele (spellId em DATA.monsterSpells)
{ type:'mare', cura, duration }           // poça onde termina a vez; parado em cima dela recupera `cura` × vida máxima
{ type:'couraca', pontos, reducao }       // corta `reducao` de cada golpe até perder `pontos` placas (golpe de ar arranca duas)
{ type:'ventania', tiles }                // quem o golpeia de perto, na própria vez, é soprado `tiles` casas
```

### Layout de sala (strings, todas do mesmo comprimento; grades entre 11×11 e 15×15)

- `.` chão · `#` parede (bloqueia movimento e visão, tem altura) · `~` buraco/vazio (bloqueia movimento, NÃO bloqueia visão)
- `P` spawn de herói (≥3 por sala) · letras `a`–`z` = spawn de monstro conforme o mapa `monsters` da sala
- `,` chão decorado alternativo (visual apenas, mesmo comportamento de `.`)

## API da Engine (`JOGO.Engine`) — dono: Lógica

```js
Engine.createBattle(dungeonId, roomIndex, heroIds) -> state   // também guarda em Engine.state
Engine.reachable(state, uid) -> [{x,y,cost}]                  // células alcançáveis com PM atual
Engine.path(state, uid, x, y) -> [{x,y},...] | null           // caminho (sem incluir origem)
Engine.move(state, uid, x, y) -> bool                         // valida, gasta PM, emite evento 'move'
Engine.castTargets(state, uid, spellId) -> [{x,y}]            // células-alvo válidas
Engine.aoeTiles(state, spellId, casterX, casterY, tx, ty) -> [{x,y}]  // área afetada
Engine.cast(state, uid, spellId, x, y) -> bool
Engine.endTurn(state)                                          // tick de efeitos, próxima unidade, emite 'turnStart'
Engine.activeUnit(state) -> unit
Engine.unitAt(state, x, y) -> unit | null
Engine.events  // FILA (array) de eventos; main.js drena a cada frame
```

### Formato do `state`

```js
{
  dungeonId, roomIndex, round, phase: 'playing'|'won'|'lost',
  grid: { w, h, tiles },        // tiles[y][x] = { type:'floor'|'wall'|'hole', deco: bool }
  units: [ { uid, defId, kind:'hero'|'monster'|'summon', side:'player'|'enemy',
             name, x, y, hp, hpMax, pa, paMax, pm, pmMax, initiative, power,
             resists, spells, cooldowns: {spellId:n}, castsThisTurn: {spellId:n},
             effects: [ {type, ...camposDoEffect, duration, sourceUid} ],
             shield, alive, boss } ],
  order: [uid,...], activeIdx
}
```

### Eventos (`Engine.events` recebe objetos `{ type, ... }`)

`battleStart {state}` · `roundStart {round}` · `turnStart {uid}` · `move {uid, path}` ·
`cast {uid, spellId, x, y, fxKey, element}` · `damage {uid, amount, element}` · `heal {uid, amount}` ·
`shield {uid, amount}` · `effectApplied {uid, effect}` · `pushed {uid, fromX, fromY, toX, toY, collision}` ·
`teleport {uid, fromX, fromY, toX, toY}` · `summon {unit}` · `death {uid}` · `battleEnd {winner}` · `log {text}`

## IA (`JOGO.AI`) — dono: Lógica

`AI.planTurn(state, uid) -> [ {action:'move',x,y} | {action:'cast',spellId,x,y} | {action:'end'} ]`
Respeita `taunt` (só pode alvejar o provocador se houver) e `invisible` (não alveja invisíveis). Usa feitiços conforme papel (`melee` aproxima, `ranged` mantém distância, `support` cura/bufa aliados, `boss` combina).

## Fluxo do jogo (`JOGO.Game`) — dono: Lógica

Telas: `'menu' | 'heroSelect' | 'dungeonSelect' | 'battle' | 'roomClear' | 'defeat' | 'dungeonComplete'`.

```js
Game.init(); Game.update(dt);
Game.screen                       // tela atual (string)
Game.state                        // battle state atual ou null
Game.selectedSpellId              // feitiço selecionado ou null
Game.hoverTile                    // {x,y} ou null (setado por onTileHover)
Game.party, Game.dungeonId, Game.roomIndex
Game.startRun(heroIds, dungeonId) // valida 3 heróis, inicia sala 0
Game.nextRoom(); Game.restart()   // restart volta ao menu
Game.selectSpell(spellId)         // toggle; null desmarca
Game.onTileClicked(x, y)          // mover ou conjurar conforme seleção
Game.onTileHover(x, y)            // atualiza hoverTile (null se fora)
Game.endTurn()                    // só funciona no turno de um herói
Game.isPlayerTurn() -> bool
```

`Game.update` conduz os turnos da IA: executa 1 ação do plano por vez, esperando `Renderer.isBusy()` ser `false` entre ações (se `JOGO.Renderer` não existir, não espera — permite teste headless). Ao mudar de tela chama `JOGO.UI.showScreen(nome, dadosOpcionais)` se existir.

## Renderizador (`JOGO.Renderer`) — dono: Designer

```js
Renderer.init(canvasEl); Renderer.render(dt); Renderer.handleEvent(ev); Renderer.isBusy() -> bool
```

- **Câmera 3D-like**: arrastar com mouse pressionado gira a câmera ao redor do tabuleiro (horizontal = rotação contínua, vertical = inclinação/tilt com limites); roda do mouse = zoom. Clique sem arrasto (< 6px) = ação no tile. Projeção isométrica rotacionável com profundidade correta (depth sort), paredes com altura, personagens "billboard".
- Desenha por leitura de `Game.state`/`Game.screen`: overlays de células alcançáveis (`Engine.reachable`), preview de caminho no hover, células-alvo (`Engine.castTargets`) e área do feitiço (`Engine.aoeTiles`) quando `Game.selectedSpellId` ≠ null. Envia input via `Game.onTileClicked/onTileHover/…`.
- `isBusy()` = true enquanto anima movimento/conjuração (a Lógica espera isso para ritmar a IA).
- Arte 100% procedural (paths, gradientes, glow). Cada herói, monstro e chefe com silhueta ÚNICA e legível. Tema visual por calabouço (paleta do `DATA.dungeons`). Animações de idle (respirar/flutuar), conjuração e dano.

`JOGO.Sprites` e `JOGO.FX` são detalhes internos do Designer (partículas, números de dano flutuantes, projéteis, shake) — interface interna livre, mas `FX.handleEvent(ev)` é chamada pelo main.

## HUD (`JOGO.UI`) — dono: Designer

```js
UI.init(); UI.update(dt); UI.showScreen(name, data); UI.handleEvent(ev)
```

DOM dentro de `#ui-root`. Telas: menu (título + jogar), seleção de heróis (cards das 5 raças, escolher 3), seleção de calabouço (3 cards), HUD de batalha (timeline de iniciativa com retratos, painel do herói ativo com HP/PA/PM, barra de feitiços com tooltips ricos — custo, alcance, efeitos, cooldown —, botão "Encerrar turno", log de combate), telas de vitória de sala/derrota/conclusão. Botões chamam `JOGO.Game.*` diretamente.

## ADENDO v2 — Progressão, Equipamentos e Saque

### Regras fixas
- O jogador escolhe **1 a 3 heróis** (não mais exatamente 3). `Game.startRun` valida 1–3.
- **Sorte de saque** por tamanho do grupo: `LUCK = 1.0 (3 heróis) | 1.6 (2) | 2.4 (1)`. No sorteio de drops, o peso efetivo de um item é `weight * 1.0` (common), `weight * LUCK` (rare), `weight * LUCK²` (epic).
- **XP**: ao limpar uma sala, cada herói vivo ou morto do grupo recebe `floor(soma do xp dos monstros mortos na sala / tamanho do grupo)`.
- **Drops**: 1 sorteio por sala limpa + 1 sorteio extra na sala do chefe (use `minRoom` para restringir itens ao chefe). Sorteio pode resultar em item já possuído (duplicatas permitidas).
- Persistência em `localStorage` chave `soterra-save-v1` (níveis, XP, inventário, equipados). Save automático a cada mudança.

### Novos esquemas em `JOGO.DATA` (dono: Criativo)
```js
items: { itemId: { id, name, slot:'weapon'|'armor'|'trinket', rarity:'common'|'rare'|'epic',
                   dungeonId,                    // de qual calabouço este item dropa
                   bonuses: { hp?, pa?, pm?, power?, initiative?, resists?: {element:val} },
                   description, flavor, iconKey } }
monsters[*].xp: number                            // XP concedido ao morrer (sugestão ~hp/2; chefes ~hp*1.5)
dungeons[*].lootTable: [ { itemId, weight, minRoom } ]   // minRoom: 0=qualquer sala, 2=só chefe
leveling: { maxLevel, xpTable: [xp acumulado p/ atingir nível i],   // index 0 = nível 1 = 0
            perLevel: { hp, power } }             // ganho por nível acima do 1
```
Restrições de sanidade: `pa`/`pm` em bonuses só em itens `epic` e no máximo +1; hp em itens 5–35; power 3–20.

### Novo módulo `js/core/progress.js` (dono: Lógica) — `JOGO.Progress`
```js
Progress.load(); Progress.save(); Progress.reset()
Progress.state -> { heroes: {heroId: {xp, level}}, inventory: [itemId,...], equipped: {heroId: {weapon,armor,trinket}} }
Progress.addXp(heroId, amount) -> níveis ganhos (aplica xpTable/maxLevel)
Progress.xpInfo(heroId) -> { level, xp, xpNext, pct }
Progress.effectiveStats(heroId) -> stats base + perLevel*(level-1) + soma de bonuses equipados
Progress.equip(heroId, itemId) -> bool (desequipa o slot anterior de volta ao inventário)
Progress.unequip(heroId, slot)
Progress.rollDrops(dungeonId, roomIndex, partySize) -> [itemId,...] (regra LUCK acima; adiciona ao inventário)
```
`Engine.createBattle` usa `JOGO.Progress.effectiveStats(heroId)` quando `JOGO.Progress` existir (senão stats base — testes podem stubar). `Game` integra no fluxo: ao vencer sala → XP + drops + save, e passa resumo à UI: `UI.showScreen('roomClear', { xpGanho, levelUps: [{heroId, novoNivel}], drops: [itemId] })` (idem `dungeonComplete`).

### UI/Arte (dono: Designer)
- Seleção de heróis: escolha 1–3; indicador claro de **Sorte de Saque** (ex.: ★ por raridade favorecida) explicando a regra; nível + barra de XP por card; painel de **Equipamento** por herói (3 slots, inventário, comparação de bônus, cor por raridade: common bronze/cinza, rare azul, epic dourado/roxo).
- Telas de vitória: XP ganho, level-ups com destaque, cards dos itens dropados com raridade.
- HUD de batalha: nível no retrato do ativo.
- `Sprites.itemIcon(itemId)` — ícone procedural por item (slot+iconKey+raridade).

## ADENDO v3 — Camada visual 3D real (Three.js/WebGL)

A camada de apresentação canvas-2D (js/render/*) é SUBSTITUÍDA por WebGL real com Three.js, preservando o restante do jogo. `js/core/*`, `js/ui/hud.js` e o contrato de APIs NÃO mudam.

### Vendor (dono: orquestrador, somente leitura)
`vendor/three.min.js` (r147 UMD, global `THREE`), `vendor/GLTFLoader.js`, `vendor/{EffectComposer,RenderPass,ShaderPass,UnrealBloomPass,CopyShader,LuminosityHighPassShader}.js` — carregados por `<script>` clássico ANTES dos módulos do jogo.

### Novos arquivos (dono: Designer 3D)
| Arquivo | Global | Papel |
|---|---|---|
| `assets/embedded/*.js` | `JOGO.ASSETS` | GLBs CC0 (KayKit) embutidos em base64 (o jogo abre via file:// — `fetch` de .glb é bloqueado; usar `GLTFLoader.parse` sobre ArrayBuffer decodificado). Orçamento total ≤ 10 MB. |
| `js/render3d/models3d.js` | `JOGO.Models3D` | Constrói/carrega TODOS os meshes: ambiente por tema a partir dos kits (pisos, paredes, colunas, props, com tint da paleta do dungeon) e PERSONAGENS/MONSTROS procedurais low-poly fiéis ao GDD (identidade das raças é inegociável), com animações por código (idle/walk/cast/hit/death via transforms de grupos). |
| `js/render3d/renderer3d.js` | `JOGO.Renderer` | MESMA API do contrato: `init(canvas)/render(dt)/handleEvent(ev)/isBusy()/project(x,y)/setCamera({ang,tilt,zoom})`. Câmera = órbita 3D real (arrasto gira/inclina com clamps, roda = zoom com clamps, clique <6px = ação, pivô fixo no centro). Picking por raycast → `Game.onTileClicked/onTileHover`. Luzes reais (ambiente + direcional com sombras + pontuais temáticas), névoa, chão estendido, overlays de alcance/alvo/AoE como quads luminosos. |
| `js/render3d/fx3d.js` | `JOGO.FX` | MESMA API (`handleEvent`). Partículas GPU (Points/InstancedMesh), projéteis com luz própria, impactos, decais no chão, números de dano (sprites), bloom (UnrealBloomPass), shake. |
| `tests/preview3d.html` | — | Página de desenvolvimento com state mock (padrão da preview 2D: snap/espelho p/ headless). |

Os arquivos antigos `js/render/*` permanecem no repositório (fallback histórico), mas fora do `index.html` após a troca. O orquestrador faz a troca no `index.html` na integração. Performance: 60 fps @1440×900 (pixelRatio clampado ≤1.5, sombras PCF em resolução moderada, bloom com threshold alto).

## Qualidade

- Nenhum erro no console. Nada de `alert/prompt`. 60fps alvo (evite criar objetos por frame no caminho quente).
- Testes: páginas em `tests/` que carregam os módulos e exibem PASS/FAIL no DOM e no console (não há Node na máquina — tudo testa no navegador).
