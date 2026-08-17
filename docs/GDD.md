# SOTERRA — Ecos do Mundo Enterrado
### Documento de Game Design · Agente Criativo
> Fonte da verdade dos dados: `js/core/data.js` (`JOGO.DATA`). Este documento explica o *porquê* de cada dado e dá ao Designer e à Lógica tudo o que precisam para construir por cima. Todos os ids citados aqui existem em `data.js` e foram validados por `tests/validate_data.html`.

---

## 1. Premissa

**Há mil anos, o céu virou pedra.**

Ninguém sabe se foi castigo, acidente ou misericórdia. Num único dia — o dia da **Grande Lousa** — o firmamento coagulou, desceu e se assentou sobre o mundo como uma tampa de sarcófago. Tudo o que estava sob céu aberto foi apagado. Só sobreviveu o que já estava **embaixo**: adegas, cisternas, estufas, forjas, catacumbas.

Os últimos construtores do mundo antigo selaram essas bolsas de realidade em **Fechos**: calabouços-cofres, cada um mantido vivo por um **Coração** — o coração de brasa de uma forja, o coração d'água de uma cisterna, o coração-raiz de um jardim. Dentro de cada Fecho, um pedaço do mundo antigo continua existindo, teimoso, iluminado por aquilo que tiver à mão.

Mil anos é muito tempo para um coração bater sozinho. Os guardiões enlouqueceram de saudade e de dever; a fauna e a flora aprenderam a caçar; os Corações começaram a falhar. Quando um Coração para, o Fecho escurece — e a Grande Lousa desce mais um palmo.

Os cinco povos sobreviventes enviam **Descidas**: grupos de três heróis que atravessam os Fechos doentes, sala por sala, até o Coração — para retomá-lo antes que se apague. *Por isso só existem calabouços:* o mundo **é** os calabouços. Fora deles, só há pedra.

**Loop de jogo:** escolha 3 dos 5 heróis → escolha 1 dos 3 Fechos → vença 3 salas (2 normais + chefe) em combate tático por turnos.

---

## 2. As Cinco Raças

Regra de ouro para o Designer: cada raça tem uma **silhueta-assinatura** reconhecível a 30 células de distância, em isometria, sem cor. A cor confirma; a forma anuncia.

### 2.1 Sineiros (`bellborn`) — o povo de bronze
- **Silhueta:** cúpula. Cabeça em forma de **sino sem rosto** (a boca do sino aponta para baixo, sobre os ombros), corpo abaulado e pesado, pernas curtas e firmes como suportes de campanário. Um **badalo** pende visível dentro da cabeça-sino — é o "rosto" deles: balança quando falam.
- **Matéria:** bronze polido com **veias de azinhavre verde** correndo como hera; rebites, cordas de sino puídas, cicatrizes de marteladas.
- **Cultura:** fundidos pelos construtores para segurar os portões quando a Lousa desceu. Os construtores partiram; eles ficaram. Tocam as horas de um tempo que ninguém conta mais. Cada badalada é memória; esquecer é o único pecado.
- **Traço racial:** *Liga Paciente* — o bronze não racha: são a linha de frente natural de qualquer Descida, feitos para apanhar no lugar dos outros.
- **Paleta:** primária `#b08543` (bronze), secundária `#3f8f7a` (azinhavre), destaque `#ffd98a` (brilho dourado).

### 2.2 Pávios (`waxkin`) — o povo de cera
- **Silhueta:** gota escorrida. Corpo **fino, alto e derretido**, contorno irregular como vela usada; dedos longos que pingam; uma **chama viva** ardendo no alto da cabeça (o único ponto de luz forte da silhueta).
- **Matéria:** cera translúcida morna, camadas escorridas endurecidas nos ombros como capas. A chama muda de cor com o humor.
- **Cultura:** nasceram das velas votivas dos funerais do mundo antigo. Cada Pávio é sua própria chama: emprestá-la é intimidade; apagá-la é o silêncio absoluto — e eles fizeram do silêncio uma faca. Vivem depressa, derretem devagar.
- **Traço racial:** *Pavio Curto* — um Pávio nunca está onde a chama indica: somem no breu e reaparecem atrás do inimigo com a lâmina já quente.
- **Paleta:** primária `#e8d5a8` (cera), secundária `#8a5a44` (escorrido seco), destaque `#ff8c3a` (chama).

### 2.3 Miceles (`sporeborn`) — o povo-fungo
- **Silhueta:** guarda-chuva. **Chapéu carnudo largo** (mais largo que os ombros), **véu de lamelas** caindo do chapéu e cobrindo o rosto por completo, corpo esguio terminando em **filamentos pálidos** no lugar dos pés — eles deslizam, não pisam.
- **Matéria:** carne de cogumelo fosca com **bioluminescência turquesa** pulsando nas lamelas e esporos flutuando ao redor como poeira lenta.
- **Cultura:** enquanto todos cavavam para baixo, os Miceles cresceram *por dentro* das paredes. Memória coletiva: o micélio dos Fechos é um só corpo sonhando em milhares de chapéus. Um Micele carrega os esporos de todos os seus mortos — e os semeia.
- **Traço racial:** *Bolor Fecundo* — onde um Micele pisa, algo brota: crias de esporo, nuvens pútridas, veneno doce que trabalha enquanto o dono descansa.
- **Paleta:** primária `#7a5fa0` (violeta), secundária `#33453f` (verde-musgo escuro), destaque `#6fe0c8` (turquesa bioluminescente).

