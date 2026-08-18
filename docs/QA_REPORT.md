# SOTERRA — Relatório de QA
**Agente Revisor (QA) · 16/08/2026 · build testada: working tree de `C:\Users\danie\Documents\Jogo`**

---

## 1. Resumo executivo

> ## Veredito: **APROVADO COM RESSALVAS**

O jogo está funcional de ponta a ponta. Todas as suítes de teste passam (2122 + 62 + 29 checagens, zero erros de console), o fluxo completo **menu → seleção de heróis → seleção de calabouço → 3 salas → conclusão/derrota** funciona nos 3 calabouços sem uma única exceção, a regra entre salas está correta, os 15 casos de borda da engine passam, a câmera rotacionável converte cliques em tiles corretamente em 4 ângulos distintos, o desempenho está com folga dentro do orçamento (5,4–6,1 ms/frame @ 1440×900, limite 12 ms) e o jogo abre via `file://` como exige o contrato.

Nenhum bug **crítico** ou **alto** foi encontrado. As ressalvas são: **1 bug médio** (divergência de contrato: `Game.screen` não reflete as telas pré-batalha porque a UI navega sem chamar `Game.goTo`), **4 bugs baixos** e **2 observações informativas** — detalhados na §4. Nenhum deles bloqueia a aprovação; recomendo corrigir o médio (B1) antes do release e tratar os baixos como polimento.

**Contagem de bugs:** 0 críticos · 0 altos · **1 médio** · **4 baixos** · 2 informativos.

---

## 2. Tabela de resultados por área

| # | Área | Método | Resultado | Números |
|---|---|---|---|---|
| 1 | Dados (`validate_data.html`) | suíte no navegador | ✅ PASS | **2122 checagens OK**, console limpo |
| 2 | Motor/IA/Game (`test_engine.html`) | suíte no navegador | ✅ PASS | **62 PASS / 0 FAIL**, console limpo |
| 3 | Sprites (`sprite_gallery.html`) | suíte no navegador | ✅ PASS | **29 sprites, 0 faltando, 0 erros** |
| 4 | Preview do renderer (`preview_render.html`) | suíte no navegador | ✅ PASS | "PASS — módulos ok, 0 erros" |
| 5 | E2E fluxo completo (index.html, 3 calabouços) | bombeamento manual + IA nos heróis | ✅ PASS | Estufa: **vitória** (10 rodadas na última sala) · Cisterna: **vitória** (7) · Fecho de Brasa: salas 1–2 limpas, **derrota no chefe** (desfecho legítimo). **0 exceções**, 0 erros de console |
| 6 | Regra entre salas | verificação automática no E2E | ✅ PASS | 4/4 transições: vivos curam 50% do perdido; mortos revivem com 30% do hpMax (fórmula exata conferida) |
| 7 | HUD/timeline/log refletem o estado | amostragem automática no E2E | ✅ PASS | 37 amostras: slots da timeline == unidades vivas; "Rodada N" == `state.round`; log cresce (1→8 linhas visíveis) |
| 8 | Casos de borda (Engine/AI direto) | `javascript_tool` | ✅ PASS | **15/15** (detalhe na §3) |
| 9 | Câmera e input | eventos sintéticos de mouse | ✅ PASS | **16/16** cliques→tile corretos em ang 0 / 1.5 / 3.1 / 4.7; arrasto gira; tilt clampado [0.35–0.85]; zoom clampado [0.55–2.4]; micro-arrasto <6px ainda clica; hover correto |
| 10 | Visual (15 screenshots headless inspecionados) | Chrome headless 1440×900 | ✅ PASS c/ ressalva | Profundidade correta em todos os ângulos; silhuetas legíveis; HUD íntegra; pt-BR sem overflow. Ressalva B3 (contraste de paredes no Fecho de Brasa) |
| 11 | Performance | 60× `Renderer.render(0.016)` | ✅ PASS | Estufa **6,13 ms** · Cisterna **5,98 ms** · Fecho **5,38 ms** @ 1440×900, DPR 1 (limite: 12 ms) |
| 12 | Conformidade de contrato | leitura de código | ✅ PASS c/ ressalva | Detalhe na §5. Ressalva B1 |

---

## 3. Detalhe dos testes executados

### 3.1 E2E (roteiro 2)
Fluxo dirigido por DOM real (cliques nos `.hero-card`, "Confirmar Descida", "Descer", "Avançar", "Tentar de novo") + bombeamento manual do loop (drenagem de `Engine.events` → `Game.update` → `UI.update` → `Renderer.render`). Heróis jogados por `JOGO.AI.planTurn`, com ações executadas **pela API de contrato** (`Game.selectSpell` → `Game.onTileClicked` → `Game.endTurn`), esperando `Renderer.isBusy()` entre ações.

- **Estufa** (Repique+Morela+Rosácea): battle→roomClear→battle→roomClear→battle→**dungeonComplete**. 164 ações de herói executadas.
- **Cisterna** (Repique+Rosácea+Sibilo): idem, **dungeonComplete**. 171 ações.
- **Fecho de Brasa** (Estopim+Morela+Rosácea): salas 1–2 limpas, **defeat** na Câmara do Coração (Magno). 170 ações. "Tentar de novo" → volta ao menu com `Game.state === null`. ✔
- Banners corretos: "Sala limpa!", "Fecho selado!", "Derrota…".

### 3.2 Casos de borda (roteiro 3) — 15/15 PASS
| Caso | Resultado |
|---|---|
| Conjurar sem PA | `castTargets` vazio e `cast` retorna `false` ✔ |
| Mover além do PM | `reachable` limitado ao PM; `move` para célula longe retorna `false` ✔ |
| Alvo abaixo do alcance mínimo | recusa ✔ |
| Alvo sem linha de visão | fora de `castTargets` e `cast` recusa ✔ (parede bloqueia; buraco não — coberto pela suíte da engine) |
| Empurrar contra parede | evento `pushed` com `collision=20` (2 células bloqueadas × 10) e dano aplicado ✔ |
| `pushImmune` | não se move um palmo, sem evento `pushed`, sem dano de colisão ✔ |
| `needsEmptyTile` em célula ocupada | recusa (fora de `castTargets` e `cast=false`) ✔ |
| Cooldown | `fan-flame` (recarga 3): seta recarga, bloqueia reconjuração, volta a ser conjurável exatamente no 4º turno do dono (regra documentada no cabeçalho da engine) ✔ |
| `castsPerTurn` | `molten-blade` 1×/turno respeitado ✔ |
| Invisível vs IA | após `snuff-out`, nenhum plano de 4 monstros mira a célula da invisível ✔ |
| Taunt vs IA | após `curfew-toll`, todos os feitiços hostis planejados pelos monstros miram a célula do provocador ✔ |
| Summon do jogador | herda `side:'player'`, `kind:'summon'`, entra na ordem **imediatamente após** o invocador, e `Game.isPlayerTurn()` é `false` no turno dele (IA conduz) ✔ |

### 3.3 Câmera e input (roteiro 4)
Verificado por leitura do código (`renderer.js` linhas 162–221) **e** por despacho programático de `mousedown/mousemove/mouseup/wheel` no canvas:
- Limiar de arrasto: `dx²+dy² > 36` (= 6px) ✔; arrasto horizontal gira (`ang += dx*0.0085`), vertical inclina com clamp [0.35, 0.85] ✔ (medido pela projeção), roda ajusta zoom com clamp [0.55, 2.4] ✔ (medido).
- Clique <6px → `Game.onTileClicked` com o tile exato: **16/16** acertos em ang = 0, 1.5, 3.1, 4.7 (4 tiles × 4 ângulos) — `unproject` é a inversa exata de `project` (rotação+tilt+zoom+shake). Micro-arrasto de 4px ainda conta como clique ✔. Hover reporta o tile sob o cursor ✔.

### 3.4 Visual (roteiro 5) — screenshots em `tests/qa_shots/`
15 imagens inspecionadas (3 temas × 3 ângulos + heroSelect + dungeonSelect + overlay de feitiço + menu via http + menu via `file://`):
- **Profundidade**: sem nenhum caso de "atrás desenhado na frente" nos 4 ângulos verificados; paredes com altura e faces corretas; buracos rebaixados com brilho temático; unidades billboard ordenadas corretamente entre paredes.
- **Silhuetas**: os 5 heróis batem com o GDD (cúpula/gota/guarda-chuva/polígono/sanfona) e são distinguíveis a distância; chefes 2–3× maiores com adereço memorável (martelo-chaminé do Magno visível).
- **HUD**: timeline com retratos e HP, painel do ativo (HP/PA/PM em pips), barra de feitiços com custo/recarga e estado selecionado, tooltip rico (custo, alcance, ×/turno, efeitos, descrição — verificado por DOM), log, "Encerrar Turno" desabilitado fora do turno do jogador.
- **pt-BR**: sem overflow/corte em nenhuma tela; acentuação correta ("Rosácea", "Fôlegos", "Derrota…").
- Ressalva: ver B3.

---

## 4. Bugs e observações

### B1 — `Game.screen` não reflete as telas pré-batalha — **MÉDIO**
- **Sintoma:** durante a seleção de heróis e de calabouço, `JOGO.Game.screen` permanece `'menu'`. O contrato define `Game.screen` como "tela atual (string)" com o vocabulário `'menu'|'heroSelect'|'dungeonSelect'|…`, e o Game até expõe `Game.goTo(name)` para isso — mas a UI navega chamando `UI.showScreen(...)` diretamente, sem avisar o Game.
- **Reprodução:** abrir `index.html` → clicar "Descer ao Fecho" → avaliar `JOGO.Game.screen` no console → retorna `'menu'` (deveria ser `'heroSelect'`).
- **Impacto:** hoje é inócuo (o Renderer trata qualquer tela ≠ battle igual), mas é a "fonte da verdade" divergindo — qualquer código futuro que leia `Game.screen` nas telas pré-batalha quebra silenciosamente.
- **Arquivo/dono sugerido:** `js/ui/hud.js` (Designer) — nos handlers dos botões "Descer ao Fecho" (l.105), "Voltar" (l.121/200) e "Confirmar Descida" (l.125), chamar `JOGO.Game.goTo(nome)` (que já chama `UI.showScreen` de volta) em vez de `UI.showScreen` direto.

