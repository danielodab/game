# SOTERRA 2.0 — os sistemas, como eles são hoje

Referência funcional do jogo **como ele está**, não como foi planejado. Todo
número aqui foi lido dos arquivos de dados, não da memória.

Se este documento discordar do código, **o código está certo** — corrija o
documento.

- Mapa técnico do repositório: [`../README.md`](../README.md)
- Quem manda em qual arquivo: [`CONTRACT_V2.md`](CONTRACT_V2.md)
- Intenção de design: [`GDD.md`](GDD.md)

---

## 1. O laço do jogo

Você escolhe **dois heróis**, desce num **calabouço**, limpa **sala por sala**
até o chefe, e volta com itens e experiência. Cada sala é uma batalha tática em
grade, por turnos.

A decisão que dá identidade ao jogo é a **fusão**: a qualquer momento os dois
heróis podem virar **uma unidade só**, com um arsenal inteiro diferente. Ganha
poder e perde um corpo no tabuleiro.

---

## 2. Combate

### Recursos

Cada unidade tem dois recursos que **enchem no começo do turno dela**:

- **PA** (pontos de ação) — conjurar feitiço.
- **PP** (pontos de passo) — andar. Uma casa custa 1 PP.

### A grade

Distância é **Manhattan** — soma das diferenças em X e Y, sem diagonal. Andar na
diagonal custaria dois passos de qualquer jeito, então medir em linha reta
mentiria sobre o custo.

O chão de cada sala é desenhado como **texto**, num retângulo de 21×17 a 27×23:

| símbolo | o que é |
|---|---|
| `.` | chão |
| `,` | chão decorado |
| `#` | obstáculo **alto** — bloqueia passagem **e visão** |
| `=` | obstáculo **baixo** — bloqueia passagem, **não** bloqueia visão (cobertura) |
| `~` | vazio/buraco — dá para empurrar alguém para dentro |
| `P` | onde o herói nasce |
| `a`–`z` | onde cada monstro nasce |

A diferença entre `#` e `=` é o que faz posicionamento importar: atrás de um
obstáculo baixo você é atingível mas tem cobertura; atrás de um alto, ninguém te
vê.

### Alcance e área

Duas coisas separadas:

- **`range`** — até onde o feitiço **chega**. Tem `min`, `max`, e as travas
  `line` (só em linha reta) e `los` (precisa de linha de visão).
- **`aoe`** — o que ele **pega** ao chegar. Formas: `single`, `circle`, `cross`,
  `cone`, `line`, `ring`.

**Feitiço de área mira o CHÃO.** Quando `aoe.shape !== 'single'` e `size > 0`, a
célula-alvo é um **lugar**: basta estar no alcance, e a área pega quem estiver
dentro — ou ninguém. Só o feitiço de alvo único exige criatura na casa.

Isso permite largar a explosão **entre** dois inimigos, ou chutar onde o outro
vai estar. Antes disso a área só podia ser lançada em cima de alguém, o que
jogava fora metade da mecânica de posicionamento.

### Esquiva e fixação

Esquiva é **identidade de classe**, não um número igual para todos — vai de
**5** no Bárbaro a **30** no Ladino. O tanque prende; o assassino escapa.

### Clima

Cinco climas, definidos **por sala**: `calmo`, `chuva`, `estiagem`, `tremor`,
`vendaval`. Cada um favorece ou prejudica dependendo do que você está fazendo.

### Eventos de terreno

Nove marcas espalhadas pelo chão (`ev-*`), que agem **sobre quem pisa**:

`ev-might` (força) · `ev-haste` (pressa) · `ev-focus` (clareza) ·
`ev-guard` (guarda) · `ev-slip` (piso escorregadio) · `ev-mystery` (surpresa) ·
`ev-portal` (respiradouro) · `ev-drain` (sanguessuga) · e a fonte teimosa.

---

## 3. As seis classes

Cada uma tem **3 feitiços neutros** que todo mundo daquela classe sabe de saída,
mais **quatro caminhos elementais** — e você escolhe **um** no nível 5,
**para sempre**.

