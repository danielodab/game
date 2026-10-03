# O equilíbrio — classes, caminhos, fusões e duelos

> Pedido do dono (02/10/2026): *"isso é importantíssimo. equilibre todas as classes e
> fusões"* — vale para PvE e para PvP (paridade de 5 níveis).
>
> Este documento diz **o que se mede, com que régua, qual é a faixa-alvo de cada coisa e
> por quê**, e registra cada ajuste feito nos dados com o motivo. A prova que cobra tudo
> isto é `node tests/equilibrio.js`; a conta mora em `tests/equilibrio_bancada.js` (a
> mesma que `tests/equilibrio_fusao.html` mostra no navegador). Se este documento e a
> prova discordarem, **a prova está certa e o documento está velho** — corrija o documento.

---

## 1. A régua

### 1.1 A bancada

Node puro, sobre o **motor do juiz** (`servidor/juiz/motor.js` + `js/core/progress.js`): o
jogo de verdade, sem navegador. **Determinística** — todo sorteio passa pelo `_rng` do
estado e todo estado nasce de uma semente fixa; a mesma árvore dá o mesmo número em
qualquer máquina, então a medida de antes e a de depois são comparáveis e o veredito não
pisca. O herói sai do mesmo caminho do jogo (`Progress.battleParty`): stats do nível,
ganho elemental, defesa por papel, feitiços liberados até ali. **Corpo nu**: sem item,
sem estrela, sem pet — a régua compara classes, não inventários.

O trabalho pesado vai para processos-filhos em prioridade baixa (a máquina é dividida).

### 1.2 O perfil de cada classe

Por classe × caminho elemental × nível (5, 12, 20, 30), numa arena aberta de 15×11
contra **bonecos** de um milhão de PV que não agem. Tudo por **turno, na média de quatro
turnos** — o feitiço com recarga não sai todo turno, e o veneno plantado no terceiro ainda
pinga no quarto:

| métrica | o que é |
|---|---|
| **dano único** | dano num alvo só, podendo andar; o melhor de 1, 3, 5 e 7 casas de distância |
| **dano em área** | dano somado em três bonecos encostados (um L); o melhor de 1, 3 e 5 casas |
| **alcance** | a maior distância, **sem andar**, de onde ainda sai ≥ 50% do melhor dano único — contando só o dano do PRÓPRIO herói (o Xamã parado a 8 casas "acertava" com o bicho que andou até lá) |
| **cura** e **escudo** | o que o herói concede a um aliado ferido ao lado (sem teto de PV), por turno — separados, porque restaurar é o verbo do Curandeiro e o escudo é o do Minotauro |
| **próprio** | cura + escudo que o herói dá a si mesmo |
| **controle** | PP negado (raiz = 3 por turno; buff negativo de PP = o valor), PA negado (×2), casas de empurrão/puxão, muro × turno (×0,5) |
| **vida efetiva** | PV do nível × (1 + resistência média) + 4 turnos de **próprio** |

O turno é montado lance a lance por uma escolha **gulosa** que sonda cada feitiço em cada
casa boa (a que cobre mais inimigos, a que cobre mais aliados, a vazia mais perto do
inimigo) e fica com a que rende mais; duas variantes (por rendimento e por rendimento por
PA) e vale a melhor. Para não desprezar o que rende depois (veneno, marca, invocação,
bônus de poder), a escolha soma um **potencial** do que ainda vai render dentro da medida
— mas o número publicado é só o que o motor de fato entregou (os eventos de dano, cura e
escudo). Invocação e pet do herói jogam pela IA do jogo e o que eles fazem conta.

### 1.3 A fusão contra os dois separados

A pergunta é a do jogador: *fundir vale a pena?* — e a resposta tem de ser "depende", nunca
"sempre" nem "nunca".

- **O mesmo orçamento: três rodadas inteiras de cada lado.** Separados, cada herói joga
  as três vezes dele com o PA cheio (6 + 6 por rodada); fundidos, a fusão joga as três
  dela com o PA cheio (o maior dos dois + 4). Os 2 PA da declaração são despesa de um
  turno só e ficam fora (`fusion.js`: "o turno seguinte já nasce cheio").
- **Valor** = dano no inimigo − fogo amigo + cura + escudo concedidos. Ponto de vida
  devolvido adia a mesma morte que ponto tirado do inimigo; a régua é a mesma dos dois lados.
- **Duas cenas, e vale a soma**: um alvo só e o L de três. A fusão que só presta num dos
  casos aparece pela metade.
- **Misturas de elemento**: a prova usa oito (os quatro puros e quatro mistos em rodízio);
  a medida completa (`--completo`) usa as dezesseis. A razão da dupla é a **média
  geométrica** das misturas (a razão é multiplicativa: 0,5 e 2,0 dão 1, não 1,25).
- **Níveis**: 5, 12, 20 e 30 entram no ajuste do `PAIR_TUNE`; **16 e 25 só conferem**.

Os quatro defeitos da bancada antiga (README §7.1) continuam proibidos — fusão com a sobra
de PA, área mirada no canto do alcance, instantâneo que não volta tudo, "melhor feitiço
repetido" — e entrou um quinto na lista: **medir um turno só**. Veneno, marca, invocação e
bônus de poder rendem depois, e a régua de um turno zerava o veneno do Bruxo e as marcas do
Caçador.