### 2.4 Vitrélios (`glassborn`) — o povo de vitral
- **Silhueta:** ângulos. Placas de **vidro colorido facetado** articuladas por um esqueleto fino de **chumbo dourado**; cabeça como rosácea de catedral; um **núcleo de luz** pulsando no peito, visível através das placas. Nenhuma curva orgânica: tudo é geometria de janela.
- **Matéria:** vitral vivo — cada Vitrélio retrata em seu próprio corpo uma cena do céu perdido (auroras, sóis, pássaros). Quando se movem, projetam manchas de cor no chão.
- **Cultura:** quando o céu virou pedra, os artesãos gravaram sua lembrança nas rosáceas dos templos — e a lembrança acordou. São janelas que andam: a última luz do sol antigo mora dentro deles, e eles a repartem com quem sangra no escuro.
- **Traço racial:** *Última Claridade* — a luz que atravessa um Vitrélio sai maior do que entrou: fecha feridas, endurece aliados, lembra ao escuro quem chegou primeiro.
- **Paleta:** primária `#6d7fd3` (azul-vitral), secundária `#2e2a4a` (chumbo escuro), destaque `#ffd166` (dourado solar).

### 2.5 Fôlegos (`bellowsborn`) — o povo-fole
- **Silhueta:** sanfona. **Torso pregueado** de couro claro e madeira que **infla e desinfla visivelmente** (a animação de idle já está no corpo), braços como tubos flexíveis, **boca-válvula** circular que assobia. Leves: tocam o chão como quem pede licença.
- **Matéria:** couro encerado, madeira pálida, anéis de latão; pequenos apitos e registros ao longo dos braços.
- **Cultura:** um mundo enterrado sufoca — alguém precisa respirar por ele. Os Fôlegos bombeiam o ar antigo de sala em sala pelos respiradouros. Dizem que o último suspiro de cada criatura passa pelos foles de um Fôlego, que o guarda e o devolve a quem precisa.
- **Traço racial:** *Sopro Emprestado* — posição é opinião: empurram, sugam e trocam corpos de lugar como quem reorganiza os móveis.
- **Paleta:** primária `#7fb6b0` (verde-água pálido), secundária `#4a5a66` (cinza-ardósia), destaque `#eef7f5` (branco-névoa).

---

## 3. Os Cinco Heróis

Papéis táticos **sem sobreposição**: tanque · assassina · invocadora/veneno · suporte · controladora de posição. Todos: PA 6, PM 3, power 0.

### 3.1 Repique, o Dobre-Guardião (`hero-toll`, Sineiro) — TANQUE
*Último porteiro do Fecho Setentrional. Fala pouco; cada palavra soa como hora grave. Proteger é a única música que importa.*

**HP 140 · Iniciativa 20** (age por último — o escudo chega antes do golpe seguinte).

| Feitiço | Elem. | PA | Alcance | Recarga | Fantasia → Mecânica |
|---|---|---|---|---|---|
| **Badalada** (`bell-strike`) | terra | 3 | 1 | — (2×/turno) | Golpeia com o próprio badalo: **21–27 terra + empurra 1**. Mantém a porta limpa. |
| **Toque de Recolher** (`curfew-toll`) | neutro | 3 | si mesmo | 3 | O dobre que ninguém ignora: **provoca 2 turnos + 25 de escudo**. O botão de "olhem para mim". |
| **Muralha de Bronze** (`bronze-wall`) | terra | 3 | 0–4 | 2 | Verte o próprio bronze sobre um aliado: **35 de escudo por 2 turnos**. |
| **Dobre Fúnebre** (`funeral-knell`) | terra | 4 | si mesmo, cruz 2 | 2 | O sino toca por quem vai morrer: **16–21 em cruz** ao redor dele. Recompensa por ser cercado. |
| **Chamado do Sino** (`bell-call`) | neutro | 2 | 2–5 | 1 | O sino chama, o corpo obedece: **puxa 3 + 7–10**. Traz o arqueiro para a zona de provocação. |

**Plano de jogo:** entrar no gargalo, provocar, puxar quem foge, ecoar em área. Sinergia: puxa inimigos para o `spore-cloud` de Morela.

### 3.2 Estopim, a Chama que Some (`hero-wick`, Pávia) — ASSASSINA
*Ladra de relíquias "aposentada desde sempre". Ri no escuro; some no meio da frase.*

**HP 95 · Iniciativa 85** (age primeiro).

| Feitiço | Elem. | PA | Alcance | Recarga | Fantasia → Mecânica |
|---|---|---|---|---|---|
| **Salto de Pavio** (`wick-jump`) | fogo | 2 | 1–4 (célula vazia) | 2 | A chama salta de pavio em pavio: **teleporte**. Entrada e fuga. |
| **Apagar-se** (`snuff-out`) | sombra | 2 | si mesma | 4 | Aperta a própria chama: **invisível 2 turnos** (quebra ao causar dano). |
| **Lâmina Escaldante** (`molten-blade`) | fogo | 4 | 1 | — (1×/turno) | Adaga de cera fervente: **38–46**. O pagamento da emboscada. |
| **Cuspe de Fagulha** (`spark-spit`) | fogo | 2 | 2–5 | — (2×/turno) | Fagulha que assobia: **16–21** à distância. Plano B quando não dá para entrar. |
| **Avivar a Chama** (`fan-flame`) | fogo | 2 | si mesma | 3 | Abana a chama até rugir: **+25 power por 2 turnos**. Prepara o pico de dano. |