| id no código | nome | papel | PV | PA | PP | esquiva |
|---|---|---|---|---|---|---|
| `sumo` | **Bárbaro** | tanque | 150 | 6 | 3 | 5 |
| `arqueiro` | **Batedor** | atirador | 100 | 6 | 3 | 25 |
| `bruxo` | **Bruxo** | mago | 95 | 6 | 3 | 15 |
| `espadachim` | **Ladino** | assassino | 95 | 6 | **4** | 30 |
| `curandeiro` | **Paladina** | suporte | 110 | 6 | 3 | 20 |
| `invocador` | **Xamã** | invocador | 105 | 6 | 3 | 12 |

> O `id` no código não bate com o nome na tela — `sumo` virou Bárbaro,
> `curandeiro` virou Paladina, `espadachim` virou Ladino. É dívida de renomeação
> antiga; **os ids são o que importa** para quem mexe no código.

### O que cada uma veste

Não é enfeite: é o que permite reconhecer a classe a 40 px, e é o que a fusão
empresta.

| classe | mão direita | mão esquerda | cabeça | capa |
|---|---|---|---|---|
| Bárbaro | machado de 1 mão | **segundo machado** | — | capa do bárbaro |
| Batedor | besta de 2 mãos | — | capuz (parte do corpo) | capa do ladino |
| Bruxo | cajado de 2 mãos | grimório fechado | chapéu pontudo | capa de mago |
| Ladino | adaga | segunda adaga | — | capa do ladino |
| Paladina | espada de 1 mão | escudo de brasão | — | capa do cavaleiro |
| Xamã | varinha | grimório aberto | — | capa de mago |

---

## 4. Feitiços

**171 no total**: 162 de caminho (6 classes × 4 elementos × 6 degraus) + 9
cargas de armadilha do Xamã.

### A escada de desbloqueio

| nível | o que abre |
|---|---|
| **0** | os 3 neutros da classe |
| **5** | 1º do caminho — **e é aqui que você escolhe o elemento** |
| **10** | 2º |
| **12** | 3º |
| **15** | 4º |
| **20** | 5º |
| **30** | 6º — o de fecho |

Os quatro caminhos abrem nos **mesmos níveis**, de propósito: a árvore de
feitiços é uma grade, e um caminho com degraus diferentes deixaria buraco nela.

### Efeito visual

Cada feitiço declara um `fxKey`, e o nome decide a **família** de desenho. São
**21 famílias**, e cada uma tem movimento e forma próprios:

`meteoro` (cai do céu de viés) · `chuva` · `cone` (abre a partir do conjurador) ·
`cruz` · `anel` · `terremoto` (o chão ergue) · `onda` · `investida` · `corte` ·
`armadilha` (**planta**, não estoura) · `invocacao` (coluna de luz) ·
`aura` (no próprio corpo) · `cura` · `feixe` · `flecha` · `estouro` · `escudo` ·
`piscar` · `gancho` · `maldicao` · `bola` (último recurso, 4% dos casos)

As partículas usam um **atlas de 16 formas** (meia-lua de corte, cascalho,
círculo de runas, brasa, fumaça, redemoinho, halo, risco…), com o quadro escolhido
por partícula — as 16 convivem numa **única chamada de desenho**.

---

## 5. Fusão

O sistema mais próprio do jogo.

### Como funciona

Dois heróis viram **uma unidade**. A fundida **mantém o uid e a casa na ordem de
iniciativa** do herói A; o B sai do tabuleiro (`alive:false, offBoard:true`) —
sem evento de morte e **sem contar derrota**.

### Os números

- **15 duplas** possíveis (as combinações de 6 classes 2 a 2).
- **105 formas** — 7 por dupla, nos degraus **0, 5, 10, 12, 15, 20, 30**.
- **16 misturas** elementais (os pares de elemento dos dois heróis).
- **105 × 25 = 2.625 feitiços compostos.**

### Forma × mistura

Cada feitiço de fusão nasce de duas metades:

