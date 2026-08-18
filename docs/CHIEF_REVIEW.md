# SOTERRA — Ecos do Mundo Enterrado · Revisão do Agente Chefe

**Data:** 16/08/2026 · **Build avaliada:** working tree de `C:\Users\danie\Documents\Jogo` (pós-arte v2 e pós-correções B1/B2/B3/B5)
**Papel:** avaliação final e veredito. Nenhum arquivo do jogo foi alterado por esta revisão.

---

## Veredito: **APROVADO**

O jogo cumpre integralmente o pedido do usuário: tabuleiro tático por turnos em grade isométrica no espírito Dofus/Wakfu, 5 raças originais com identidade forte, 23 monstros mecanicamente distintos, 3 calabouços × 3 salas com personalidade própria, câmera 360° por arrasto com personagens **direcionais de verdade** (frente/perfil/costas aparecem ao girar — exatamente o que o usuário exigiu na rejeição da arte v1), FX com carga/impacto/hit-stop, HUD completa e bonita, zero erros de console e desempenho com folga. Verifiquei tudo isso de forma independente — suítes, fluxo E2E jogado por mim com cliques DOM reais, câmera com eventos reais de mouse, e evidência visual em mais de 20 screenshots — e não encontrei nenhum defeito bloqueante.

---

## 1. Metodologia (verificações independentes desta revisão)

Não confiei apenas nos relatórios anteriores; refiz ao menos uma verificação de cada tipo na carga atual:

| Verificação | Método | Resultado |
|---|---|---|
| Suíte do motor (`tests/test_engine.html`) | navegador, `window.TEST_RESULTS` | **62 PASS / 0 FAIL** ✔ |
| Validação de dados (`tests/validate_data.html`) | navegador | **2122 checagens OK** ✔ |
| Galeria de sprites (`tests/sprite_gallery.html`) | navegador | **PASS — 29 fichas × 4 direções, 0 faltando, 0 erros** ✔ |
| Fluxo completo jogado por mim | cliques DOM reais (menu → 3 heróis → Estufa) + bombeamento síncrono do loop; heróis dirigidos por `JOGO.AI.planTurn`, ações executadas pela API de contrato (`Game.selectSpell`/`onTileClicked`/`endTurn`) | **Estufa vencida de ponta a ponta** (chefe na rodada 10, 164 ações de herói, ~2.900 frames bombeados), transições `battle→roomClear→battle→…→dungeonComplete` corretas, **0 exceções, 0 erros de console** ✔ |
| Regra entre salas | conferência aritmética automática nas 2 transições | 6/6 heróis: vivos curam exatamente 50% do HP perdido (fórmula exata) ✔ |
| `Game.screen` (fix B1) | avaliado ao vivo durante o fluxo | `menu → heroSelect → dungeonSelect → battle` refletidos corretamente ✔ |
| Banners | leitura do DOM | "Sala limpa!" / "Fecho selado!" / "Derrota…" com textos de sabor corretos; "Voltar à superfície" retorna ao menu com `Game.state === null` ✔ |
| Câmera 3D | `MouseEvent`/`WheelEvent` reais no canvas | clique→tile exato **antes e depois** de girar (arrasto de 250px moveu o tile 164px na tela); zoom por roda funciona; 0 erros ✔ |
| Desempenho | 60× `Renderer.render(0.016)` em batalha no Fecho | **4,4 ms/frame** no meu ambiente (QA mediu 5,4–6,1 ms @ 1440×900; orçamento 12 ms) ✔ |
| Conformidade | grep + leitura | sem `console.*`/`alert`/`fetch`/imagens externas/ES modules; ordem de scripts do `index.html` exata ✔ |
| B6 (chefe final) | 3 execuções IA×IA adicionais contra Magno (headless, Engine+AI diretos) | 3 derrotas (Magno em 384/420, 243/420 e 150/420) — análise na §3.2 |
| Evidência visual | inspeção de screenshots v2_*/v3_* e `tests/qa_shots/` | análise na §2 (Arte/UI) |

---

## 2. Avaliação por área

### 2.1 Agente Criativo (universo + dados) — **9,5/10**
- A premissa ("o céu virou pedra; o mundo É os calabouços") é original e resolve com elegância a restrição de design "só calabouços" — o lore justifica a estrutura do jogo em vez de decorá-la.
- As 5 raças são genuinamente originais (povo-sino, povo-vela, povo-fungo, povo-vitral, povo-fole) e desenhadas **silhueta-primeiro**, com paletas e traços raciais que viram mecânica de verdade nos kits dos heróis.
- Papéis táticos sem sobreposição (tanque/assassina/invocadora/suporte/controle) e cada um dos 23 monstros responde a "o que ele faz de diferente?" — torretas `pushImmune`, bombas que explodem ao morrer, divisores, curandeiros com aura, atirador que fica invisível, atiradora que só acerta em linha e te puxa de volta para ela. Os 3 chefes têm gimmicks distintos e legíveis (a poda / o baile / a fornalha que respira).
- As salas ensinam conceitos deliberadamente (flanco, prioridade de alvo, empurrão contra buracos, formação) — design de calabouço à altura da referência Dofus/Wakfu.
- O GDD é excepcional: inclui direção de arte acionável (§6) e racional de balanceamento (§7) que os outros agentes claramente usaram.
- Desconto mínimo: a duplicidade `theme`/`id` (B7) nasceu aqui.

### 2.2 Agente de Lógica (motor/IA/fluxo) — **9,5/10**
- 62/62 testes; 2122 checagens de dados; meus casos ao vivo (fluxo completo, regra entre salas, cliques, câmera) passaram todos sem uma única exceção.
- `engine.js` é determinístico (RNG semeado), sem DOM, com **todas as decisões de design não especificadas pelo contrato documentadas no cabeçalho** (semântica de cooldown, direção de push/pull, colisão, lifesteal, split, enrage, LoS) — prática exemplar.
- A IA respeita taunt/invisível, tem papéis distintos por monstro e conduz inclusive as invocações do jogador; o fluxo (`game.js`) ritma a IA com `Renderer.isBusy()` e funciona headless para testes, como o contrato pede.
- Desconto mínimo: a IA de heróis não planeja teleporte/swap (decisão documentada) — correta para monstros, mas reduz a força do auto-play usado em testes de balanceamento (ver B6).