**Turno-assinatura:** Avivar (2) + Salto (2) → adjacente do alvo → Lâmina (4) com +25 power ≈ 52 de dano. Frágil: se errar a janela, morre.

### 3.3 Morela, a Pastora de Esporos (`hero-morel`, Micele) — INVOCADORA / VENENO
*Carrega os mortos da colônia em esporos sob o véu — e os semeia na batalha. Doce, paciente, implacável.*

**HP 105 · Iniciativa 45.**

| Feitiço | Elem. | PA | Alcance | Recarga | Fantasia → Mecânica |
|---|---|---|---|---|---|
| **Brotar Esporinho** (`sporeling-call`) | terra | 3 | 1–3 (célula vazia) | 2 | Um esporo cai do véu e abre os olhinhos: **invoca Esporinho** (35 HP, morde+veneno, **explode ao morrer**: 10 terra, raio 1). Corpo extra que nega célula. |
| **Dardo de Bolor** (`mold-dart`) | terra | 3 | 1–5 | — (2×/turno) | Dardo felpudo que floresce na carne: **13–17 + veneno 5–8 por 2 turnos**. |
| **Véu de Esporos** (`spore-cloud`) | terra | 3 | 1–4, círculo 1 | 2 | Ergue o véu por um instante: **veneno 8–11 por 2 turnos em área**. |
| **Laço Micelial** (`mycelial-snare`) | terra | 2 | 1–4 | 1 | Filamentos amarram tornozelos: **−2 PM por 1 turno + 6–9**. Kiting. |
| **Banquete Pútrido** (`putrid-feast`) | sombra | 3 | 1–2 | 1 | O micélio devora por dentro: **22–28 com roubo de vida**. Sustento pessoal. |

**Plano de jogo:** dano em prestação — venenos acumulados matam no início do turno inimigo; o Esporinho tanca, morre e explode. Nada se desperdiça.

### 3.4 Rosácea, a Janela do Amanhã (`hero-rose`, Vitrélia) — SUPORTE
*Retrata no corpo o nascer do sol que ninguém viu. Otimista de teimosia geológica.*

**HP 110 · Iniciativa 60.**

| Feitiço | Elem. | PA | Alcance | Recarga | Fantasia → Mecânica |
|---|---|---|---|---|---|
| **Estilhaço Radiante** (`light-shard`) | luz | 3 | 1–6 | — (2×/turno) | Arremessa uma placa do próprio corpo: **22–28 luz**. O suporte não é inofensivo. |
| **Refração Vital** (`vital-refraction`) | luz | 3 | 0–5 | — (2×/turno) | A luz do núcleo sai curativa: **cura 24–30**. |
| **Redoma Prismática** (`prism-dome`) | luz | 3 | 0–4 | 2 | Cúpula de vitral: **22 escudo + regeneração 6–9 por 2 turnos**. |
| **Hino Radiante** (`radiant-hymn`) | luz | 2 | 0–4 | 2 | Vibra como órgão de catedral: **+20 power por 2 turnos** num aliado. |
| **Memória do Sol** (`sun-memory`) | luz | 4 | 0–4, círculo 1 | 2 | Projeta o amanhecer gravado no peito: **cura 14–18 em área**. |

**Plano de jogo:** manter Repique de pé, dobrar o pico de Estopim com Hino, punir à distância com Estilhaço.

### 3.5 Sibilo, o Vento Emprestado (`hero-whistle`, Fôlego) — CONTROLE DE POSIÇÃO
*Zelador de respiradouros; decorou a planta de cada Fecho pelo assobio do ar. A batalha é um problema de ventilação: tudo no lugar errado.*

**HP 100 · Iniciativa 70.**

| Feitiço | Elem. | PA | Alcance | Recarga | Fantasia → Mecânica |
|---|---|---|---|---|---|
| **Rajada de Fole** (`gale-push`) | ar | 3 | 1–4 | — (2×/turno) | Soco de ar comprimido: **13–17 + empurra 2** (colisão: +10/célula bloqueada). Empurre para paredes e buracos. |
| **Sucção** (`bellows-suction`) | ar | 2 | 2–5 | 1 | Abre as válvulas e inspira: **puxa 3 + 6–9**. Tira o suporte inimigo de trás da parede. |
| **Permuta de Ar** (`air-swap`) | ar | 2 | 1–5 | 3 | Dois corpos, um sopro: **troca de lugar** com qualquer unidade. Resgate ou entrega. |
| **Chicote de Corrente** (`wind-lash`) | ar | 3 | 1–3 | — (2×/turno) | Corrente de ar afiada: **26–32**. O dano honesto do kit. |
| **Fôlego Emprestado** (`second-wind`) | ar | 2 | 0–4 | 3 | Empresta um suspiro guardado: **+2 PM por 1 turno**. Habilita alcances impossíveis. |