### 1.4 Os duelos

As duas IAs do jogo (`AI.planTurn`), nas salas do PvP (as dos calabouços abertos, como
`Coop.sorteiaArena`, mais a Praça do desafio), pela mesma porta do jogo e do juiz
(`Engine.createDuelSala`), com o teto de 40 rodadas do PvP (vence a maior fração de vida;
igual é empate, que vale meio).

- **A matriz que conta é em DUPLA**: X + Z contra Y + Z, com o **mesmo parceiro Z dos dois
  lados**, Z passando pelas sete classes. O PvP do jogo é de dupla (a Arena, o Campo, a
  guerra), e é na dupla que o Curandeiro e o Minotauro fazem o que existem para fazer —
  um curandeiro sozinho não mata ninguém, e isso é o papel dele, não desequilíbrio. O
  parceiro igual dos dois lados isola a diferença entre X e Y.
- Cada semente sorteia a sala e os quatro elementos e joga **duas vezes, com os lados
  trocados** (quem nasce nos P e quem nasce nas letras) na mesma sala.
- O **um contra um** também é medido e mostrado, sem cobrança: é o kit cru.
- **Replanejar quando o lance falha.** A IA planeja o turno do estado de antes e não
  prevê o efeito dos próprios golpes: o Bárbaro empurra com a primeira machadada e a
  segunda, planejada na casa antiga, não acha ninguém. Na bancada, lance recusado = plano
  novo (até 4 por turno). Isto é só da bancada — a IA dos monstros segue como está.

**Quantos jogos.** A prova rápida joga 2 sementes (28 jogos por célula): o desvio de uma
taxa de 50% é de ~9 pontos, e uma célula certa cairia fora de 40–60% uma vez em quatro só
por sorteio. Por isso a prova rápida cobra a **média de cada classe** (168 jogos, ~4
pontos) e só acusa a célula quando o **intervalo de 90%** dela inteiro fica fora da faixa.
A medida completa (`--completo`, 11 sementes, 154 jogos por célula) julga cada célula
pelo número dela — é a tabela deste documento.

### 1.5 O que a régua não vê (leia antes de confiar num número)

- **A IA não é um jogador.** Ela não planeja dois turnos, não usa a troca de lugar
  (`swap`), não guarda a invisibilidade para chegar, não prepara armadilha no caminho de
  quem anda. O que ela faz bem — atirar de longe e recuar — ela faz melhor que muita
  gente. A matriz de duelos mede *o kit nas mãos da IA*; confirme com gente jogando
  (§7).
- **Muro** vale, para a IA, a visão que ele corta e a casa que fecha ao lado de um
  inimigo (`ai.js`, `valorDoMuro`); o muro que muda o caminho do inimigo dois turnos
  depois ela não enxerga.
- **No perfil os bonecos não andam**, então armadilha não dispara ali (ela conta nos
  duelos).
- **Item, estrela e pet ficam fora.** Um Ladino com o conjunto dele não é o Ladino nu.

---

## 2. As faixas-alvo

### 2.1 O papel de cada classe (perfil)

Em múltiplos da **média do elenco no mesmo nível** e em **ordem entre as classes** — a regra
é a identidade, não o número: o que precisa continuar verdade depois de qualquer ajuste é
"o Ladino é quem mais bate num alvo só", não "o Ladino bate 83".

| papel | classe | regra |
|---|---|---|
| tanque | Bárbaro | dano único 0,80–1,60× · vida efetiva ≥ 1,05× |
| atirador | Caçador | dano único 0,70–1,40× · alcance 5–10 e **a no máximo 15% atrás do Bruxo** |
| mago | Bruxo | dano em área 1,20–3,00× · alcance 5–10 (do nível 10 em diante) |
| assassino | Ladino | **o maior dano único do elenco** · alcance 1–2 (corpo a corpo) |
| suporte | Curandeiro | **a maior cura num aliado do elenco** · dano único 0,30–0,95× |
| invocador | Xamã | dano único 0,30–1,05× |
| guardião | Minotauro | **o maior escudo num aliado do elenco** · dano único **abaixo de 75% do Bárbaro** · vida efetiva ≥ 1,25× |
| todos | — | dano único entre 0,30× e 2,20× (ninguém inútil, ninguém dono do jogo) |

"O maior" aceita empate a 3%. Por que cada uma:

- a do **Minotauro** é a do próprio desenho (`docs/CLASSES_V3.md`): *"vale cuidar para o
  Minotauro não ganhar dano decente, senão ele vira um Sumô melhor"*; e o escudo é o verbo dele
  (BARRAR), como a cura é o do Curandeiro (RESTAURAR) — por isso as duas medidas separadas;
- o **Caçador** perdeu o "maior alcance do jogo" sozinho: a régua mostrou que era o alcance
  que decidia o duelo (§5.1), e ele divide o topo com o Bruxo;
