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
| `#` | obstáculo **alto** — bloqueia passagem **e visão**; dois `#` encostados só pelo canto também fecham a fresta entre eles |
| `=` | obstáculo **baixo** — bloqueia passagem, **não** bloqueia visão; quem está encostado nele e é atingido por cima dele tem **cobertura −25%** |
| `~` | vazio/buraco — dá para empurrar alguém para dentro; não bloqueia visão |
| `P` | onde o herói nasce |
| `a`–`z` | onde cada monstro nasce |

A diferença entre `#` e `=` é o que faz posicionamento importar: atrás de um
obstáculo baixo você é atingível mas tem cobertura; atrás de um alto, ninguém te
vê.

### A visão (19/09)

O que "obstáculos atrapalham" quer dizer no motor, medido em **todas** as salas
(`tests/visao_mapas.js`, sobre o motor do juiz em Node):

- **Simétrica e estrita.** `Engine.los(A,B)` traça de A a B **e** de B a A, e os
  dois têm de passar. Quem vê é visto. Antes o traçado de um sentido só deixava
  5.768 pares (2,7%) em que A via B e B não via A — o arqueiro acertava o monstro
  e o monstro, da mesma casa, não acertava o arqueiro.
- **Só `#` bloqueia.** `=`, buraco, armadilha e evento de chão não. O muro
  invocado (o Minotauro) vira `#` enquanto vive e devolve a visão ao cair.
- **A fresta de canto está fechada.** Dois `#` encostados só pelo canto não
  deixam a visão passar entre eles (eram 325 pares em 8 cantos). Não é o
  supercover: esse tiraria 8,9% da visão do jogo inteiro.
- **A área não atravessa muro.** Toda casa da área precisa de visão a partir do
  **centro do impacto**, em todas as formas; a casa do centro entra sempre; a
  linha para no primeiro muro. A explosão contorna a esquina, mas não fura a
  parede. Exceção nomeada: o Julgamento do Mestre.
- **Cobertura −25%.** Se o alvo está encostado (ortogonal) num `=` e o traçado de
  onde o golpe **sai** até ele entra por esse `=` (a última casa antes do alvo é a
  mureta), o dano dos efeitos de dano (`damage`, `chain`, `detonateMarks`) perde
  25% — arredonda para baixo, nunca abaixo de 1. "De onde o golpe sai" é a mesma
  casa de onde a visão daquele golpe é exigida: o **conjurador** (onde ele está na
  hora do golpe: o Salto de Brasa bate cheio ao cair encostado) para o alvo na
  casa do centro; o **centro do impacto** para as outras casas da área; a
  **vítima anterior** para cada salto do raio. Uma mureta que só está na linha do
  conjurador não cobre o salto nem a casa da área, e uma que está entre o centro
  e a vítima cobre mesmo que o conjurador nem veja a vítima. O corte é sobre o
  dano **já escalado pela dificuldade** (um só lugar, `dealDamage`: no difícil, o
  tiro de 10 vira 14 e a mureta o deixa em 10, −4). O evento de dano leva
  `coberto: true` e `reducao`, e o log diz "cobertura −25% (−N)" com o mesmo N.
  Cura, controle, invocação e auto-alvo não mudam; corpo a corpo encostado nunca
  é coberto (o traçado não cruza casa nenhuma). `Engine.coberto(state, x0, y0,
  x1, y1)` responde.
- **O raio e a explosão também respeitam o muro.** O raio em cadeia só salta para
  quem a vítima de agora vê; a explosão de morte (`explodeOnDeath`) só fere quem
  vê a bomba. Nenhum dos dois contorna ou fura um `#`.
- **Todo feitiço com alcance > 0 exige `los`.** Os validadores cobram; a única
  exceção nomeada é `gm-julgamento`. Um feitiço sem `range` cai em
  `Engine.RANGE_PADRAO` (`{min: 0, max: 1, line: false, los: true}`), no motor,
  na IA e na fusão — com max 1 o `los` não decide nada hoje (casas encostadas
  sempre se veem); é o cinto para um `range` futuro sem `los`.