- **A FORMA decide a mecânica e o DESENHO.** É ela que diz se é escudo, meteoro
  ou gancho.
- **A MISTURA decide o sabor elemental** — o afixo do nome, o rider, a cor.

O nome sai da soma: `formName + affix` — "Furacão" + "Salgado". Toda forma é
substantivo masculino singular e todo afixo é adjetivo masculino singular, para
a concatenação sempre concordar.

> Isto já esteve **invertido**, e era um defeito grave: a mistura sobrepunha a
> forma, e como são 16 misturas para 105 formas, **toda fusão do mesmo par de
> elementos saía com o mesmo efeito** — escudo, meteoro e gancho idênticos.

### Como a fusão se parece

O corpo é do **anfitrião**; o **convidado** empresta três marcas: a peça de
cabeça, a capa e a **arma-assinatura**. A arma emprestada é sempre de **uma
mão** — arma de duas mãos entraria atravessada no corpo de quem já segura a
própria. A mão que recebe é esvaziada antes.

O teste cobra que **as 15 mostrem marca dos dois pais** e que nenhum punho
carregue duas peças.

### O equilíbrio (leia com atenção)

`equilibrio_fusao.html` mostra **18 de 30** duplas dentro de ±20%.

Isso **não é regressão recente**. A bancada de medição antiga tinha quatro
defeitos que sustentavam o "30/30": media a fusão com 4 PA contra 12 dos dois
heróis separados; pegava o canto do alcance como alvo; não restaurava estado nem
semente entre medições; e media "melhor feitiço repetido" quando 92 das 105
formas só podem ser lançadas uma vez por turno.

Com a bancada corrigida, **seis duplas estão fora por construção**: um
coeficiente constante multiplica nível 12 e nível 30 juntos, e só cabe em ±20%
nos dois se a razão entre eles for ≤ 1,5. Nessas seis vai de 1,52 a 2,90 — e a
inclinação **troca de sinal** entre elas, então nenhum valor global resolve.

---

## 6. Calabouços

Seis, cada um com elemento, clima próprio, bestiário e um chefe.

| id | nome | chefe | modelo do chefe |
|---|---|---|---|
| `greenhouse` | A Estufa Soterrada | `boss-gardener` — A Jardineira-Viúva | Mushnub_Evolved |
| `cistern` | a Cisterna | `boss-baroness` — Baronesa Salmoura | Glub_Evolved |
| `forge` | o Fecho de Brasa | `boss-heartforge` — Magno, o Acendedor | BlueDemon |
| `scaffold` | os Andaimes | `boss-windwright` — Cambota | Alpaking_Evolved |
| `mine` | a Mina Trêmula | `boss-deepknock` — Batepedra | Yeti |
| `heart` | o Coração Partido | `boss-riftheart` — O Coração Partido | Ghost_Skull |

### Os chefes têm de ser maiores que qualquer herói

O teto de personagem é **4,76 m** — a fusão mais alta (Bárbaro + Bruxo). Os seis
chefes ficam entre **5,16 e 5,46 m**, e nenhum passa de 3,7 células de largura.

Isso teve de ser medido, não estimado: os chefes antigos **reprovaram**. Dois
eram o mesmo T-Rex, e o triceratops da Mina declarava 3,84 m mas de pé media
**1,81 m** — menor que o Bárbaro sozinho.

---

## 7. Invocações do Xamã

Sete criaturas, uma por conceito, **nenhuma repetida**:

| invocação | elemento | criatura |
|---|---|---|
| Familiar | neutro | Hywirl |
| Cão de Brasa | fogo | Demon |
| Colosso de Magma | fogo | Dragon_Evolved |
| Ninfa da Maré | água | Squidle |
| Sentinela de Pedra | terra | Cactoro |
| Golem da Montanha | terra | GreenSpikyBlob |
| Falcão da Tempestade | ar | Birb |

> Nenhuma é literalmente de pedra porque **o acervo não tem criatura de pedra** —
> Cactoro e GreenSpikyBlob são as mais minerais que ele oferece. Antes disso o
> Colosso de Magma e o Golem da Montanha eram **o mesmo boi**, um laranja e
> outro verde.