- a área do **Bruxo** chega com o caminho: no nível 5 ele só tem o primeiro degrau, e o
  Bárbaro (área em volta do corpo) e o Ladino (que bate tanto num alvo que a soma no L passa
  a de quem espalha) aparecem acima dele;
- o **teto geral** é 2,2× porque o assassino vive só de dano num alvo — alcance de 1 ou 2
  casas e a menor vida efetiva do elenco; os duelos em dupla dizem se é demais, e com 1,8–2,1×
  ele fica em ~50%;
- o **Bárbaro** tem vida efetiva só um pouco acima da média: quem é parede é o Minotauro
  ("o Sumô ataca e segura; o Minotauro protege e bloqueia").

### 2.2 Os caminhos elementais

Os quatro caminhos de uma classe valem o mesmo: o **poder** de cada caminho (dano único +
metade da área + o maior entre a sustentação própria e a cura num aliado + 2× controle) fica
a **±25%** da média dos quatro caminhos da classe, em cada nível. Escolher o elemento é
escolher estilo, não escolher o forte. A cura no aliado entra porque o caminho de Água do
Curandeiro rende curando os outros; o maior e não a soma porque o roubo de vida do Caçador de
Água já é as duas coisas.

### 2.3 A fusão

Fundida dentro de **±20%** dos dois separados, **em cada nível** (5, 12, 20, 30 e os de
conferência 16 e 25), para as 21 duplas. ±20% e não menos: fundir também concentra vida e
dá +50 de escudo, e carrega o risco de que a morte da fusão encerra a batalha — 20% de
dano não decide a escolha sozinho. A faixa existe para que a escolha continue difícil.

### 2.4 Os duelos

Cada célula X × Y da matriz em dupla entre **40% e 60%**, em cada nível; e a média de
cada classe contra as outras seis entre **45% e 55%**.

---

## 3. Defeitos de regra que a medida achou

Medir mais de um turno, com a área mirada direito, fez aparecer coisas que nenhum ajuste de
número conserta — e que o `PAIR_TUNE` antigo estava tapando (o 3,83 do Muro Vivo existia
por causa delas). Tudo isto sobe `Engine.VERSAO_REGRAS` para 6.

**3.1 O feitiço misto acertava o lado errado** (`engine.js`, `feiticoMisto`). O motor
aplicava cada efeito em **quem estivesse na área**, de qualquer lado. Feitiço de classe
segue a convenção de `spells.js` (área que fere só carrega efeito contra o inimigo), mas
meia tabela de formas de fusão é desenhada como "fere o inimigo e cura o aliado no mesmo
gesto" (`docs/CLASSES_V3.md` §4) — e a varredura achou dezoito delas fazendo o contrário:

| forma | o que fazia |
|---|---|
| Contrapeso (Caçador+Bárbaro) | dava escudo e fixação ao inimigo que apanhava |
| Círio, Terço (Caçador+Curandeiro); Legado (Bruxo+Curandeiro) | curavam/regeneravam o inimigo atingido |
| Recuo, Rastro (Caçador+Ladino); Retalho (Curandeiro+Ladino) | davam esquiva e passo ao **alvo** do golpe |
| Amparo, Botica, Enfermaria, Hospício (Curandeiro+Minotauro) | feriam os aliados que deviam curar, e curavam o inimigo |
| Parapeito (Caçador+Minotauro); Fortaleza, Vigia, Guarnição (Xamã+Minotauro) | escudavam o inimigo no raio |
| Sentinela, Vigia, Guarnição (Xamã+Minotauro); Guardião (Xamã+Bárbaro); Coro, Sabá (Bruxo+Xamã); Arsenal (Caçador+Xamã); Cortejo (Ladino+Xamã) | o dano da cravada caía no próprio ídolo recém-invocado — a Sentinela **matava** o dela no nível 5 |

A regra nova, no mesmo espírito da invisibilidade de 22/09 ("no feitiço que fere, quem some
é o conjurador"): num feitiço que tem efeito **a favor** (cura, escudo, regeneração, bênção
ou resistência positiva, reflexo, limpeza, invocação) **e** efeito **hostil**, o hostil só pega
o outro lado e o a favor só pega o lado de quem lança — e quem lança sempre. Feitiço só
hostil continua com fogo amigo (a área do Bruxo queima o parceiro, como sempre); feitiço só a
favor continua pegando quem estiver na área. Nenhum monstro, pet ou invocação tem feitiço
misto (medido), então a IA dos monstros não muda. A IA mede com a mesma régua (`ai.js`).

**3.2 A armadilha caía em cima do muro** (`engine.js`, efeito `trap`). "Muro que deixa brasa
acesa em volta", "deixa o laço armado ao pé": o feitiço erguia o muro na casa e armava a
armadilha **na mesma casa**, que acabara de virar pedra — e a armadilha sumia. Os três
feitiços de nível 5 do Minotauro (Fogo, Água, Ar) e a Guarita do Muro Vivo nunca armaram
nada. Agora a casa murada pelo mesmo lance passa a armadilha para a primeira vizinha de chão
livre (norte, sul, oeste, leste — ordem fixa, o juiz refaz igual).