### 2.3 Agente Designer — Arte/FX (v2) — **8,5/10**
- **A exigência central do usuário foi atendida.** Os personagens são turntables paramétricos com detalhamento específico por direção — e não truques de espelhamento: a placa de memória nas costas do Repique, o laço fúnebre atrás da Jardineira, o amarração do espartilho nas costas da Baronesa, o caldeirão do Seiveiro que some quando ele está de costas. Comparei screenshots dos mesmos elencos em ângulos opostos (ex.: `v2_cistern_a0_6.png` × `v2_cistern_a3_7.png`) e as costas/perfis aparecem de verdade ao girar. A galeria (29 fichas × 4 direções) confirma unidade a unidade.
- **Luz fixa no mundo** (`LIGHT_W` em `renderer.js`): sombras e faces iluminadas trocam de lado coerentemente com a rotação — é isso que "vende" o 3D.
- Os 3 temas têm personalidade imediata: Estufa (verde-dourado, vagalumes, sebes), Cisterna (azul profundo, buracos d'água luminosos, águas-vivas), Fecho de Brasa (piso-grelha rubro, topo das muretas em brasa — correção B3 confirmada em `v2_emberlock_ax0.png`, legível mesmo no ângulo axial que era o problema).
- FX: círculo de conjuração + antecipação, bursts elementais, números de dano fortes, nova em área com anel, shake proporcional e micro hit-stop — o combate tem "peso" (`v2_fx_*.png`, `v3_fx_impacto.png`).
- Silhuetas: pinte tudo de preto e Repique ainda é uma cúpula, Estopim uma gota com chama, Morela um guarda-chuva — o teste do GDD passa. Chefes 2–3× maiores com adereço memorável (martelo-chaminé do Magno).
- Descontos honestos: o traço "fofinho/chibi" é mais simples que o acabamento de um Dofus comercial (proporções muito parecidas entre monstros pequenos; Cinzento e Monte de Escória são as fichas menos legíveis do elenco); em zoom padrão alguns detalhes direcionais ficam sutis. Nada disso compromete identidade ou leitura tática.

### 2.4 Agente Designer — UI/HUD — **8,5/10**
- Telas pré-batalha bonitas e informativas: cards de herói com retrato animado, papel, stats, traço racial e chips de feitiço; cards de calabouço com arte temática, dificuldade em pips e nome do guardião ("Os Fechos Doentes" é um belo título de tela).
- HUD de batalha completa: timeline de iniciativa com retratos e HP, painel do ativo com PA/PM em pips, barra de feitiços com custo/recarga/estado, tooltips ricos, log de combate com texto de sabor em pt-BR correto, "Encerrar Turno" com estado desabilitado fora do turno.
- Banners de fim de sala/calabouço/derrota com escrita afiada ("A Grande Lousa desce mais um palmo").
- Descontos: log renderiza só as 8 últimas linhas (histórico de 40 inacessível); tooltip sem clamp vertical — polimentos já listados pelo QA (§6), não bloqueantes.

### 2.5 Agente Revisor (QA) — **9,5/10**
- Relatório rigoroso, reprodutível e honesto: 12 áreas, 15 casos de borda, câmera verificada por eventos sintéticos em 4 ângulos, screenshots inspecionados, conformidade de contrato item a item, severidades bem calibradas.
- Tudo o que re-testei desta revisão (suítes, E2E, regra entre salas, câmera, banners, fixes B1/B2/B3/B5) confirmou as afirmações do relatório — nenhuma divergência encontrada.
- As 4 correções que o QA motivou estão de fato no código: B1 (`navTo` → `Game.goTo`, hud.js l.56), B2 (`ANIM_WATCHDOG` 3s, renderer.js l.48), B3 (topo em brasa), B5 (`overUI`, renderer.js l.191).

---

## 3. Análise das pendências

### 3.1 B4 — Engine.move/cast não validam unidade ativa · **ACEITO (não corrigir)**
O racional do orquestrador é sólido e eu o endosso:
- O contrato define `Engine.move` como "valida, gasta PM" — validação de **legalidade do movimento**, não de autorização de turno; a checagem de turno nunca foi atribuída à Engine.
- A separação é arquiteturalmente correta: Engine = sandbox de regras headless (usada pelos testes exatamente assim, com unidades arbitrárias); **Game** é a camada de autorização — e verifiquei no código que `Game.onTileClicked`/`endTurn` guardam com `isPlayerTurn()`/`activeUnit` (game.js l.170–207), e que a condução de IA só executa ações da unidade ativa.
- No fluxo real nada viola a regra (meu E2E completo com 164 ações não produziu nenhuma ação fora de turno).
Sugestão de custo zero (não exigência): uma linha no cabeçalho de `engine.js` dizendo "autorização de turno é papel do Game".

### 3.2 B6 — Magno invicto em IA×IA · **NÃO BLOQUEIA, com recomendação**
Ampliei a evidência: rodei mais 3 tentativas IA×IA na Câmara do Coração (partys toll+rose+wick, toll+morel+rose, wick+morel+whistle) — 3 derrotas, com Magno terminando em 384, 243 e **150**/420 HP. Somadas às 3 do orquestrador, são 6 derrotas de IA. Minha análise:
- **O auto-play subestima o jogador humano por construção**: a IA de heróis não usa teleporte/swap (documentado em ai.js), não concentra fogo, não protege a retaguarda dos empurrões do `m-bellows-blast` e não prioriza o Ferreiro. As mesmas IAs venceram as 8 demais salas (incluindo 2 chefes) em todas as execuções registradas — o gap é específico do topo da curva.
- **O orçamento numérico fecha para um humano**: um time focado (ex.: Repique+Rosácea+Sibilo) entrega ~100–120 de dano/rodada no chefe após controlar os lacaios (Sibilo ignora as resistências de fogo/terra da família), contra 420 HP → ~6–8 rodadas, dentro do TTK de chefe previsto no GDD (6–9); a mitigação do time (provocação + escudos 25/35 + curas 24–30×2 + redoma) cobre o output pré-enrage de Magno (~50–70/rodada). O enrage a 50% (+40) cria a corrida final tensa — que é o design declarado.
- **Contexto de gênero**: chefe final do calabouço "difícil" punir composição errada (Estopim, de fogo, contra família com 25–40 de resistência a fogo) é profundidade à la Dofus, não defeito.
**Recomendação (não exigência):** um playtest humano do Magno antes de qualquer distribuição; se ele se provar impossível, o ajuste fino é uma alavanca pequena em `js/core/data.js` (dono: Criativo — ex.: HP 420→390 ou enrage +40→+30).

### 3.3 B7 — `theme` ≠ `id` nos calabouços · **NÃO BLOQUEIA**
String mágica duplicada (`garden`/`greenhouse`, `forge`/`emberlock`) tratada em pontos diversos de renderer/sprites. Sem impacto funcional (2122 checagens de dados + evidência visual dos 3 temas corretos). É dívida de higiene com risco só em extensão futura. **Recomendação:** unificar num vocabulário (donos: Criativo + Designer), junto com os polimentos da §6 do QA.

---

## 4. Recomendações não bloqueantes (herdadas e endossadas)

1. Playtest humano do Magno (§3.2) — dono: Criativo (`js/core/data.js`) se precisar de ajuste.
2. Unificar `theme`/`id` (§3.3) — Criativo + Designer.
3. Log com scroll do histórico de 40 linhas e clamp vertical do tooltip — Designer (`js/ui/hud.js`).
4. Cache de retratos da timeline e cache por turno dos overlays (`reachable`/`castTargets` por frame) — Designer.
5. Nota de uma linha sobre autorização de turno no cabeçalho da Engine (§3.1) — Lógica.

---

## 5. Veredito final

> ## **APROVADO**

**Justificativa resumida:** o jogo está genuinamente bom — não apenas funcional. O motor é sólido e testado (62/62 + 2122 checagens + meu E2E com 0 exceções), o combate é tático e legível (posicionamento, empurrões contra buracos, provocação, venenos, invocações — tudo funcionando e comunicado pela UI), a arte v2 resolveu exatamente o que o usuário rejeitou (personagens com costas/perfis reais ao girar a câmera 360°, luz coerente fixa no mundo, FX com impacto), os 3 calabouços têm personalidade visual e mecânica própria, e as 5 raças/heróis são originais com papéis táticos distintos. As três pendências abertas (B4/B6/B7) foram analisadas e nenhuma bloqueia: B4 é uma decisão arquitetural correta, B6 é dificuldade de chefe final compatível com o gênero (com recomendação de playtest humano), B7 é higiene de código sem efeito no jogador.

**Notas:** Criativo **9,5** · Lógica **9,5** · Arte/FX **8,5** · UI/HUD **8,5** · QA **9,5** — média ponderada da experiência entregue: **≈9/10**.

*— Agente Chefe, 16/08/2026*

---

# Reauditoria v3 — 17/08/2026

**Escopo:** auditoria focada no DELTA da revisão de arte v3, feita depois que o usuário rejeitou dois aspectos da arte v2 **já aprovada** pela auditoria acima. Nada da 1ª auditoria é apagado; o que segue avalia se a v3 resolve as duas reclamações **sem regredir** o que estava aprovado.

**Reclamações do usuário (pós-aprovação):**
1. *"Tô achando essa visão 3D dos personagens muito ruim"* — o turntable paramétrico contínuo da v2 gerava poses "borrachudas" em ângulos intermediários.
2. *"O campo deve ser estático e conseguir mover somente a câmera, não o campo junto… e ele está flutuando"* — o tabuleiro lia como um diorama girando solto num vazio.

## R1. Metodologia desta reauditoria (verificações independentes)

| Verificação | Método | Resultado |
|---|---|---|
| Suíte do motor (`tests/test_engine.html`) | navegador, `window.TEST_RESULTS` | **62 PASS / 0 FAIL** ✔ |
| Galeria de sprites (`tests/sprite_gallery.html`) | navegador, status da página | **"PASS — 29 fichas × 4 direções, 0 faltando, 0 erros"** ✔ |
| E2E curto no `index.html` | cliques DOM reais (menu → 3 heróis → Confirmar Descida → Descer/Estufa) + bombeamento síncrono; heróis dirigidos por `JOGO.AI.planTurn` com ações **pela API de contrato** (`Game.selectSpell`/`onTileClicked`/`endTurn`) | 3 rodadas jogadas (19 ações de herói), `menu→heroSelect→dungeonSelect→battle` refletidos em `Game.screen` (B1 vivo), **0 exceções, 0 erros de console/window** ✔ |
| Varredura de câmera 360° **simultânea** ao combate | `Renderer.setCamera` avançando o ângulo a cada frame bombeado | **359° varridos durante as 3 rodadas**, 0 exceções ✔ |
| Pivô ancorado (reclamação 2) | centro do tabuleiro projetado por `Renderer.project` em **12 poses** (ângulo × tilt × zoom variados) | **deriva 0,00 px** — o campo não translada nem "gira junto"; só a câmera orbita ✔ |
| Snap com histerese (reclamação 1) | `Sprites.dirStep` exercitado nos limiares | dentro de ±0,1 rad **mantém** o quadrante; além, troca; wrap correto entre os setores das costas (±π) — 6/6 casos ✔ |
| Coerência de HUD | amostra com `UI.update` no loop | "Rodada 4" == `state.round` 4; timeline com 4 slots == 4 unidades vivas ✔ |
| Desempenho | 60× `Renderer.render(0.016)` | câmera parada **5,4 ms**/frame; girando a cada frame **6,5 ms** — dentro do orçamento (12 ms), sem regressão vs QA v2 (5,4–6,1 ms) ✔ |
| Evidência visual | inspeção de 20 screenshots (`gallery_*`, `zoom_*`, `g_*`, `c_*`, `e_*`) | análise na §R2 |

## R2. Reclamação 1 — personagens: **RESOLVIDA**

A v3 abandona o turntable paramétrico contínuo (a causa raiz das poses borrachudas) por **4 direções discretas**: 2 vistas desenhadas (3/4 frontal e 3/4 traseira), espelhadas para SE/SW/NE/NW, assadas em cache offscreen; troca por snap de quadrante com histerese ±0,1 rad e micro-crossfade ≤80 ms; idle apenas por transform (bob/sway/breath sobre o cache — a forma nunca deforma); overlays só de partículas/brilhos ("nunca a forma", `sprites.js`).

O que vi nos screenshots:
- **Desenhos limpos nas 4 direções, sem nenhuma pose borrachuda** — são ilustrações estáticas bem acabadas, não poses interpoladas (`gallery_top/full`, `zoom_heroes1`). O problema da v2 era estrutural (ângulos intermediários deformavam membros); na v3 ângulos intermediários **não existem** — entre os limiares o desenho fica parado, como em Dofus/Wakfu.
- **As costas são desenhos de verdade, no nível da frente v2**: placa de memória no capacete do Repique, capuz de cera escorrida do Estopim, painéis de vitral emplumados da Rosácea, tanque com correia em X do Sibilo (`zoom_morela_col`); nos chefes, o laço fúnebre da Jardineira, a amarração do espartilho da Baronesa e a escotilha acorrentada do Magno (`gallery_bosses`, `gallery_magno_portraits`) — os detalhes direcionais que elogiei na v2 sobreviveram à mudança de técnica.
- **Troca pré/pós-snap limpa** (`g_presnap`/`g_postsnap`): mesmas vistas coerentes dos dois lados do limiar, sem imagem dupla, sem deformação, personagens consistentes com a rotação do tabuleiro.
- Em jogo, as trocas frente/costas acontecem onde deviam ao girar (Baronesa de frente em `c_a1` e de costas em `c_a3`; Magno idem em `e_a1`/`e_a2`).
- Ressalva honesta (não bloqueante): nas fichas mínimas (Escorinha, Gotinha, Carrapichinho) a diferença frente/costas é sutil — coerente com o desconto que a 1ª auditoria já fazia para os bichos pequenos.

## R3. Reclamação 2 — campo flutuando / girando junto: **RESOLVIDA**

- **Chão até as bordas em todos os ângulos e zooms inspecionados**: aprons de terreno temático ancorados no MUNDO (próximo nítido + distante com névoa) cobrem a tela inteira na Estufa (`g_a1/a2/a3`), inclusive no tilt mínimo (`g_lowtilt`) e nos zooms mínimos da Cisterna e do Fecho (`c_zoomout`, `e_zoomout`) — **nenhum vazio visível em nenhum dos 14 shots in-game**.
- **O campo agora é um LUGAR**: vasos suspensos, treliças e capim na Estufa; colunas submersas e lajes d'água na Cisterna; correntes, pilares e fagulhas no Fecho — props em coordenadas de mundo, com névoa e depth-sort, que giram **com o mundo** (não com a câmera), matando o efeito diorama.
- **Buracos como cavidades**: a boca do buraco cava o chão com paredes internas visíveis e fundo temático (poços d'água luminosos na Cisterna em `c_zoomin`; fosso de brasa no Fecho em `e_zoomout`) — o apron passa por baixo, nada de buraco-para-o-void.
- **Pivô fixo de verdade**: além da leitura do código (`renderer.js`: "pivô ANCORADO… nada de deriva"), medi 0,00 px de deriva do centro em 12 poses (§R1). Arrastar gira/inclina a câmera em torno do tabuleiro; o tabuleiro não sai do lugar.
- A luz de mundo virou rim light sutil + sombras (cabeçalho do `renderer.js`), mantendo a sensação de rotação real sem re-iluminar a forma assada — compatível com a técnica de cache da §R2.

## R4. Regressões — **nenhuma encontrada**

| Item | Situação na v3 |
|---|---|
| B1 (`Game.screen` via `Game.goTo`) | `hud.js` l.58 chama `g.goTo(name)`; confirmado **ao vivo**: `menu→heroSelect→dungeonSelect→battle` ✔ |
| B2 (watchdog de animações) | `ANIM_WATCHDOG = 3.0` em `renderer.js` l.56, aplicado no consumo da fila (l.426) ✔ |
| B3 (topo em brasa das muretas do Fecho) | visível nos shots novos, inclusive em ângulo quase axial (`e_a1`, `e_a2`, `e_a4`) ✔ |
| B5 (hover não atravessa a HUD) | `overUI()` em `renderer.js` l.194, usado no hover (l.232) e no arrasto (l.242) ✔ |
| Regra CSS de pointer-events | `#ui-root > .battle-hud { pointer-events:none }` + `.battle-hud > * { pointer-events:auto }` preservadas (`css/style.css` l.310–311) ✔ |
| APIs do contrato | todas exercitadas ao vivo nesta reauditoria (`Engine.events/activeUnit`, `AI.planTurn`, `Game.selectSpell/onTileClicked/endTurn/isPlayerTurn/screen`, `Renderer.render/handleEvent/isBusy` + extensões `setCamera/project`, `UI.update`, `FX.handleEvent`) ✔ |
| Suítes | 62/62 motor · galeria 29×4 PASS ✔ |
| Desempenho | 5,4–6,5 ms/frame — sem regressão ✔ |
| Pendências aceitas (B4/B6/B7) | inalteradas; seguem valendo as análises da §3 da 1ª auditoria |

*Nota de método:* numa primeira amostra a HUD parecia congelada em "Rodada 1" — era defeito do **meu** bombeamento (faltava `UI.update` no loop, que o `main.js` real sempre chama); com o loop correto a HUD acompanha o estado. Nenhum bug do jogo.

## R5. Nota revisada — Arte/FX

**8,5 → 9,0.** A v3 não é um remendo: é a técnica certa para o estilo (vistas desenhadas + snap, como os isométricos de referência), e resolve as duas reclamações pela causa raiz — pose borrachuda ficou impossível por construção, e o tabuleiro está literalmente ancorado no mundo (deriva 0,00 px). O acabamento das costas está no nível das frentes, os detalhes direcionais que davam identidade na v2 foram preservados, e o cenário aterrado com props de mundo dá ao campo a leitura de "lugar" que faltava. O que segura o 10: o desconto herdado das fichas pequenas (frente/costas sutis) e o traço chibi mais simples que um Dofus comercial — limitações de escopo já aceitas, não defeitos novos.

## R6. Veredito da reauditoria

> ## **APROVADO**

As duas reclamações do usuário foram resolvidas **pela causa raiz**, com evidência visual e funcional independente; nada do que estava aprovado regrediu (suítes verdes, correções B1–B5 vivas, CSS preservado, desempenho igual, contrato intacto). Acredito que desta vez a resposta do usuário será positiva: o que ele verá ao girar a câmera são desenhos firmes trocando de vista com um estalo limpo — e um campo parado, fincado num lugar, com a câmera orbitando em volta.

**Exigências:** nenhuma. **Recomendações (não bloqueantes, herdadas):** 1. playtest humano do Magno (§3.2); 2. unificar `theme`/`id` (§3.3); 3. polimentos de HUD já listados na §4 da 1ª auditoria.

*— Agente Chefe, 17/08/2026*

---

# Auditoria Final da v2 — 18/08/2026

**Agente Chefe.** Escopo: o jogo inteiro, contra o que o **usuário** pediu — não contra o que os
relatórios dizem. Nada aqui foi copiado do QA: cada número abaixo foi reproduzido por mim.

**Instantâneo auditado:** `c9276ef` (*Classes reskinadas para os modelos 3D*), árvore limpa.

**Método (verificações independentes):**
- As 8 suítes rodadas por mim em Chrome headless (perfil temporário, `--dump-dom`), do zero.
- Jogo real dirigido por **cliques DOM** e por **toques de ponteiro reais no tabuleiro 3D**
  (`pointerdown`/`pointerup` sobre o canvas, com raycast do próprio renderizador — não
  `onTileClicked` direto), com bombeamento síncrono e relógio virtual via `Game._setClock`.
- **Um calabouço inteiro vencido** (Estufa: 3 salas + chefe) e mais dois começados
  (Cisterna 19×15, Coração Partido 21×19). Zero exceções de JavaScript na sessão toda.
- Capturas próprias em `tests/qa_shots/chief/` (9), além da leitura das do QA em `qa_shots/3dv2/`.
- Página própria `tests/chief_play.html` — cópia fiel do `index.html` **com cache-buster por
  timestamp**. Ela existe porque o `index.html` real estava servindo JS velho (ver C3): sem isso eu
  teria auditado o jogo de ontem.

---

## 1. Suítes — carga atual conferida por mim

| Página | Meu resultado | Esperado |
|---|---|---|
| `tests/test_engine_v2.html` | **201 / 201** ✔ | 201 ✔ |
| `tests/test_progress_v2.html` | **143 / 143** ✔ | 143 ✔ |
| `tests/validate_classes.html` | **6.161 / 6.161** ✔ | 6.161 ✔ |
| `tests/validate_world.html` | **6.494 / 6.498 — 4 FALHAS** ✘ | "6.498, 0 falhas" |
| `tests/validate_fusion.html` | **3.674 / 3.674** ✔ | 3.674 ✔ |
| `tests/art_gallery.html` | **618 / 618** ✔ | 618 ✔ |
| `tests/ui_screens.html` | **110 / 110** ✔ | 110 ✔ |
| `tests/preview2d.html` | **18 / 18** ✔ | 18 ✔ |

Duas observações de peso:

1. **`validate_world` está vermelha** e ninguém percebeu (ver C5). O QA a rodou *antes* do commit
   que recalibrou a `xpTable` e não voltou nela.
2. **Não existe suíte automatizada da camada que o jogo realmente usa.** `preview2d.html` testa o
   renderizador PixiJS; o `index.html` carrega `js/render3d/*_v2.js`. O renderizador em produção
   tem 2.275 linhas e **zero teste verde de regressão**.

---

## 2. O que eu verifiquei jogando (e que funciona)

- **Calabouço completo**: Estufa Soterrada, dupla nível 10 com conjunto e pet — 3 salas + a
  Jardineira-Viúva (300 PV) vencida na rodada 6. Cisterna e Coração Partido abrem e rodam.
- **Fusão declarada e resolvida em combate real** (botão FUNDIR → folha de confirmação → fim de
  turno): `fus:curandeira+sumo`, `hp 251/300` (96+155 / 130+170), `paMax 8` (6+2), `ppMax 4` (3+1),
  `escudo 50`, `nível 5` (média), `iniciativa 55` (máximo), `elemPower 3` (média), herói B fora do
  tabuleiro. **Todos os números do §4 batem.**
- **Cronômetro**: 30 s, sobra vai para o banco (26,9 s → turno seguinte com 56,9 s, teto 120) e a
  expiração encerra o turno sozinha ✔.
- **Cancelamento de feitiço**: clique fora da zona válida desmarcou sem gastar PA/PP ✔ (§9 [G3]).
- **Caminho elemental no nível 5** pela interface: os 4 caminhos, 6 feitiços cada com os níveis
  **5/10/12/15/20/30** e custo, confirmação "É irreversível", efeito imediato em `spellsFor` e em
  `effectiveStats` (`elemPower`), segunda troca recusada ✔ — exatamente o que você pediu.
- **Clima**: tique de ±5 PV pela rivalidade, chuva favorecendo Água e punindo Fogo, chuva visível na
  tela; Coração Partido com troca a cada 3 rodadas ✔.
- **Pet age sozinho** depois do dono ("Brasinha agiu sozinho") ✔.
- **Cartas, estrelas, forja**: coleção com trilha das 5 estrelas e bônus certos; custos de
  desbloqueio **exatamente os seus** (invocador 10 · bruxo 10 · espadachim 20 · arqueiro 25);
  forja pela UI 0 → +2 consumindo 5 pedras (2+3) do elemento certo ✔.
- **Corte de XP por profundidade agora aparece na tela** ("+2 XP · +5 ×0,42 · Conteúdo fácil demais
  para o seu nível (recomendado: 3)") — o defeito B3 do QA está corrigido ✔.
- **Celular (375 px)**: nenhum alvo de toque abaixo de 44 px (B7 corrigido), sem transbordo
  horizontal, fila de turnos é rolador legítimo ✔.
- **Mapa fixo, câmera se move** — provado numericamente: um arrasto de um dedo mudou só o azimute
  (`ang −0,84 rad`) e deixou o pivô **exatamente** onde estava (`panX −13 / panY 0`, deriva 0,00);
  a roda mudou só a distância. É o que o §9-F pede e o que você pediu.
- **Conteúdo completo**: 6 classes · 171 feitiços · 129 de monstro · 66 monstros · 6 chefes ·
  6 calabouços · 18 salas de 17×15 a 23×19 (a do chefe sempre a maior) · 6 pets · 48 itens ·
  12 conjuntos · 5 pedras · 15 formas × 25 misturas = **1.875 ataques de fusão** · 5 climas ·
  9 eventos de terreno · forja até +10 · 5 estrelas.
- **Desempenho em GPU de verdade** (a medida que faltava): headless com `--use-angle=d3d11` e o
  painel real relatam **ANGLE / Intel Iris Xe (D3D11)** — não é mais SwiftShader. Na **maior sala**
  (21×19, 10 unidades), tela 562×1218: **10,7 – 13,2 ms por render** e **10,8 ms de quadro completo**
  (`update` + `UI` + `render`, com `gl.finish()` forçando a GPU). Passa nos 16,7 ms, mas com pouca
  folga numa iGPU de notebook — num celular médio isso encosta no limite.

---

## 3. Defeitos que eu encontrei (novos)

### C1 — A fusão da dupla inicial **não tem ataque nenhum** — **ALTO**

A mecânica que você mais quer ver é, hoje, uma armadilha para o grupo padrão.

- Com **2 heróis** (§9-B), fundir transforma a dupla em **uma única unidade** — não sobra aliado.
- A fusão **substitui** o kit pelos feitiços compostos (isso é o contrato, §4). Para o par
  `curandeira+sumo` (as duas classes que já nascem liberadas) as formas de tier 0 e 5 são de
  **apoio**: *Amparo Escaldante* (escudo em aliado) e *Chamado Escaldante* (puxa aliado). Como
  formas de apoio usam `riderSupport`, **nem o rider elemental traz dano**.
- Resultado medido em batalha real: a unidade fundida nível 5 morreu ao longo de 5 rodadas com os
  **5 inimigos em PV cheio** — ela não tinha como causar um único ponto de dano.
- Varredura completa (`Fusion.spellsFor` nos 15 pares): **sem nenhum feitiço ofensivo** em
  **4 pares no nível 5-11** (`curandeira+sumo`, `curandeira+invocador`, `espadachim+invocador`,
  `invocador+sumo`), **2 pares no 12-19**, e **`curandeira+invocador` continua sem dano no nível 30**
  — 5 feitiços, nenhum ataque, para sempre.
- **Causa raiz de integração:** as formas foram escritas quando o grupo era de 1-3 heróis (havia
  aliado para escudar); o adendo v2.1 baixou para 1-2 e ninguém revisitou o conteúdo da fusão.

### C2 — O HUD não sabe ler feitiço de **item** nem de **fusão** — **ALTO**

`js/ui/hud.js:91` resolve nome/custo só em `DATA.spells` e `DATA.fusionSpells`.

- **Visto na tela**, com a Bolsa de Sementes (espaço **Lume**) equipada: o botão sai
  **"0 is-seed-bomb"**. O feitiço real é *Bomba de Sementes*, **3 PA**, terra, dano+veneno.
  Como o custo exibido é 0, o botão nunca fica esmaecido: a interface mente sobre o preço.
  Atinge os **12 itens de Lume** — o espaço que você inventou para "conceder um feitiço novo".
- Os feitiços de fusão são gerados em memória (`Engine._genSpells`) e **também não são achados**
  por esse `spellDef` (conferido em runtime: `emSpells:false, emFusionSpells:false, emGen:true`).
  Ou seja, a barra da unidade fundida mostra `fus:curandeira+sumo:agua+fogo:0` e custo 0.
- O motor está certo (`Engine.spell` resolve as 5 fontes); é a HUD que ficou para trás.

### C3 — O jogo que você vai abrir de manhã **não é o jogo auditado** — **ALTO (processo)**

O bug B5 do QA voltou no commit seguinte ao relatório.

- `c9276ef` mudou `classes.js` e `spells.js` **sem bumpar o `?v=6`** do `index.html` — e o próprio
  arquivo tem o aviso escrito no cabeçalho.
- **Provado no navegador**: `classes.js?v=6` veio do cache (`transferSize: 0`) e o jogo rodou com
  `classes.sumo.name === "Sumô"` e `sumo-neutro-1 === "Palma de Ferro"`, enquanto o disco (via XHR
  com `?fresh=`) entrega **"Bárbaro"** e **"Machadada de Ferro"**. Todo o meu teste de jogo teve de
  migrar para uma página com cache-buster.
- Quem abriu o jogo hoje continua com os dados de antes do reskin. Suíte verde convivendo com jogo
  velho — exatamente o que o QA chamou de "o mais traiçoeiro".

### C4 — As 6 classes foram **renomeadas** sem registro nem aval — **MÉDIO**

`c9276ef` trocou os nomes visíveis: **Sumô → Bárbaro** · Elfo Arqueiro → **Batedor** ·
Espadachim → **Ladino** · Curandeira → **Paladina** · Invocador → **Xamã** (só Bruxo sobreviveu).

- Contraria o `PROJETO_V2.md` §2, que lista os nomes um a um, e contraria o seu pedido original.
- O `PLANO_NOITE.md` — que existe justamente para registrar decisões tomadas em seu nome — **não
  menciona** isso. Foi decidido às 23h e ficou só no diff.
- Ironia técnica: o **seu desenho do Sumô** (`assets/embedded/sprites-sumo.js`) continua sendo o
  retrato da classe na HUD — o jogo mostra a sua arte de sumô com o nome "Bárbaro".
- Os ids (`sumo`, `curandeira`…) e as chaves de fusão (`fus:curandeira+sumo`) não mudaram, então é
  reversível numa linha por classe.

### C5 — `validate_world` vermelha: a economia de XP ainda tem dois donos — **MÉDIO**

4 falhas de 6.498. A `xpTable` foi recalibrada tendo a **dupla** como referência (decisão registrada
pelo QA no B1); `validate_world` mede a descida **inteira** (isto é, o herói **solo**):

- Estufa (nível 3): rende **1,89 nível** por descida — a faixa exigida é 0,7–1,4.
- Mina (22) e Coração (28): 0,77 e 0,67 — a faixa é 0,25–0,55.
- E o teto geral ("nada de upar de graça, máx. 1,4") estoura no primeiro calabouço.

Não é teste bobo: no jogo, **solo sobe quase o dobro por descida e ainda tem a sorte de saque
máxima** (medi 74,3% × 71% de item e 60,7% × 49,2% de carta). Alguém precisa decidir se solo é para
subir mais rápido — e então o teste está errado — ou se a `xpTable` é que está.

### C6 a C9 — menores

- **C6 (BAIXO)** — Log de clima confuso: *"Aranha-de-Orvalho sofre com o clima (0 PV)"* quando o
  clima na verdade a **favorece** e ela está com PV cheio; e o mesmo evento vira duas linhas
  contraditórias (*"Bárbaro sofre com o clima (5 PV)"* + *"(-5)"*).
- **C7 (BAIXO)** — A câmera nasce colada na unidade ativa; quando o primeiro turno é de um monstro
  distante, a primeira imagem do jogo é um canto vazio do mapa, sem o grupo. O §9-F pede
  "o grupo e o primeiro grupo inimigo".
- **C8 (BAIXO)** — A seleção de heróis persiste entre partidas (o velho N3 da v1, ainda vivo).
- **C9 (BAIXO)** — O painel de recompensa anuncia item repetido que o inventário (uma entrada por
  item) descarta em silêncio.

---

## 4. Notas por área

### 4.1 Criativo (dados, mundo, classes, fusão) — **7,5/10**
Volume e acabamento de texto excelentes: as descrições dos calabouços são as melhores coisas
escritas no projeto, os 171 feitiços têm identidade, os custos de carta são exatamente os que você
fixou e a integração de dados não tem órfão. Perde pontos por três coisas de peso: o conteúdo de
fusão que deixa a dupla inicial sem ataque (C1), a economia de XP que ainda briga com o outro dono
(C5) e o rebatismo das 6 classes sem registro (C4).

### 4.2 Lógica (motor, fusão, progressão, fluxo) — **9,0/10**
É a área mais sólida. 201 + 143 testes verdes, os números da fusão batem um a um em combate real,
cronômetro com banco e expiração, cancelamento que não gasta ação, corte de XP do §9-D aplicado
certo, forja determinística, save robusto. Numa sessão longa de jogo real, **zero exceção**. O que
falta para o 10 é fora do motor: a IA do jogador continua perdendo salas fundas (achado F do QA,
que eu confirmo — e a Vergasta prende o tanque com raiz a cada 2 turnos enquanto atira, o que
transforma um herói corpo a corpo isolado em alvo parado).

### 4.3 Apresentação 3D — **7,0/10**
Os personagens leem bem: silhuetas distintas, paleta cartoon coerente, escala certa na célula, e o
cenário casa com eles (mesma família KayKit). O Coração Partido e a Cisterna têm atmosfera de
verdade — chuva visível, colunas partidas, grade de lava, névoa. **O mapa fica parado e a câmera
orbita** (provado, deriva zero) e roda em 60 fps numa GPU real. Mas: a Estufa — o primeiro
calabouço, a primeira impressão do jogo — é um tabuleiro grande e **vazio**, com dois engradados e
umas moitas; os efeitos são discretos (anéis, pontinhos, um clarão branco na fusão) para quem pediu
"efeitos caprichados" e mandou refazer o FX de ataque três vezes na v1; e a **fusão não é
reconhecível** de longe: o modelo é o do parceiro mais corpulento 26% maior com a arma do outro
enxertada na mão esquerda — de perto dá para ver, na distância de jogo é só o Bárbaro.

### 4.4 Interface — **6,5/10**
As telas de meta são muito boas: Coleção com trilha de estrelas, Inventário único com dono de cada
peça, Forja com prévia do ganho, escolha de caminho com os 24 feitiços à vista e confirmação em
folha, painel de recompensa que agora **explica** por que a XP veio menor. Cabe em retrato de
celular sem transbordo e sem alvo pequeno. O que derruba a nota é C2: os dois recursos que você mais
pediu — o espaço que **concede um feitiço** e a **fusão** — chegam ao jogador como um identificador
cru com custo 0.

### 4.5 QA — **7,5/10**
O relatório de integração é honesto e minucioso (775 checagens cruzadas, sandbox de save, casos de
borda excelentes) e cinco dos seis defeitos médios que ele apontou estão corrigidos. Mas ele
declarou verde uma suíte que ficou vermelha logo depois e não voltou a rodá-la (C5), a camada 3D —
que é o jogo — ficou fora do escopo e sem suíte própria, e a disciplina de cache-buster que ele
cobrou foi violada no commit seguinte sem que ninguém pegasse (C3).

---

## 5. As pendências herdadas — meu julgamento

| Pendência | Julgamento |
|---|---|
| **Capturas da unidade fundida não saíam** | **Resolvida por mim.** `tests/qa_shots/chief/07` e `08` mostram a fusão parada: modelo do Bárbaro ampliado com a espada da Paladina enxertada e halo branco. Serviu para descobrir que a silhueta quase não muda (§4.3). Não bloqueia. |
| **IA perde batalhas profundas** | **Não bloqueia, mas é sintoma.** Joguei eu mesmo: dupla nível 5 limpou a sala 1 em 4 rodadas; dupla nível 10 venceu o calabouço inteiro com folga. O jogo é vencível por humano na faixa recomendada. O que a IA expõe é real e vale corrigir: controle sem quebra (raiz recorrente) trava herói corpo a corpo isolado. |
| **Desempenho só medido em software** | **Resolvida por mim.** Intel Iris Xe via D3D11: 10,7–13,2 ms/quadro na maior sala, quadro completo 10,8 ms. Passa, com pouca folga. Vale medir num celular antes de prometer 60 fps em qualquer aparelho. |

---

## 6. VEREDITO

> ## **REPROVADO**

Não é reprovação de mérito geral — o núcleo está bom e perto do selo. É reprovação por **quatro
defeitos que atingem exatamente o que você pediu**, e um deles faz o jogo que você abriria de manhã
não ser o jogo que eu auditei. Nenhuma das exigências abaixo é cosmética e nenhuma leva mais de
algumas horas.

**Exigências (todas obrigatórias para a aprovação):**

1. **Dar ataque a toda fusão possível.** Nenhum par de classes pode gerar, em nenhum nível a partir
   do 5, um conjunto de feitiços sem um único efeito ofensivo. Corrigir pelo menos os 4 pares do C1
   (prioridade absoluta ao `curandeira+sumo`, a dupla que todo jogador tem no começo) e o
   `curandeira+invocador`, que hoje não ataca nem no nível 30. Acrescentar à `validate_fusion.html`
   a checagem "todo par, em todo tier, tem ao menos um feitiço com dano".
2. **Fazer a HUD ler as cinco fontes de feitiço.** `js/ui/hud.js:91` precisa consultar
   `Engine.spell(id)` (ou incluir `itemSpells`, `petSpells`, `monsterSpells` e `Engine._genSpells`),
   para que feitiço de item e de fusão apareçam com **nome e custo reais**. Teste de regressão na
   `ui_screens.html` com um herói de Lume equipado e com uma unidade fundida.
3. **Acabar com o JS velho de vez.** Bumpar o `?v=` do `index.html` agora **e** trocar a disciplina
   manual por carimbo automático de build (ou `?v=` gerado). Enquanto isso não existir, toda
   verificação "no jogo real" é suspeita.
4. **Decidir e registrar os nomes das classes — e o destino da arte do usuário.** Ou volta
   *Sumô, Elfo Arqueiro, Bruxo, Espadachim, Curandeira, Invocador* (é o que está no `PROJETO_V2.md`
   e o que você pediu) **com o sprite desenhado religado**, ou o novo elenco é assumido, escrito no
   `PROJETO_V2.md` e registrado no `PLANO_NOITE.md` com o motivo — incluindo o desligamento de
   `sprites-sumo.js`/`spriteart.js` do `index.html` (§8), que hoje só existe num comentário de HTML.
   Decisão do usuário, não do time.
5. **Fechar a briga da XP e deixar `validate_world` verde.** Definir por escrito se o §9-D se
   calibra pela dupla ou pelo solo e ajustar o lado que estiver errado (dado ou teste). Suíte
   vermelha entregue como verde não pode acontecer de novo.

**Recomendações (não bloqueantes):**

6. Encher a Estufa: ela é a primeira impressão do jogo e hoje é o cenário mais vazio dos seis.
7. Subir o impacto dos efeitos de ataque (o padrão que você cobrou na v1 ainda não foi alcançado em 3D).
8. Marcar a fusão visualmente (aura permanente, escala maior, pedestal ou emblema) para ela se
   distinguir na distância de jogo.
9. Enquadrar a câmera de abertura no grupo + primeiro grupo inimigo (§9-F), mesmo quando quem começa
   é um monstro distante.
10. Criar uma suíte de regressão para `js/render3d/*_v2.js` — o renderizador em produção não tem uma.
11. Limpar o log de clima (C6) e a persistência da seleção de heróis (C8).

---

## 7. Recado para o usuário (leia ao acordar)

O jogo **roda de verdade**: eu desci a Estufa inteira, matei a Jardineira-Viúva com uma dupla nível
10 clicando na tela como você clicaria, e abri mais dois calabouços sem um único erro de JavaScript.
O tabuleiro fica **parado** e a câmera é que gira em volta — isso está provado e é bonito de ver.
A escolha do caminho elemental no nível 5, o cronômetro com tempo guardado, a coleção de cartas com
as estrelas, a forja até +10 e a tela que agora explica por que a XP veio menor: tudo isso está no
lugar e bom. **Mas eu não aprovei**, por quatro motivos: (1) fundir o Sumô com a Curandeira — as duas
classes com que você começa — cria uma unidade **sem nenhum ataque**, o que perde a batalha na
certa; (2) os feitiços que vêm de item e os da fusão aparecem na barra como código cru
("0 is-seed-bomb") em vez de nome e custo; (3) o `index.html` está servindo arquivos velhos do
cache, então o que você abrir pode ser o jogo de ontem — abra `tests/chief_play.html` para ver o de
hoje; e (4) alguém rebatizou suas 6 classes na madrugada: **o seu Sumô agora se chama "Bárbaro"**,
a Curandeira virou "Paladina" — e, já no fim da noite, o **seu desenho do sumô foi desligado do
jogo** (duas linhas comentadas no index.html), justamente porque não combinava mais com o modelo de
bárbaro em campo. Essa quarta é decisão sua, não minha: se você gostar dos nomes novos, é só dizer e a
exigência cai.

**Por onde começar de manhã (15 minutos):** abra `tests/chief_play.html`, faça uma descida na
Estufa com a dupla, clique em **FUNDIR** para ver o problema (1) na prática, olhe a barra de
feitiços de um herói com item de Lume para ver o (2), e depois passe os olhos em
`tests/qa_shots/chief/` — em especial `08_fusao_modelo2.png`, que é a cara da sua fusão de perto.

---

## 8. Adendo — a árvore se moveu durante a auditoria (e piorou o C4)

Enquanto eu auditava, dois commits entraram: `abec7b2` (*Retratos coerentes com os modelos em
campo*) e `7778748` (*README atualizado*). Reverifiquei o HEAD depois deles:

- **A sua arte desenhada saiu do jogo.** `abec7b2` **comentou** `assets/embedded/sprites-sumo.js` e
  `js/render2d/spriteart.js` no `index.html`. Confirmado em runtime no HEAD: `JOGO.SpriteArt` e
  `JOGO.SPRITES` não existem mais; todos os retratos vêm agora do `Portraits3D`. O motivo está
  escrito — num comentário de HTML: *"a classe `sumo` virou um BÁRBARO de machado … o retrato
  desenhado mostraria um lutador de sumô ao lado de um bárbaro"*. A justificativa técnica é boa e o
  resultado é coerente (`tests/qa_shots/chief/10_head_retratos3d.png`), mas isto **contraria uma
  promessa explícita** do `PLANO_NOITE.md` — *"Sua arte desenhada fica nos retratos e cartas da
  interface"* — e a decisão continua fora de qualquer documento. Some-se ao C4: primeiro a classe
  perdeu o nome, agora perdeu o desenho. **Duas linhas comentadas trazem tudo de volta.**
- **O C3 continua valendo no HEAD**: `index.html` foi editado outra vez e os `?v=6` seguem
  intocados. A exigência 3 permanece.
- **Nada mais mudou em `js/`** entre `c9276ef` e o HEAD (`git diff --stat` só acusa `index.html`),
  então todos os outros achados e números desta auditoria valem para o HEAD atual.


*— Agente Chefe, 18/08/2026*