- **A tela sabe o porquê.** `Engine.casasSemVisao(state, uid, spellId)` devolve
  as casas no alcance (distância e linha) que caem só pela visão, cada uma com o
  primeiro muro que a bloqueia (`{x, y, muro: {x, y}}`), para o tabuleiro pintar
  "no alcance mas sem visão" com cor própria.
- **A IA mira o chão.** Com um feitiço de área ela pode largar a explosão entre
  dois heróis, como o motor já permitia ao jogador.

O juiz refaz a sala com esta mesma função, então mudar a visão muda o fim de
salas já jogadas: por isso existe `Engine.VERSAO_REGRAS` (docs/SEGURANCA.md §4.1). Hoje é **6**
— uma subida só, na junção de 03/10, para as três frentes que mudaram o fim de uma sala: o
equilíbrio (docs/EQUILIBRIO.md), o chão do Poço e os Colossos (§6) e o corpo grande com o Eco
Primordial (§6-B).

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

**De que lado cai cada efeito (03/10).** O que fere pega quem estiver na área,
menos quem lança — a área do Bruxo queima o parceiro, de propósito. O que ajuda
(cura, escudo, bênção, regeneração) pega quem estiver na área. O feitiço
**misto** — que fere E ajuda, como meia tabela das formas de fusão ("fere o
inimigo e cura o aliado no mesmo gesto") — fere só o outro lado e ajuda só o
próprio lado, e quem lança sempre recebe a parte que ajuda. E a armadilha que o
mesmo lance arma na casa onde acabou de erguer muro vai para a vizinha livre
("deixa o laço armado ao pé"). E o feitiço de alvo próprio cuja área é só a
casa de quem lança cobra o efeito hostil dele mesmo — é o preço escrito na
descrição ("+35 de poder, ao preço de queimadura própria"); a área em volta do
corpo continua sem ferir quem lança. Ver `docs/EQUILIBRIO.md` §3; a prova é
`tests/regras_equilibrio.js`.

**O muro de espinhos do Minotauro (03/10).** Todo muro do Minotauro (e das fusões dele) fere quem é
do outro lado e **termina a vez numa casa vizinha** — norte, sul, leste ou oeste, nunca de quina —, e
quem é **jogado contra ele** por empurrão ou puxão (além dos 10 da colisão). Uma vez por vez, o muro
que fere mais; nunca o próprio lado; o dano é o `fere` do feitiço (30) vezes o poder de quem ergueu
na hora de erguer, menos a resistência ao elemento do muro. Quem sangra nos espinhos não sai das
sombras, e o reflexo não volta pela pedra. A IA dos dois lados enxerga: quem anda evita terminar
encostado, quem ergue põe a pedra onde o inimigo não pode sair ou logo atrás dele antes do
empurrão. Na tela: as estacas ao pé da pedra, as casas vizinhas pintadas e a casa de passo
vermelha. `docs/EQUILIBRIO.md` §3.6.

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

## 3. As sete classes

Cada uma tem **3 feitiços neutros** que todo mundo daquela classe sabe de saída,
mais **quatro caminhos elementais** — e você escolhe **um** no nível 5,
**para sempre**. O papel de cada uma é uma regra medida (dano, alcance, cura,
escudo, vida efetiva — ver [`docs/EQUILIBRIO.md`](EQUILIBRIO.md) §2.1).

| id no código | nome | papel | PV | PA | PP | esquiva |
|---|---|---|---|---|---|---|
| `sumo` | **Bárbaro** | tanque | 150 | 6 | 3 | 5 |
| `arqueiro` | **Caçador** | atirador | 100 | 6 | 3 | 25 |
| `bruxo` | **Bruxo** | mago | 95 | 6 | 3 | 15 |
| `espadachim` | **Ladino** | assassino | 95 | 6 | **4** | 30 |
| `curandeiro` | **Curandeiro** | suporte | 110 | 6 | 3 | 20 |
| `invocador` | **Xamã** | invocador | 105 | 6 | 3 | 12 |
| `minotauro` | **Minotauro** | guardião | 145 | 6 | 3 | 8 |

> O `id` no código não bate com o nome na tela — `sumo` virou Bárbaro,
> `arqueiro` virou Caçador, `espadachim` virou Ladino. É dívida de renomeação
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

- **21 duplas** possíveis (as combinações de 7 classes 2 a 2 — o Minotauro entrou).
- **147 formas** — 7 por dupla, nos degraus **0, 5, 10, 12, 15, 20, 30**.
- **25 misturas** elementais (os pares ORDENADOS de elemento dos dois heróis,
  `A+B`, com os 5 elementos).
- **147 × 25 = 3.675 feitiços compostos** (medido no motor, 19/09).

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

Medido e cobrado por `node tests/equilibrio.js`; o método, as faixas e cada ajuste estão em
[`docs/EQUILIBRIO.md`](EQUILIBRIO.md). Em uma frase: a fundida fica a **±20% dos dois
heróis separados em cada nível**, com o mesmo orçamento (três rodadas inteiras de cada lado).

O que segura isso é o `Fusion.PAIR_TUNE`, que desde 03/10 tem **nível**: `[k5, k12, k30]` por
dupla, ajustado nos níveis 5, 12, 20 e 30 e conferido no 16 e no 25 (`Fusion.tuneDe`). Um
número só por dupla não fechava os dois lados — a razão fundida/separados muda com o nível,
e em seis duplas ia de 1,52 a 2,90 entre o 12 e o 30.

O que ainda escapa (§6 do documento): alguns degraus no 16 e no 25, entre 20% e 25%, que vêm
do lado dos separados (o quarto feitiço do caminho chega no 15).

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

### O Poço sem Fundo (`js/core/poco.js`)

A torre infinita, só para quem desce sozinho. Cada andar empresta o **palco** de
uma sala real (layout, clima, cenário) e troca o elenco por uma mistura dos
comuns de todos os calabouços abertos; os inimigos ganham **+10% de PV por
andar** e o XP paga no mesmo fator. Com sessão do site o andar sai da **semente
do bilhete** (`Poco.salaSemeada`) e o juiz refaz a mesma sala para pagar. O
recorde é semanal.

**Andar múltiplo de 5 (02/10):** **um** chefe e **um** Colosso. O chefe toma
**uma** casa de monstro com letra própria — antes tomava uma letra do palco, e
a letra se repete (no Fecho de Brasa 3 a letra `c` tem cinco casas: saíam até
cinco chefes). O colosso toma outra casa, girando por andar:

| andar | colosso | id | o que faz |
|---|---|---|---|
| 5, 25, 45… | Colosso de Brasa | `colosso_fogo` | as casas por onde passa ficam **em brasa** por 2 rodadas (armadilha do lado dele: queima e para quem pisa) |
| 10, 30… | Colosso da Maré | `colosso_agua` | onde termina a vez nasce uma **poça**; terminando a vez **parado** em cima dela, recupera 8% da vida |
| 15, 35… | Colosso de Rocha | `colosso_terra` | **couraça** de 6 placas: corta cada golpe pela metade; cada golpe arranca uma placa, golpe de **ar** arranca duas |
| 20, 40… | Colosso da Ventania | `colosso_ar` | quem o golpeia **de perto**, na própria vez, é soprado 2 casas; anda 5 |

Os colossos **não** entram no sorteio comum (`colosso: true`), **não** são
chefes (selo, insígnia e roleta seguem só de chefe), pagam mais que qualquer
comum (XP 45; pedras sempre, 4 a 6 — o teto do não-chefe) e sobem de vida com o
andar como todo o resto. Porte: **1,6×** um monstro comum (2,88 m). Sem a arte
do dono ainda, cada um tem chave de modelo própria (`colosso-fogo`…) que cai
no **corpo provisório** de um monstro do calabouço do mesmo elemento
(`M.CORPO_PROVISORIO` em `models3d_v2.js`: Monte de Escória, Golem de
Salmoura, Boca do Túnel, Nuvem-Enxame). Arte final: embutir com a chave e
apagar a linha do provisório.

**Os perigos do chão (02/10).** Todo andar tem perigos sorteados pela MESMA
semente, todos **à vista desde o começo** e todos **avisados antes de ferir**:

| perigo | desde o andar | o que faz | aviso |
|---|---|---|---|
| **placa de setas** | 1 | quem pisa (herói ou monstro) arma; setas varrem até 5 casas numa direção (até o primeiro obstáculo); a placa não está na linha | a linha acende ao armar; dispara no começo da **2ª rodada depois** |
| **runa de exaustão** | 1 | prende o passo em cima dela e tira 2 PP | ela mesma (não fere) |
| **jato** (fogo, água, terra ou ar) | 2 | a casa do respiro e as 4 vizinhas, a cada 3 rodadas a partir da 3ª; a resistência conta | a área acende no começo da rodada anterior |
| **chão rachado** | 3 | desaba na rodada 3 a 5 e vira buraco; quem está em cima se fere e sobe na casa livre mais perto; debaixo de um muro invocado ele cede do mesmo jeito, e o muro devolve buraco ao cair | range no começo da rodada anterior |

O dano é **fração da vida máxima** da vítima (setas 12%, jato 15%, queda 10%;
chefe e colosso levam metade): o Poço recebe herói de qualquer nível, e número
fixo seria cócega no 30 e morte no 5. Quantos: 1 no andar 1 e mais um a cada 3
andares, até 7. Nenhum perigo alcança a **zona de entrada** (o chão a até 3
casas de um P, a mesma régua da escolha da posição) nem nasce em casa de
monstro, dois não dividem casa, e o chão rachado só nasce onde o buraco **não
separa o mapa**. O chão do Poço não gasta o sorteio da sala.

**A IA sabe:** a casa que leva golpe no começo da próxima rodada pesa −80 (mais
que armadilha), a da rodada seguinte −30, placa e runa −15/−20; e, em todo andar
do Poço, o caminho de **mesmo custo** desvia de placa, runa e armadilha que quem
anda enxerga (vale para o jogador também — o clique não leva o herói por cima
da placa se há outro caminho igual). Prova: `node tests/poco_perigos.js`; a tela,
`tests/poco_chao_tela.html`.

---

## 6-B. O Eco Primordial — o chefe supremo da semana (02/10)

O pedido do dono: "um mapa BEM difícil com chefe supremo e placar de quem tirou mais dano". O dado
mora em `js/core/data/eco.js` (o elenco, os feitiços, as fases e os golpes, com o porquê de cada
número), a arena em `js/core/data/arenas.js` (`camara_eco`) e a regra no motor (`engine.js`, "O ECO
PRIMORDIAL" e a decisão de design 19). O servidor está em `servidor/supremo.py` e no juiz
(`servidor/juiz/supremo.js`); a SEGURANCA §4.8 conta o lado de lá.

**A Câmara do Eco.** Circular (18×18, raio 8,4 sobre o vazio), com quatro pares de pilares altos a 5
passos do corpo dele (o do sul trocado por entulho baixo: quem chega vê o Eco por cima da mureta), quatro
pilares nas diagonais a 4 passos e entulho baixo na borda. Os quatro `P` ficam ao sul, a 6+ passos.

**O corpo 2×2.** O Eco ocupa 2×2 casas no centro e não anda (PP 0). Qualquer das quatro casas é
alvo; a área que cobre várias acerta UMA vez; o corpo bloqueia passagem e fixa quem encosta em qualquer
casa; não é empurrado, puxado, trocado nem teleportado; não tem cobertura baixa; quando ele conjura, o
golpe sai da casa dele que tem alcance e visão do alvo — e, sendo a visão simétrica, ninguém acerta sem
poder ser acertado. O raio em cadeia mede o salto pela casa mais perto e não o acerta duas vezes. A regra
é do motor (`unit.porte`), não do Eco: um corpo grande futuro herda tudo.

**As fases.** A cada 25% da vida perdida ele troca de elemento, Fogo → Água → Terra → Ar, e a
resistência troca pela roda (`DATA.beats`): resiste (+30) ao que o elemento da fase vence e fica fraco
(−30) a quem o vence. Os feitiços passam a ser os da fase (mais o Pulso do Núcleo, neutro). A troca é
conferida depois do golpe inteiro (fim do feitiço, começo de vez) e chama dois Ecos Menores do elemento
novo, nas casas livres mais perto do corpo. Um golpe que atravessa dois limiares troca uma vez, direto
para a fase de chegada. A fase nunca volta.

**O golpe grande, avisado.** No fim da 1ª, 3ª, 5ª… vez dele as casas do golpe da fase ficam marcadas
no chão (vermelhas, pulsando); o golpe cai no começo da vez seguinte dele, em qualquer um que esteja nelas
(menos ele — o chão não escolhe lado, e atrair um Eco Menor para a marca é jogada). Os desenhos:

| fase | golpe | o que marca |
|---|---|---|
| Fogo | Chuva do Núcleo | um círculo de 1 casa em volta de cada herói que ele VÊ (o invisível não é marcado) |
| Água | Maré Funda | toda casa a 3–6 passos do corpo com visão do núcleo — o pilar abriga |
| Terra | Rachadura | as faixas de 2 casas que saem do corpo nos 4 sentidos, até o primeiro muro alto |
| Ar | Correntes Rompidas | toda casa a 1–2 passos com visão — quem está colado se afasta |

**A tentativa e o placar.** 12 rodadas ou até o grupo cair; a 13ª não começa. O placar é a vida que o
GRUPO tirou do Eco (herói, fusão, pet, invocação do lado do jogador): o excedente do golpe que mata, o
clima e o golpe de quem é do lado dele ferem mas não pontuam. Derrubá-lo encerra a tentativa e soma 25% da
vida máxima (6.000) aos pontos. A tentativa NÃO usa nem gasta a vida única (todos entram cheios), não tem
desafio de sala, é sempre na dificuldade normal e é só da dupla da própria conta. Medido: a dupla de nível
30 jogada pela IA tira ~1/3 da vida em 12 rodadas — derrubar exige jogar bem (`tests/eco_motor.js`).

**A semana.** 3 tentativas por dia (o dia de Brasília); vale a melhor da semana, de segunda 00:00 a
domingo 23:59 de Brasília. O ranking é por conta (empate: quem chegou primeiro); a equipe joga mas não
entra. No fechamento, por faixa: 1º–3º 5.000 vinténs, 20 selos de chefe e o título **Voz do Eco** (para
sempre, como o de chefe); 4º–10º 2.500 e 10 selos; 11º–100º 1.000 e 4 selos; participação 150 vinténs.
Nada disso se compra. A semana aparece como evento do mundo (a faixa da praça e o site/eventos.html) com a
contagem regressiva, e o ranking está na ficha do Eco (o cais da praça) e em site/ranking.html#eco.

**A arte é provisória.** O Eco veste o Coração Partido com o porte dobrado e a tinta do elemento da fase;
os Ecos Menores, os quatro Arautos do Coração. Cada um tem chave de modelo própria
(`boss-eco-primordial`, `eco-menor-*`): a arte final do dono entra embutida com essa chave e passa na
frente sozinha; para aposentar o provisório, apaga-se a linha dele em `M.CORPO_PROVISORIO`
(`js/render3d/models3d_v2.js`).

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
Desde 02/10, com a conta do site (o servidor dono da economia), liberar classe,
nível e elemento viram ops do Mestre (`GM.liberaClasse`/`poeNivel`/`poeElemento`
em `js/core/gm.js`, refeitas pelo juiz); encher o saco, desfazer e a Brasa ficam
só para o jogo local. O mesmo corpo aparece na aba **Ferramentas** do painel do
Mestre (`js/ui/painel_mestre.js`, tecla F9), que também dá peça com estrelas e
forja, moedas, e cuida de contas, denúncias e banimentos — a regra disso mora no
servidor (`docs/SEGURANCA.md` §10).

---

## 11. O que está aberto

| assunto | estado |
|---|---|
| **Equilíbrio** | classes, caminhos, fusões e duelos medidos — ver `docs/EQUILIBRIO.md` (03/10, as duas decisões do dono de §6 de lá: o muro do Minotauro fere quem encosta, e a paridade da Arena caiu de 5 para 3 níveis) |
| **Efeitos** | 21 famílias e placas ligadas; falta julgar no tamanho real do tabuleiro |
| **Fogo na arma** | proposto, depende do resultado das placas |
| **Nomes das classes** | confirmados pelo dono — ficam como estão |
| **Elenco chibi** | decidido: **fica KayKit**, pela coerência com o cenário |