**3.3 Sentinela, Vigia e Guarnição eram de casa única** (`fusions.js`). A casa única é a do
ídolo que acabou de nascer; o dano "de quem estava do lado" caía nele. A área virou o círculo
de 1 em volta da cravada.

**3.4 A IA não sabia usar dois verbos** (`ai.js`). O **muro** valia zero (o `switch` não
tinha o caso): o Minotauro conduzido pela IA nunca erguia a Muralha, e o verbo inteiro da
classe sumia de toda batalha da IA. O **teleporte** valia zero: o Passo do Vento do Ladino
nunca saía. Agora o muro vale a visão que corta e a casa que fecha ao lado de um inimigo, e o
teleporte vale como a investida (aproximar, para quem bate de perto). Nenhum monstro ergue
muro nem teleporta (medido).

**3.5 O preço no próprio corpo nunca era cobrado** (`engine.js`, `precoProprio` — achado na
revisão). O Sangue Fervente (`sumo-fogo-15`) e as Veias em Chamas (`espadachim-fogo-12`) dão
+35/+40 de poder "ao preço de queimadura própria por turno": alvo próprio, casa única, um bônus e
um veneno. Mas o efeito hostil nunca pega quem lança, e a casa única é a dele — a queimadura não
pegava ninguém desde a v2, e as primeiras medidas desta rodada viram os caminhos de Fogo do
Bárbaro e do Ladino com um bônus de graça. São os dois únicos feitiços de classe com efeito a
favor e hostil juntos (a "convenção" do topo de `spells.js` vale para todo o resto). Agora, no
feitiço de alvo próprio cuja área é só a casa de quem lança, o hostil é o preço e cai nele; a
área em volta do corpo (o Rodopio, o Halo, a Fortaleza) continua sem ferir quem lança. Medido
depois: perfis 198/198, os oito caminhos dos dois a ±25% (Fogo do Bárbaro 0,94–1,17, do Ladino
1,07–1,13), fusão igual.

Cada regra desta seção tem prova direta, num lance só: `node tests/regras_equilibrio.js`
(29 de 29; na base `39a6ae9` 15 de 28, uma falha por regra).

## 4. Antes e depois

Medida completa (`node tests/equilibrio.js --completo`) nas duas árvores: **antes** é a base
`39a6ae9` com a bancada nova por cima; **depois** é esta branch. Mesmas sementes, mesmos
jogos.

| | antes | depois |
|---|---|---|
| regras de papel e caminhos (perfil) | 181 de 198 | **198 de 198** |
| fusão a ±20% (21 duplas × 6 níveis) | 53 de 126 | **119 de 126** |
| duelos em dupla: células em 40–60% | 20 de 84 | **62 de 84** (51 de 60 sem o Minotauro) |
| duelos em dupla: médias de classe em 45–55% | 5 de 28 | **20 de 28** |
| a prova inteira | 259 de 436 | **399 de 436** |

A prova rápida (`node tests/equilibrio.js`, 2 sementes, a que se roda no dia a dia) deu
**418 de 436** na mesma árvore: ela é mais branda nas células (só acusa quando o intervalo de
90% inteiro sai da faixa) e mais ruidosa nas médias (168 jogos — o Caçador oscila entre 53% e
59% de uma medida para a outra). A referência é a completa. No navegador,
`tests/equilibrio_fusao.html` deu 118 de 126, o mesmo número da fusão na prova rápida.

### 4.1 Duelos em dupla — a média de cada classe contra as outras seis

924 jogos por classe e nível (154 por célula).

| classe | nível 5 | nível 12 | nível 20 | nível 30 |
|---|---|---|---|---|
| Bárbaro (`sumo`) | 43% → **54%** | 41% → **54%** | 44% → **54%** | 48% → **57%** |
| Caçador (`arqueiro`) | 68% → **53%** | 77% → **55%** | 70% → **52%** | 70% → **53%** |
| Bruxo (`bruxo`) | 63% → **57%** | 55% → **47%** | 67% → **48%** | 74% → **53%** |
| Ladino (`espadachim`) | 42% → **57%** | 38% → **51%** | 36% → **50%** | 40% → **52%** |
| Curandeiro (`curandeiro`) | 53% → **49%** | 52% → **50%** | 48% → **51%** | 42% → **49%** |
| Xamã (`invocador`) | 58% → **46%** | 60% → **47%** | 59% → **52%** | 55% → **54%** |
| Minotauro (`minotauro`) | 24% → **35%** | 27% → **44%** | 27% → **44%** | 22% → **33%** |

O que sobra fora da faixa da média: o **Minotauro** em todos os níveis (§6.1), o Bruxo e o
Ladino em 57% no nível 5, o Bárbaro em 57% no 30 e o Caçador na borda (55,4%) no 12.

**Um contra um** (o kit cru, sem cobrança, 48 jogos por célula) — a média de cada classe,
antes → depois, nos níveis 5 / 12 / 20 / 30: Bárbaro 53/54/49/51 → 56/60/66/65; Caçador
73/84/82/79 → 55/57/50/53; Bruxo 64/48/73/79 → 54/41/35/47; **Ladino 54/51/47/57 →
74/76/81/84**; Curandeiro 31/39/30/22 → 28/38/30/19; Xamã 61/57/57/55 → 49/37/47/55;
Minotauro 13/16/11/7 → 34/40/41/28. O Ladino é feito para matar **um**: sozinho contra
outro sozinho ele domina, e em dupla fica em 50%. O PvP do jogo é em dupla; se um dia
abrir o um contra um, ele é o primeiro a rever.