**Plano de jogo:** xadrez — empurra o Tição para explodir no meio dos inimigos, troca Estopim para dentro, dá PM para Repique alcançar o gargalo. **Atenção:** chefes e monstros âncora têm `pushImmune` — o contra-jogo do Sibilo é mover os *lacaios*.

---

## 4. Os Três Calabouços

Dificuldade crescente: Estufa (fácil) → Cisterna (média) → Fecho de Brasa (difícil).

### 4.1 A Estufa Soterrada (`greenhouse`) — verde, dourado, apodrecido
A estufa real do mundo antigo, selada com o jardim ainda vivo dentro. Séculos no escuro ensinaram as plantas a caçar. Vagalumes presos em redomas fazem as vezes de sol; vidro quebrado range sob os pés; tudo goteja clorofila.

**Paleta:** primária `#5a8f4d` · secundária `#8a6b3e` · destaque `#ffd76b` · pisos `#35513a`/`#3d5c41` · paredes `#57452f` (madeira podre e treliça).

**Salas:**
1. **O Vestíbulo das Heras** (13×11) — uma sebe central (parede dupla) divide a sala em dois corredores; buracos de canteiro no canto superior. Ensina flanco: um corredor é curto e perigoso, o outro é longo e seguro. Elenco: 2 Bufos-de-Pólen, 1 Vergasta, 1 Vespa-Lustre.
2. **Os Canteiros Afundados** (13×13) — canteiros rebaixados (buracos 3×2) nos quatro cantos formam uma cruz de passarelas. O Seiveiro fica no meio, curando; as Vergastas cobrem as passarelas. Ensina prioridade de alvo (mate o curandeiro) e uso de empurrão perto de buracos. Elenco: 2 Vergastas, 1 Seiveiro, 1 Carrapicho-Mãe, 1 Vespa-Lustre.
3. **O Coreto da Viúva** (13×13) — o coreto do jardim: quatro pilares em anel, a Jardineira no fundo, dois buracos diante dos spawns. Os pilares bloqueiam linha de visão contra o `m-vine-hook`. Elenco: **A Jardineira-Viúva** + 2 Seiveiros (as auras de regeneração dos Seiveiros curam a chefe: mate-os primeiro).

### 4.2 A Cisterna dos Afogados (`cistern`) — azul profundo, turquesa elétrico
O reservatório que matou a sede do mundo antigo — e depois bebeu seus donos. A corte afogada ainda dá bailes na água parada: pérolas no lodo, lampiões submersos ainda acesos, lustres de águas-vivas. Tudo reflete.

**Paleta:** primária `#2e6e8e` · secundária `#1d3a4d` · destaque `#7ef0d4` · pisos `#24404f`/`#2a4a5a` · paredes `#16222c` (pedra negra úmida).

**Salas:**
1. **A Galeria das Goteiras** (13×11) — dois canais de água (colunas de buraco) com uma faixa central e **uma única ponte**. As Moreias atacam em linha através dos canais; a fila indiana na ponte é o perigo. Ensina: buracos não bloqueiam visão. Elenco: 2 Afogadiços, 2 Moreias-Flauta.
2. **O Salão das Colunas de Sal** (15×13) — salão de baile com colunas avulsas (cobertura de verdade) e um pilar central oco com poço. Espaço aberto = perigo das linhas de Moreia; colunas = abrigo. O Salmourão avança devagar e inexorável. Elenco: Afogadiço, Moreia-Flauta, Salmourão, Água-Viva-Lustre, Gota-Gorda.
3. **O Trono da Salmoura** (13×13) — o estrado da Baronesa numa alcova, **buracos flanqueando o meio da sala**: o `m-tide-pull` dela arrasta a Descida por cima do salão na direção do trono — posicione-se para não parar ao lado do `m-bitter-gulp`. Elenco: **Baronesa Salmoura** + Moreia-Flauta + Água-Viva-Lustre.

### 4.3 O Fecho de Brasa (`emberlock`) — vermelho fundido, negro fuligem
O último Fecho, forjado ao redor da primeira chama do mundo. Corredores de bigornas frias, correntes do teto, luz que vem de baixo — das grelhas no piso. O maior portão já construído acordou com ciúme do próprio fogo.

**Paleta:** primária `#c4502e` · secundária `#4a2a26` · destaque `#ffb347` · pisos `#3a2422`/`#452a25` · paredes `#241512` (ferro escuro e pedra queimada).

**Salas:**
1. **O Corredor de Brasas** (13×11) — espinha de muretas de ferro no centro, poço de escória à esquerda. Os Tições correm pelos vãos: matá-los perto do grupo é pagar 22 de fogo. Ensina: onde o inimigo morre importa. Elenco: 2 Tições, 1 Cinzento, 1 Bigorna Ambulante.
2. **A Nave dos Malhos** (15×13) — duas paredes-trilho compridas criam um **corredor central estreito** com só duas travessias; fossos de têmpera nos flancos. O Ferreiro Sem-Rosto fica atrás, temperando os aliados; a Bigorna entope a travessia. Ensina: quebrar a formação inimiga com `air-swap`/empurrões. Elenco: Tição, Cinzento, Bigorna Ambulante, Monte de Escória, Ferreiro Sem-Rosto.
3. **A Câmara do Coração** (15×13) — Magno diante da grelha do Coração; dois bolsões murados com poços criam um **portal apertado** no centro; fossos diante dos spawns limitam o recuo. O `m-bellows-blast` de Magno empurra 3 células — de costas para um fosso, isso é colisão e dano. Elenco: **Magno, o Acendedor** + 2 Tições + Ferreiro Sem-Rosto.

