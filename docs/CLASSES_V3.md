# SOTERRA 3.0 — as sete classes

Proposta de estrutura para a mudança pedida: **sai a Paladina, entram o
Minotauro e o Curandeiro.** Documento de decisão — nada disto está no código
ainda.

---

## 1. O princípio: cada classe é dona de um VERBO

O que faz uma fusão valer a pena não é somar dano, é somar **coisas que a outra
classe não sabe fazer**. Então cada classe precisa ser dona de um verbo
mecânico que ninguém mais tem — e é esse verbo que ela empresta na fusão.

| classe | papel | **verbo exclusivo** | como ele soa na fusão |
|---|---|---|---|
| **Sumô** | tanque de linha de frente | **PRENDER** — tirar PP, fixar, puxar para si | o feitiço do parceiro passa a colar o alvo no lugar |
| **Xamã** | invocador | **INVOCAR** e **ARMAR** | o feitiço do parceiro deixa uma criatura ou uma armadilha para trás |
| **Mago** | dano em área | **ESTOURAR** — área média, chão marcado | o feitiço do parceiro ganha área onde não tinha |
| **Arqueiro** | longa distância | **ACUMULAR** — marcas que somam e detonam | o feitiço do parceiro passa a empilhar marca no alvo |
| **Ladino** | assassino | **SUMIR** — invisibilidade, esquiva, reposicionar | o feitiço do parceiro esconde ou reposiciona quem lança |
| **Minotauro** | controle de terreno | **BARRAR** — escudo em alguém, **muro** no chão | o feitiço do parceiro deixa cobertura no campo |
| **Curandeiro** | suporte | **RESTAURAR** — cura e bênção | o feitiço do parceiro cura ou fortalece quem está perto |

**Isso é o coração da mudança.** Hoje as classes se distinguem por números
(quanto dano, que alcance); passam a se distinguir por **o que só elas fazem**.

---

## 2. As sete, em detalhe

### Sumô · tanque
Corpo a corpo pesado, dano alto **em área curta** — o único que acerta vários
adversários sem sair do lugar. Prende: rouba PP, fixa no chão, puxa para perto.

O que o distingue do Minotauro: o Sumô **ataca e segura**; o Minotauro
**protege e bloqueia**. Um é ameaça, o outro é parede.

### Xamã · invocador
Criaturas e armadilhas. Poucos ataques diretos, e os que tem servem para
empurrar o inimigo para cima do que ele já plantou.

**As armadilhas são de urso** — ficam no chão, visíveis, na cor do elemento, e
fecham quando alguém pisa. Isso já está implementado.

### Mago · dano em área
Média distância, área generosa, chão que continua queimando/gelando depois.
Frágil de perto.

### Arqueiro · longa distância
O maior alcance do jogo e o único que **acumula**: cada tiro deixa uma marca, e
há feitiços que detonam todas de uma vez. Recompensa quem planeja dois turnos à
frente.

### Ladino · assassino
**Invisibilidade** e esquiva alta. Aparece, dá um dano grande num alvo só,
some. Vive de posicionamento, não de resistência.

### Minotauro · controle de terreno  *(novo)*
Escudo em aliado, e **muros invocados** que ficam no campo bloqueando passagem
e visão. Não mata — **estraga o plano do outro**.

O muro é peça de tabuleiro: ocupa célula, dura alguns turnos, pode ser
quebrado. É o que faz o Minotauro jogar com o mapa, e não com o inimigo.

### Curandeiro · suporte  *(novo)*
Cura e bênção. O único que devolve vida de verdade e o único que dá bênção
duradoura.

---

## 3. Duas sobreposições que precisam de decisão

Sendo honesto sobre onde o desenho ainda se morde:

**Xamã e Curandeiro dividem "buff".** Você descreveu os dois com bênçãos. Se
ficar assim, a fusão dos dois não soma nada. **Proposta:** o Xamã fortalece
**as próprias criaturas** (bênção que só pega invocação), e o Curandeiro
fortalece **heróis**. Aí a fusão Xamã+Curandeiro vira algo novo de verdade —
criaturas abençoadas como se fossem heróis.

**Sumô e Minotauro dividem a linha de frente.** Resolvido pelo verbo: prender
contra barrar. Mas vale cuidar para o Minotauro não ganhar dano decente, senão
ele vira um Sumô melhor.

---

## 4. A fusão: 21 duplas

Com sete classes são **21 duplas** (eram 15). Cada fusão herda **o verbo dos
dois pais** — é a regra que substitui o "soma os números" de hoje.