### B2 — `Renderer.isBusy()` pode ficar preso em `true` com animações órfãs — **BAIXO**
- **Sintoma:** a fila `animQ` só é limpa no evento `battleStart`. Animações pendentes de uma batalha que terminou (ou de um estado trocado por fora, como em páginas de teste) mantêm `isBusy() === true` até que `render()` as consuma — e itens de unidades inexistentes só são descartados quando `render()` roda.
- **Reprodução:** headless — criar batalha A, enfileirar animações sem renderizar, trocar para batalha B sem emitir `battleStart` ao renderer → `isBusy()` fica `true` e cliques são ignorados (observado durante o QA; no fluxo real do jogo o `battleStart` sempre chega, então o impacto é restrito a testes/robustez).
- **Arquivo/dono sugerido:** `js/render/renderer.js` (Designer) — limpar `animQ/delayed` também em `battleEnd`, ou descartar animações cujo `uid` não existe no estado atual mesmo fora do `render()`.

### B3 — Paredes do Fecho de Brasa com contraste fraco em ângulos alinhados aos eixos — **BAIXO**
- **Sintoma:** em `ang≈0` e `ang≈1.6` (visão quase axial), as muretas do tema forge quase se confundem com o piso — a face lateral única visível é muito escura e o topo tem pouco contraste. Em ângulos diagonais (`ang=4.0`) a leitura é ótima.
- **Evidência:** comparar `tests/qa_shots/emberlock_a0.png` e `emberlock_a16.png` com `emberlock_a40.png` (e com `greenhouse_a22.png`, onde as paredes lêem bem).
- **Arquivo/dono sugerido:** `js/render/sprites.js` (Designer) — `wallFace` do tema forge: aumentar contraste do topo (o GDD pede "blocos de ferro rebitado, **topo em brasa**" — uma linha de brasa no topo resolveria a legibilidade e a fidelidade ao GDD de uma vez).

### B4 — `Engine.move`/`Engine.cast` não validam se `uid` é a unidade ativa — **BAIXO**
- **Sintoma:** a engine aceita mover/conjurar com qualquer unidade viva a qualquer momento; a proteção de turno mora só no `Game` (`isPlayerTurn`/`activeUnit`). O contrato não exige essa checagem, e no fluxo real nada a viola — é uma fragilidade de API para consumidores diretos da engine.
- **Reprodução:** `Engine.cast(state, uidDeUnidadeNaoAtiva, …)` → executa normalmente.
- **Arquivo/dono sugerido:** `js/core/engine.js` (Lógica) — opcional: recusar (ou ao menos documentar) ações de unidades não ativas.

### B5 — Hover de tile "atravessa" a HUD — **BAIXO**
- **Sintoma:** o listener de `mousemove` fica no `window`; com o cursor sobre painéis da HUD (barra inferior, log), `Game.onTileHover` continua sendo chamado com o tile "por baixo" do painel, mantendo overlay de hover num tile que o jogador não está apontando de verdade.
- **Arquivo/dono sugerido:** `js/render/renderer.js` (Designer) — ignorar hover quando `e.target !== canvas`.

### B6 — Balanceamento: chefe final nunca venceu em auto-play — **INFORMATIVO**
- Nas 2 execuções IA-vs-IA observadas (suíte `test_engine`: "emberlock[2]: lost em 46 turnos"; E2E deste QA: derrota na rodada 6), a Câmara do Coração não foi vencida. As 8 demais salas foram vencidas em todas as execuções. É o calabouço "difícil" por design e a IA de heróis não usa teleporte/troca (decisão documentada em `ai.js`), então **não é conclusivo para jogador humano** — mas recomendo um playtest humano do Magno antes do release. Dono para eventual ajuste: Criativo (`js/core/data.js`).

### B7 — `theme` ≠ `id` nos calabouços — **INFORMATIVO**
- `data.js` usa `theme: "garden"/"cistern"/"forge"` com ids `greenhouse/cistern/emberlock`; renderer e sprites tratam os dois vocabulários em vários pontos (`theme === 'garden' || theme === 'greenhouse'`). Funciona, mas é string mágica duplicada — risco de deriva se um novo tema for adicionado. Donos: Criativo + Designer (alinhar num vocabulário só).

---

## 5. Conformidade de contrato (roteiro 7)

| Item do contrato | Situação |
|---|---|
| Preâmbulo de namespace `var JOGO = …` em todo arquivo JS | ✅ 9/9 arquivos |
| Sem ES modules / `require` / recursos externos; abre via `file://` | ✅ (screenshot `qa_shots/file_protocol_menu.png`) |
| `index.html`: ordem de scripts data→engine→ai→game→sprites→fx→renderer→hud→main; `#game-canvas` + `#ui-root` | ✅ exata |
| `js/main.js` conforme especificação (drena eventos na ordem Renderer→FX→UI→Game, depois update/render) | ✅ idêntico ao comportamento especificado; sem modificações aparentes |
| Donos por arquivo (cabeçalhos e conteúdo coerentes com a tabela) | ✅ nenhum arquivo mistura responsabilidade de outro dono |
| APIs exatas: `Engine.createBattle/reachable/path/move/castTargets/aoeTiles/cast/endTurn/activeUnit/unitAt/events` · `AI.planTurn` · `Game.*` · `Renderer.init/render/handleEvent/isBusy` · `UI.init/update/showScreen/handleEvent` · `FX.handleEvent` | ✅ todas presentes com as assinaturas do contrato (extensões documentadas: `Game.goTo`, `Renderer.project/unitWorld/setCamera`, `Engine.los/findUnit/…` — aditivas, não conflitam) |
| Vocabulário FECHADO de efeitos no `data.js` | ✅ somente `damage/heal/shield/buff/resist/push/pull/teleport/swap/poison/regen/summon/taunt/invisible` (extração integral por grep) |
| Vocabulário FECHADO de traços | ✅ somente `explodeOnDeath/split/enrage/pushImmune/regenAura` |
| Fórmula de dano, colisão 10/célula, poison no início do turno, PA/PM renovando, 3 heróis, 3×3 salas, elementos | ✅ cobertos por `test_engine` (62/62) + casos de borda §3.2 |
| Sem `alert/prompt/confirm`; sem `console.*` em código de produção; nenhum erro de console | ✅ |
| `Game.screen` como fonte da verdade das telas | ⚠️ ressalva **B1** |
| Regra entre salas ("curam 50% do HP perdido e limpam efeitos") | ✅ implementada; **extensão documentada** no cabeçalho de `game.js`: mortos revivem com 30% (o contrato é omisso sobre mortos; decisão registrada e testada) |

Decisões de design não especificadas pelo contrato estão **documentadas nos cabeçalhos** de `engine.js`/`game.js`/`ai.js` (RNG determinístico, semântica de cooldown, direção de push/pull, IA não planeja teleporte/swap etc.) — boa prática, facilita a auditoria.

---

## 6. Melhorias recomendadas (não bloqueantes)

1. **Cache de retratos na HUD** (`hud.js`): a timeline recria todos os canvases de retrato a cada mudança de assinatura (cada dano/gasto de PA). Com ~10 unidades é barato hoje, mas um cache por `defId` eliminaria trabalho repetido e pressão de GC.
2. **Cache por turno dos overlays** (`renderer.js`): `Engine.reachable` (BFS) e `Engine.castTargets` (varredura da grade + LoS) rodam **a cada frame** durante o turno do jogador. Invalidar por (uid, pa, pm, feitiço selecionado) pouparia a maior parte disso.
3. **Histórico do log**: `hud.js` guarda 40 linhas mas renderiza só as 8 últimas — o scroll não dá acesso ao histórico. Renderizar as 40 com scroll (mantendo o fade nas recentes) aproveitaria o que já está guardado.
4. **Clamp vertical do tooltip** (`hud.js`): o posicionamento clampa só no eixo X; clampar também em Y evita corte em janelas baixas.
5. **Playtest humano do Magno** (ver B6) e, se necessário, ajuste fino em `data.js`.
6. **Unificar `theme`/`id` de calabouço** (ver B7).

---

## 7. Evidências

- Screenshots inspecionados: `tests/qa_shots/*.png` (15 arquivos — 3 temas × 3 ângulos, telas de menu/heróis/calabouços, overlay de feitiço, `file://`).
- Suítes: `tests/validate_data.html`, `tests/test_engine.html`, `tests/sprite_gallery.html`, `tests/preview_render.html` — todas PASS com console limpo na carga atual (verificado com marcadores).
- E2E e casos de borda: executados via `javascript_tool` com bombeamento manual do loop (aba dedicada, servidor estático `jogo-static`, porta 8137).

---
---

# QA da Expansão de Progressão + FX v4 — 17/08/2026

**Agente Revisor (QA) · regressão pós-aprovação + validação do ADENDO v2 (grupo 1–3, XP/níveis, equipamentos/saque, save) e do retrabalho de FX · build `?v=6` da working tree**

> **Sandbox de save:** antes de qualquer teste foi feito snapshot de `localStorage['soterra-save-v1']` (483 chars); ao final o valor foi **restaurado byte-idêntico** (conferido por comparação de string) e `Progress.load()` ressincronizou a memória. Nenhum resíduo de QA ficou no save.

## R1. Resumo executivo

> ## Veredito: **APROVADO**

A expansão está sólida e a regressão está limpa. As 4 suítes passam (62/62 motor · **18/18 progressão** · **2631** checagens de dados · galeria 29×4 + **21 ícones de item**), com **zero erros de console em todas as páginas durante toda a sessão**. O fluxo E2E por cliques DOM reais funciona de ponta a ponta com grupo de 1, 2 e 3 heróis; XP, drops, level-ups, telas de recompensa e persistência batem com o contrato **e** com a calibração do GDD (trio termina a Estufa no nível 3, como previsto no §8.2). A regra de sorte foi validada estatisticamente com Math.random real (12.000 sorteios): épico solo **11,32%** vs trio **2,88%** — exatamente a tabela do GDD (~11,5% / ~3%) — e **0 épicos em 8.000 sorteios nas salas 0/1** (minRoom respeitado). O FX v4 entrega o que promete em screenshots de fase: flash→burst em 2 tempos, slash arc, decais dos 6 elementos esvaecendo em ~3s, crítico gigante e morte de chefe cinematográfica em 3 atos; `isBusy()` drena sempre (libera no frame 337 com 13 FX sobrepostos e `battleEnd` zera na hora).