---

## 5. Bestiário

Cada monstro responde a uma pergunta: **"o que ele faz de diferente?"** Visual → ver §6; números → `data.js`.

### 5.1 Estufa Soterrada (família *Flora Voraz* / *Enxame da Estufa*)

| Monstro | HP | IA | A diferença |
|---|---|---|---|
| **Vergasta** (`thorn-lasher`) | 50 | ranged | Torreta enraizada: `pushImmune`, PM 1. Atira farpas (2–6) e trava PM (`m-root-grip`). Não foge — você é que vai até ela. |
| **Bufo-de-Pólen** (`pollen-puff`) | 45 | melee | Bomba fofa: **explode ao morrer** (18 terra, raio 1). Caminha sorrindo até o grupo. Mate-o longe — ou empurre-o de volta. |
| **Carrapicho-Mãe** (`burr-mother`) | 60 | melee | **Divide-se** em 2 Carrapichinhos ao morrer. Um corpo vira três problemas de posicionamento. |
| **Vespa-Lustre** (`lantern-wasp`) | 48 | melee | Iniciativa 75, PM 4: chega primeiro, ferroa com veneno e força a Descida a reagir cedo. |
| **Seiveiro** (`sap-shaman`) | 55 | support | Curandeiro com **aura de regeneração** (8, raio 2) + buff de power. O alvo prioritário de toda sala em que aparece. |
| **A Jardineira-Viúva** (`boss-gardener`) | **280** · PA 7 | boss | **Gimmick: a poda.** `m-vine-hook` puxa um herói 3 células para dentro do coreto e a Tesourada (24–30) o apara; `m-seed-toss` semeia Brotinhos-Vorazes sem parar; `pushImmune`; **enfurece a 40%** (+30 power). No coreto, os 2 Seiveiros a regeneram — a luta é sobre *quem* você corta primeiro. |

Invocados: **Brotinho-Voraz** (`sprout-feral`, 30 HP, PM 4 — pressa e dentes) · **Carrapichinho** (`burrlet`, 22 HP — gruda e não solta).

### 5.2 Cisterna dos Afogados (família *Corte Afogada*)

| Monstro | HP | IA | A diferença |
|---|---|---|---|
| **Afogadiço** (`drowned-porter`) | 75 | melee | Mordida com **roubo de vida** ×2 por turno: duela mal — ele se cura enquanto te come. |
| **Moreia-Flauta** (`moray-piper`) | 65 | ranged | Só ataca em **linha reta** (jato 2–6 e língua-arpão que **puxa 2**). Saia da linha; ela recoloca você nela. |
| **Água-Viva-Lustre** (`lantern-jelly`) | 60 | support | Aura de regeneração + cura + **escudos** (`m-jelly-ward`). Transforma Afogadiços em esponjas. |
| **Salmourão** (`brine-golem`) | 105 | melee | Muralha andante: `pushImmune`, **enfurece a 50%** (+25). Ignorá-lo é um cronômetro. |
| **Gota-Gorda** (`fat-drop`) | 70 | melee | **Divide-se** em 2 Gotinhas. Na sala das colunas, cada gota nova entope um vão. |
| **Baronesa Salmoura** (`boss-baroness`) | **340** · PA 8 | boss | **Gimmick: o baile.** `m-tide-pull` (círculo raio 3) **arrasta a sala inteira até ela**; no turno seguinte, `m-bitter-gulp` (cruz 2) devora quem ficou perto, com veneno. Entre um gole e outro, verte Gotinhas e atira lanças de sal. `pushImmune`, enfurece a 35%. A dança: espalhar-se, ser puxado, **sair antes do gole**. |

Invocada: **Gotinha** (`droplet`, 25 HP — pequena, redonda, indignada).

### 5.3 Fecho de Brasa (família *Prole da Fornalha*)

| Monstro | HP | IA | A diferença |
|---|---|---|---|
| **Tição** (`ember-imp`) | 60 | melee | Kamikaze veloz (PM 4, iniciativa 75): **explode ao morrer** (22 fogo, raio 1). Magno os fabrica; Sibilo os devolve. |
| **Bigorna Ambulante** (`walking-anvil`) | 110 | melee | O tanque deles: `pushImmune`, **enfurece a 50%** (+30), esmaga por 20–26. Lenta (iniciativa 10) — cite-a por último, mas cite-a. |
| **Cinzento** (`ash-wraith`) | 70 | ranged | Atirador que **fica invisível** (`m-ash-veil`, 1 turno) quando pressionado. Obriga a trocar de alvo — ou adivinhar. |
| **Monte de Escória** (`slag-mound`) | 95 | melee | **Divide-se em 2 Escorinhas que explodem** ao morrer: uma morte em três atos. A pior coisa para matar em espaço apertado. |
| **Ferreiro Sem-Rosto** (`faceless-smith`) | 80 | support | Suporte ofensivo: **+20 power** (`m-forge-temper`) e **escudos de 20** nos aliados. Uma Bigorna temperada desmonta um herói. |
| **Magno, o Acendedor** (`boss-heartforge`) | **420** · PA 9 | boss | **Gimmick: a fornalha respira.** Alterna `m-bellows-blast` (linha, **empurra 3** — contra fossos e paredes, colisão) com `m-spark-call` (fabrica Fagulhas explosivas) e, com a Descida desarrumada, desce o `m-doom-hammer` (cruz, 30–38, recarga 2). Auto-buff `m-stoke`, `pushImmune`, **enfurece a 50% (+40)** — a segunda metade da luta é outra luta. |