### Armadilhas

O Xamã tem **9 cargas de armadilha** (uma por elemento e variação). A armadilha
**armada fica no chão** até disparar ou expirar, desenhada como **laço de urso**
— base escura, arco de metal e oito dentes virados para dentro — na **cor do
elemento**. Gira devagar e pulsa de leve.

A silhueta é um **anel dentado** de propósito: as marcas de evento de terreno já
são redondas e lisas, e se a armadilha fosse mais um círculo o jogador não
separaria as duas coisas a 40 px.

---

## 8. Itens

### Espaços de equipamento

Quatro por herói, com nomes próprios do jogo:

| espaço | o que é | o que dá |
|---|---|---|
| **punho** | o que golpeia | PA |
| **passo** | o que anda | PP |
| **casca** | o que protege | vida e resistências |
| **lume** | a relíquia acesa | **concede um feitiço** |

Mais um espaço de **bicho** (pet), que age depois do dono.

### Raridade

Quatro níveis, com cor e brilho próprios: **comum**, **raro**, **épico**,
**lendário**.

O acervo base tem 48 itens (22 comuns, 16 raros, 6 épicos, 4 lendários), mais 24
avulsos em `items_extra.js`.

### Conjuntos

**12 conjuntos** no acervo base, dois por calabouço, com bônus por **2, 3 ou 4
peças** vestidas. O `element` e o `setId` de cada peça são **derivados no rodapé
do arquivo** a partir do conjunto — nunca escritos à mão, para não divergirem.

### Forja — as pedras

Item sobe de nível com **pedras elementais**, até **+10**. É a trilha do poder
bruto: o item cru vira **2,20×** ele mesmo no +10.

### Estrelas — a trilha da raridade

Juntar **3 itens iguais** dá **1 estrela**. Três estrelas é o topo, e é o
caminho difícil: **27 cópias** do mesmo item.

A estrela mostra-se como **cor de fundo** da célula, não como nome:

| estrelas | cor | bônus |
|---|---|---|
| ★1 | cinza | +8% |
| ★2 | azul | +18% |
| ★3 | amarelo | +30% |

**As duas trilhas se somam**, e o teto do jogo é **★3 com +10 = 2,50×** o item
cru. A estrela sozinha vale menos que a forja sozinha — de propósito: forjar é o
caminho previsível, estrelar é o caminho da sorte.

Nem forja nem estrela mexem em **PA/PP** além do teto de +1. Esses dois recursos
são o esqueleto do turno; inflar eles quebraria o jogo inteiro.

### Nível de uso