**Três dos quatro bugs da rodada anterior foram corrigidos e verificados** (B1, B2, B5; B3 tratado — ver R5). Nesta rodada: **nenhum bug crítico, alto ou médio**; **1 baixo** e **2 informativos** novos.

**Contagem de bugs (novos desta rodada):** 0 críticos · 0 altos · 0 médios · **1 baixo** · 2 informativos.

## R2. Resultados por área

| # | Área | Método | Resultado | Números |
|---|---|---|---|---|
| 1 | Suíte do motor (`test_engine.html`) | navegador, carga atual | ✅ PASS | **62/62**, console limpo |
| 2 | Suíte de progressão (`test_progress.html`) | navegador | ✅ PASS | **18/18**, console limpo; não polui o save |
| 3 | Dados (`validate_data.html`) | navegador | ✅ PASS | **2631 checagens OK** (cobrem `items`/`lootTable`/`leveling`/`xp`) |
| 4 | Sprites + ícones (`sprite_gallery.html`) | navegador | ✅ PASS | 29 fichas × 4 direções + **21 ícones de item**, 0 erros |
| 5 | E2E regressão (trio, Estufa completa) | cliques DOM reais + bombeamento síncrono | ✅ PASS | menu→heróis→calabouço→3 salas→`dungeonComplete`; 175 ações de herói pela API de contrato; cura entre salas exata (80→95 = 80+round(30×0,5)) |
| 6 | Câmera e input | eventos reais de mouse no canvas | ✅ PASS | arrasto gira (projeção move 22px); zoom clampado (razão máx/mín medida 4,37 ≈ 2,4/0,55); **6/6 cliques→tile exatos em 2 ângulos**; arrasto de 40px NÃO clica; hover exato; clique é ignorado enquanto `isBusy()` (por design) |
| 7 | Progressão E2E — trio | run real | ✅ PASS | sala 0: XP=floor(93/3)=**31** p/ os 3, salvo; 1 drop; sala 1: floor(140/3)=46, todos Nv 2; chefe: 491 XP (**inclui 3 invocações inimigas mortas ×5**), floor/3=163, Nv 3, **2 sorteios** (duplicata permitida), banner com XP/level-ups/espólios corretos |
| 8 | Progressão E2E — solo | run real 1v4 | ✅ PASS | painel de sorte no máximo (3★, 100%, "raros ×2,4 · épicos ×5,8"); vitória: XP integral **93** (sem divisão), raro dropado, salvo; nível 4 |
| 9 | Derrota | run real (HP forçado a 1, morte pela IA inimiga) | ✅ PASS | tela de derrota; **nada aplicado**: XP/inventário intactos e save **byte-idêntico** ao pré-batalha |
| 10 | Equipar via UI real | cliques em `⚒ Equipamento` e no item | ✅ PASS | painel abre; clicar o raro equipa (poder 6→**15**, slot "ARMA" preenchido, inventário 4→3, save atualizado); batalha seguinte cria herói com hpMax **152**, power **15**, resist terra **10** (nível+item aplicados no `createBattle`) |
| 11 | Persistência | `navigate` (reload real) | ✅ PASS | nível 4, xp 333, inventário e equipado sobrevivem; card mostra Nv 4 e barra "333/435" |
| 12 | Save corrompido | lixo em `soterra-save-v1` + reload | ✅ PASS | boot limpo, 0 erros de console, estado zerado; jogo 100% jogável (ver N2) |
| 13 | Regra de sorte (estatística) | 12.000 sorteios reais (Math.random) | ✅ PASS | épico solo **11,32%** vs trio **2,88%** (GDD: ~11,5%/~3%); razão 3,92× dentro da banda do roteiro [3,46–8,06]; raros 1,58× (teórico 1,56×); **0 épicos em 8.000 sorteios nas salas 0/1** |
| 14 | Casos de borda da progressão | API real no console | ✅ PASS | 10/10 (detalhe em R4) |
| 15 | FX v4 (fases fotografadas) | 14 screenshots headless (`tests/qa_shots/fx_v4/`) | ✅ PASS | detalhe em R5 |
| 16 | FX: drenagem | 520 frames com 13 FX sobrepostos | ✅ PASS | `isBusy()` true→false no frame 337 (morte de chefe é o mais longo), nunca re-trava; `battleEnd` zera na hora (B2 corrigido) |
| 17 | Performance | 60× `render(0.016)` durante nova em área | ✅ PASS c/ ressalva | melhor caso **7,42 ms** @1440×900 (limite 12 ms); medições no painel oculto MUITO ruidosas (idle oscilou 3,4–21 ms sem mudança de cena — throttling do ambiente, não do jogo); 2 de 3 medições limpas < 8 ms |

## R3. Verificações de contrato do ADENDO v2 (leitura de código + runtime)

- `Game.startRun` valida 1–3 heróis (0, 4 e duplicado recusados em runtime) ✔
- `LUCK = 1.0/1.6/2.4` e peso `weight × LUCK^grau` — confirmado em `progress.js` e estatisticamente ✔
- XP para herói vivo **ou morto** do grupo; só lado `enemy` conta (invocação inimiga morta soma; do jogador não — teste dirigido: ganho 98 = 93 + 5) ✔
- 1 sorteio/sala + 1 extra no chefe (`roomIndex >= 2`); duplicatas permitidas ✔
- Save automático em toda mutação; `load()` não grava (documentado) ✔
- `Engine.createBattle` usa `Progress.effectiveStats` com try/catch e cai em stats base ✔
- `UI.showScreen('roomClear'/'dungeonComplete', {xpGanho, levelUps, drops})` — payload conferido no DOM (banner com "+31 XP"/"+163 XP", "▲ … alcançou o nível N!", cards de espólio com raridade) ✔
- Sanidade dos 21 itens: épicos são os únicos com `+1 PA/PM` (um por calabouço, `minRoom: 2`) ✔
- Nível no retrato do ativo na HUD de batalha ("Nv 4") ✔ · Painel de sorte com ★, medidor e texto por tamanho de grupo (×2,6 = 1,6² e ×5,8 = 2,4² corretos) ✔

## R4. Casos de borda (roteiro 6) — 10/10 PASS

| Caso | Resultado |
|---|---|
| Equipar item que não possui | `equip` → `false` ✔ |
| Equipar itemId inexistente | `false` ✔ |
| Item com slot fora do vocabulário (def injetada `slot:'hat'`) | `false`, nenhum slot fantasma criado ✔ |
| `unequip` de slot vazio | `false` ✔ |
| `unequip` de slot inválido (`'chapeu'`) | `false` ✔ |
| `addXp` no nível máximo (20) | 0 níveis, xp truncado em 27135, `xpInfo` = `{xpNext: null, pct: 1}` ✔ |
| `addXp` negativo / NaN | 0, xp não regride ✔ |
| Party 0 / 4 / duplicada | `startRun` → `false`, tela não muda ✔ |
| `rollDrops` com partySize 0/4, dungeon inexistente | sem exceção; `[]` p/ dungeon inválido ✔ |
| XP: invocação inimiga morta vs do jogador morta | conta / não conta (98 = 93+5) ✔ |

## R5. FX v4 — verificação objetiva (evidências em `tests/qa_shots/fx_v4/`)

- **Impacto em 2 tempos** (`cast_20/33/42.png`): projétil com rastro em voo → chegada (T1: flash branco 0,07s + hit-stop, confirmado também no código `fx.js` l.464-476) → T2: burst denso com anel de choque, clarão colorido e número "18" — sequência visível nas 3 fases ✔
- **Slash melee** (`slam_14.png`): arco de golpe nítido sobre o alvo + pose de investida do atacante ✔
- **Crítico gigante** (`crit_12.png`): "47" enorme com contorno e núcleo branco, legível de longe, com burst e anel no alvo ✔
- **Decais dos 6 elementos** (`elements_30/130/215.png`): 6 impactos simultâneos distintos (fogo/água/terra/ar/luz/sombra); marcas no chão presentes e distintas aos ~0,5s, esvaecendo aos ~2,1s, praticamente extintas aos ~3,4s (contrato interno ~3s ✔; teto `DECAL_MAX=18` evita acúmulo) ✔
- **Morte de chefe cinematográfica** (`bosskill_12/45/95.png`): 3 atos — clarão branco engolindo o chefe → onda de choque dourada de vários tiles com colunas de luz e "64" gigante → **sigilo dourado residual** no tile da morte ✔
- **Regressões antigas**: B2 (fila órfã) **corrigido** — `battleEnd` limpa `animQ/delayed` (código + runtime); B5 (hover através da HUD) **corrigido** — `overUI()` em mousemove/mouseup; B3 (paredes do forge) **tratado** — topo em brasa brilhante legível também em ângulo axial (`emberlock_ang0.png`) ✔
- Perf: ver linha 17 da tabela R2 — dentro do orçamento nas medições limpas; a variância é do painel oculto (idle da MESMA cena oscilou 6×), não do renderer.

## R6. Bugs e observações (novos)

### N1 — Card de herói não exibe "poder": equipar arma não muda nada visível no card — **BAIXO**
- **Sintoma:** o card da seleção mostra ❤/⚡/PA/PM, mas não o poder. Equipar `gh-thorn-whip` (+9 poder) muda o painel de Equipamento (✦ 6 → 15), porém o card continua idêntico ("❤ 152 ⚡ 20 6 PA · 3 PM") — o jogador não vê o efeito da arma onde escolhe o grupo (a classe `boosted` já está acesa pelo nível, então nem o realce muda).
- **Repro:** heroSelect → ⚒ Equipamento do Repique → equipar arma de +poder → fechar painel → comparar card antes/depois.
- **Dono sugerido:** Designer (`js/ui/hud.js`, `fillHeroCards` ~l.284-291 — acrescentar "✦ poder" na linha de stats do card).

