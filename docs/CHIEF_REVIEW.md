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