### 4.2 A fusão — fundida sobre os dois separados (16 misturas; * = conferência)

| dupla | nv 5 | nv 12 | nv 20 | nv 30 | nv 16* | nv 25* |
|---|---|---|---|---|---|---|
| arqueiro + bruxo | 94% → **100%** | 115% → **102%** | 113% → **98%** | 124% → **101%** | 106% → **96%** | 118% → **95%** |
| arqueiro + curandeiro | 64% → **100%** | 95% → **102%** | 89% → **95%** | 90% → **102%** | 93% → **101%** | 95% → **108%** |
| arqueiro + espadachim | 25% → **100%** | 86% → **99%** | 103% → **103%** | 97% → **100%** | 89% → **114%** | 108% → **111%** |
| arqueiro + invocador | 98% → **100%** | 129% → **100%** | 138% → **99%** | 145% → **101%** | 121% → **96%** | 145% → **103%** |
| arqueiro + minotauro | 160% → **100%** | 174% → **97%** | 212% → **107%** | 218% → **99%** | 220% → **124%** | 222% → **111%** |
| arqueiro + sumo | 67% → **100%** | 77% → **99%** | 83% → **102%** | 89% → **101%** | 86% → **114%** | 84% → **98%** |
| bruxo + curandeiro | 93% → **100%** | 134% → **100%** | 150% → **101%** | 182% → **99%** | 132% → **95%** | 161% → **100%** |
| bruxo + espadachim | 114% → **97%** | 171% → **101%** | 160% → **97%** | 177% → **101%** | 174% → **105%** | 169% → **95%** |
| bruxo + invocador | 114% → **100%** | 166% → **110%** | 133% → **84%** | 189% → **108%** | 141% → **90%** | 142% → **80%** |
| bruxo + minotauro | 94% → **100%** | 126% → **105%** | 106% → **91%** | 120% → **99%** | 119% → **106%** | 115% → **95%** |
| bruxo + sumo | 82% → **100%** | 91% → **98%** | 101% → **104%** | 119% → **97%** | 91% → **97%** | 107% → **94%** |
| curandeiro + espadachim | 46% → **101%** | 89% → **103%** | 84% → **95%** | 85% → **103%** | 87% → **100%** | 92% → **106%** |
| curandeiro + invocador | 173% → **100%** | 295% → **100%** | 276% → **96%** | 240% → **101%** | 222% → **76%** | 297% → **119%** |
| curandeiro + minotauro | 59% → **99%** | 74% → **90%** | 100% → **120%** | 87% → **92%** | 78% → **92%** | 108% → **123%** |
| curandeiro + sumo | 76% → **102%** | 88% → **99%** | 80% → **101%** | 64% → **99%** | 86% → **100%** | 88% → **124%** |
| espadachim + invocador | 102% → **103%** | 178% → **101%** | 194% → **98%** | 211% → **101%** | 190% → **104%** | 205% → **97%** |
| espadachim + minotauro | 71% → **100%** | 97% → **102%** | 109% → **103%** | 123% → **99%** | 109% → **121%** | 116% → **97%** |
| espadachim + sumo | 14% → **100%** | 29% → **103%** | 39% → **95%** | 55% → **102%** | 35% → **102%** | 40% → **91%** |
| invocador + minotauro | 0% → **100%** | 74% → **101%** | 150% → **98%** | 231% → **101%** | 164% → **100%** | 165% → **81%** |
| invocador + sumo | 109% → **100%** | 121% → **97%** | 142% → **109%** | 143% → **93%** | 121% → **94%** | 153% → **110%** |
| minotauro + sumo | 100% → **100%** | 129% → **102%** | 137% → **97%** | 149% → **99%** | 157% → **121%** | 148% → **98%** |

### 4.3 O perfil — × a média do elenco no mesmo nível

**Nível 5** (× a média do elenco: antes → depois)

| classe | dano único | dano em área | apoio/turno | vida efetiva | alcance |
|---|---|---|---|---|---|
| Bárbaro | 0.94 → **1.27** | 1.13 → **1.41** | 13 → **18** | 1.13 → **1.19** | 2.0 → **2.0** |
| Caçador | 1.24 → **0.91** | 1.15 → **0.86** | 6 → **2** | 0.73 → **0.68** | 7.3 → **5.3** |
| Bruxo | 1.08 → **0.86** | 1.19 → **0.99** | 7 → **3** | 0.72 → **0.67** | 7.3 → **5.3** |
| Ladino | 1.30 → **1.75** | 1.12 → **1.52** | 0 → **0** | 0.58 → **0.56** | 1.3 → **1.3** |
| Curandeiro | 0.89 → **0.81** | 0.77 → **0.70** | 63 → **53** | 1.94 → **1.67** | 5.0 → **5.0** |
| Xamã | 0.98 → **0.65** | 0.84 → **0.56** | 0 → **0** | 0.63 → **0.61** | 6.0 → **5.0** |
| Minotauro | 0.57 → **0.75** | 0.81 → **0.96** | 20 → **40** | 1.27 → **1.61** | 1.0 → **1.0** |