### N2 — Save corrompido permanece no storage até a primeira mutação — **INFORMATIVO**
- `Progress.load()` detecta lixo e cai em estado limpo (correto, 0 erros), mas não regrava — o blob corrompido fica em `soterra-save-v1` até o primeiro `save()` de mutação. Inofensivo na prática (decisão "load() não grava" documentada no cabeçalho de `progress.js`); higienizar no load eliminaria a janela. Dono: Lógica, se quiser.

### N3 — Seleção de heróis persiste entre runs — **INFORMATIVO**
- Ao "Voltar à superfície" e entrar de novo em "A Descida", os cards da run anterior continuam selecionados. Defensável como conveniência (relembra o grupo), mas não é sinalizado — e um clique no card já selecionado o DESmarca, o que pode surpreender (derrubou um script deste QA). Sugestão: manter, mas documentar; ou limpar seleção ao concluir/derrotar. Dono: Designer.

### Pendências antigas (status)
- **B1 (médio, `Game.screen`)**: **CORRIGIDO** — verificado em runtime (`heroSelect`/`dungeonSelect` refletidos). ✔
- **B2 / B5 (baixos)**: **CORRIGIDOS** (ver R5). ✔ · **B3 (baixo)**: **TRATADO** (topo em brasa; `emberlock_ang0.png`). ✔
- **B4** (engine não valida unidade ativa), **B6** (Magno invicto em IA×IA — segue pedindo playtest humano), **B7** (`theme`≠`id`): inalterados, pendências aceitas.

## R7. Evidências e método

- Screenshots: `tests/qa_shots/fx_v4/` (14 imagens: 3 fases do bolt, 3 do melee, crítico, 3 dos decais, 3 da morte de chefe, ângulo axial do forge).
- Método: aba dedicada no servidor `jogo-static` (8137) com cache-buster `?qa=…` (build `?v=6` conferida via `JOGO.Progress` presente); painel oculto ⇒ todo teste com bombeamento SÍNCRONO (drenar `Engine.events` → handleEvent de Renderer/FX/UI/Game → `Game.update`/`UI.update`/`Renderer.render`), teto por `performance.now()`; screenshots via Chrome headless (`Start-Process -Wait`, `--virtual-time-budget` + `&frames=2&snap=N&fx=bt-*`).
- Estatística de sorte: 3.000 chamadas de `rollDrops` (sala do chefe = 6.000 sorteios) por configuração, com `Math.random` real; `Progress.save` temporariamente neutralizado só nesse teste de massa (12k gravações de localStorage com inventário crescente seriam O(n²)); o sorteio em si intocado. Sandbox restaurado ao final (byte-idêntico).

## R8. Veredito final

**APROVADO.** Regressão limpa (3 bugs antigos corrigidos e verificados, nenhum reaberto), expansão conforme contrato e GDD, FX v4 validado objetivamente. Bugs novos: **0 críticos · 0 altos · 0 médios · 1 baixo (N1) · 2 informativos (N2, N3)** — nada bloqueante.

---
---

# QA da Camada 3D — 17/08/2026

**Agente Revisor (QA) · regressão da integração 3D (Three.js/WebGL) no `index.html` (`?v=7`; ordem 8 vendors → data → env-kit → engine → ai → progress → game → models3d → fx3d → renderer3d → hud → main) · núcleo e HUD inalterados · ADENDO v3 do CONTRACT.md**

> **Sandbox de save:** snapshot de `localStorage['soterra-save-v1']` (483 chars) feito antes de qualquer teste; ao final o valor foi **restaurado byte-idêntico** (comparação de string confirmada) e a chave auxiliar de QA removida. O teste de save corrompido usou backup em chave separada, também limpa ao final. Headless roda em perfil próprio (não toca o save do painel).

## T1. Resumo executivo

> ## Veredito: **APROVADO**

A migração 3D preservou o contrato. As 3 suítes de núcleo passam intactas (**62/62 · 18/18 · 2631**, console limpo), o jogo real (`index.html?qa=…`) roda o fluxo completo por cliques DOM reais nos **3 calabouços sem uma única exceção JS em toda a sessão**, com IA dos dois lados, câmera orbital variando a cada frame (setCamera) e canvas WebGL sempre com conteúdo. O contrato de input do Renderer 3D está exato: **9/9 cliques → tile certo em 3 ângulos** (raycast é a inversa exata da projeção), arrasto gira sem clicar, zoom clampado nos dois extremos, HUD bloqueia clique e hover. Os 13 gatilhos de FX drenam `isBusy()` em **0,25–0,95 s** — nenhum resgate pelo watchdog de 3 s. Os 12 FX foram fotografados em 2 fases cada e inspecionados (30 PNGs em `tests/qa_shots/3d/`): projétil com luz própria, impactos com anel, números legíveis, invisível translúcido (opacity ≈0,26–0,38 verificada em runtime), morte de chefe em 3 atos. Progressão intacta: vitória → XP/drops salvos; derrota → save byte-idêntico. Performance com `gl.finish` @1440×900 com bloom: **9,4–12,2 ms idle · 11,3–12,8 ms durante nova** — dentro da referência da fase B (10–13 ms) e abaixo do teto de 16 ms.

**Contagem de bugs (novos desta rodada): 0 críticos · 0 altos · 0 médios · 2 baixos (N4, N5) · 1 informativo (N6) · 1 lacuna registrada (L1).**

## T2. Resultados por área

| # | Área | Método | Resultado | Números |
|---|---|---|---|---|
| 1 | Suítes de núcleo (não mudaram) | navegador, carga atual | ✅ PASS | `test_engine` **62/62** · `test_progress` **18/18** · `validate_data` **2631** · console limpo nas 3 |
| 2 | Módulos no jogo real | `index.html?qa=…` | ✅ PASS | THREE **r147** · `JOGO.ASSETS` **49** GLBs · Models3D/FX/Renderer/UI/Game/Progress presentes · `Models3D.isReady()` true · API completa (`init/render/handleEvent/isBusy/project/setCamera/unitWorld/hitDelay`) |
| 3 | E2E Estufa (cliques DOM reais) | trio Repique+Estopim+Morela | ✅ PASS | menu→heroSelect→dungeonSelect→battle (telas refletidas em `Game.screen`); sala 0 vencida (29 ações de herói via API de contrato); **+31 XP=floor(93/3)** p/ cada, 1 drop comum, salvo em localStorage (memória==storage); "Avançar"→sala 1 (rebuild da cena, 8 unidades), cura entre salas correta (106/140=80+... conferida na rodada anterior; heróis com HP parcial recuperado); 2 rodadas na sala 1 limpas; `restart()`→menu com `state null` |
| 4 | E2E Cisterna + derrota | trio Repique+Rosácea+Sibilo; HP forçado a 1, IA inimiga mata | ✅ PASS | 3 rodadas com câmera variando; derrota legítima → tela "Derrota…", **save byte-idêntico ao pré-batalha**; "Tentar de novo"→menu |
| 5 | E2E Fecho de Brasa | trio Estopim+Morela+Rosácea | ✅ PASS | 3 rodadas (22 ações), 0 exceções; `battleStart` destrava o isBusy residual do menu (ver N4) |
| 6 | Batalha c/ IA dos 2 lados + câmera girando | `setCamera` a CADA frame bombeado (ang+=0,05, tilt/zoom oscilando) | ✅ PASS | ~1.800 frames bombeados nas 3 batalhas; `project()` finito em todas as amostras (27 amostrais registradas); canvas com conteúdo em ang 0 / 2,1 / 4,4 (`toDataURL` 124–159 KB); busy streak máx **17 frames = 0,85 s** simulados (watchdog de 3 s nunca foi o destravador) |
| 7 | Contrato de input 3D | eventos reais mousedown/mousemove/mouseup/wheel no canvas | ✅ PASS | **9/9 cliques <6px → `Game.onTileClicked` com o tile EXATO em 3 ângulos (0,3 / 2,4 / 4,6)**; micro-arrasto de 2px ainda clica; arrasto de 80px gira (projeção de (0,0) move 369px) e NÃO clica; zoom clampado nos 2 sentidos (distância de tela entre tiles estabiliza: 69,7→1181 zoom-in, trava; →11,7 zoom-out, trava); clique sobre `#ui-root` ignorado; hover sobre HUD → `onTileHover(-1,-1)`; hover no canvas → tile correto |
| 8 | Overlays de feitiço | turno real de herói (Estopim) | ✅ PASS | sem feitiço: 3 quads de alcance; `selectSpell('wick-jump')`: **16 quads de alvo**; hover em alvo válido: **18** (alvos+AoE+hover); presença confirmada na cena via `Renderer._scene()` (18 PlaneGeometry aditivos visíveis); render sem erro; canvas muda |
| 9 | FX: drenagem | preview3d, 13 botões, bombeamento síncrono dt=0,05 | ✅ PASS | `isBusy()` drena após TODOS: move 0,25s · cast/slam/nova/beam/heal/poison/buff/summon/kill 0,5–0,6s · push 0,7s · bosskill 0,85s · tp 0,95s (cast 0,5 + teleporte 0,42 em série); **nenhum watchdog primário**; projéteis/números zeram ≤1,45s |
| 10 | FX: inspeção visual (29 PNGs) | Chrome headless + SwiftShader, 2 fases por FX | ✅ PASS c/ ressalvas | detalhe em T4; ressalvas N5 (números sobrepostos) e N6 (veneno na cisterna) |
| 11 | Performance | `__perf(n)` com `gl.finish` @1440×900, DPR 1, bloom ativo | ✅ PASS | idle: Estufa **10,38 ms** · Cisterna **11,52 / 11,69 / 12,22 ms** · Fecho **9,38 ms**; durante nova em área: Cisterna **11,32 ms** · Fecho **12,80 ms** (teto de alerta 16 ms; referência fase B 10–13 ms) |
| 12 | Bordas | resize / battleEnd / save corrompido | ✅ PASS | 2× `dispatch(resize)` + render sem erro; `battleEnd` zera `delayed` do FX na hora (transientes esvaem sozinhos por design e o próximo `battleStart` reseta pools); save com lixo → boot limpo, 0 erros, jogável, e higienização na 1ª mutação (comportamento N2 antigo mantido) |
| 13 | Console | sessão inteira (suítes + index + preview3d) | ✅ PASS | **zero erros** em todas as páginas do início ao fim |