Toda peça e todo bicho pedem um **nível do herói** para entrar nele (pedido do
dono, 10/09: "os itens mais fortes são níveis mais altos; o set especial da
roleta é nível 30 em todas as peças; pets a partir do 10"). A régua mora em
`DATA.nivelUso` (items.js) e é **por calabouço e raridade**: o degrau do mapa
é o nível recomendado dele, a peça mais rara pede 2 a mais, e no Coração a
escada desce um degrau para caber no teto 30.

| calabouço | comum | raro | épico |
|---|---|---|---|
| Estufa Soterrada | 3 | 5 | 7 |
| Corte Afogada (Cisterna) | 7 | 9 | 11 |
| Fecho de Brasa | 11 | 13 | 15 |
| Andaimes do Vento | 16 | 18 | 20 |
| Mina que Treme | 22 | 24 | 26 |
| Coração Partido | 26 | 28 | 30 |

Fora da tabela: **lendária = 30** (venha de onde vier), as 4 peças do **Traje do
Colecionador = 30**, todo **pet = 10**. Um `nivelUso` explícito na definição
vence a régua; peça de que a régua não sabe pede 0 (nunca tranca por engano).

Quem cobra é o Progress (`equip`/`equipPet`, e a transferência de bicho entre
heróis cobra o destino); a recusa fica em `Progress.ultimaRecusa` e a ficha
mostra o motivo ("Estribos de Hera pede o nível 5 — o Sumo está no 3"). A peça
acima do nível **continua caindo, sendo comprada, trocada, guardada no banco e
tirada na roleta** — só não entra no herói; a grade mostra o `Nv. N` de cada
peça e apaga (com cadeado) o que o herói escolhido ainda não veste. O **Mestre**
não paga. Ao carregar um save com peça vestida acima do nível do herói, ela
**volta ao saco** (mesma série, mesmo nível de forja e estrelas — mesmo com o
saco cheio, porque é migração única) e o bicho volta à lista; o Acampamento
(ou a ficha do inventário) avisa uma vez. A carga só saneia na memória: é ao
**entregar o aviso** que a migração vai ao disco (e à Nuvem), e daí a abertura
seguinte não repete o toast. Gravar na própria carga seria perigoso: no ar, a
conta do Mestre pode abrir antes de a Nuvem conferir a marca dele, e o que o
saneamento tirou da memória (o herói do Mestre, a Panóplia) viraria perda
permanente.

A menor exigência do jogo é 3: o herói novo guarda no saco o primeiro saque até
chegar ao nível 3 (40 XP).

---

## 9. Inventário

Uma tela só — **Personagens** — com quatro abas:

**Inventário** · **Forja** · **Feitiços** · **Coleção**

### A grade

**Fixa**: **48 casas** no mínimo, crescendo de doze em doze para
nunca terminar numa fileira quebrada. As casas vazias continuam visíveis — é
delas que vem a leitura de "quanto ainda cabe".

A casa vazia **não é botão**: sem toque, sem foco de teclado, tracejada. É chão,
não peça.

O saco é **do grupo**, não do herói. Itens iguais **empilham com ×N**, e equipar
**tira a peça do saco** — ela fica presa àquele herói até ser desequipada. Dois
pares de botas iguais aparecem como ×2 e podem ir um em cada herói.

Acima da grade ficam o **carrossel de heróis** (só os liberados) e os espaços de
equipamento do herói corrente.

Dá para abrir o inventário **durante a luta**, pelo botão ☰ → Personagens.

### Árvore de feitiços

A aba **Feitiços** mostra a classe inteira numa grade: o **tronco** em cima (os
3 neutros) e os **quatro galhos** embaixo, um nível por linha. O galho escolhido
acende, os outros três apagam — a escolha do elemento é permanente e a tela
mostra o que foi abandonado.

Os degraus saem dos **dados** (`unlockLevel` de cada feitiço), não de uma lista
fixa: quando a escada ganhou os degraus 10 e 15, uma grade cravada teria ficado
com buraco.

### Coleção

Cartas de todas as classes, monstros, chefes, pets e fusões, com moldura de
raridade. O retrato vem do **modelo 3D**, renderizado uma vez e guardado — não
do desenho 2D antigo.

---

## 10. Progressão

Nível por experiência, com tabela em `progression.js`. A cada nível o herói
ganha vida e, nos degraus 5/10/12/15/20/30, um feitiço novo do caminho
escolhido.

Existe um **painel de teste** (`js/ui/debug.js`, fora do `#ui-root`) que libera
as 6 classes, define nível e elemento de cada herói, enche o saco, e tem um
**modo TESTE DE EFEITOS** — todos os 27 feitiços da classe, 99 PA, sem recarga,
99999 PV dos dois lados. Serve para ver todo efeito sem jogar até o nível 30.
Tem um "Desfazer tudo" que restaura o save copiado na abertura da página.

---

## 11. O que está aberto

| assunto | estado |
|---|---|
| **Equilíbrio da fusão** | 18 de 30. Seis duplas fora por limite matemático — ver §5 |
| **Efeitos** | 21 famílias e placas ligadas; falta julgar no tamanho real do tabuleiro |
| **Fogo na arma** | proposto, depende do resultado das placas |
| **Nomes das classes** | confirmados pelo dono — ficam como estão |
| **Elenco chibi** | decidido: **fica KayKit**, pela coerência com o cenário |