Invocadas: **Fagulha** (`spark-whelp`, 28 HP, explode 15) · **Escorinha** (`slag-bit`, 30 HP, explode 12).

### 5.4 Rebanho de Morela
**Esporinho** (`sporeling`, `summonOnly`, 35 HP) — cogumelo-bebê de olhos grandes; morde com veneno e **explode em nuvem de esporos** (10 terra, raio 1) ao morrer. A invocação da heroína: corpo, dano retardado e negação de célula num pacote só.

---

## 6. Direção de Arte (guia prático para o Designer)

### 6.1 Mood geral
- **Escuro, mas quente.** SOTERRA não é terror: é um mundo de lanternas. Fundos sempre escuros e dessaturados; a vida acontece em **poças de luz saturada** (vagalumes, águas-vivas, brasas, vitrais). Contraste alto entre personagem e chão.
- **Luz vem de baixo ou de dentro.** Não há céu: nada de luz fria de cima. Ilumine por grelhas no piso, água que brilha, chamas na cabeça, núcleos no peito. Personagens devem parecer *fontes* de luz, não receptores. (Rim light na cor de destaque do calabouço amarra o elenco ao cenário.)
- **Silhueta primeiro.** Teste mental: pinte tudo de preto — Repique é uma cúpula, Estopim uma gota com chama, Morela um guarda-chuva, Rosácea um polígono, Sibilo uma sanfona. Nos monstros, idem (bola, chicote, novelo, lustre, bigorna...).
- **Formas por papel:** aliados e suportes = curvas e círculos; ameaças corpo a corpo = massas largas e baixas; atiradores = linhas finas e verticais; chefes = 2–3× a altura de um herói, com **um** adereço memorável (tesoura, colar de pérolas, martelo-chaminé).

### 6.2 Linguagem visual por calabouço
| | Estufa Soterrada | Cisterna dos Afogados | Fecho de Brasa |
|---|---|---|---|
| **Formas** | orgânicas, emaranhadas, diagonais de vinha | verticais, colunas, reflexos simétricos | retas pesadas, ângulos de ferro, correntes |
| **Luz** | pontinhos dourados (vagalumes), feixes finos por vidro rachado | cáusticas turquesa onduladas, brilho vindo dos buracos d'água | brilho rubro pulsante vindo de baixo, faíscas subindo |
| **Piso decorado `,`** | ladrilho com grama/musgo irrompendo | mosaico com poça-espelho | grelha de forja com brasa viva embaixo |
| **Paredes `#`** | treliças e sebes lenhosas | pedra negra com escorrido salino claro no topo | blocos de ferro rebitado, topo em brasa |
| **Buracos `~`** | canteiros afundados em terra escura | água escura com anéis de ondulação e luz subindo | fossos com magma/escória incandescente no fundo |
| **Partícula ambiente** | esporos e vagalumes lentos | bolhas e gotejar constante | fagulhas e fuligem subindo |

### 6.3 Animações mínimas por unidade
Idle (respirar/flutuar — o torso de Sibilo já respira, a chama de Estopim tremula, as placas de Rosácea reordenam-se sutilmente) · conjuração (antecipação de 2–3 frames na direção do alvo) · dano (flash branco + recuo) · morte (desmontar na própria matéria: bronze racha, cera derrama, vidro estilhaça, gota espirra, cinza dispersa).

### 6.4 Glossário de `fxKey` (contrato Criativo → Designer/FX)
| fxKey | Efeito visual esperado |
|---|---|
| `slam` | impacto corpo a corpo pesado: flash no alvo, poeira, screen-shake curto |
| `bolt` | projétil rápido com rastro, do conjurador ao alvo |
| `beam` | feixe/corrente contínua ligando conjurador e alvo por ~300ms |
| `burst` | erupção no alvo (partículas radiais), sem projétil |
| `nova` | onda expansiva a partir do centro da área (feitiços de área/chefes) |
| `heal` | motas ascendentes douradas/verdes + brilho suave no alvo |
| `buff` | espiral ascendente na cor do elemento |
| `debuff` | espiral descendente escura + dessaturação breve do alvo |
| `shieldFx` | bolha/redoma facetada que se fecha e persiste sutil enquanto durar |
| `veil` | fumaça que engole a unidade; sprite fica 30% de alfa |
| `hook` | linha/corda lançada ao alvo, que é arrastado com esticada elástica |
| `gust` | linhas de vento horizontais + arremesso do alvo |
| `blink` | flash de partida + flash de chegada (teleporte/troca) |
| `summonFx` | círculo no chão + a criatura brota/cai nele |
| `poisonCloud` | nuvem borbulhante persistente ~1s na área |