**Nível 12** (× a média do elenco: antes → depois)

| classe | dano único | dano em área | apoio/turno | vida efetiva | alcance |
|---|---|---|---|---|---|
| Bárbaro | 1.09 → **1.32** | 1.07 → **1.20** | 20 → **26** | 1.09 → **1.08** | 3.3 → **2.0** |
| Caçador | 1.38 → **1.05** | 1.26 → **0.97** | 11 → **9** | 0.76 → **0.66** | 7.5 → **5.5** |
| Bruxo | 1.03 → **0.88** | 1.37 → **1.30** | 8 → **3** | 0.69 → **0.62** | 7.5 → **6.3** |
| Ladino | 1.29 → **1.76** | 1.20 → **1.57** | 3 → **4** | 0.62 → **0.59** | 1.5 → **1.5** |
| Curandeiro | 0.84 → **0.74** | 0.73 → **0.64** | 63 → **54** | 1.59 → **1.33** | 5.3 → **5.3** |
| Xamã | 0.89 → **0.61** | 0.69 → **0.47** | 10 → **7** | 0.75 → **0.65** | 6.0 → **5.0** |
| Minotauro | 0.47 → **0.64** | 0.68 → **0.86** | 48 → **96** | 1.51 → **2.06** | 2.8 → **2.8** |

**Nível 20** (× a média do elenco: antes → depois)

| classe | dano único | dano em área | apoio/turno | vida efetiva | alcance |
|---|---|---|---|---|---|
| Bárbaro | 1.14 → **1.31** | 0.94 → **1.06** | 38 → **43** | 1.20 → **1.14** | 2.8 → **2.8** |
| Caçador | 1.29 → **0.99** | 1.34 → **1.24** | 13 → **9** | 0.75 → **0.63** | 8.0 → **6.3** |
| Bruxo | 1.16 → **0.92** | 1.71 → **1.32** | 10 → **6** | 0.70 → **0.60** | 9.3 → **7.0** |
| Ladino | 1.45 → **1.97** | 0.92 → **1.34** | 3 → **4** | 0.62 → **0.57** | 1.5 → **1.5** |
| Curandeiro | 0.74 → **0.65** | 0.71 → **0.68** | 92 → **96** | 1.47 → **1.34** | 5.5 → **6.3** |
| Xamã | 0.78 → **0.56** | 0.93 → **0.74** | 13 → **9** | 0.72 → **0.62** | 7.5 → **6.5** |
| Minotauro | 0.45 → **0.59** | 0.45 → **0.62** | 78 → **156** | 1.55 → **2.11** | 2.8 → **2.8** |

**Nível 30** (× a média do elenco: antes → depois)

| classe | dano único | dano em área | apoio/turno | vida efetiva | alcance |
|---|---|---|---|---|---|
| Bárbaro | 1.19 → **1.34** | 1.16 → **1.27** | 41 → **46** | 1.14 → **1.09** | 3.3 → **3.3** |
| Caçador | 1.28 → **0.93** | 1.35 → **1.28** | 15 → **11** | 0.79 → **0.66** | 8.8 → **7.3** |
| Bruxo | 1.23 → **0.91** | 1.82 → **1.35** | 6 → **8** | 0.73 → **0.64** | 9.8 → **7.5** |
| Ladino | 1.56 → **2.15** | 0.92 → **1.31** | 3 → **4** | 0.65 → **0.60** | 1.3 → **1.3** |
| Curandeiro | 0.61 → **0.57** | 0.57 → **0.57** | 145 → **165** | 1.53 → **1.47** | 6.3 → **6.3** |
| Xamã | 0.77 → **0.61** | 0.83 → **0.72** | 14 → **10** | 0.73 → **0.64** | 7.5 → **6.5** |
| Minotauro | 0.36 → **0.50** | 0.35 → **0.51** | 78 → **156** | 1.43 → **1.90** | 2.8 → **2.8** |

## 5. Os ajustes, um por um

### 5.1 O alcance decidia o duelo

Na primeira medida, nos duelos em dupla, o Caçador vencia **66–80%** e o Bruxo **59–77%**,
enquanto o Ladino ficava em 36–43%, o Bárbaro em 35–49% e o Minotauro em 21–30%. O que decidia
não era o número do dano: era o **alcance** — quem atira de 7 a 10 casas e recua 3 por turno
nunca é alcançado por quem anda 3 e bate a 1. Medido: cortar **só o dano** do Caçador até
0,51× ainda o deixava em 58%; tirar **2 casas** do alcance dele, com o dano a 0,8×, o punha em 53%.