| dupla | o que a fusão passa a fazer |
|---|---|
| Sumô + Xamã | prende **e** invoca — a criatura nasce colada no alvo preso |
| Sumô + Mago | área corpo a corpo que **estoura** e deixa o chão marcado |
| Sumô + Arqueiro | prende de longe: puxa o alvo marcado para perto |
| Sumô + Ladino | some, aparece atrás e prende |
| Sumô + Minotauro | prende e **se barra junto** — os dois presos no mesmo lugar |
| Sumô + Curandeiro | segura e se cura enquanto segura |
| Xamã + Mago | a criatura nasce **estourando** onde pisa |
| Xamã + Arqueiro | a criatura **acumula marca** em quem ela ataca |
| Xamã + Ladino | criatura invisível, que só aparece ao atacar |
| Xamã + Minotauro | invoca **muro vivo**: barra e ataca |
| Xamã + Curandeiro | criatura abençoada — a que resolve a sobreposição |
| Mago + Arqueiro | área **à distância máxima**, detonando marcas |
| Mago + Ladino | estoura e some no mesmo gesto |
| Mago + Minotauro | área que **deixa muro** na borda |
| Mago + Curandeiro | área que fere inimigo e cura aliado dentro dela |
| Arqueiro + Ladino | marca de longe, some, detona de perto |
| Arqueiro + Minotauro | marca através do próprio muro (atira e continua coberto) |
| Arqueiro + Curandeiro | a marca cura quem estiver perto dela |
| Ladino + Minotauro | some **e deixa muro** no lugar onde estava |
| Ladino + Curandeiro | some para curar sem ser interrompido |
| Minotauro + Curandeiro | muro que **cura** quem se encosta nele |

**Cada linha dessa tabela é lida a partir dos dois verbos.** Não precisei
inventar 21 conceitos soltos — eles saem da combinação, o que é justamente o
sinal de que o desenho por verbo funciona.

---

## 5. O que isso custa, medido

| | hoje | depois |
|---|---|---|
| classes | 6 | 7 |
| feitiços de classe | 171 | **~198** (+27) |
| duplas de fusão | 15 | **21** (+40%) |
| formas de fusão | 107 | **~147** |
| composições de fusão | 2.625 | **~3.700** |
| arquivos que citam a classe que sai | **47** | — |

Os 47 arquivos não são todos trabalho: a maioria é teste e documentação que
seguem a lista de classes automaticamente. O trabalho real está em
`spells.js`, `fusions.js`, `classes.js` e `dungeons.js` (que distribui itens e
inimigos por classe).

---

## 6. Ordem de execução proposta

O jogo continua jogável em cada etapa — nenhuma delas deixa a árvore quebrada.

1. **Classes** (`classes.js`) — as sete entram com seus números e caminhos
   elementais. O Minotauro e o Curandeiro nascem sem feitiço, e o jogo ainda
   roda.
2. **Verbos** — quase nada a fazer, e isto foi **medido, não estimado**. O
   motor já reconhece: `root` (prender), `summon`, `trap`, `mark`, `shield`,
   `heal`, `buff`, `regen`, `resist`, `pull`, `push`, `taunt`, `teleport`,
   `swap`, `cleanse`, `chain`, `poison`, `reflect` — e **`invisible`**, que eu
   tinha dado como faltando e está inteiro em `engine.js:1697`.

   Falta **um só**: o **muro invocado**. E ele é menor do que parece, porque
   `wall` já é um tipo de célula (`tiles[y][x].type === 'wall'`, vindo do `#` do
   desenho da sala) que já bloqueia passagem e visão, e que o renderizador já
   desenha. O que não existe é um efeito que **mude o tipo da célula em tempo de
   partida** e um relógio que a devolva ao normal depois de N turnos.
3. **Feitiços** — 27 por classe nova, e revisão dos 135 existentes para afiar
   os verbos.
4. **Fusão** — as 21 duplas × 7 degraus.
5. **Arte** — modelos, invocações e monstros, conforme você criar.

**Nenhuma etapa tem risco alto.** Eu tinha escrito aqui que a etapa 2 era o
risco, por supor que muro e invisibilidade faltavam. Fui medir: invisibilidade
está pronta, e muro é um efeito novo pequeno sobre uma estrutura que já existe.

**O trabalho desta mudança é CONTEÚDO, não motor** — escrever os feitiços e as
formas de fusão. Isso é bom: conteúdo é revisável peça por peça e não quebra o
jogo enquanto está pela metade.