## T3. Conformidade com o ADENDO v3 (leitura de código + runtime)

- `index.html` na ordem exata do adendo, cache-buster `?v=7` em todos os scripts ✔ (`js/render/*` 2D fora do index, preservados no repositório ✔)
- `js/main.js` e `js/core/*`/`js/ui/hud.js` **inalterados** (loop drena Renderer→FX→UI→Game como antes) ✔
- Vendors UMD r147 (`THREE.REVISION === '147'`), GLTFLoader + cadeia de bloom carregados antes dos módulos ✔
- GLBs embutidos: 49 entradas em `JOGO.ASSETS` (env-kit 2,95 MB ≤ orçamento de 10 MB) ✔
- MESMA API do contrato no lugar: `Renderer.init/render/handleEvent/isBusy` + `project/unitWorld/setCamera/hitDelay`; `FX.handleEvent` (+`bind/resize/onScene/update/render` internos); picking por raycast → `Game.onTileClicked/onTileHover` ✔
- Câmera órbita com clamps reais (tilt 0,9–1,35; zoom por sala), pivô fixo no centro ✔ · pixelRatio clampado ≤1,5 ✔ · sombras 1024 PCF a 30 Hz ✔ · bloom em meia resolução ✔
- `Engine`/`AI`/`Game`/`Progress`: nenhuma chamada nova exigida — headless "sem Renderer" continua suportado (`Game.update` só espera `isBusy` se `JOGO.Renderer` existe) ✔

## T4. FX 3D — verificação objetiva (evidências em `tests/qa_shots/3d/`)

- **bolt** (`bolt_20/42.png`): projétil de fogo em voo **com luz própria** (poça de luz laranja no piso sob ele, rastro de fagulhas) → impacto com clarão, luz na parede e **"18" legível** ✔
- **golpe** (`slam_14/35.png`): windup → impacto com anel no chão do alvo e **"31"** dourado ✔
- **nova** (`nova_20/40.png`): anel duplo expandindo + fagulhas + "22" ✔
- **feixe + crítico** (`beam_16/40.png`): feixe reto nítido conjurador→alvo atravessando o tabuleiro → **"47" gigante** (formato crit) com decal sombrio no chão ✔
- **cura + escudo** (`heal_20/45.png`): coluna ascendente verde + anel; números aparecem, mas **"+24" e "15" se sobrepõem** (ver N5)
- **veneno** (`poison_25/60.png`): impacto com halo no alvo ✔; nuvem residual de contraste fraco no tema cistern (ver N6)
- **buff + invisível** (`buffinvis_20/50.png` + runtime): coluna dourada no alvo do buff ✔; invisível **fica translúcido de verdade** — 13 materiais do modelo a opacity ~0,26 com shimmer (verificado via `_scene()`; no PNG o efeito é sutil pela paleta clara da Estopim) ✔
- **empurrão** (`push_14/40.png`): bigorna deslocada contra a parede + poeira + **"10"** de colisão ✔
- **teleporte** (`tp_14/35/50/62.png` + runtime): encadeia cast (0,5s) → blink; modelo some no origem e **reaparece exatamente no destino** (`unitWorld` == state (5,4)); anel de chegada ✔
- **invocação** (`summon_10/30.png`): anel de nascimento + burst; esporinho surge com pop e fica de pé ✔
- **matar monstro** (`kill_25/50.png`): flash + burst na cor do lado + "42"; corpo dissolve e some ✔
- **matar CHEFE** (`bosskill_25/45/80.png`): cinematográfico em 3 atos — coluna de luz branca + hit-stop + "64" → ondas + chefe desabando → **anel de choque duplo gigante** (branco+dourado) varrendo vários tiles com o chefe já dissolvido ✔
- Ambiente por tema visível nos 3 cenários (`scene_greenhouse/cistern/emberlock.png`): vagalumes/feixes de sol, cáusticas/bolhas/cortina d'água, fagulhas/grelhas rúnicas/tochas com flicker ✔

## T5. Bugs e observações (novos)

### N4 — `Renderer.isBusy()` fica preso em `true` no menu após derrota/restart — **BAIXO**
- **Sintoma:** morrendo unidades no fim da batalha, o dissolve (`deathK` 0→1 em 0,55s) só avança dentro de `render()` com batalha ativa; com `restart()` → `Game.state = null`, o `render()` retorna cedo e os `deathK` congelam em (0,1) — `isBusy()` responde `true` indefinidamente no menu (verificado: 40 frames bombeados no menu, segue `true`). O próximo `battleStart` reconstrói a cena e destrava (verificado no Fecho).
- **Impacto:** nulo no fluxo real (nada consulta `isBusy` fora de batalha), mas é o mesmo espírito do antigo B2 (busy retido por animação órfã) numa forma nova — páginas de teste e código futuro que espere `isBusy()` drenar fora de batalha travam.
- **Repro:** batalha com mortes → derrota → "Tentar de novo" → `JOGO.Renderer.isBusy()` no menu → `true` para sempre.
- **Dono sugerido:** Designer 3D (`js/render3d/renderer3d.js`) — em `battleEnd`, além de zerar filas, completar/zerar `deathK` das unidades (ou avançar os dissolves mesmo sem state no `render`).

### N5 — Números simultâneos no mesmo alvo se sobrepõem — **BAIXO**
- **Sintoma:** cura + escudo no mesmo instante desenham "+24" e "15" praticamente no mesmo ponto sobre a cabeça — lê-se "1524" (`heal_20/45.png`). Cada número isolado é grande e legível; só a colisão simultânea prejudica.
- **Dono sugerido:** Designer 3D (`js/render3d/fx3d.js`, `number()`) — offset horizontal/temporal quando já houver número vivo no mesmo âncora.

### N6 — Nuvem de veneno quase invisível no tema cistern — **INFORMATIVO**
- A fumaça do `poisonCloud` usa verde muito escuro (`#1c3012`, alpha 0,5) que some sobre o piso escuro da Cisterna (`poison_60.png`); na Estufa/Fecho contrasta melhor. Impacto e halo do cast continuam lendo o evento. Sugestão: clarear/saturar a fumaça ou adicionar borda luminosa por tema.

### L1 — Sem mensagem amigável se WebGL indisponível — **LACUNA REGISTRADA**
- Não testável neste ambiente (WebGL sempre disponível; headless exige `--enable-unsafe-swiftshader`). Pela leitura: `renderer3d.js` só protege contra `THREE` ausente (console.error + return); se `new THREE.WebGLRenderer` lançar (WebGL desligado), a exceção estoura dentro do `DOMContentLoaded` de `js/main.js` (sem try/catch) e **aborta também `UI.init()`/`Game.init()`** → tela preta sem qualquer aviso. Sugestão (Designer 3D + orquestrador): try/catch no `init` com mensagem pt-BR no `#ui-root`.

### Pendências antigas (status)
- **N1** (card sem "poder"), **N2** (save corrompido até 1ª mutação — comportamento re-verificado nesta rodada, segue inofensivo), **N3** (seleção persiste entre runs — re-observado no fluxo DOM; o script de QA desmarca antes de selecionar), **B4/B6/B7**: inalterados, pendências aceitas.
- **B2/B5 (2D)**: os equivalentes 3D estão implementados (`battleEnd` zera filas; `overUI()` em down/up/move) e foram verificados em runtime ✔ — com a ressalva nova N4 acima.

## T6. Evidências e método

- **Screenshots:** `tests/qa_shots/3d/` — 30 PNGs @1456×960 (12 FX × 2 fases + bosskill em 3 atos + 2 retakes de teleporte + 3 cenas por tema). Receita: Chrome headless via `Start-Process -Wait` com `--enable-unsafe-swiftshader --virtual-time-budget=3400 --screenshot`, página `tests/preview3d.html?dungeon=…&fx=bt-…&snap=N&frames=2` (snap espelha o canvas). Uma captura saiu preta por flake do headless (beam_40, 26 KB) e foi refeita com sucesso — não é bug do produto.
- **Método:** aba própria no servidor `jogo-static` (8137), cache-buster `?qa=…`; painel oculto ⇒ TODO o exercício via bombeamento síncrono (drenar `Engine.events` → handleEvent de Renderer/FX/UI/Game → `Game.update(0,05)` → `UI.update` → `Renderer.render`), tetos por `performance.now()`; heróis jogados por `AI.planTurn` executado pela API de contrato (`selectSpell`/`onTileClicked`/`endTurn`) esperando `isBusy()` entre ações; cliques de fluxo por DOM real; input por `MouseEvent`/`WheelEvent` reais no canvas; espião temporário em `onTileClicked/onTileHover` apenas nos testes de input (restaurado).
- **Perf:** `__perf(n)` da preview3d (n renders síncronos + `gl.finish`) no painel com viewport 1440×900, DPR 1 — variância entre amostras ≤0,7 ms.

## T7. Veredito final

**APROVADO.** A camada 3D implementa fielmente as APIs do contrato sobre um núcleo intocado: suítes 62/62 · 18/18 · 2631, E2E nos 3 calabouços sem exceções, input do renderer exato em 3 ângulos, FX drenando sem watchdog, progressão e sandbox de save intactos, perf 9,4–12,8 ms @1440×900 com bloom (teto 16 ms). Bugs novos: **0 críticos · 0 altos · 0 médios · 2 baixos (N4, N5) · 1 informativo (N6)**, mais a lacuna **L1** (fallback WebGL) a cargo do orquestrador/Designer 3D. Nada bloqueia a entrega.

---

# QA de Integração da v2 — 18/08/2026

**Agente Revisor.** Escopo: regressão e integração de **tudo que não depende da camada 3D**
(dados, motor, progressão, interface 2D, fluxo E2E no jogo real, desempenho e celular).
A camada 3D está sendo construída em paralelo por outro agente e **não foi avaliada**.