**Ajuste:** alcance máximo **−2** em todo feitiço de dano do Caçador e do Bruxo, e **−1** nos do
Xamã (`spells.js`; nunca abaixo do mínimo). O do Xamã veio na segunda volta: no piso da
potência (0,7) ele ainda vencia 57% em três níveis — o que sobrava não era dano, era o Verbo do
Pacto atirando de 6 casas com as invocações à frente. O Caçador e o Bruxo continuam dividindo o
maior alcance de quem ataca com o próprio feitiço (§2.1).

### 5.2 A potência de cada classe, por degrau

Uma **potência** multiplica dano, cura e escudo dos feitiços da classe, separada por grupo de
degrau: **A** = 0 e 5, **B** = 10 e 12, **C** = 15 e 20, **D** = 30. O grupo A vale em todo
nível (os neutros são usados sempre); o B entra no 10, e assim por diante. Calibrada nos
duelos em dupla de cada nível, em ordem (o 5 acerta o A; o 12, o B; o 20, o C; o 30, o D), e
**presa entre 0,7 e 1,4** na primeira volta — fora disso a régua da IA estaria pedindo para
refazer a classe, não para acertá-la. A segunda volta (com a medida completa da primeira)
corrigiu o que sobrava, e só o topo do Bruxo passou do piso. As cargas de armadilha e os
golpes das invocações herdam a potência do feitiço que as arma/chama. Os números da tabela
são o total das duas voltas.

| classe | A (0–5) | B (10–12) | C (15–20) | D (30) | observação |
|---|---|---|---|---|---|
| Bárbaro | **1,40** | 1,06 | 1,00 | 0,94 | o tanque que bate: estava em 35–49% |
| Caçador | 0,80 | 0,75 | 0,95 | 0,70 | junto com o alcance −2 |
| Bruxo | 0,85 | 1,10 | 0,68 | 0,63 | junto com o alcance −2; o topo (15–30) é o mais forte do jogo na régua |
| Ladino | **1,40** | **1,40** | **1,40** | 1,15 | no teto: corpo a corpo com a menor vida efetiva |
| Curandeiro | 0,88 | 1,05 | 1,16 | 1,35 | cura e escudo levam a potência; o dano, a raiz dela |
| Xamã | **0,70** | **0,70** | 0,75 | 0,85 | no piso, junto com o alcance −1 |
| Minotauro | 2,0 | 2,0 | 2,0 | 2,0 | **escudo** ×2,0; dano ×1,37 (a potência elevada a 0,45) |

O Minotauro é o caso à parte: o escudo dele sobe inteiro e o dano sobe pouco, para ele
continuar batendo **menos de 75% do Bárbaro** (§2.1, a regra do próprio desenho). A
calibragem pedia 3,0 (escudo ×3); ficou em 2,0 de propósito — ver §6.

O contrato (`tests/validate_classes.html`) segurou três números: A Chama que Cuida, a Corrente
Sanadora e A Cisterna Boa do Curandeiro (fogo-30, água-20, água-30) param em **16 de cura por PA**, e o Arremesso do Fim do
Mundo do Bárbaro (`sumo-ar-30`) em **20 de dano por PA** e 40% do chefe final. Toda descrição de feitiço que
cita um número mudou junto (a tela mostra a descrição).

### 5.3 Os caminhos

Medidos depois da potência, os caminhos fora de ±25% (ou na borda, em mais de um nível)
ganharam um multiplicador de **dano** só no elemento deles:

| classe | caminho | × | por quê |
|---|---|---|---|
| Ladino | Ar | 1,25 | 0,67–0,81 da média; o mais fraco também nos duelos (17–35%) |
| Ladino | Terra | 0,9 | 1,17–1,28 |
| Caçador | Ar | 1,15 | 0,73–0,75 no 5 e no 30 |
| Caçador | Fogo | 0,9 | 1,21–1,32 |
| Bruxo | Fogo | 0,9 | 1,13–1,25 |
| Bruxo | Ar | 1,1 | 0,79–0,86 |
| Bárbaro | Ar | 1,12 | 0,76–0,82 |
| Xamã | Ar | 1,2 | 0,74 no 30 |
| Minotauro | Ar | 1,15 | 0,79–0,80 |
| Curandeiro | Fogo | 0,8 | 1,25–1,29 (o caminho que cura E bate) |
| Curandeiro | Casca Amiga (terra-5) | escudo 0,85 | Terra a 1,26 no 12 |

O "poder" do caminho soma o maior entre a sustentação própria e a cura num aliado: sem a cura
no aliado o caminho de Água do Curandeiro parecia 30% mais fraco — e ele é o que mais cura os
outros.

### 5.4 A fusão

- **Bote** (Caçador+Ladino) e **Encontrão** (Ladino+Bárbaro) eram as únicas formas de base presas
  a recarga 1: no nível 5 a fusão tinha **um** golpe por turno contra os quatro dos dois separados
  e rendia 23% e 10% deles. Passam a sair duas vezes por turno, como as outras dezenove.
- **`PAIR_TUNE` com nível**: `[k5, k12, k30]` por dupla (`Fusion.tuneDe`), ajustado por mínimos
  quadrados nos níveis 5, 12, 20 e 30 sobre a medida completa (dezesseis misturas), conferido no
  16 e no 25. Duas âncoras não bastavam (resíduo de 55% no 5). Os valores estão em `fusion.js`,
  e a tabela abaixo (§4.2) é a conferência.