### 6.5 UI
Molduras da UI em tom neutro escuro (`#14181c`+) com detalhes na cor de destaque do calabouço atual. Retratos da timeline: fundo na cor primária da raça/família. Números de dano na cor do elemento; curas em verde-dourado; escudo em azul-claro facetado. Fonte de exibição com peso alto (títulos) + monoespaçada para números.

---

## 7. Notas de balanceamento (racional)

- **Dano de herói:** ~9–11 de dano médio por PA em alvo único (`molten-blade` 10,5/PA com trava de 1×/turno; `wind-lash` 9,7/PA), menos quando carrega utilidade (`bell-strike` 8/PA + empurrão) ou área (`funeral-knell` ~4,6/PA por alvo atingido). Venenos pagam ~1 turno de atraso pelo total maior.
- **Curas** curam menos do que dano equivalente custa (24–30 por 3 PA): curar é comprar tempo, não desfazer o turno inimigo.
- **TTK esperado:** monstro comum da Estufa cai em ~1 turno focado; da Cisterna em ~1,5; do Fecho em ~2. Chefes: 6–9 turnos com a pressão dos lacaios crescendo (Jardineira semeia, Baronesa verte, Magno fabrica Fagulhas).
- **PA dos chefes** (7/8/9) sustenta o gimmick + 1 ação de pressão por turno; `enrage` garante que o fim da luta seja o momento mais tenso.
- **Contrapesos dos heróis:** o tanque age por último (iniciativa 20); a assassina morre se errar a janela (95 HP); a invocadora tem dano à vista baixo; o suporte não empurra nem puxa; a controladora não fura `pushImmune` (mas `air-swap` não é push — é a resposta dela a chefes).

## 8. Progressão e Espólios

> Dados: `items`, `monsters[*].xp`, `dungeons[*].lootTable` e `leveling` em `data.js`. Regras de sorteio e persistência: CONTRACT.md, Adendo v2 (`JOGO.Progress`, dono: Lógica).

### 8.1 Filosofia — o risco compra sorte

A Descida oficial tem três heróis. Descer com menos é imprudência — e os Fechos **respeitam imprudência**. A regra fixa do contrato: `LUCK = 1.0` (3 heróis) · `1.6` (2) · `2.4` (solo). No sorteio, o peso efetivo é `weight × 1` para comum, `× LUCK` para raro e `× LUCK²` para épico. Com os pesos escolhidos (comuns 30, raros 12, épico 4), isso significa na sala do chefe:

| Grupo | Chance de épico por sorteio | Por sala de chefe (2 sorteios) |
|---|---|---|
| 3 heróis | ~3% | ~6% |
| 2 heróis | ~6,5% | ~12% |
| **solo** | **~11,5%** | **~22%** |

O épico é o item-troféu do chefe: **1 por calabouço, só na sala do chefe** (`minRoom: 2`), sempre com +1 PA ou +1 PM — o único lugar do jogo onde se compra ação extra. Duplicatas são permitidas (o mundo enterrado não faz encomendas). XP é dividido pelo tamanho do grupo: solo também nivela ~3× mais rápido — e morre ~3× mais fácil. Essa é a barganha inteira.

### 8.2 Nivelamento

- `maxLevel: 20` · ganho por nível: **+6 HP, +3 power**. No nível 20: +114 HP e +57 power sobre a base — um herói veterano bate ~1,5× mais forte e aguenta quase o dobro.
- Curva (`xpTable`, acumulada): nível 2 aos 60 XP, degraus crescendo ~1,4× no início e amaciando no fim (60 · 85 · 120 · 170 · 240 … 4230). Total do nível 20: 27.135 XP.
- Calibração: a Estufa completa rende ~710 XP de grupo. Um trio termina a primeira Descida no **nível 3** (2 níveis ganhos); uma dupla no nível 4; um solo sai no nível 6. Os três calabouços completos rendem ~2.720 XP de grupo por volta.
- XP dos monstros: ~HP/2 (comuns), ~HP×1,5 (chefes: 420/510/630), 4–5 para crias invocadas pelos inimigos, **0 para o Esporinho** (ninguém cultiva o próprio rebanho).

### 8.3 Espólios da Estufa Soterrada (`greenhouse`)

| Item | Slot | Raridade | Bônus | Flavor (tooltip) |
|---|---|---|---|---|
| Tesoura de Poda | arma | comum | +4 poder | *"O jardim inteiro estremece quando ela se abre."* |
| Chicote de Vergasta | arma | raro | +9 poder, +10% terra | *"Ainda tenta chicotear de volta. Faz parte do charme."* |
| Escudo de Treliça | armadura | comum | +10 HP | *"A hera que o cobre aperta o seu braço com carinho."* |
| Avental da Estufa | armadura | raro | +20 HP, +10% terra | *"Os bolsos ainda têm sementes. Não plante nenhuma."* |
| Redoma de Vagalumes | amuleto | comum | +8 iniciativa | *"Eles acordam meio segundo antes do perigo. Copie-os."* |
| Âmbar de Seiva | amuleto | raro | +12 HP, +5 poder | *"Doce por fora, faminta por dentro. Como tudo aqui."* |
| **Tesourão da Viúva** | arma | **épico** | **+1 PA**, +14 poder | *"Ela podava o jardim. Agora você poda o mundo."* |