**Instantâneo auditado:** `628f560` (*roomFury no dado e xpTable recalibrada*), com
`js/render3d/*` sujos na árvore de trabalho (do outro agente). A árvore **se moveu três vezes
durante esta auditoria** (`92c35f6` salas maiores, `d1f677e` fúria da sala, `628f560` xpTable) —
onde isso muda um resultado, o texto diz explicitamente o antes e o depois.

**Sandbox de save:** `localStorage['soterra-save-v2']` foi fotografado antes de qualquer coisa
(529 bytes, save limpo do usuário: sumô + curandeira nível 1) e **restaurado byte a byte** ao fim
(conferido por comparação de string exata). Cópia de segurança fora do projeto durante a sessão.

---

## A. Suítes (carga atual, HEAD `628f560`)

| Página | Resultado | Observação |
|---|---|---|
| `tests/test_engine_v2.html` | **201 / 201** · 0 falhas | eram 186 antes de `d1f677e`; console só com `PASS`/`AUTO-PLAY` |
| `tests/test_progress_v2.html` | **143 / 143** · 0 falhas | não suja o save (snapshot/restore próprio) |
| `tests/validate_classes.html` | **6.161 / 6.161** · 0 falhas | **estava 6.143 com 9 falhas** no início da auditoria — ver B1 |
| `tests/validate_world.html` | **6.498 / 6.498** · 0 falhas | eram 6.397 antes das salas maiores |
| `tests/validate_fusion.html` | **3.674 / 3.674** · 0 falhas | — |
| `tests/art_gallery.html` | **578 / 590 · 12 FALHAS** ✘ | **regressão nova** — ver B2 (era 542/542 há uma hora) |
| `tests/ui_screens.html` | **93 / 93** · 0 falhas | mas apaga o save do jogador — ver B4 |
| `tests/preview2d.html` | **18 / 18** · 0 falhas | PixiJS 7.4.2 carregado, renderizador pronto |

Console limpo (zero `error`) em todas, exceto `art_gallery` (as 12 falhas) e `validate_classes`
enquanto estava vermelha.

---

## B. Bugs

### B1 — Economia de XP estava fora do contrato §9-D — **CORRIGIDO DURANTE A JANELA**

- **Sintoma:** `validate_classes.html` abriu a auditoria com **9 falhas**. A XP viva dos calabouços
  (`66 · 204 · 422 · 753 · 1.196 · 1.847`) era ~metade da usada para calibrar a `xpTable`
  (`133 · 385 · 844 · 1.531 · 2.427 · 3.628`). Em dupla, o calabouço 1 pedia **1,97 descidas por
  nível** (faixa 0,7–1,6) e o nível 30 saía em **151 descidas** (faixa 30–120).
- **Causa raiz (integração):** `monsters.js` (Criativo Mundo, `40ccbb2`) recalibrou a XP mirando a
  **fração de nível de um herói SOLO**; `progression.js` / `validate_classes.html` (Criativo Classes)
  mediam a mesma coisa para a **DUPLA**. O contrato §9-D não diz o tamanho do grupo.
- **Desfecho:** o Criativo Classes refez a `xpTable` em `628f560` adotando a **dupla** como
  referência (o comentário do arquivo agora declara `calabouço 1 → 0,94 nível` em dupla).
  Reverificado: **6.161/6.161, 0 falhas**. Fica registrada a decisão de interpretação tomada aqui:
  *a referência de calibragem do §9-D é a DUPLA*.
- **Pendência menor (BAIXO, Criativo Classes):** o comentário de `js/core/data/progression.js`
  ainda diz `xpTable[29] = 39.055`; o valor real da tabela é **28.180**.

### B2 — Cenário novo do adendo 9-F não tem desenho: 12 falhas em `art_gallery` — **MÉDIO**

- **Sintoma:** `tests/art_gallery.html` caiu de 542/542 para **578/590 com 12 falhas**, duas por
  tema: *"cenário X: as 4 descrições de ALTO dão desenhos distintos — 13 pares"* e o equivalente
  de BAIXO (19 pares), nos 6 temas.