- Tentei acertar os degraus do 16 e do 25 (§6) mexendo nas formas de 15 e 20 das duplas do
  Minotauro e do Curandeiro: a medida não andou (o degrau vem do lado dos SEPARADOS, ver §6) e
  o ajuste foi desfeito.

## 6. O que ficou fora da faixa, e por quê

(os números finais estão em §4; aqui o porquê e a decisão que cabe ao dono)

**6.1 O Minotauro, nos duelos.** É a classe mais longe da faixa: subiu de 24/27/27/22% para
**35/44/44/33%** (níveis 5/12/20/30), e é dele a maior parte das células que sobram fora de
40–60%. Os números sozinhos não o trazem: no nível 30 ele ficou em 36–39% com escudo ×4, com +60 de PV e com dano ×2,2 —
medido, um de cada vez. O que falta não é número, é o verbo: a IA entende o muro que corta a
visão agora (§3.4), mas não o muro que muda o caminho do inimigo dois turnos depois, e é esse
que um jogador usa. A calibragem pedia potência 3,0 (o Escudo de Ombro daria 120 a cada turno
por 2 PA); ficou em **2,0** porque 120 por turno anula o monstro do calabouço e o PvE não foi
medido aqui. **Decisão do dono:** (a) dar dano ao Minotauro no topo — ele chega perto do
Bárbaro, que é o que o desenho evita; (b) aceitar que ele vale mais nas mãos de gente do que
na régua da IA; (c) dar ao muro uma mecânica que a IA também enxergue (por exemplo, muro que
fere quem encosta).

**6.2 A fusão nos níveis de conferência.** Os desvios que sobram ficam no 16 e no 25, entre 20%
e 25%, e todos numa direção que o ajuste não alcança: o degrau vem do lado dos **separados**.
No 15 a classe ganha o quarto feitiço do caminho; o do Minotauro é muro (que a régua da fusão
não pontua) e o do Curandeiro é cura grande, então a razão salta entre o 12 e o 20 e volta.
Uma quarta âncora no 16 passaria por construção — e o 16 deixaria de ser conferência.

**6.3 A paridade de 5 níveis do PvP.** Medido (dupla da mesma classe com parceiro sorteado, os
dois lados trocados, 84 jogos por faixa): o lado 5 níveis acima vence **73%** (10 contra 5),
**80%** (17 contra 12), **65%** (25 contra 20) e **76%** (30 contra 25). Cinco níveis são uma
vantagem grande. Se o dono quiser o PvP ranqueado mais justo: paridade de 3, ou o lado mais
alto descer ao nível do mais baixo durante a luta.

**6.4 A régua é a IA.** Tudo o que §5 fez nas classes foi medido com a IA do jogo dos dois
lados (§1.5). Os ajustes grandes — o Ladino e o Bárbaro com até +40% de dano, o Caçador e o
Bruxo com 2 casas a menos de alcance, o Xamã a 0,7 — saíram dela. Antes de abrir o PvP para
gente, vale jogar e observar (§7).

**6.5 Baterias que já falhavam antes (medido na base 39a6ae9, iguais depois).**
`tests/test_progress_v2.html` está **118 / 56** — o conserto de 21/09 que o README dava como
174/0 nunca entrou em ramo nenhum (`git log --all -- tests/test_progress_v2.html`).
`tests/validate_fusion.html` tem **51** falhas (saque e pedras, nenhuma de fusão).
`tests/validate_classes.html` tem **7** (o teste crava `starCosts = [5,15,30,55,90]` e o dado é
`[5,15,35,65,110]`, a escada que o dono pediu em 30/08). As três listas de falha são
idênticas antes e depois desta rodada.

## 7. Como rodar e o que observar jogando

**Jogando, observe** (o que a régua da IA pode ter errado para mais ou para menos):

- o **Ladino** com até +40% de dano: ele some, chega e mata antes da resposta? (a IA não usa a
  invisibilidade para chegar; um jogador usa — pode ter ficado forte demais na mão de gente);
- o **Bárbaro** com +40% nos feitiços de nível 0–5: no começo do jogo ele limpa a sala sozinho?
- o **Caçador** e o **Bruxo** com 2 casas a menos: ainda dá para jogar de longe nos mapas grandes?
- o **escudo do Minotauro** ×2: o calabouço ficou fácil demais com ele no grupo?
- o **Xamã** a 0,7: as invocações dele ainda resolvem alguma coisa no calabouço?

```bash
node tests/equilibrio.js                 # a prova: perfis + fusão + duelos (~10 min com 4 filhos)
node tests/equilibrio.js perfis          # só os perfis (~1 min)
node tests/equilibrio.js fusao           # só a fusão (~1 min)
node tests/equilibrio.js duelos          # só os duelos (~8 min)
node tests/equilibrio.js --completo      # a medida deste documento (~35 min com 4 filhos; ~2 h de CPU)
# recortes para calibrar: --niveis 5,30  --classes minotauro  --sementes 4
# experimentar sem tocar nos dados: --ajuste arquivo.json (formato no topo de tests/equilibrio.js)
```