### 8.4 Espólios da Cisterna dos Afogados (`cistern`)

| Item | Slot | Raridade | Bônus | Flavor (tooltip) |
|---|---|---|---|---|
| Florete de Sal | arma | comum | +5 poder | *"A corte afogada duelava por educação. Você não precisa."* |
| Flauta-Arpão | arma | raro | +10 poder, +5 iniciativa | *"Assobia a mesma nota grave a cada golpe: 'desça'."* |
| Casaca do Carregador | armadura | comum | +12 HP | *"Quem a veste nunca larga o que carrega. Cuidado com o que carrega."* |
| Couraça de Salmoura | armadura | raro | +18 HP, +15% água | *"Quanto mais quebra, mais afiada fica. Igual ao dono anterior."* |
| Lampião Submerso | amuleto | comum | +7 iniciativa | *"A chama não sabe que afogou. Ninguém teve coragem de contar."* |
| Frasco de Maré Viva | amuleto | raro | +15 HP, +10% água | *"Duas vezes por dia, o frasco puxa. Ninguém sabe para onde."* |
| **Colar da Baronesa** | amuleto | **épico** | **+1 PM**, +15 HP, +10% água | *"A maré abre caminho para quem o veste. Por respeito — ou por medo."* |

### 8.5 Espólios do Fecho de Brasa (`emberlock`)

| Item | Slot | Raridade | Bônus | Flavor (tooltip) |
|---|---|---|---|---|
| Martelo de Bancada | arma | comum | +5 poder | *"Não forjou o mundo, mas consertou boa parte dele."* |
| Sabre de Escória | arma | raro | +10 poder, +10% fogo | *"Nunca esfriou de verdade. Guarda rancor da bigorna."* |
| Chapa Rebitada | armadura | comum | +12 HP | *"O portão não sente falta. Provavelmente."* |
| Manto de Fuligem | armadura | raro | +18 HP, +15% fogo | *"Às vezes ele lembra que já foi alguém — e te abraça."* |
| Válvula de Fole | amuleto | comum | +8 iniciativa | *"O assobio é meio segundo de vantagem. Nos Fechos, é uma vida."* |
| Brasa Perpétua | amuleto | raro | +8 poder, +10% fogo | *"Aquece o bolso, o peito e as más ideias."* |
| **Grelha do Primeiro Fogo** | armadura | **épico** | **+1 PA**, +20 HP, +15% fogo | *"O primeiro fogo do mundo agora bate atrás das suas costelas."* |

### 8.6 Guia visual de `iconKey` (contrato Criativo → Designer)

Ícones procedurais em `Sprites.itemIcon(itemId)`: silhueta simples e legível a 32px, fundo/moldura na cor da raridade (comum = bronze/cinza, raro = azul, épico = dourado/roxo, conforme CONTRACT.md). Um adereço por ícone, nada de cena.

| iconKey | Silhueta esperada | Toque de cor |
|---|---|---|
| `shears` | tesoura de poda fechada, lâminas curtas | aço fosco, cabos verdes |
| `vine-whip` | chicote enrolado em espiral com espinhos | verde `#5a8f4d`, farpas douradas |
| `trellis-shield` | escudo quadrado em grade (treliça), hera num canto | madeira `#57452f`, folhas verdes |
| `apron` | avental trapezoidal com bolso central | couro, remendo de folha |
| `firefly-jar` | redoma/cúpula com 3 pontos brilhantes | vidro azulado, motas `#ffd76b` |
| `amber` | gota facetada com bolha interna | dourado translúcido `#ffd76b` |
| `great-shears` | tesourão aberto em X, ferrugem | aço + ferrugem, brilho épico dourado |
| `rapier` | lâmina fina com copo de guarda circular | branco-sal, reflexo turquesa |
| `flute` | crânio alongado com 3 furos de flauta | osso pálido, furos escuros |
| `coat` | casaca de gola alta escorrendo água | azul profundo `#2e6e8e` |
| `salt-plate` | peitoral de placas facetadas de cristal | branco-sal com arestas `#7ef0d4` |
| `oil-lantern` | lampião de alça com chama dentro | metal escuro, chama `#7ef0d4` |
| `tide-flask` | frasco bojudo com linha d'água inclinada | vidro, água `#2e6e8e` |
| `pearl` | colar: arco de 5 pérolas | pérolas nacaradas, brilho épico |
| `anvil-hammer` | martelo de forja de cabeça quadrada | ferro escuro, cabo claro |
| `slag-saber` | sabre curvo com gume irregular (escória) | negro com veios `#ffb347` |
| `riveted-plate` | placa retangular com 4 rebites nos cantos | ferro `#241512`, rebites claros |
| `soot-cloak` | manto/capuz esfarelando em partículas na barra | cinza-fuligem, olhos de brasa sutis |
| `valve` | válvula redonda de latão com alavanca | latão, sopro branco |
| `ember` | carvão facetado com rachaduras acesas | negro com fissuras `#ffb347` |
| `furnace-grate` | peitoral com grelha de 3 barras e brilho atrás | ferro, luz interna `#c4502e` pulsando |

---

*Fim do GDD. Divirtam-se lá embaixo — e não parem ao lado do Bufo-de-Pólen.*