- **Causa raiz (integração):** `92c35f6` (adendo v2.5, divisórias temáticas) cresceu
  `DATA.scenery[tema].high` de 4 → **6** e `.low` de 5 → **7** descrições (ex.: *"palmeira de
  estufa tombada de través"*, *"cerca-viva podada até a altura do peito"*), mas
  `js/render2d/art.js` não ganhou desenho para os nomes novos — eles caem no genérico e saem
  **pixel a pixel iguais** a outros (13 de 15 pares de ALTO colidem).
- **Impacto:** a promessa central do 9-F ("o espaço extra precisa virar estrutura … com a
  linguagem visual do tema") não chega à tela; salas maiores ficam repetitivas.
- **Repro:** abrir `tests/art_gallery.html` → seção de cenário → 12 falhas em `TEST_RESULTS`.
- **Dono sugerido:** Designer Arte (`js/render2d/art.js`); e atualizar o rótulo do teste em
  `tests/art_gallery.html`, que ainda diz "as 4 descrições" quando já são 6.

### B3 — A tela de recompensa mostra a XP **antes** do corte de profundidade — **MÉDIO**

- **Sintoma:** o painel de "Sala limpa"/"Calabouço vencido" anuncia uma XP que o herói **não
  recebeu**. Medido no jogo real: dupla nível 20 na Estufa (nível recomendado 3, multiplicador no
  piso `×0,10`) → painel **"+4 XP"**, `xp` dos dois heróis **antes 15.495 / depois 15.495**
  (ganho real **0**).
- **Causa:** `js/ui/hud.js:658` imprime `lastRewards.xpGanho`, que `js/core/game.js:536` documenta
  como *"XP da sala já dividida pelo grupo, **ANTES do corte**"*. O valor realmente entregue é
  `xpPorHeroi = floor(xpGanho × xpMult)`.
- **Contrato:** §9-D pede o oposto — *"`Game` informa o multiplicador aplicado no pacote de
  recompensa (`xpMult`) **para a UI poder explicar ao jogador por que ganhou menos**"*.
  `hud.js` **nunca lê** `xpMult`, `xpPorHeroi` nem `recommendedLevel` (grep: zero ocorrências).
- **Repro:** herói acima de `recommendedLevel + 4`, vencer qualquer sala, comparar o "+N XP" do
  painel com `JOGO.Progress.hero(id).xp` antes e depois.
- **Dono sugerido:** Designer Arte (`js/ui/hud.js`, bloco de recompensa ~656-658).

### B4 — `tests/ui_screens.html` **apaga o save do jogador** — **MÉDIO**

- **Sintoma:** basta abrir a página de testes da interface para perder o progresso real.
  `tests/ui_screens.html:94` faz `localStorage.removeItem('soterra-save-v2')` dentro de `seed()` e
  em seguida grava um save de demonstração (3 classes, itens, 40 pedras de cada, forja +3),
  **sem snapshot nem restauração**.
- **Comprovado:** meu snapshot inicial (529 bytes) virou um save de 1.357 bytes com
  `unlockedClasses: [sumo, curandeira, invocador]` e `cards {sumo:42,…}` só por eu ter aberto a página.
- **Referência de como fazer certo:** `tests/test_progress_v2.html:461-471` guarda e devolve o save.
- **Dono sugerido:** Designer Arte (`tests/ui_screens.html`).

### B5 — `index.html` fixa `?v=2` e serve JS velho: o jogo real rodou com a `xpTable` antiga — **MÉDIO**

- **Sintoma:** os arquivos de dados mudaram três vezes hoje; `index.html` continua com
  `?v=2` em **todos** os `<script>`. As páginas de teste usam `?v=Date.now()` e enxergam o dado
  novo; o **jogo** continua com o antigo em cache.
- **Comprovado:** com `628f560` já no disco (`xpTable[29] = 28.180`), o `index.html` recarregado
  ainda entregava `xpTable[29] = 56.345` — a suíte verde convivendo com um jogo cuja curva de
  progressão inteira estava **por um fator 2**. Confirmado buscando o arquivo com
  `XMLHttpRequest(…?fresh=…)`: o conteúdo servido já era o novo.
- **Impacto:** qualquer verificação feita "no jogo real" é inválida sem limpar o cache; e o
  jogador que abriu o jogo hoje continua com o balanceamento velho.
- **Dono sugerido:** Orquestrador (`index.html`) — o próprio arquivo manda *"Bump do `?v=N` a cada
  entrega"*; vale automatizar (carimbo de build) em vez de depender de disciplina.

### B6 — Raridade `lendario` é desconhecida da apresentação — **MÉDIO**

- **Sintoma:** as 4 peças do conjunto lendário do Coração Partido (`cp-heart-crown`,
  `cp-quicksilver-boots`, `cp-worldshell`, `cp-heart-horn`) aparecem com a **cor de item comum** e
  o rótulo em minúsculas sem acento.
- **Comprovado (DOM do jogo real):** rótulo `"Punho · lendario"` (o épico ao lado sai `"Punho ·
  Épico"`); as células recebem `--rc: #9aa4ae` (cinza de comum) enquanto o épico recebe `#ffc44d`;
  `JOGO.Art.rarityColor('lendario') === '#9aa4ae'`.
- **Causa:** `js/render2d/art.js:130-132` (mapa `RARITY` sem `lendario` → cai no `comum`),
  `art.js:4104` (brilho 0,25 = comum) e `art.js:4107` (1 pedrinha = comum);
  `js/ui/hud.js:69` (`RAR_PT` sem `lendario`, usado em `hud.js:1274` e `1369`).
- **Causa de fundo:** `items.js` introduziu uma 4ª raridade (`e500f90`) que o **CONTRACT_V2 §8
  ainda não define** (`rarity:'comum'|'raro'|'epico'`). `progress.js` e `validate_fusion.html` já a
  tratam; a camada visual, não.
- **Dono sugerido:** Designer Arte (`art.js`, `hud.js`, `css/style.css`) + Orquestrador (adendo no
  contrato oficializando `lendario`).

### B7 — Alvos de toque de 40 px (o contrato pede ≥ 44) — **BAIXO**

- `css/style.css:180` → `.btn-tab { min-height: 40px }`. Medido em 390×844: abas do Inventário
  (*Tudo / Punho / Passo / Casca / Lume*) a **40 px** e abas de herói da escolha de elemento a
  **40 px**. Todo o resto passa (menu 56, ações 44-56, miniaturas da forja 54×56).
- **Agravante de cobertura:** `tests/ui_screens.html:134` reprova só abaixo de **40**
  (`r.height < 40`), então a própria suíte de interface não pega a violação do §0.
- **Dono sugerido:** Designer Arte (`css/style.css` e o limiar do teste).

### B8 — Dados inertes no bestiário — **BAIXO**

- Varredura referencial completa (salas + `summon` em qualquer fonte de feitiço + `traits` +
  eventos de terreno): **2 monstros não são alcançáveis por nada**.
  - `mist-warbler` (*Cantarola-de-Névoa*, cisterna, `xp 6`, `summonOnly: false`): não está em
    nenhuma sala e nenhum feitiço o invoca.
  - `sporeling` (`summonOnly: true`): o único invocador (`sporeling-call`) existe apenas no
    `js/core/data.js` da v1, que a v2 não carrega.
- **Dono sugerido:** Criativo Mundo (`js/core/data/monsters.js`).

### B9 — `progression.js` foi editado por quem não é o dono — **BAIXO (processo)**

- `DATA.leveling.roomFury` foi acrescentado a `js/core/data/progression.js` (dono declarado no
  contrato §1: **Criativo Classes**) pela Lógica Combate, em `d1f677e`. O contrato é explícito:
  *"NUNCA edite arquivo de outro dono"*. O conteúdo em si está correto e testado — o problema é o
  precedente.
- **Dono sugerido:** Orquestrador (definir se `roomFury` é dado de Classes ou constante do Motor).

---

## C. Integração de dados (cruzada entre agentes) — **775 checagens, 0 falhas**

Todos os arquivos `js/core/data/*.js` carregados juntos pelo `index.html` real.

- **Feitiços:** todo `spellId` citado por classes (base + 4 caminhos), monstros, pets, invocações de
  fusão e itens existe em `spells` (171) · `monsterSpells` (129) · `petSpells` (8) ·
  `itemSpells` (13) · `fusionSpells` (9). **Zero órfãos reais**: `is-heart-whole` é o feitiço do
  conjunto `cp-set-heart` e os 5 `fus-*` pertencem aos `fusionSummons`.
- **Monstros:** os 66 `monsterId` de sala existem e pertencem ao calabouço certo; os 24 `summon`
  (incluindo os 5 `fusionSummons`, todos usados) e os 6 `split` (via `traits`) resolvem; 17 `trap`
  e 26 `weatherShift` apontam para feitiço/clima existentes.
- **Saque:** 48 entradas de `lootTable`, todas com item existente, do próprio calabouço, peso > 0 e
  `minRoom` válido; **todo item de um calabouço tem entrada na sua tabela**. Prefixos 1:1 com o
  calabouço (`gh` / `ci` / `em` / `av` / `mt` / `cp`, 8 itens cada).
- **Cartas:** 26 entradas de `cardDrops`, **nenhuma inerte** — as de `sumo`/`curandeira` (classes
  iniciais) não são lixo: viram **estrelas** pela regra do §9-B, e nenhuma entrada viola o
  `minDungeon` da carta. Taxa medida (4.000 sorteios por caso): **~59% solo · ~50% dupla**, só na
  sala 2; **0%** nas salas 0 e 1.
- **Conjuntos:** 12 `sets`, todos com 4 peças existentes, uma por espaço (`punho/passo/casca/lume`),
  mesmo `setId`/elemento/calabouço, e bônus de 2/3/4 peças preenchidos.
- **Pedras:** 5, uma por elemento, sem duplicata. `DATA.upgrade.nonScalingKeys = ['pa','pp']` presente.
- **Itens:** 12 por espaço; sanidade do §8/§9-C respeitada (`punho` no máximo +1 PA, `passo` +1 PP,
  `casca` 10–60 PV sem PA/PP, `lume` sempre com `grantsSpell` e sem PA/PP). Única divergência:
  a raridade `lendario` (B6).
- **Salas (pós adendo 9-F):** 18 salas de **17×15 a 23×19**, a do chefe sempre a maior do seu
  calabouço; densidade de obstáculo do interior entre **12,3% e 24,8%** (faixa do 9-F: 12–30%) ✔.
- **Vocabulário de efeitos:** 100% dentro dos 24 tipos fechados do §3; nenhum tipo estranho.

---

## D. Fluxo E2E no jogo real (`index.html`, cliques DOM, bombeamento síncrono)

**4 calabouços** exercitados (o roteiro pedia 3), com a IA jogando os dois lados pela API de
contrato (`selectSpell` / `onTileClicked` / `endTurn`), esperando `Renderer.isBusy()` entre ações.
**Zero exceções de JavaScript em toda a sessão** (`window.onerror`, `unhandledrejection` e
`console.error` instrumentados).

| Calabouço | Grupo | Resultado |
|---|---|---|
| Estufa Soterrada | dupla nv30 + itens + pets | **3/3 salas · calabouço vencido** |
| Cisterna dos Afogados | dupla nv30 + itens + pets | **3/3 salas · calabouço vencido** (carta + pet no chefe) |
| Fecho de Brasa | dupla nv15 + itens + pets | **3/3 salas · calabouço vencido** |
| Mina Trêmula | dupla nv26 + itens + pets | 2/3 salas · **derrota no chefe** (ver F) |
| Estufa (extra) | herói SOLO nv3 | derrota na sala 1 |
| Estufa (extra) | dupla nv10, fusão forçada | sala 0 vencida, derrota na sala 1 |

Verificado no caminho:

- **Menu → 1 herói / 2 heróis → calabouço → batalha → sala limpa → próxima sala → chefe →
  recompensa**, tudo por clique real no DOM (o botão "Confirmar" nasce `is-off` com 0 selecionados).
- **XP com multiplicador de profundidade:** dupla nível 10 na Estufa (rec. 3) →
  `xpMultiplier = 0,421875` = `0,75³` (3 níveis acima de `rec+4`) ✔ exatamente o §9-D;
  nível 15 no Fecho (rec. 11, dentro da graça) → `×1,0`, e aí o painel bateu com a XP real
  (+26, +50, +138 por sala). O erro de exibição fora da graça está em B3.
- **Saque, pedras e cartas:** itens caem com o nome certo; as pedras vêm do **elemento do monstro
  morto** (Estufa derrubou `stone-root` de terra e `stone-breath` do ar, da vespa) ✔; carta do chefe
  da Cisterna: *"+1 Invocador — 1 / 10 para liberar"* ✔; pet novo (*Borbulha*) no mesmo painel ✔.
- **Cronômetro (§9 [G2]):** turno começa em 30 s; gastos 4,3 s, sobraram 25,7 s; ao encerrar o
  turno o resto foi para o banco e o turno seguinte mostrou **55,7 s** ✔ (`bankMax` 120).
- **Cancelamento de feitiço (§9 [G3]):** com feitiço selecionado, clique fora da zona válida
  **desmarcou** e devolveu o modo de movimento — `pa` 6→6, `pp` 3→3, PV dos inimigos inalterados,
  turno seguiu do mesmo herói. Depois, o mesmo feitiço conjurado normalmente gastou 3 PA ✔.
- **Fusão declarada e resolvida em combate real:** `declareFusion` cobrou 2 PA (6→4), marcou
  `mustEndTurn`, e `Fusion.resolve` fundiu no fim do turno. Unidade resultante
  `fus:curandeira+sumo`: `hp 345` (190+155) · `hpMax 350` (195+155) · `paMax 8` (6+2) ·
  `ppMax 4` (3+1) · `shield 50` · `level 10` (média) · `initiative 55` (máximo) ·
  `elemPower 18` (média) · `unitElements = ['fogo','agua']` · feitiços gerados
  `fus:curandeira+sumo:fogo+agua:0` e `:5`, resolvendo para *Amparo Escaldante* e *Chamado
  Escaldante* ✔. O herói B saiu do tabuleiro e **não conta para derrota** ✔. Evento `fusion`
  emitido; ao morrer, `fusionEnd` ✔.
- **Eventos observados em batalha real:** `weatherTick` (160+), `dodgeOk`/`dodgeFail`,
  `tileEventSpawn`/`tileEvent`/`tileEventExpired`, `petSpawn`/`petAct`, `summon`, `markStack`,
  `dispelShield`, `reflect`, `cleanse`, `timerTick` — todos drenando sem travar.
- **Escolha de elemento pela interface:** tela com os 4 caminhos e os 6 feitiços de cada,
  confirmação em folha ("É **irreversível**"), efeito imediato em `spellsFor` e em
  `effectiveStats` (nível 10: `power 9` dos níveis 2-4 + `elemPower 18` dos níveis 5-10, §9-C) ✔;
  segunda tentativa de trocar recusada ✔.
- **Renderizador:** `Renderer.isBusy()` **não** fica preso após derrota nem no menu (o defeito N4
  da camada 3D **não existe** aqui); `strayNodes()` vazio em batalha; 5 ciclos
  batalha→menu→batalha mantêm `objects`/`floor` constantes (97/172) — sem vazamento.

---

## E. Progressão de longo prazo (simulada com o sandbox)

Simulação fiel ao caminho real de recompensa (`Math.floor(xpTotal / grupo)` por sala →
`Math.floor(× xpMultiplier)`, mais `rollDrops` / `rollPet` / `rollCards` / pedras por
`stoneDrop` de cada monstro morto), sempre descendo **no calabouço mais fundo liberado**.
Números com a `xpTable` **corrigida** (`628f560`).

**30 descidas em dupla, do zero:**

| Marca | Quando |
|---|---|
| Nível 1 → 7 | descidas 1-9 (Estufa, +33 XP por descida) |
| Nível 7 → 11 | descidas 10-18 (Cisterna, +101) |
| Nível 11 → 15 | descidas 19-30 (Fecho, +211) |
| **Invocador liberado** | descida **27** (10 cartas, Fecho — `minDungeon 1` respeitado) |
| ★1 da Curandeira | descida 30 (6 cartas) |
| Acervo | 16 itens · 3 pets · 749 pedras · 3 classes liberadas |

`xpMultiplier` ficou em **×1,00 a run inteira** — o corte do §9-D só morde quem insiste no raso,
que é exatamente o objetivo do adendo.

**Até o nível 30:** **78 descidas em dupla** · **39 solo** (a faixa da suíte é 30-120 ✔).
Desbloqueios em dupla, todos respeitando `minDungeon`: invocador d27 (nv15) · bruxo d52 (nv22) ·
espadachim d59 (nv25) · **arqueiro não sai** dentro da corrida até o 30 (21 de 25 cartas) — cauda
longa provavelmente deliberada, mas vale a decisão consciente: **a última classe só chega depois do
nível máximo**.

**Forja:** verificada peça a peça até **+10**. Custos gastos `2·3·4·6·8·10·13·16·20·25`
(**107 pedras**, idêntico ao `DATA.upgrade.stoneCost`); tiers Comum → Raro (+3) → Supremo (+6) →
Magnífico (+10); +11 recusado. Pedra de **elemento errado recusada** (500 pedras de fogo intactas
diante de um item de terra) e item **neutro aceita qualquer pedra** ✔. Escala correta:
bônus base `{pa: 1, power: 14}` no +10 → `power 31` (= 14 × 2,2) e `pa` **não escala**
(`nonScalingKeys`) ✔. Determinístico, nunca regride ✔.

**Observação de economia (BAIXO):** as pedras sobram muito — 3.364 acumuladas nas 78 descidas
contra 107 de um item completo no +10. A forja, hoje, não é um sumidouro de recurso; é um
formalismo. Vale ao Criativo Fusão decidir se quer isso.

---

## F. Dificuldade: a IA do jogador perde muito (observação de jogabilidade) — **MÉDIO**

Não é falha de teste — as suítes só exigem que a batalha **termine**. Mas o retrato é consistente
e merece decisão humana:

- Auto-play do `test_engine_v2` (18 salas × 3 grupos): o **herói solo nível 15 perde nas 18 salas**;
  a **dupla nível 30 com pets perde metade das salas profundas** (perde em `windscaffold[2]`,
  `quakemine[0]`, `quakemine[2]`, `brokenheart[0]`, `brokenheart[2]`).
- No meu E2E, o chefe da Mina Trêmula (`boss-deepknock`) levou **26 de dano em 35 rodadas** contra
  uma dupla nível 26 com conjunto completo e pets: `m-vein-call` (custo 3 PA, recarga 1, **sem
  teto**) repõe `ore-chip` mais rápido do que a IA limpa, e `m-quake-stance` ainda dá escudo e
  reflexo. A IA nunca focou o chefe.
- A **fúria da sala** (`roomFury`, `d1f677e`) entrou justamente para acabar com esses empates — e
  acaba, mas convertendo o impasse em **derrota** na rodada 40. O empate virou derrota, não vitória.
- **Recomendação:** playtest humano do chefe da Mina Trêmula e do Coração Partido antes de
  aprovar o balanceamento; se a IA for a referência, `m-vein-call` precisa de teto de invocações
  vivas e a `AI.planTurn` precisa de prioridade para o chefe.

---

## G. Casos de borda — **todos aprovados**

| Caso | Resultado |
|---|---|
| Grupo de **0** | botão "Confirmar" nasce `is-off`, clique não faz nada; `Game.startRun([], …)` → `false` |
| Grupo de **3** | `Game.startRun(['sumo','curandeira','invocador'], …)` → `false` |
| Herói repetido / calabouço inexistente | `false` nos dois |
| **Item em espaço errado** | impossível por construção: `Progress.equip` deriva o espaço do próprio item e ignora um 3º argumento de slot — nunca gera estado inválido |
| **Item já equipado em outro herói** | `equip` → `false`; `equippedBy` responde `'sumo'`; nada muda no outro herói (§9-B) |
| **Forja sem pedras** | `upgradeInfo.temPedras = false`, `upgradeItem` → `false`, nível intacto |
| **Forja com pedra do elemento errado** | recusada, pedras não consumidas |
| **Elemento antes do nível 5** | `Progress.chooseElement` e `Game.chooseElement` → `false`; no nível 5 aceita; elemento inexistente e `'neutro'` recusados; escolha irreversível |
| **Save corrompido** (9 variantes: lixo, `{}`, array, `null`, `heroes` string, classe fantasma, nível 9999 / xp 1e12, versão 9999, formato v1) | **nenhuma exceção**; cai no padrão limpo (sumô + curandeira nv1), descarta classe/item inexistente, corta nível absurdo em 30, ignora o save v1; `startRun` continua funcionando em todos |
| **`localStorage` negado** (`getItem`/`setItem`/`removeItem` lançando `SecurityError`) | `load` cai no padrão, `save()` devolve `false` sem lançar, XP/itens/reset funcionam em memória, batalha completa e volta ao menu — **zero erro de console** |

---

## H. Desempenho e celular

**Desempenho** (`Renderer.perfProbe(120)`, viewport 390×844, DPR 2 → tela de 780×1688,
painel oculto com SwiftShader — números **relativos**):

| Sala | Grade | Objetos / chão / unidades | ms por render |
|---|---|---|---|
| Estufa sala 0 | 17×15 | 98 / 172 / 7 | **2,16 ms** |
| Fecho sala 2 (chefe) | 21×17 | 136 / 238 / 11 | **2,77 ms** |
| Coração sala 2 (a maior) | 23×19 | 160 / 292 / 13 | **2,59 ms** |

Regime estável folgado dentro dos 16,7 ms de 60 fps, **mesmo com as salas maiores do adendo 9-F**.
Uma única medição destoou (**15,8 ms/quadro** na primeira batalha logo após carregar a página, com
`busy: true` e FX de abertura) — custo de aquecimento (upload de textura/shader), não reprodutível
depois. Quadro completo (drenagem + `Game.update` + `UI.update` + `render`): 13–28 ms nesse mesmo
aquecimento, 3-5 ms depois.

**Retrato de celular 390×844** (auditoria de DOM no jogo real, não em maquete):

- **Nenhum transbordo horizontal em nenhuma tela**: `documentElement.scrollWidth === 390` no menu,
  seleção de heróis, seleção de calabouço, batalha, Coleção, Inventário e Forja; zero elementos
  além da largura.
- A faixa de itens da Forja é um **rolador horizontal legítimo** (`overflow-x: auto`,
  360 visíveis de 834), com miniaturas de 54×56.
- **Alvos ≥ 44 px em tudo, menos as abas** — ver B7 (40 px).
- Canvas correto: 390×844 CSS / 780×1688 de buffer (DPR 2).
- HUD de batalha em retrato traz ordem de turno, cartão da unidade ativa, PA/PP em pips,
  cronômetro, botão **FUNDIR**, feitiços e "Encerrar turno" sem cortar nada.

---

## I. Lacunas e limitações desta auditoria

- **Camada 3D não avaliada** (por atribuição). `index.html` hoje carrega `js/render2d/*`.
- **A árvore se moveu durante a auditoria** (3 commits + arquivos sujos). Os resultados valem para
  `628f560`; `art_gallery` foi a última a ser reexecutada e está vermelha **agora**.
- **`recommendedLevel` não aparece em lugar nenhum da interface** — sem isso o jogador não tem como
  saber onde descer para não cair no corte de XP. Somado ao B3, o sistema do §9-D é invisível.
- **Seleção de heróis persiste entre runs** (`UI.selection` não é limpa ao voltar ao menu):
  reaparece "Escolhido 1" ao abrir a tela de novo. Cosmético; é o antigo N3 da v1, ainda vivo.
- **Estrelas ★2+ são inalcançáveis numa jogada normal**: as classes iniciais terminam a corrida ao
  nível 30 com 10-13 cartas (★2 pede 15 excedentes). Pode ser intencional (cauda longa), mas nunca
  foi declarado.
- **Ferramenta nova:** criei `tests/qa_mobile_frame.html` — o Chrome headless desta máquina ignora
  `--window-size` e entrega viewport de 504×692, cortando a captura em vez de reduzir o layout; a
  moldura embute a página num iframe de exatamente 390×844 para fotografar o mobile de verdade.

**Evidências:** `tests/qa_shots/v2/` — 9 capturas em 390×844 (menu, seleção de heróis, seleção de
calabouço, batalha, sala limpa, inventário, forja, coleção, escolha de elemento).

---

## J. Veredito

**APROVADO COM RESSALVAS.**

O núcleo está sólido: 775 checagens de integração de dados sem uma única inconsistência, quatro
calabouços percorridos de ponta a ponta no jogo real sem uma exceção de JavaScript, fusão
declarada e resolvida em combate com todos os números do contrato batendo, cronômetro com banco,
cancelamento de feitiço que não gasta ação, forja determinística até o +10, e uma robustez de save
excelente (9 formatos corrompidos e `localStorage` negado sem quebrar nada). O desempenho aguenta
as salas maiores do adendo 9-F com folga em retrato de celular.

O que segura a aprovação plena são **cinco defeitos médios de integração**, todos entre donos
diferentes e nenhum deles no motor: a arte não acompanhou o cenário novo (B2, suíte vermelha), a
interface mente sobre a XP (B3) e ignora a raridade lendária (B6), a página de teste da interface
apaga o save do jogador (B4) e o `index.html` serve JS velho (B5) — este último é o mais
traiçoeiro, porque faz uma suíte verde conviver com um jogo desatualizado.

Some-se a isso a **observação F**: com a IA no comando, o grupo perde metade das salas profundas e
o chefe da Mina Trêmula é praticamente imortal. Isso precisa de um humano jogando antes de
qualquer selo de balanceamento.

**Contagem de bugs desta rodada: 0 críticos · 0 altos · 5 médios (B2, B3, B4, B5, B6) · 4 baixos
(B7, B8, B9 e o comentário defasado da `xpTable`) · 1 observação de jogabilidade (F).**
**1 defeito médio encontrado e corrigido dentro da janela (B1).**

**Números das suítes:** 201 · 143 · 6.161 · 6.498 · 3.674 · **578/590 (12 falhas)** · 93 · 18.
