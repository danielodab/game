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
salas já jogadas: por isso existe `Engine.VERSAO_REGRAS` (docs/SEGURANCA.md §4.1). Hoje é **10** (08/10 à noite, atacar a casa vazia — §9-A.16; a lista das subidas está no cabeçalho do engine.js).
A 6 foi uma subida só, na junção de 03/10, para as três frentes que mudaram o fim de uma sala: o
equilíbrio (docs/EQUILIBRIO.md), o chão do Poço e os Colossos (§6) e o corpo grande com o Eco
Primordial (§6-B). A 7 é a do Santuário dos Elementos (§6-C): o juiz passou a carregar o calabouço
especial e os oito guardiões, e a página de antes não saberia refazer uma sala dele.

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

**A assinatura de cada classe (07/10).** O dono: "estou achando muito genérico". A família decide
o desenho e o elemento decide a cor, então o corte do Bárbaro e o do Ladino eram a mesma meia-lua
em outro tom. Agora cada classe tem uma **assinatura** que entra **por cima** da família, na cor da
classe e não do elemento (`fx3d_v2.js`, `ASSINATURA`/`assinaturaDe`): o que ela faz na origem e a
marca que deixa no alvo.

| classe | na origem | no alvo |
|---|---|---|
| Bárbaro | poeira dos pés na arrancada | o chão **racha** (placa de raio) e o cascalho voa, com tremida |
| Caçador | farpas de risco (o arco solta) | lascas secas e uma estrela de impacto |
| Bruxo | runas girando no chão, runas subindo | um resto de runa cai sobre o alvo |
| Ladino | fumaça escura nos pés (forro escuro) | garras saindo do escuro |
| Curandeiro | halo e pétalas caindo devagar | o mesmo, um instante depois |
| Xamã | o aro no chão e espíritos em órbita | espíritos sobem do alvo |
| Minotauro | cascalho pesado | a cruz de poeira sob o alvo, com tremida |

**A fusão mistura:** a assinatura da anfitriã inteira e a da convidada a 0,7 e 120 ms depois — a mesma
leitura do "segundo elemento chegando" do filme. Monstro não tem assinatura. Orçamento: até duas placas
e ~30 partículas por assinatura. O golpe de contato (família `corte`) ganhou a batida da folha CC0
(`baque`), miúda e de frente. `FX.setAssinatura(false)` desliga; `FX.debugAssinatura(classe, x, y, tx, ty)`
dispara uma à mão.

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

A torre infinita. Cada andar empresta o **palco** de
uma sala real (layout, clima, cenário) e troca o elenco por uma mistura dos
comuns de todos os calabouços abertos; os inimigos ganham **+10% de PV por
andar** e o XP paga no mesmo fator. Com sessão do site o andar sai da **semente
do bilhete** (`Poco.salaSemeada`) e o juiz refaz a mesma sala para pagar. O
recorde é semanal.

**Em grupo (07/10 à noite, "descida em grupo com tudo que o solo tem").** Era só de quem descia sozinho
(o andar saía do `Math.random` da página). Agora quem lidera desce ao Poço pela Rede como aos seis portais
(`Grupo.descer('poco')` → `startRun` com `grupo`): o andar nasce da **semente da ata** nos dois motores
(`Game._criaDaAta`: `Poco.poeSala(andar, Poco.salaSemeada(andar, ata.semente))` e a escalada antes do PV),
o `POST /api/grupo/abrir` aceita `'poco'` (o juiz anuncia 9999 andares) e `/grupo/fecha` refaz o andar da
mesma semente (`sala.js`) e paga cada um no mundo dele, com o recorde do Poço anotado nas duas contas.
Provas: `node tests/juiz_poco.js` (o bloco do grupo) e `tests/grupo_duelo_api.py` (`test_06`).

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
andar como todo o resto. Porte: **1,6×** um monstro comum (~3,5 m desde 07/10, quando o comum subiu de 1,80 para 2,20 m e a invocação para 2,00 m — a pedido do dono; chefe, herói e bicho ficaram). Desde
03/10 os quatro vestem a **arte do dono** (`assets/embedded/models-meshy-colossos.js`,
chaves `colosso-fogo`…`colosso-ar`, grupo `poco:colossos` no jogo servido — só
desce com o andar que os tem). A arte veio cinza de propósito: são irmãos de
corpo e quem diz o elemento é a tinta do jogo. Até 03/10 vestiam um corpo
provisório de outro calabouço (`M.CORPO_PROVISORIO`); as quatro linhas saíram.

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

### Os afixos do Calabouço do Dia (07/10)

O dono: "tô achando meio repetitivo". As dezoito salas dos seis portais são desenhadas à mão e não
mudam; na terceira visita a jogada ótima de cada uma já é conhecida. Um **afixo** é uma regra posta
**por cima** da sala que existe — mapa, elenco e chefe ficam iguais; a solução, não. Mora em
`js/core/afixos.js`; o motor o aplica em `Engine.createBattle` com `opts.afixo` (decisão 22 do
`engine.js`) e só a sala que nasce com o campo passa por ele.

**Onde entra:** no **Calabouço do Dia** (`diario.js`). O portal em promoção abre as salas com o afixo
do dia, além do +50% de saque, e a sala com afixo paga **+25% de XP e de saque** (`Afixos.BONUS`, a
mesma régua do desafio de sala). Os outros cinco portais seguem o jogo de sempre, de propósito: quem
está subindo tem um lugar previsível; quem já bateu o teto tem o lugar que muda todo dia.

| id | nome | a regra |
|---|---|---|
| `ferozes` | Ferozes | o dano de quem é do lado inimigo ×1,2, no mesmo funil da dificuldade (`dealDamage`) |
| `couracados` | Couraçados | o PV máximo de quem nasce do lado inimigo ×1,3 |
| `ligeiros` | Ligeiros | +1 PP de quem nasce do lado inimigo |
| `esquivos` | Esquivos | +15 de esquiva de quem nasce do lado inimigo |
| `clima_virado` | Clima Virado | a sala abre com **outro** clima da roda dela, sorteado pela semente, e ele não gira (só o Coração Partido gira clima hoje; sem o sorteio o afixo seria um nada em cinco portais) |
| `chao_traicoeiro` | Chão Traiçoeiro | os perigos do Poço (acima) nascem na sala, de um gerador semeado pela semente dela — 3 perigos, os quatro tipos abertos (`Afixos.ANDAR_DO_CHAO`); `Po.regras` cuida do resto |

**Determinístico pelo dia de Brasília** (`Afixos.doDia(ts)`, hash próprio do AAAAMMDD): todo mundo
vê o mesmo afixo o dia inteiro, e o servidor sabe qual é sem perguntar — o juiz responde `POST /dia`
e a API **guarda o afixo no bilhete** (`salas_afixo`, `salas_grupo_afixo`; `docs/SEGURANCA.md`
§4.1): a sala aberta às 23:59 fecha com o afixo com que abriu, e o juiz a refaz com ele. A página
só **propõe** (`afixo` no `POST /api/sala/abrir`); o que vale volta na resposta. O id entra no hash
da sala; `Engine.VERSAO_REGRAS` subiu para **8**.

**Na tela:** a linha azul-gelo no painel do portal e na porta da antessala (o afixo de hoje e o que
ele faz), o chip ao lado do desafio na linha da sala, o chip na recompensa e o nome do afixo em cada
dia dos "próximos 14 dias" da agenda. Invocação e filhote que nascem no meio da luta **não** ganham
os números do afixo (ele é aplicado a quem nasce com a sala) — aceito.

**O caminho escuro (07/10, o mesmo bloco).** Da **segunda sala** da descida em diante, a porta da antessala
oferece a escolha: a sala de sempre, ou "descer pelo caminho escuro" — a sala abre com um afixo **sorteado
pelo servidor** (`escuro: true` no `POST /api/sala/abrir`; `salas.py`, `_afixo_da_abertura`) e paga os
mesmos +25% de XP e saque. A primeira sala nunca (é a porta de entrada), o Poço não (tem os perigos dele),
e no portal do dia o do dia já manda. A escolha é de cada porta: entrar na sala a apaga. Sem servidor a
proposta da página sorteia pela sala e pelo dia.

**Em grupo (07/10 à noite, "descida em grupo com tudo que o solo tem").** Quem lidera vê o mesmo botão na
porta; a escolha vai no `POST /api/grupo/abrir` (`escuro: true`, `grupo.py` → `_afixo_da_abertura`), o
servidor sorteia e guarda em `salas_grupo_afixo`, e o afixo volta na **ata** (`coop.js`, `mandaAta`) — os
dois motores nascem iguais e o juiz refaz com ele. Quem segue vê na porta que o líder pediu o caminho
escuro (o estado do grupo leva `escuro`, `grupo.js` `mandaEstado`) e, na sala, o chip do afixo. A trilha
da temporada conta o ponto do afixo para os dois (`soma_trilha`, `'afixo'`).

**De quebra:** o Calabouço do Dia deixou de mudar quando a conta visita o Poço (`dungeonPoco` o
empurra em `DATA.dungeons` e a lista de `diario.js` passava a ter sete entradas — a página marcava
um portal e o servidor, que não visita o Poço, pagava outro).

Provas: `node tests/afixos.js` (39) e `python tests/afixos_api.py` (API + juiz).

---

### Os elites de sala (07/10)

A segunda camada contra o "repetitivo", abaixo dos afixos: em **40% das salas** dos calabouços (os
seis portais e o Poço) **um** monstro comum nasce **elite** — +50% de vida e um traço a mais,
sorteado pelo rng semeado da própria sala (`js/core/elites.js`, chamado por `Engine.createBattle`
via `Ex()`, decisão 23 do `engine.js`; a mesma `VERSAO_REGRAS` 8 dos afixos). O juiz chega ao mesmo
elite com a mesma semente. Nunca na primeira sala da Estufa (o tutorial), nunca no PvP, no Eco nem no
Santuário; nunca o chefe, o colosso nem um filhote.

| traço | o que faz |
|---|---|
| Couraçado | couraça de 3 placas: cada golpe entra pela metade até ela cair (golpe de ar arranca duas) — a mesma regra do Colosso de Rocha |
| Explosivo | ao cair, explode nas casas vizinhas com o próprio elemento (25% do PV máximo dele) |
| Enfurecido | com metade da vida, +30 de poder até o fim |
| Veloz | +1 PP e +1 PA |
| Regenerador | recupera 6% da vida máxima no começo de cada vez dele (traço `regen`, novo no `runStartTicks`) |

**O que paga:** o elite derrubado vale **×1,5 de XP** (e os vinténs, que derivam da XP) e deixa
**pedra do elemento dele sempre, uma a mais** (`game.js`, `computeRewards`/`collectStones`). Na tela:
o corpo sai 20% maior, a fila dos turnos marca ★ e a dica do monstro diz o traço (e as placas da
couraça). As bancadas de equilíbrio (`tests/equilibrio.js`, `equilibrio_pve.js`) rodam com a chance a
zero: medem o jogo base.

Prova: `node tests/elites.js` (21).

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

**A sorte rodada a rodada (03/10).** A semente que o servidor dá na abertura decide só a colocação e a
rodada 1. Na virada para cada rodada seguinte (2 a 12) a batalha para um instante — a barra diz "A rodada N
vem do servidor…" — e o jogo pede ao servidor o SAL da rodada, mandando junto o caminho (um resumo
criptográfico dos lances jogados até ali). O servidor dá um sal por rodada e fica preso àquele caminho: não há
como saber a sorte de uma rodada futura antes de ter travado lá o que se jogou. Sem rede a tentativa espera
("Sem resposta do servidor — a rodada N espera, tentando de novo…") e segue quando a rede volta; se o servidor
recusar de vez (a tentativa venceu, a semana fechou), a tentativa acaba na virada e o dano até ali vai para a
conferência. O treino sem conta passa pela mesma parada com um sal local e não conta no placar. O porquê e
as contas estão em docs/SEGURANCA.md §4.8.

**Em dupla (07/10 à noite, "descida em grupo com tudo que o solo tem").** A Câmara abre também pela
descida em grupo: na ficha do Eco quem lidera toca "Enfrentar o Eco com {parceiro}" (`Grupo.descer(arena)`),
os dois vão à antessala da Câmara e a porta abre a sala do grupo no `dungeonId` da arena (`grupo.py`,
`_grupo_abrir`: o juiz anuncia a arena em `/regras` `eco`). Na mesma transação nascem **duas tentativas**,
uma por conta, com a semente da sala do grupo, presas ao gid (`supremo_grupos`); cada conta gasta a vez do
dia, e sem vez numa delas a porta não abre (429 `sem-tentativas`, `quem`). A ata leva a tentativa de quem
lidera; o **sal** de cada rodada é pedido pela autoridade do lockstep (qualquer dos dois pode, sempre com
essa tentativa) e viaja como lance `{a:'r'}` — quem segue só o tira da fila (`updateRede`). O fim é o da
sala em grupo (os dois conferem o hash) e o fechar vai pelo `POST /api/grupo/fechar` com o registro do
lockstep: o juiz refaz a Câmara no modo da sala em grupo (`supremo.js`, `membros`) e o placar é **um** para
as duas contas — as duas entram no ranking, a trilha conta o Eco para as duas. Não usa a vida única (todos
entram cheios), é sempre na normal, e quem larga no meio só deixa a marca do registro: o parceiro segue
(os heróis de quem saiu pela IA) e fecha com o registro dele. Treino em dupla sem servidor existe (o sal
local), e não pontua. Provas: `node tests/juiz_supremo.js` (o bloco da dupla) e `tests/supremo_api.py`
(`test_15`, `test_16`).

**A semana.** 3 tentativas por dia (o dia de Brasília); vale a melhor da semana, de segunda 00:00 a
domingo 23:59 de Brasília. O ranking é por conta (empate: quem chegou primeiro); a equipe joga mas não
entra. No fechamento, por faixa: 1º–3º 1.500 vinténs, 20 selos de chefe e o título **Voz do Eco** (para
sempre, como o de chefe); 4º–10º 750 e 10 selos; 11º–100º 300 e 4 selos; participação 50 vinténs.
Nada disso se compra. A semana aparece como evento do mundo (a faixa da praça e o site/eventos.html) com a
contagem regressiva, e o ranking está na ficha do Eco (o cais da praça) e em site/ranking.html#eco.

**A arte, em 03/10.** Chegaram três Ecos Menores com corpo próprio (`assets/embedded/models-meshy-eco.js`,
grupo `evento:eco`): Brasa, Coral e Rocha (este é o tanque, 2,00 m, e veio sem o clipe de correr).
**Ainda provisórios:** o Eco Primordial veste o Coração Partido com o porte dobrado e a tinta do elemento da
fase, e o Eco Menor de Vento veste o Arauto do Vento. Cada um tem chave de modelo própria
(`boss-eco-primordial`, `eco-menor-ar`): a arte final entra embutida com essa chave e passa na frente
sozinha; para aposentar o provisório, apaga-se a linha dele em `M.CORPO_PROVISORIO`
(`js/render3d/models3d_v2.js`).

---

## 6-C. O Santuário dos Elementos — o calabouço especial (03/10)

O pedido do dono: "um mapa dos elementos; uma parte escura que só consegue ver quem é de
inteligência [o caminho do Fogo]; e outras ideias para os outros elementos, algo que mude no mapa
relacionado a elementos". É o calabouço `elementsanctum`: **cinco salas, sem chefe e sem
armadilha**, nível recomendado 30. As quatro primeiras são um quadrante cada, com uma regra de
terreno e os dois guardiões dele; a quinta, o Altar dos Quatro, junta os quatro quadrantes em volta
do altar, com os oito guardiões. O resumo de uma página está em
[`docs/SANTUARIO.md`](SANTUARIO.md); aqui fica o que o sistema precisa saber.

**Onde mora.** O dado em `js/core/data/santuario.js` — em `DATA.especiais`, e **não** em
`DATA.dungeons`: tudo que lê aquela lista trata o que acha como um dos seis portais (a praça ergue
um portal, o Poço empresta o palco, a Arena sorteia a sala, o Calabouço do Dia a escolhe, a régua
do mundo cobra três salas com chefe). Quem precisa de um calabouço pelo id usa
`DATA.calabouco(id)` (o motor, o jogo, o juiz, a tela). A regra em `js/core/santuario.js`
(`Santuario.regras`), chamada pelo motor só quando a sala tem `state.santuario` — o desenho do
chão do Poço. A sala guarda no estado só o que muda (braseiros acesos, pilares de pé, quem espera)
e isso entra no `Engine.hash`.

**As quatro regras** (os números em `DATA.santuario`; todas valem para os dois lados):

| quadrante | a regra | o que avisa |
|---|---|---|
| **Fogo** — A Câmara Apagada | casa escura só se **mira** a 2 casas; quem é do caminho do Fogo (e o Vigia de Pavio) mira de longe. O braseiro aceso clareia 2 casas em volta (as que ele vê); golpe de Fogo acende, de Água apaga | o breu está na tela desde a preparação; a casa que o escuro tira do alcance aparece roxa e o motivo sai escrito |
| **Água** — A Galeria Alagada | o passo que entra em casa alagada custa 2 PP (1 para a Água); no fim da rodada a correnteza leva 1 casa quem está na água, para onde a bica que verte aponta; troca de bica a cada 2 rodadas; a ponte é seca | os veios correm na direção de agora; a bica que vai verter ganha o sinal uma rodada antes |
| **Terra** — O Salão dos Pilares Vivos | os pilares trocam (o de pé desce, o baixo sobe) no começo das rodadas 3, 5, 7…; pilar de pé fecha passo e visão | uma rodada antes a casa pisca: ▲ vai subir, ▼ vai descer |
| **Ar** — O Terraço da Ventania | no fim da rodada a rajada empurra 1 casa quem está na zona do vento; gira norte → leste → sul → oeste a cada 2 rodadas; feitiço de Ar lançado de dentro alcança +1; as quatro casas ao lado de um respiro são calmas | as setas do chão e o cata-vento mostram a direção; a seta-fantasma mostra a próxima uma rodada antes |

**O que nunca acontece.** Nada sorteia (a regra não gasta o rng da sala). O pilar nunca esmaga: com
alguém em cima do soquete ele **espera** e tenta de novo a cada rodada — deslocar à força tiraria a
casa de quem está preso por raiz ou fixação e cobraria um dano que ninguém escolheu. Os pilares
nunca fecham o único caminho (com todos de pé, todo chão segue ligado a todo chão). O empurrão da
correnteza e da rajada não fere, não joga em buraco nem em parede, e não mexe em quem é imune a
empurrão nem em corpo grande. Ninguém nasce dentro de uma regra: a entrada de toda sala é seca,
clara e sem vento.

**O escuro na tela e na IA.** A tela do grupo esconde o monstro que está numa casa escura que
ninguém do grupo vê, pelo mesmo caminho da invisibilidade (`Engine.ocultoDe`,
`Game.ocultoNaTela`): a fila dos turnos não entrega a casa, o passo que dá nele esbarra. O golpe
que sai do breu aparece. Do outro lado, os monstros conhecem a casa (não ficam cegos para o
grupo), mas **miram com a mesma régua**: fora o Vigia de Pavio, só acertam de longe quem está na
luz. A IA dos dois lados lê as regras: o caminho conta o custo da água, ela não planeja golpe que o
escuro recusa, mede a rota sem contar com o vão de um pilar (que abre e fecha), prefere não
terminar a vez na água quando não é dela e, quem atira de longe, prefere a casa calma do respiro.

**A recompensa.** O saque é o do Coração Partido (`saqueDe: 'brokenheart'`, com o mesmo peso de
"nada"): as quatro salas de quadrante sorteiam como a última sala comum de lá, e o Altar como a do
chefe (dois sorteios, com épica e lendária). A mais, cada guardião deixa **pedra do elemento dele**
(75%, de 2 a 5). Sem chefe não há selo, insígnia, âncora, carta de classe nem de bicho.

**A porta.** A oitava do cais do Acampamento (a praça não ganhou portal, como no Eco). A ficha diz
as regras em português simples, quem mora lá, o que paga e quem desce — e avisa quando a dupla não
tem ninguém do Fogo. A descida é a de qualquer calabouço (antessala, bilhete do servidor, vida
única, uma recompensa por sala), sozinho, em dupla ou em grupo pela Rede. Cada sala abre com o
cartão da regra dela na primeira visita (`js/ui/tutor.js`), e a linha da sala na batalha mostra o
estado de agora e o que vem na próxima rodada.

**O servidor.** O juiz carrega os dois arquivos, anuncia `elementsanctum: 5` em `GET /regras` e
refaz as salas como as dos seis. `Engine.VERSAO_REGRAS` é **7**.

**A arte.** Os guardiões (`el-fogo-1` … `el-ar-2`) e o kit `santuario` (peças `el_*`) chegam por
outras frentes. Sem eles: corpo provisório do mesmo elemento (`M.CORPO_PROVISORIO`, só enquanto a
chave própria não tem kit), o tema veste o kit do Coração Partido (`temaReserva`) e as peças de
mecânica saem em primitiva (`js/render3d/santuario3d.js`). A chave própria vence sozinha quando o
embutido chega.

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

### Forja — a Gema Enterrada (08/10)

A terceira porta da Forja. A **Gema Enterrada** (`stone-gem`, `DATA.gema` em
`js/core/data/items.js`) engasta **um** bônus a mais numa cópia de peça,
sorteado pelos pesos 1:2:3:4 — do mais difícil ao mais fácil, como o dono
pediu: **+1 PA**, **+1 PP**, **+10 de poder** (dano), **+30 PV** (vida). Com
sessão do site o sorteio é do servidor (op `engastarGema`, pelo índice + série
do saco ou pelo herói + espaço da vestida). Cada peça aceita **uma** gema; o
bônus mora na cópia (`extra`), não escala com a forja nem com as estrelas,
soma **fora do teto** da peça (uma peça de +1 PA com gema de PA dá +2) e viaja
com ela: vestir, devolver ao saco, forjar vestida, cofre do Acampamento,
saneamento do save. A cópia engastada **não funde** (a nova nasceria sem o
bônus) e **não sai da conta** — mercadinho, troca e banco da guilda recusam
(juiz: motivo `engastada`), porque o anúncio deles não guarda o bônus.

Os **Fragmentos de Gema** (`stone-gem-frag`) viram gema de **100 em 100** (op
`juntarFragmentos`, sem sorteio). Caem só nos **seis portais** (`DATA.gema.drop`:
chefe sempre, 2–4; comum 8%, 1; elite um a mais), vendem-se na loja do site em
lotes de 10/50/100 (60/270/500 barras; a gema inteira não se vende) e vêm do
anúncio premiado do aplicativo (3 por anúncio, 5 por dia — tabelas
`propaganda_*_v2`). Nem a gema nem o fragmento servem de pedra de forjar a
peça neutra. `Engine.VERSAO_REGRAS` subiu para **9** (o saque e os stats
mudaram). Prova: `node tests/gema.js`.

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

### Cartas, estrelas e as duas iniciais (08/10)

- **Os dois primeiros heróis são livres.** A conta nova escolhe duas classes
  quaisquer em "Quem desce" (`Progress.escolheIniciais`, op `escolherIniciais`);
  elas entram liberadas, no nível 1, com custo 0 de carta, e ficam gravadas em
  `escolhidas`. As comuns do dado (Bárbaro, Curandeiro) que não foram escolhidas
  saem da conta e passam a custar 5 cartas, ou a loja (250 barras). A conta que
  já jogou (XP, peça, carta) não escolhe mais — o save de antes fica como está,
  sem campo novo e sem mudar de hash.
- **A carta é moeda.** `cards[classId]` é a carta NA MÃO e decresce: liberar
  pela carta gasta o `unlockCost`; a estrela se compra à mão — na ficha do
  herói, no cartão de "Quem desce" ou na aba Cartas — por 5, 10, 20, 30 e 45
  cartas (`starCosts` lido degrau a degrau; `Progress.subirEstrela`, op
  `subirEstrela`), e mora em `estrelas[classId]`. Nada sobe sozinho: o dono
  queria ver as cartas e decidir quando gastar. O `cardInfo` diz `podeSubir`.
- **Migração:** o save de antes (cartas acumuladas, estrela derivada da sobra)
  vira, no saneamento, as estrelas que a sobra dava + o resto na mão. Uma vez.
- Prova: `node tests/estrelas_manuais.js`; a escada em `tests/estrelas_caminhos.html`.

---

## 9-A. A semana do SOTERRA (07/10)

O dono: "quero um jogo que o jogador tenha motivo para voltar". O Eco, a Brasa e as ofertas já giravam
por semana, mas o jogador não via um calendário com "hoje acontece X". Agora a semana tem rosto: um
**programa fixo**, um bônus por dia de Brasília, igual para todo mundo (`servidor/api.py`,
`PROGRAMA_SEMANAL`):

| dia | nome | o que vale |
|---|---|---|
| domingo | Domingo do Poço | pedras ×1,5 no Poço — e o recorde da semana fecha |
| segunda | Segunda dos Vinténs | vinténs ×1,5 em toda sala (o Eco abre a semana) |
| terça | Terça das Pedras | pedras ×1,5 em todo calabouço |
| quarta | Quarta da Descida | XP ×1,25 |
| quinta | Quinta do Saque | saque ×1,25 |
| sexta | Sexta do Dia | saque ×2 só no Calabouço do Dia (no lugar do ×1,5 de sempre: +33%) |
| sábado | Sábado Cheio | XP ×1,5 |

Os números são modestos de propósito — a economia é dura por desenho, e o que se quer é ritmo, não
inflação. O programa viaja como **evento do mundo fixo** (`semanais`, como a semana do Eco; origem
`programa`, id `semana-<tipo>-<dia>`), um por dia da janela de 14 dias, e o servidor **paga por ele**
(`_fatores_no_ar`: a mesma lista do `GET /api/eventos`). Do mesmo tipo vale o maior (um evento do
Mestre maior passa na frente), os tetos são os de sempre e o bônus de XP comprado segue preso aos ×2 com
o evento. A sexta precisa do juiz (o Calabouço do Dia daquela sexta sai do `POST /dia`); sem ele o
evento daquele dia não sai. Ninguém liga nem cancela; `PROGRAMA_SEMANAL=0` no ambiente desliga tudo.

**Na tela:** a faixa de eventos da praça (a pílula "✦ N eventos") já mostra o de hoje; a ficha dos
Eventos do mundo ganhou o bloco "A semana do SOTERRA" com os sete dias e o de hoje aceso, e os
"próximos 14 dias" listam o de cada dia. O site (`eventos.html`) os mostra pelo mesmo campo.

Provas: `python tests/programa_api.py` (API + juiz).

## 9-A.5 O prêmio diário de resgate (08/10)

O dono: "prêmios diários de resgate para quem entra todos os dias; vinténs, 10
dias seguidos barra de ouro". `servidor/premio_diario.py` + `js/core/premio_diario.js`
+ o bloco no alto do Quadro de Missões (`hud.js`, `diarioBloco`). Um resgate por
dia de Brasília, à vontade do jogador (nada entra sozinho). A **ordem anda só
pelos resgates** (o dono: quem resgata o 1º e some nove dias colhe o 2º, não a
barra do 10º); pular dias não volta ao 1. Ao chegar à praça com o prêmio de hoje
esperando, a ficha dele abre sozinha. O calendário é o **mês de Brasília** (o
dono: "quando vira o mês ele zera e começa de novo"): no dia 1 a contagem volta
ao 1º prêmio. Os prêmios por posição: vinténs todo dia (100 no 1º, +20 por
resgate, 680 no 30º); Fragmentos de Gema no 3º (3) e no 7º (5)
de cada dezena; 5 Lascas da Lousa no 5º; **1 barra de ouro no 10º e no 20º**;
no 30º, 2 barras + 10 fragmentos. Tudo pela fila da loja, entregue na hora
(vinténs por `credita`, pedras por pedido de preço 0 `diario`, barra por
`barras_move` com ref `diario:<dia>`). Tabelas novas `premio_diario` e
`premio_diario_resgates`. Ao chegar à praça com o prêmio esperando, um aviso.
Prova: `python tests/premio_diario_api.py` (4 próprias; herda as da autoridade).
**08/10 à noite:** o módulo é `JOGO.PremioDiario` — ele nascera como `JOGO.Diario` e, carregado depois
de `diario.js`, apagava o Calabouço do Dia no cliente (o +50% de saque do dia sumia; o juiz seguia pagando;
o calendário do Mestre perdia o sorteio do dia). `tests/gm_agenda.html` acusou.

## 9-A.6 Customizar: título, aura e moldura (08/10)

O dono: "um painel dentro da aba do personagem onde o usuário clica para
customizar; lá ele escolhe título, aura e moldura para o nome; crie umas
molduras premium; conforme o título que ele possui, muda a moldura; e o título
não pode ser fixo — quem perde o Top 1 PvP perde o título". Entrou:

- **A ficha Customizar** (`openSheet('customizar')`, botão em Personagem →
  "A sua plaquinha"): o menu do título (o de sempre), a aura e a moldura.
- **Auras:** três novas na loja (Sombra 250, Geada 250, Dourada 400 barras;
  `hub3d.js AURA_FORMA.sombra/gelo/ouro`). Na ficha **só aparecem as que a conta
  tem**; as outras ficam na loja (um aviso com o link). A Geada e a Dourada foram
  refeitas em 08/10 à noite (o dono: "dá para melhorar"): peças SÓLIDAS como as
  lascas da Lousa — estacas e cristais de gelo (InstancedMesh) sobre um floco de
  neve riscado em código (`flocoAura`) e neve caindo; moedas de ouro girando em
  espiral sobre uma coroa de sol (`solAura`) e brilhos que piscam. 3 chamadas
  cada. `tests/foto_auras.html?auras=gelo,ouro` fotografa as auras na praça.
- **Molduras da plaquinha** (`hub3d.js MOLDURAS`, `desenhaMoldura`: cada uma com
  a sua FORMA, sem brilho; desde 08/10 à noite a borda é METAL (degradê claro/cor/escuro,
  `tomDe`), o fundo leva verniz, um fio escuro por dentro, rebites nos cantos e gemas
  lapidadas nos losangos; o nome da placa do jogador foi a 50 px e o título a 34, só nela —
  as placas da praça e a da guilda seguem em 44/32 — lâmina da Arena, arcos do Eco, ameias dos Chefes,
  barras do pódio de classe, losangos grandes da Dourada, espinhos da Rubi,
  folhas da Esmeralda, cantos cortados da Obsidiana, e as chamas pretas de ponta
  vermelha da **Moldura do Mestre**, que só a conta marcada tem e que é a
  automática dela): as **dos títulos**, de graça e automáticas
  (`molduraDoTitulo`: Arena para "Top N Pvp", Eco, Chefes, pódio de classe; o
  pódio de XP continua acendendo o nome), e as **premium** da loja (Dourada,
  Rubi, Esmeralda 180; Obsidiana 300), que valem por cima. A escolha é do
  servidor (`moldura_escolhida`, `/api/loja/moldura`, posse = pedido vivo
  `moldura-*`) e o Relé a carimba no perfil como faz com a aura.
- **Títulos dinâmicos:** o título de pódio **acompanha a posição** — o Relé
  (`rele_ident.titulo_do_podio`, com o pódio lido do banco a cada conferência)
  troca "Top 1 Pvp" por "Top 2 Pvp" quando a conta cai, e tira quando sai do
  pódio; a HUD faz o mesmo na própria plaquinha (`tituloPendurado`) e vigia o
  ranking de 3 em 3 minutos na praça. O novo Top 1 escolhe o título na ficha.
- **A Rede avisa `mudouVisual`** (título, aura ou moldura trocados sem sair do
  lugar) e a praça repinta só a plaquinha e a aura (`Hub.fantasmaVisual`).
- Provas: `tests/rele_titulos_prova.py`, `tests/auras_formas.html` 18,
  `tests/aura_praca.html` 12, `tests/titulos.html` 33, `tests/loja_api.py` 31.

## 9-A.3 Os feitos da coleção (07/10)

A Coleção existia e não pagava nada por ser completada. Agora três famílias de **feito**, lidas de
contadores que o `computeRewards` anota no jogo **e** no juiz (`Progress.state.bestiario` — quantas vezes
cada monstro caiu, por id do dado; `Progress.state.fusoes` — quantas salas cada dupla fundida venceu,
pela chave `a+b` ordenada; os dois entram no hash da economia):

| feito | o que pede | o que paga |
|---|---|---|
| Bestiário de um portal | todo monstro do portal (fora filhote e colosso) caiu ao menos uma vez | **+10% de saque** naquele portal (`Progress.feitoSaque`) |
| Os seis chefes | os seis chefes caíram | **+5% de XP** em toda sala (`Progress.feitoXp`) |
| As 21 fusões | as 21 duplas venceram uma sala fundidas (a dupla viva no fim da sala conta) | **+5% de XP** em toda sala |

Nada de título: os títulos continuam sendo posição ou teimosia (`titulos.js`). O sanitize descarta id
que o dado não conhece e número torto. Na tela: o bloco "Feitos da coleção" no alto da aba Coleção, com a
barra de cada um. Prova: `node tests/feitos.js` (12).

## 9-A.4 As crônicas do mundo enterrado (07/10 à noite)

O pedido do dono: "o GDD tem um mundo forte, a Grande Lousa, os Fechos, os Corações falhando. Quase nada
disso chega ao jogador. Crônicas curtas, uma por feito da coleção e por chefe derrubado, custam texto e dão
motivo para completar." O dado é `js/core/data/cronicas.js` (14 crônicas na voz do mundo, tiradas de
`docs/GDD.md` §1 e §4 e das descrições dos portais e dos chefes); a leitura dos ganchos é
`js/core/cronicas.js` (`JOGO.Cronicas`).

| crônica | abre com |
|---|---|
| O dia da Grande Lousa (o prólogo) | sempre aberta |
| uma por portal (6): o jardim que aprendeu a caçar, a corte que a água bebeu, a prole da fornalha, os que nunca entregaram a obra, o turno que não subiu, o que vive no Coração | o feito do bestiário daquele portal (`Progress.feitos`) |
| uma por chefe (6): a Jardineira-Viúva, a Baronesa Salmoura, Magno, Cambota, Batepedra, o Coração Partido | o chefe no bestiário da conta (`Progress.bestiarioConta` > 0: ele caiu ao menos uma vez) |
| Dois que viram um | o feito das 21 fusões vencedoras |

**Na tela:** a aba **Coleção** lista todas abaixo dos feitos (`cronicasBloco`): a aberta se lê no toque; a
fechada mostra o título e o que falta ("Derrube Magno, o Acendedor."). A tela da **recompensa** avisa a que
acabou de abrir ("Crônica desbloqueada", com "Ler agora", que abre a Coleção naquela crônica). Nada entra na
economia: o que está aberto sai dos contadores do Progress (os do servidor); a página só guarda, em
`localStorage` (`soterra-cronicas-vistas`), quais o jogador já leu — para avisar a nova. Os títulos e os
textos são chaves de tradução (en/es em `js/i18n/textos_*.js`).

Prova: `node tests/cronicas.js` (16).

## 9-A.2 A trilha da temporada (07/10)

A trilha **gratuita** de recompensas por jogar, presa às temporadas de 42 dias da Brasa
(`js/core/brasa.js`, `B.EPOCA` = 24/08/2026 UTC; o servidor espelha em `servidor/trilha.py`). É o gancho
de retorno mais comprovado do gênero e aqui **não vende poder**: é uma só, para todo mundo; uma trilha
paga, se vier, é só aparência (`docs/LOJA_SUGESTOES.md`).

**Os pontos são do servidor** — nascem onde ele já confere o que aconteceu:

| acontecimento | pontos |
|---|---|
| sala vencida (solo ou em grupo) | 10 (+5 desafio cumprido, +5 no difícil, +5 com afixo) |
| duelo ranqueado fechado (Arena, Campo) | 15 (+10 para quem venceu) |
| tentativa do Eco conferida | 20 |
| missão diária reivindicada (a op que o juiz aceitou) | 5 |

A guerra de guilda fica de fora por ora. **Os degraus:** 20, a cada 150 pontos (3.000 na temporada: quem
desce três salas por dia chega perto do 9; quem joga muito fecha em três semanas). **Os prêmios** são a
economia de sempre, pela **mesma fila da loja** que o Eco usa (`loja_pedidos`, preço 0, origem
`trilha`; `_loja_na_hora` aplica na hora): vinténs em todo degrau (100 + 25·n), 5 pedras do elemento da
temporada (fogo → água → terra → ar, girando) nos pares, Pergaminho da Sabedoria no 5 e no 15, uma
Insígnia de Fundação no 10, e no 20 a Reescrita, 2.000 vinténs e 20 pedras. **Nunca** selo, título,
estrela ou peça: o que se ganha de chefe continua só de chefe.

Rotas: `GET /api/trilha` (pontos, degraus, resgatados) e `POST /api/trilha/resgatar {degrau}` (409
`faltam-pontos` / `ja-resgatado`; um `idem` por prêmio: nada entra duas vezes). O fechar da sala devolve
`trilha: {pontos, ganhou}`. Na tela: o bloco no alto do **Quadro de Missões** (`js/core/trilha.js`,
`trilhaBloco` no `hud.js`) — a barra, os 20 degraus (★ pronto, ✓ resgatado), o que falta para o próximo e
a régua dos pontos; o prêmio resgatado entra pelo caminho das entregas ("Prêmio da trilha da temporada: …").
Sem sessão do site não há trilha. Prova: `python tests/trilha_api.py`.

## 9-A.1 A meta da semana da guilda (07/10)

A guilda tinha gestão (cargos, cofre, banco, dízimo) e guerra, mas nada para fazer **junto todo dia**.
Agora toda sala que um membro vence — sozinho ou em grupo — enche uma barra da guilda, por semana de
Brasília (segunda a domingo, a mesma semana do Eco). Cheia (**60 salas**, `META_SALAS` em
`servidor/guilda.py`; `GUILDA_META_SALAS` no ambiente troca), a guilda ganha **150 de XP** e o bônus
de **+15% de XP e de saque para todos até o fim da semana** — o mesmo `bonus_xp`/`bonus_drop` que o
cofre compra (estende o que houver). O prêmio sai uma vez por semana; as salas seguem contando.

Mora em `guilda_meta(guilda_id, semana, salas, cumprida_em)`; `soma_meta` roda na mesma transação que
paga a sala (`salas.py`, `grupo.py`), e a ficha da guilda (`/api/guilda/minha`, `meta`) e a resposta do
fechar (`guildaMeta`) levam o estado. Na tela: a barra na ficha da guilda, acima do cofre. Só existe
com o servidor (a guilda local-primeiro não tem meta). Prova: `python tests/guilda_meta_api.py`.

## 9-A.7 A virada de temporada da arena é op do juiz (08/10 à noite)

O dono: "sempre que eu mudo de mapa, acabo uma luta, aparece em verde 'nova temporada da
arena, a coroa foi para a galeria'... não quero isso". A virada (a cada 42 dias: o Elo
comprime, a coroa vai para a galeria) acontecia SÓ na tela, em `pintaConta` (`DB.brasaVirar`
local). O hash da economia leva `jogador.brasa`, então a op seguinte não batia, o cliente
adotava o estado do servidor — ainda na temporada velha — e a virada repetia a cada entrada
na praça, com o aviso. Agora `DB.brasaVirar` é embrulhado (`autoridade.js`, op
`virarTemporada` em `servidor/juiz/economia.js`): o juiz confere a temporada pelo relógio
DELE (`Agenda.agora`), comprime pelo estado dele e aceita a coroa da galeria só se os pontos
de antes a dão (com ou sem o topo da arena, que é do placar). O aviso saiu de vez: mesmo
virando uma vez por temporada, o dono não o quer. Prova: `tests/juiz_economia.js` 52.

## 9-A.8 Os pergaminhos da guilda (08/10 à noite)

O dono: "meu sistema deve ter pergaminho para renomear guilda e outro para alterar
brasão; itens vendidos somente na loja do site". Dois produtos na seção **Guilda** da
loja do site (`loja.py`, tipo `guilda`): o **Pergaminho do Novo Nome** (150 barras) e o
**Pergaminho do Brasão** (100). Nascem `entregue` como a aura — não põem nada no save; a
posse é o pedido. Quem os gasta é o **líder**, na ficha da guilda dentro da Sede, no bloco
"Nome e brasão" (`hud.js sheetGuilda`): o nome novo num campo (a mesma lei dos nomes da
fundação, único sem caixa) e o brasão na oficina de sempre, aberta no brasão de hoje. Cada
troca consome UM pedido (`guilda_pergaminhos_usados`, único por pedido; a guilda onde foi
usado fica como número solto, sem chave — a faxina de uma guilda desfeita não devolve o
pergaminho gasto). Rotas `/api/guilda/renomear` e `/api/guilda/brasao` (`guilda.py`); a
ficha traz `pergaminhos: {nome, brasao}`. Recusas traduzidas em `erros_en/es.js`. Provas:
`tests/guilda_api.py` (test_07b), `tests/loja_api.py` 31.

## 9-A.9 A plateia e o bônus de descanso (08/10 à noite)

Duas das sugestões de retenção que o dono escolheu ("faça esses dois").

**A plateia** ("drop raro, gema engastada com +1 PA, coroa nova: anunciar no chat da
praça com o nome de quem conseguiu"). A fonte é o SERVIDOR, nunca o cliente (que
poderia inventar): o juiz diz as peças épicas ou lendárias da sala
(`recompensa.raros`, `recompensa.js rarosDe`) e o degrau da coroa antes e depois do
duelo (`duelo.js coroa`); a API grava na tabela `plateia` (`api.py _plateia`: nome do
jogo pelos resumos, senão o da conta; nome reservado cala) ao fechar a sala
(`salas.py`), na op `engastarGema` com `extra 'pa'` e no duelo ranqueado que sobe de
coroa (`grupo.py`). O relé (`rele.py vigia_plateia`) olha a tabela a cada 3 s, começa
do fim (nada do passado) e manda `{t:'plateia', nome, tipo, dados}` a TODAS as
conexões; a Rede repassa (`tipo 'plateia'`) e a HUD escreve a linha com ✦ no chat
(`frasePlateia`: os nomes do DATA, já no idioma de quem lê). Provas:
`tests/rele_plateia_prova.py` 9 (puras + ao vivo), `juiz_recompensa` (raros),
`juiz_grupo` (coroa), `tests/foto_plateia.html` (as três frases no chat).

**O bônus de descanso** ("XP dobrado nas três primeiras salas do dia; dá motivo
diário sem punir quem joga muito"). `Progress.descanso(ts)` / `anotaDescanso(ts)`:
o campo `state.descanso = {dia, salas}` no save, o dia de Brasília pelo relógio do
servidor (a agenda) — o cliente só aplica com a agenda medida; o juiz, que tem o
relógio, decide, e o hash bate. No funil (`game.js collectRewards`) o fator ×2 entra
fora do teto do comprado (é regra, não compra) e a sala vencida conta antes do save.
O save de antes fica sem o campo (o hash dele não muda) até a primeira sala. A porta
diz quantas salas em dobro restam hoje (`blocoDescanso`) e a recompensa mostra
"☀ Descanso · XP ×2 (n de 3 hoje)". Provas: `tests/descanso.js` 12,
`juiz_recompensa` (a 1ª sala em dobro; com 3 usadas, a metade).

## 9-A.10 O inventário limpo e a ficha do item (08/10 à noite)

O dono, com uma foto de referência na mão: "na hora de clicar em um item e ver as
características fica bem confuso no menu do inventário, os filtros também; queria
mais clean; e que todos os menus (forja, mercado...) sejam nesse estilo". O desenho
novo (`hud.js inventoryBody`, classes `.inv2-*`):

- **O boneco** à esquerda: os quatro espaços e o do bicho em quadradinhos dos DOIS
  lados do retrato (`invBoneco`, `invSlotCompacto`), sem texto — o nome fica no balão
  do toque longo. Toque numa vestida abre a ficha dela (com "Tirar"); toque num
  espaço vazio filtra a grade por ele. O cartão do herói encolhe (nome, nível,
  elemento, Ficha); os trajes numa linha só.
- **O saco** à direita: as cinco categorias de sempre (`.inv-tabs-main`, as provas as
  conhecem), e no lugar das duas fileiras de botões DOIS seletores (`invSeletores`:
  espaço e elemento), a lupa que abre a busca e a lotação "5 / 80". A grade é só de
  ícones (`INV_ICONE` 44 px; o `.ig-nm` fica escondido para as provas que leem o
  nome). Pedra, poção, pergaminho, carta e bicho também abrem na ficha de baixo
  (`fichaOutro`), em vez de um toast.
- **A ficha do item** (`fichaItem(ref, op)`): o retrato, o nome, o chip "Nv. N"
  (vermelho quando o herói não alcança), três abas — **Efeitos** (cada bônus numa
  linha, com a diferença para a vestida no mesmo espaço entre parênteses, a Gema, o
  feitiço concedido), **Condições** (nível, espaço, conjunto, quem usa a outra cópia,
  a Gema que prende à conta) e **Carac.** (espaço, raridade, pedra, estrela, cópias,
  fusão, quebra, de onde cai) —, a descrição em itálico e as ações (equipar, forja,
  Gema, quebra: `acoesDoSaco`). Mantém `.inv-pick`, `.inv-pick-nm`, `.inv-pick-ic`,
  `.inv-pick-tranca`, `.inv-pick-acts`. No desktop mora debaixo do boneco (áreas do
  grid `.inv2-top`); no celular vai para o fim e GRUDA no pé da folha enquanto a grade
  rola (`.inv2-ficha-area` sticky, rola por dentro acima de 46vh).
- **A mesma ficha na forja e no mercado**: a peça na bancada ganha a ficha (modo
  compacto, sem ações) logo abaixo da bancada; no Mercadinho (local e do servidor),
  o toque no nome da linha abre a ficha debaixo dela e o segundo toque fecha
  (`.mc-ficha`).
- Foto: `tests/foto_fichas.html?aba=inventario&cartas=1&nivel=10&veste=1&toca=1`
  (`&aba2=carac`, `&slot=punho`; `aba=forja&forjaPeca=1`), também em 390 px.

## 9-A.11 A forja e o banco como dois inventários; a roleta à vista (08/10 à noite)

O dono: "precisa ser o inventário do lado direito e a forja / os itens do banco do lado
esquerdo, como se fosse dois inventários; fica mais organizado". E na Barraquinha: "os
prêmios em jogo mais escuros, e aleatoriamente passa um círculo acendendo o item e sorteando".

- **A forja em duas colunas** (`forjaEmDuasColunas`, chamada por `sheetParty` depois de
  `forgeBody`): a fileira dos modos em cima, inteira; à esquerda a bancada, a ficha do
  item, a trilha, o estado, o martelo, a prateleira e a Estrela; à direita, numa caixa
  "Inventário", os seletores de espaço e elemento (`seletoresDeItem`, os mesmos do
  inventário limpo) e as grades "No saco"/"Vestidas" só de ícones. `forgeBody` marca com
  `fg-dir` o que vai para a direita; o resto fica. CSS `.fg2`; no estreito, pilha.
- **O banco**: o cofre à ESQUERDA e o saco à direita (`sheetBanco`), os seletores no lugar
  das fileiras, as duas grades compactas (`bancoGrade` leva `grade-icones`; vale também
  para o banco da guilda). A classe `.grade-icones` é a grade só de ícones que o inventário
  também usa (o nome fica no balão do toque longo, `data-rot`).
- **A Barraquinha**: a fileira do traje fica SEMPRE à vista — a peça ainda em jogo escura
  (`.colec-peca.is-escura`), a que o traje já tem com ✓ (`is-tem`) — e o giro corre o anel
  de luz (`is-on`) aos SALTOS, ao acaso, rápido no começo e devagar no fim, até parar na
  sorteada (`is-ganhou` pulsa). `window.__roletaRapida` encurta a espera nas provas.
- Provas: `prova_icones_menus` (forja e banco pelos seletores), `quebra_hud`,
  `prova_forja`, `prova_conjunto`, `fichas_fotos` 390 px.

## 9-A.12 O Mercadinho limpo, o "selecionar várias" e o Mestre no Eco (08/10 à noite)

- **O Mercadinho** (o dono: "acho que o mercadinho dá para melhorar o layout"): as abas
  viraram pílulas com o ícone E o nome (`mcAbas`, `.mc-aba`, a conta na pílula); as três
  fileiras de botões viraram UMA barra de seletores (`mcBarra`: categoria, busca, espaço,
  raridade, ordem | elemento nas pedras); no balcão entre contas, Comprar e Vender ganharam
  duas colunas (`mc2Molde`): à esquerda a grade só de ícones com o preço embaixo
  (`mcCelula`: "desde Xv" / "~régua"), à direita a ficha da peça tocada (`fichaItem`) com
  os anúncios, quem vende, Comprar e Fazer oferta — ou o preço e o Anunciar, no Vender.
  As pedras seguem em linhas (os lotes abrem à direita). Meus anúncios, Minhas ofertas e
  Poções ficaram como eram. O balcão local ganhou as pílulas e a barra.
- **Selecionar várias** (o dono: "transferir vários itens para o banco ou quebrar vários
  de uma vez, não um por um"): no Banco o botão "Selecionar várias" liga o modo — o toque
  marca a pilha (✓) em vez de arrastar e a barra de cada coluna guarda/saca TODAS as cópias
  das marcadas (índices decrescentes, uma op por cópia). Na Forja › Quebrar, o mesmo botão
  na coluna do inventário: marca as pilhas que se quebram, a barra soma as pedras e
  "Quebrar as N marcadas" pergunta uma vez e quebra uma pilha por vez, achando o índice
  pela pilha na hora (o estado do servidor é adotado entre uma e outra).
- **O Mestre no Eco** (o dono: "mestre também deve enfrentar o Eco, preciso testar"): a
  classe `gm` abre a tentativa, solo e em dupla (`supremo.py _classe_entra`); a conta da
  equipe segue fora do ranking.
- Provas: `mercado_hud` 22, `mercado_pedras_hud` 69, `prova_icones_menus` (pelos
  seletores), `fichas_fotos` 390 px, `supremo_api` test_02.

## 9-A.13 O título livre do Mestre e o filtro de palavrões (08/10 à noite)

- **O Mestre escolhe o título que quiser** (o dono: "mestre pode escolher o título que ele
  quiser"): `Titulos.valido(titulo, estado)` aceita qualquer título curto (1–23 letras, o maior
  do catálogo) quando `estado.mestre === true`; o juiz (`definirTitulo`) passa
  `mestre: !!x.conta.gm`, então só a conta gm passa — a comum segue na régua (pvm/pvp/classe/
  eco/chefe). Na ficha Customizar › Título, a conta do Mestre vê o grupo "O Mestre escolhe"
  com um campo (`.tit-livre`, 23 letras) e o botão Usar; `tituloPendurado` não derruba o
  título do Mestre. O `rele_ident.carimba` já deixava o título do Mestre passar.
- **O filtro de palavrões** (o dono: "quando alguém mandar palavrão fica tipo %$@!#"):
  `js/core/palavroes.js` (`JOGO.Palavroes.limpa/tem`, puro, listado ANTES de rede.js) — a
  palavra feia vira símbolos `%$@!#` do MESMO tamanho, por palavra inteira (computador passa),
  sem acento nem caixa, com o disfarce desfeito (p0rra, m3rd@, c@r@lho: 0→o 1→i 3→e 4→a 5→s
  7→t 8→b @→a $→s !→i |→l), letras repetidas juntas (meeerda; porrrra pela TABELA_JUNTA) e o
  plural simples; a pontuação das pontas fica ("pôrra!" → "%$@!#!"). Lista pt/en/es, inclusive
  as emendadas (fodase, vaitomarnocu) e as siglas (vsf, pqp, wtf). `Rede.filtra` delega a ele
  (sem o módulo, os asteriscos antigos). A frase sai limpa AO MANDAR (`falar`, `falarGuilda`,
  `sussurrar`) e a HUD filtra AO MOSTRAR (chat, guilda e, agora, o particular) — o que chega de
  uma aba antiga também sai limpo. O nome do jogador não passa pelo filtro (é da conta).
- Provas: `node tests/palavroes.js` 12, `tests/rede.html` 17, `tests/titulos.html` 34,
  `node tests/juiz_economia.js` 53 (o Mestre passa, a conta comum cai).

## 9-A.16 Atacar a casa vazia (08/10 à noite)

O dono: "os jogadores podem atacar em células vazias.. não só em monstro, porque se o outro
estiver invisível ou ataque em área". Até aqui (22/09, `VERSAO_REGRAS` 5) o feitiço `'enemy'` de
casa única só passava com um inimigo VISÍVEL na casa: a casa do invisível do outro lado parecia
chão para quem mirava (`Engine.ocultoDe`) e o lance era recusado sem gastar nada — o Ladino
sumido só apanhava de área, de feitiço `'any'` ou por acaso, e o jogador não tinha como "chutar"
onde ele estava.

- **A regra, em uma frase:** o feitiço `'enemy'` que FERE aceita a casa vazia (dentro do
  alcance, da linha e da visão de sempre); quem estiver nela leva o golpe, visível ou não; sem
  ninguém, o feitiço sai mesmo assim, gasta PA, vezes por turno e recarga, e não acerta nada.
- **Onde mora:** `validTargetCell` (engine.js, decisão 24 no topo do arquivo) — com
  `targetSide: 'enemy'`, sem área, sem ocupante à vista e `Engine.feiticoFere(spell)` (ao
  menos um efeito hostil: dano, raio, veneno, empurrão, puxão, raiz, marca, detonar, quebrar
  escudo, maldição; hoje 102 de 102 feitiços `'enemy'` dos dados passam) a casa vale. O golpe em
  si não mudou: `applyEffects` já batia em quem está nas casas da área sem perguntar se se vê, e
  o invisível ferido SEGUE invisível (só o golpe que ELE dá o tira das sombras). O raio em cadeia
  mirado na casa do invisível acerta ele (é o corpo na casa) e dali salta só para quem se vê —
  o salto é automático, não é uma mira.
- **O que NÃO muda, de propósito:** a casa de um ALIADO continua recusada no `'enemy'`
  (nunca foi "qualquer casa"); `'ally'`, `'self'` e `needsEmptyTile` ficam como estavam — a
  cura, o escudo e a bênção não caem no chão por um toque errado (PA jogado fora, e não há
  invisível aliado a procurar: a invisibilidade nunca vai para o outro lado), e a casa do
  invisível segue "ocupada" para invocar, saltar e armar (o aviso "há alguém que não se vê"
  continua). A IA não muda: `validFrom` (ai.js) segue pedindo um corpo — no vazio o valor
  seria zero, e mirar o invisível "sem ver" seria adivinhar (`castValue` já dá −1 a essa casa);
  como a regra nova só ABRE casas, tudo o que a IA propõe o motor aceita.
- **O diário:** `Engine.cast` escreve "{name} golpeia o vazio." (en/es) sempre que ninguém
  VISÍVEL para quem lançou está na área do golpe — medido antes do golpe, dito depois da
  linha "conjura". A linha sai igual com ou sem invisível ali: se só saísse quando não
  acertou, a falta dela entregaria o escondido. A tela do outro lado continua sem a vida do
  invisível na fila (hud.js) e sem os eventos dele (`Game.eventoParaTela`): acertar não revela.
- **A tela (renderer3d_v2.js):** `castTargets` passa a trazer quase todo o alcance no feitiço
  que fere, então a casa com um CORPO à vista fica na cor forte de sempre ("quem dá para
  acertar") e a casa vazia — ou que esta tela vê vazia, a do invisível entra aqui sem buraco —
  ganha a cor do elemento mais fraca, num quadrado menor ("o golpe sai aqui também"). O toque
  continua em dois tempos no dedo (a mira e a confirmação), então tocar no chão por engano
  não dispara. `Game.alvosNaTela` segue igual; a volta dela só faz diferença para quem pede
  chão livre.
- **A versão das regras:** `Engine.VERSAO_REGRAS` subiu para **10**. Um lance que a página de
  antes recusava (e não gastava) agora sai, gasta e fere — a mesma lista de lances refeita
  termina diferente. **O juiz tem de ser publicado ANTES da API** (docs/SEGURANCA.md §4.1): a
  sala aberta com o bilhete v9 cai como `regras-mudaram`, não como fraude; a página velha que
  ainda estiver aberta leva 409 ao abrir sala nova.
- Provas: `node tests/invisivel_armadilha.js` 118 (era 106 — as 3 que cravavam "não é alvo"
  viraram o contrário, e entraram a casa vazia com invisível, a vazia sem ninguém, a de aliado,
  o `'ally'` no vazio, a área longe de todos, o raio mirado no invisível e o diário);
  `node tests/idiomas.js` 58 (VERSAO_REGRAS 10); `tests/test_engine_v2.html` (o caso "chão
  vazio inválido" virou "VÁLIDO para o golpe que fere", mais o lance no vazio e no invisível);
  os demais do motor sem mudança (santuario_regras 94, regras_equilibrio 64, eco_motor 74,
  poco_perigos 42, guerra_bancada 96, visao_mapas 274, afixos 39, elites 21, juiz_sala 9,
  juiz_guerra 26).
## 9-A.15 A coroa do Mestre (08/10 à noite)

- **O pedido** (o dono: "fiz a arte da coroa do GM que deve ser liberada somente para ele.. e o
  brilho no meio deve ser vermelho. implante no jogo"). Até aqui o Mestre não tinha coroa própria:
  ele não joga a Arena (a conta da equipe fica fora do ranking), então em 05/10 ganhou um seletor
  no painel para vestir qualquer uma das dez do ranking (`GM.coroa/defineCoroa`, `coroaMestre`
  no resumo). Agora ele tem a DELE, fixa, e o seletor saiu.
- **A régua** (`js/core/brasa.js`): `JOGO.Brasa.MESTRE = { id: 'gm', nivel: 'gm', nome: 'Coroa do
  Mestre', tam: 1.42, brilho: 1, cor: '#ff2f2f', modelo: 'coroa_gm', mestre: true }` — um degrau
  FORA de `TIERS` (ninguém chega nela por pontos). `coroaDe(pts, partidas, ehTopo, oculta,
  mestre)`: o 5º argumento virou a marca booleana — `true` devolve `MESTRE`; o número da escolha
  antiga não é mais lido. "Esconder a coroa" (`oculta`) continua valendo por cima. O brilho é o
  halo da praça (`haloDaCoroa`), na força da Coroa X e VERMELHO; o tamanho é o da X.
- **Quem é o Mestre**: o próprio cliente pelo `JOGO.GM.ativo()` (`coroaDoMestre()` na HUD, agora
  booleano — no ar, só a conta que o servidor marcou `gm`); os outros pelo `mestre: true` que SÓ
  o Relé carimba no perfil (`servidor/rele_ident.carimba` joga fora o `mestre` do cliente e põe o
  seu na conta gm). `hub3d.tierDoFantasma` passa `perfil.mestre === true`; a HUD não manda mais
  `coroaMestre` no resumo (o Relé e a Rede seguem tirando o campo de quem o forjar — um cliente
  antigo não suja o cartão).
- **A arte** (`tools/embute_coroa_gm.py`): o `.glb` do dono pesava 8,6 MB (três JPEG de 2048² e
  26 mil triângulos). A ferramenta lança o Blender em segundo plano (Decimate por colapso, razão
  0,3 → 7,8 mil triângulos; texturas a 1024; GLB com JPEG q90) e grava `JOGO.MODELS['coroa_gm']`
  em `assets/embedded/coroas-pvp-3d.js`, ao lado das dez do ranking; `extrai_assets.py` a vira
  `assets/models/bundle/coroas-pvp-3d/coroa_gm.glb` (796 KB, grupo `coroas`). As três texturas
  ficam em 1024 como nas dez coroas (`fica_inteiro` poupa a pasta; `tests/texturas_prova.py`
  cobra que nas exceções o relevo siga do tamanho da cor). Nunca referencia a pasta de downloads:
  o caminho do `.glb` cru é argumento.
- **Na praça** (`js/render3d/hub3d.js`): `chaveDaCoroa(tier)` = `tier.modelo` ou
  `'coroa_pvp_n' + nivel`; `modeloCoroa` aceita a patente (número) ou a chave (string). A coroa
  do Mestre desce SOB DEMANDA pela mesma porta das dez (`esperaCoroa` → `Bundle.pede`), só
  quando um Mestre está à vista — nunca no boot, e a pré-busca (`/^coroa_pvp_n/`) não a lista.
  Não há bilhete PNG dela (`COROAS_PVP['ngm']` não existe): enquanto o 3D não abre, a plaquinha
  espera, em vez de mostrar outra patente. Gira e flutua como as outras, no topo da pilha
  (`baseY`). `Hub._estado()` ganha `coroaMestre` e `coroaHalo`; `Hub._coroaFantasma(id)` é a
  sonda das provas.
- **Nas fichas**: Personagem › Arena mostra a marca ♛ em vermelho (`.char-coroa-mestre`) e "a
  coroa do Mestre é fixa — só a sua conta a carrega, com o brilho vermelho"; o perfil de um
  vizinho Mestre mostra "Coroa do Mestre · fixa, só do Mestre" (`.perfil-coroa-mestre`). O painel
  do Mestre › Ferramentas troca o seletor por um cartão (`.pm-coroa-fixa`) que diz que ela é fixa.
  en/es.
- Provas: `node tests/coroa_mestre.js` 20 (régua, GM sem seletor, Rede: carimbo/forjado/esconder);
  `tests/foto_coroa_gm.html` (a praça com o herói como Mestre, um vizinho carimbado `mestre:
  true` no Cavaleiro Negro e um comum de Coroa VII; cobra 3D, halo vermelho, giro e altura; título
  `COROA GM n/n`, `window.__pronto`); `tests/painel_mestre.html` (o cartão no lugar do seletor);
  `python tests/texturas_prova.py` 16; `tools/reduz_texturas.py --conferir` e `extrai_assets.py
  --conferir` em dia; `node tools/i18n_falta.js --lista` zero.
## 9-A.14 A grade dos membros fora do salão e a pergunta antes do ataque no Campo (08/10 à noite)

- **A grade dos membros fora do salão** (o dono: "no menu da guilda, fora dela, os membros podem
  ver os outros membros, e o chefe e o vice-líder podem mexer nos XP doados"): a ficha da guilda
  fora do salão passa a ser a porta + a grade dos membros (`gradeDosMembros`, a mesma de dentro);
  o dízimo de cada um (a parte do XP que ele doa) é do líder E dos oficiais — no servidor
  (`guilda_dizimo` com `conta`) e no espelho local; o dízimo padrão e o "aplicar a todos" seguem
  do líder; promover/rebaixar segue do líder. O mural, o cofre, o banco, a porta e o governo
  continuam só no salão.
- **A pergunta antes do ataque no Campo** (o dono: "só clicando em cima agride? não deveria
  aparecer uma mensagem para confirmar?"): o toque num jogador do Campo abre "Atacar {nome}?"
  (`confirmSheet`, botão Atacar em vermelho); o ataque só sai no Atacar, e a recusa (paridade,
  fora do Campo, sem vida) continua curta, depois da confirmação.
- Provas: `guilda_api` test_05b (o oficial muda o dízimo de um membro; o padrão, só o líder),
  `pvp_hud` (a pergunta, o Cancelar e o Atacar; as duas falhas do quadro já existiam no HEAD),
  `sede_visita` (a grade fora do salão).

## 9-A.17 Quem cai volta para a luta (08/10 à noite)

O dono: "loguei com duas contas, um personagem caiu na luta e quando voltou, voltou na praça e bugou na
luta permanecendo lá.. tá bem errado isso. caso caia em qualquer conexão ele deve ficar na batalha e seu
turno e tempo correr normal até ele desconectar ou perder.. caso esteja em calabouço ele volta para a próxima
sala que seu time concluiu... por exemplo ele caiu na sala 1, aí quando voltou meu time já havia entrado na
luta da sala dois, ele pode continuar na dois e reencontrar na sala 3".

O que já existia: a queda na MESMA aba (o relé avisa `caiu`, a carência de 15 s, quem ficou assume e marca os
heróis de quem caiu com `u.ia`; o `religou` manda a `volta` com a prova e pede a foto de resgate). O que
quebrava: a ABA RECARREGADA (ou o aplicativo reaberto) — o grupo e a sessão da batalha vivem na memória; ao
abrir o jogo a luta aberta da conta era fechada como `largou` e o jogador caía na praça, enquanto os corpos
dele seguiam na sala do parceiro pela marca `ia`. E a vez do herói marcado passava no primeiro quadro.

- **A vez de quem caiu corre no relógio** (`game.js`, `vezDoCaidoAcabou`; `Game.relogioCaido` para a HUD): a
  vez de um herói de gente marcado fora corre os mesmos 30 s de uma vez normal (sem banco), no relógio de
  parede de quem simula, e só então passa — é o tempo de uma recarga. A barra da batalha mostra "{a} está
  fora — a vez dele corre no relógio… 0:23". A **queda confirmada** volta a passar a vez na hora
  (`Coop.quedaConfirmada`): o parceiro fora há mais de `Coop.QUEDA_MS` (3 min, decisão minha — quem fechou o
  jogo de vez não prende o parceiro 30 s por vez), quem SAIU de vez (`sai`, ou o `sair` do grupo na batalha —
  `Grupo.parSaiu`). O relógio para enquanto a batalha está travada; o estado segue igual nos dois motores e o
  juiz passa a vez marcada sem tempo nenhum. Vale no grupo e na guerra (por jogador).
- **A sessão do grupo guardada** (`grupo.js`, `soterra-grupo-sessao-v1` + o sufixo da conta): enquanto o grupo
  está formado numa descida, o registro guarda gid, chave, quem lidera, o par (id, cx, nome, heróis), os meus
  heróis, o calabouço, a dificuldade e a ATA da sala em curso (`Grupo.lembraBatalha`, que o Coop chama ao
  nascer a batalha e zera entre salas). Vale 30 min; some quando o grupo se desfaz ou a descida acaba; e não é
  tocado pela aba nova antes de a retomada ser decidida.
- **A retomada** (`Grupo.tentaRetomada` no `cx` da Rede, na praça): o grupo é refeito do registro com QUEM
  FICOU liderando; `Game.retomaDescida` refaz a descida (os modelos, a antessala, a batalha da MESMA ata — o
  mesmo estado inicial e os mesmos uids); `Coop.retomaBatalha` entra em `retomando` (cede a autoridade, trava
  a batalha refeita, manda `retoma` a cada 3 s e pede a foto já da colocação); a `volta` vai com
  `retoma: true` (quem ficou toma a liderança). Quem ficou responde `aqui` (a tela, a sala, o bid), toma a
  autoridade e desmarca os corpos; a foto de resgate devolve os corpos onde estavam ("De volta à batalha!").
- **A sala seguinte** (o "continua na dois e reencontra na sala 3"): o parceiro ainda fora no fim da sala NÃO
  acaba mais a descida (`Coop.aoFim`); quem ficou abre a sala seguinte com os heróis guardados de quem caiu
  e, sem o `dentro` dele (a ata sem resposta, 5 × 3 s), abre SOZINHO (`abreSozinho`) com eles marcados. Quem
  volta: se quem ficou está noutra batalha, recebe a ata dela com `retoma: true` e a refaz
  (`Game.retomaBatalhaDaAta`) pedindo a foto DELA; se está na recompensa da mesma sala, a foto do FIM o leva à
  recompensa; se espera na ANTESSALA de uma sala à frente, pula para lá (`Game.retomaNaAntessala`) e manda o
  `pronto` de sempre. A mesma pergunta (`retoma` com `leve`) sai na volta na MESMA aba (`depoisDeReligar`):
  sem batalha refeita, sem travar e sem desistir — o time pode ter mudado de sala enquanto a conexão estava
  fora. A luta aberta do gid velho fecha fotografada e sem lance (quem ficou paga os dois pelo registro limpo).
- **O `largou` é só de quem desiste**: `Autoridade.fechaPendente({ retomavel: true })` é a chamada da abertura
  (ouveNuvem) e pula a sala em grupo que `Grupo.retomavel(gid)` diz retomável; toda outra chamada (bilhete,
  sala em grupo, duelo, Arena, Eco, abandonar) fecha como sempre. A retomada que falha (sem resposta por
  `Coop.RETOMA_MS` = 60 s, o parceiro fora da descida, o grupo desfeito do outro lado, versões diferentes)
  volta à praça, deixa o grupo e só então fecha a luta como `largou`.
- O servidor não muda: a sala em grupo e a luta aberta por conta já eram o que precisavam ser; o juiz segue
  refazendo os lances com as marcas `ia` de queda e de volta.
- Provas: `tests/coop_motor.html` (K5: o relógio da vez de quem caiu, a queda confirmada, a líder abrindo a
  sala seguinte sozinha; K5b: a volta na batalha da sala seguinte; K12: a volta na mesma batalha; K14: a volta
  na antessala da sala seguinte; K7 e R1 com passos de 250 ms), `tests/grupo.html` (a sessão guardada, a
  retomada no `cx`, a `volta` com `retoma`, a falha com `sair`, o registro velho e o de outro id),
  `node tests/luta_aberta_cliente.js` (o `retomavel` na abertura), `node tests/juiz_grupo.js`,
  `python tests/grupo_duelo_api.py`.
## 9-A.18 A sala que não rendeu: o porquê na tela (08/10 à noite)

O dono: "acho que os XPs dos calabouços estão bugados.. fui na Cisterna dos Afogados primeira sala
em modo normal com duas contas, 4 personagens level 1 e ativei x3 o bônus de xp ou seja x30 e todas
as XPs foram zeradas".

- **A conta do juiz está certa.** `tests/juiz_grupo_xp.js` refaz exatamente essa sala
  (duas contas × dois heróis nível 1, Cisterna sala 0 em normal, a IA pelos quatro): sem evento
  cada herói ganha 6 XP; com o evento ×3, 19; com ×10, 64; o "×30" do dono vale o **teto**
  (`AGENDA_TETOS` xp = 10) e dá os mesmos 64 — nunca zero. O descanso (×2) entra; o nível sobe.
- **De onde vem o zero, então:** de quando o servidor NÃO confirma a vitória. Em
  `js/core/game.js` (`fechaNoServidor` / `fechaGrupoNoServidor`), toda resposta que não é
  `ok + fase 'won' + recompensa` virava `recompensaVazia(motivo)` — tudo a zero — e o motivo
  passava só num toast que some. A HUD não imprimia `recusada`. As caras possíveis, pelo servidor:
  - `fase: 'aguardando'` (a sala em grupo **fotografada**: o registro de quem sincronizou por
    foto não refaz a sala; o servidor espera o registro limpo do outro até `esperaAte`,
    `GRUPO_ESPERA` = 120 s, e só então paga ou dá `nao-conferida`). O jogo tratava como "não
    confirmou" e zerava NA HORA — mesmo com o outro membro pagando a sala segundos depois. É a
    cara mais provável do relato: duas contas na mesma máquina são duas abas, e a aba escondida
    anda sem tela (`Game._tique(semTela)`), passa a vez pelo relógio, é dada por sumida pelo outro
    (`Coop.SILENCIO_MS`/`GRACA_MS`), e ao voltar sincroniza pela foto (`coop.js`, `S.fotografada =
    true`). Com as duas abas fotografadas, ninguém paga: `nao-conferida` para as duas.
  - `rapido-demais` (`SALA_MIN_S` 4 s, `SALA_S_POR_TURNO` 0,35 s × vezes encerradas pelos
    **dois** jogadores — o juiz conta todo `e` do registro). A régua NÃO é injusta para quatro
    heróis nível 1: a sala da prova tem 37 vezes → mínimo 12,9 s desde a abertura (que é na
    antessala, antes da preparação), contra minutos de luta real. Fica como está.
  - 422 do juiz (`divergiu`, `vez`, `unidade`…), 410 `regras-mudaram`/`vencida` (outra sala
    aberta por cima, a validade), `perdida` pelo registro do outro, `outro-aparelho`.
  - A API fora do ar: `fechaEmBruto` tenta de novo até responder (status 0/5xx nunca chega à
    tela zerada); o 503 do juiz também volta a tentar.
- **O que entrou:**
  - **A tela de recompensa diz o porquê**, numa linha fixa em vermelho no bloco Experiência
    (`hud.js`, `porqueSemRecompensa`, `.rw-xp-recusa`), pelo código do servidor em
    `recusadaMotivo` (`game.js`, `codigoDaRecusa`: o `motivo`, senão a `fase` da sala já fechada,
    senão `sem-resposta`), com a frase dele como complemento: rápido demais / as regras mudaram,
    abram de novo / sincronizou por foto e nenhum registro limpo chegou / a sala venceu / o
    registro não chegou à vitória / outro aparelho / sem resposta / o servidor recusou a
    conferência ({erro}). No solo e no grupo.
  - **`aguardando` espera em vez de zerar**: `Autoridade.fechaGrupo(corpo, aoAguardar)` pergunta
    de novo a cada `ESPERA_GRUPO_MS` (5 s, ou o `esperaMs` da resposta) até a resposta de vez
    (`esperaGrupo`, como `esperaGuerra`; teto `ESPERA_GRUPO_VEZES` 40, acima dos 120 s do
    servidor). Na primeira volta a tela de recompensa sai já, dizendo que **espera** (`conferindo`,
    `porqueEspera`, `.rw-xp-espera`, "até N s"); a resposta de vez refaz a tela se o jogador ainda
    estiver nela — se já seguiu, a recompensa entrou pelo estado adotado e um toast avisa.
  - **O servidor registra toda sala que não paga** (`log.warning`, para o dono achar no Coolify):
    em grupo, `_grupo_marca` com gid, quem fechou, as duas contas, o motivo e o detalhe (o tempo e
    o mínimo no `rapido-demais`, a frase do juiz, as contas fotografadas); a espera fotografada e a
    sala vencida pela validade; a `perdida` (até onde o juiz refez); o segundo a pedir uma sala já
    caída. No solo, `_sala_recusa` com o bilhete, o bilhete vencido e o já fechado. A resposta
    `aguardando` leva `motivo: 'fotografada'` e `esperaMs`; os 410 levam `motivo`
    (`vencida`/`regras-mudaram`).
- Provas: `tests/juiz_grupo_xp.js` (9), `tests/luta_aberta_cliente.js` (+4: a espera do grupo, o
  aviso por volta, o teto, a recusa de vez; as 2 falhas de sempre já existiam no HEAD),
  `tests/grupo_duelo_api.py` (test_03 cobra `motivo`/`esperaMs` e o log; test_04 o log da
  `nao-conferida` e do segundo pedido; test_04b o 410 `vencida` com motivo; test_05 o log da
  recusa do juiz), `tests/ui_screens.html` (a linha de recusa por código, a cor, a espera).
## 9-A.19 As vagas da guilda por nível (08/10 à noite)

O dono: "a guilda deve ter limite de membro por nível: nv 1 até 10 membros, nv 2 15, e assim em
diante; nv máximo 30 também para 200 membros". A escada de nível para no 30 (`NIVEL_MAX`, nos dois
lados) e cada nível tem um teto de membros, numa TABELA escrita igual em `servidor/guilda.py`
(`VAGAS`, `vagas_de`) e em `js/core/guilda.js` (`G.VAGAS`, `G.vagasDe`): +5 por nível no começo,
curvando até 200 no 30 — vaga(n) = 10 + 5(n−1) + (n−1)²·45/841, arredondada:

| nv | 1 | 2 | 3 | 4 | 5 | 10 | 15 | 20 | 25 | 30 |
|---|---|---|---|---|---|---|---|---|---|---|
| vagas | 10 | 15 | 20 | 25 | 31 | 59 | 90 | 124 | 161 | 200 |

Toda porta passa por `_g_entra` (entrar, pedido aceito, convite, trazer): cheia, recusa 409 "a
guilda está cheia — ela abre mais vagas ao subir de nível"; o pedido fica na fila. A guilda da
EQUIPE (líder Mestre) não tem teto (`vagas: null`). A ficha e a lista trazem `vagas`, e a HUD mostra
"12/15 membro(s)"; na lista de quem procura guilda o botão vira "Cheia". Prova: `guilda_api`
test_07c.

## 9-A.20 O calendário em grade no painel do Mestre (08/10 à noite)

O dono: "no painel do Mestre, em Eventos, faça um calendário em formato de calendário, não em
linhas.. melhor para visualizar". A sub-aba Calendário de `UI.gmAgendaEm` (js/ui/hud.js) era uma
pilha de listas — toda semana, no ar, próximos 14 dias, a semana do SOTERRA e os 14 dias do
Calabouço do Dia. Agora é UM MÊS por vez, em grade:

- **A grade** (`.ag-cal-grade`): 7 colunas com as cabeças de `Ag.DIA_CURTO` (dom … sáb), uma linha
  por semana, as células vazias antes do dia 1 e depois do último (`is-vazio`), setas ‹ › e o nome
  do mês/ano no alto (`.ag-cal-topo`; o botão "Hoje" aparece quando se saiu do mês de hoje). Tudo
  no relógio de BRASÍLIA lido pelo relógio do servidor (`Ag.agora() + Ag.FUSO_MIN`): é o fuso das
  regras e o do sorteio do Calabouço do Dia (diario.js, `chaveDoDia`), então o PC com a hora torta
  não desloca nenhum dia. O dia de hoje fica aceso (`is-hoje`, borda dourada) e o tocado marcado
  (`is-sel`). O estado (`gmAgendaCal`: ano, mês, dia tocado, formulário aberto) vive fora da pintura.
- **Cada célula** (`button.ag-cal-dia`, com `data-dia="AAAA-MM-DD"` e `data-calabouco`): o número;
  a sigla do Calabouço do Dia (☀ + as iniciais do nome sem artigos — "A Cisterna dos Afogados" →
  CA; o nome inteiro no `title`); um chip colorido por tipo para cada ocorrência de regra semanal
  que cai naquele dia da semana (o texto é a HORA) e para cada evento agendado que toca o dia
  (o fator — "!" no aviso), no máximo 3 e depois "+N"; e a faixa de cor no pé com o bônus fixo da
  semana do SOTERRA daquele dia da semana (`Ag.programa()`). As cores por tipo são as do site
  (`.ag-t-xp` ouro, vintém laranja, pedras verde-água, saque lilás, aviso cinza), com a legenda
  embaixo da grade. Em 390 px a célula tem ~46 px: número, sigla e chips de 8,5 px.
- **Sem contar duas vezes**: as ocorrências que o servidor já expandiu dentro da janela de 14 dias
  (origem `calendario` e `programa`) NÃO entram pela lista de eventos — a regra (`Ag.regras()`,
  respeitando `vigenteDe/vigenteAte`) e o programa desenham o dia delas em QUALQUER mês, inclusive
  além da janela; da lista só vêm os pontuais e os fixos do Eco (`Ag.ativos()` + `Ag.proximos()`),
  que só existem dentro da janela. Mês que vem, portanto, mostra as regras e o programa, não os
  eventos pontuais que o servidor ainda não expandiu.
- **O toque num dia** repinta a aba com os detalhes embaixo da grade (`.ag-cal-det`, com
  `data-dia-det`): o Calabouço do Dia e o afixo daquele dia, a linha do bônus fixo, e as linhas de
  sempre — `linhaRegra` (com Cancelar) e `linhaEvento` (Encerrar/Cancelar), as mesmas das listas
  das outras sub-abas (`listaEventos` ganhou o 4º argumento `alvo`, o contêiner). Abaixo dos
  detalhes segue a lista "Toda semana" com todas as regras, para ver as de vários dias de uma vez.
- **A regra nova** fica recolhida: o botão "Nova regra de toda semana" (`.ag-cal-nova`) abre o
  formulário de sempre (dias, hora de Brasília, duração) com o "Pôr no calendário"; o 201 recolhe
  o formulário de novo. As sub-abas Agora e Agendar não mudam; a faixa do Acampamento segue
  apontando o site.
- Provas: `tests/gm_agenda.html` (as checks "Calendário: …" cobram a grade — 7 cabeças, o mês de
  setembro de 2026, o dia 10 aceso, a Maré da Cisterna nos quatro sábados e em nenhum outro dia, os
  14 Calabouços do Dia conferidos contra `Diario.hoje` nas células certas, nenhum portal fechado, os
  detalhes de hoje com a Quinta do XP no ar, o toque no sábado 12 abrindo a regra, as setas de mês
  e o botão da regra nova abrindo o seletor de calabouço) e a página de foto
  `tests/foto_calendario_gm.html` em 390 px (título `CALENDÁRIO GM n/n`).

## 9-A.21 A sala em grupo que não pagava, e a caixa-preta (09/10)

O dono: "de novo não deu XP na luta, isso é inaceitável" (Cisterna em 08/10, Andaimes do Vento em 09/10,
duas contas, com e sem evento). A tela nova dizia: "o lance 1 deu diferente aqui". A causa, desde 21/09
(a preparação da batalha): as casas marcadas na preparação viajavam dentro do `p` para o outro cliente
(`paraFio`, `e`/`eu`) e o `anotaSrv` sabia guardá-las, mas `Coop.registra` e `Coop.aplicado` nunca as
passavam — o registro que vai ao servidor tinha um `p` sem casas, o juiz colocava todo mundo ao acaso e o
primeiro movimento já não batia. Quando ninguém marcava casa, a colocação era a mesma dos dois lados e a
sala pagava: por isso as provas (que nunca marcam) e as descidas de teste passavam, e a do dono não. Agora
os dois caminhos passam por `entradaSrv(l, ok, de)`, que leva `e` e `eu`. Prova: `node tests/coop_registro_p.js`.

**A caixa-preta.** Toda sala que o juiz recusa (422) fica inteira em `<pasta do banco>/recusas/
<tipo>-<ref>-<quando>.json` — a ata, os lances, o progress/db de cada conta, o contexto e a frase do juiz
(`Api._guarda_recusa`, chamada em grupo.py e salas.py; 60 arquivos, os velhos saem). O Mestre vê a lista em
Painel › Auditoria › "Salas recusadas pelo juiz" e baixa o arquivo (`GET /api/mestre/recusas`,
`GET /api/mestre/recusa?arquivo=`). Em casa, `node tools/refaz_recusa.js <arquivo>` refaz a sala com o mesmo
juiz e o rastreio ligado (`global.__traceLance` em servidor/juiz/sala.js): lance a lance, a unidade da vez,
PA/PM, a casa, o alvo e o ocupante — e diz onde divergiu.
## 9-A.22 A barra de vida com o escudo em azul (09/10)

O dono: "o escudo que o Minotauro dá deve somar à vida do personagem, mas a barra de vida deve
ficar azul proporcionalmente ao tamanho da quantidade de escudo". Só a tela mudou — a regra do
motor é a mesma (o escudo segue um efeito `shield` que absorve o dano antes do PV, `VERSAO_REGRAS`
intocada); o que mudou é o que a barra CONTA.

- **Uma barra só.** Antes a vida era a barra (hp/hpMax) e o escudo uma fita fininha azul-clara de
  5 px em cima dela, com largura shield/hpMax — pequena, cortada em 100% e fácil de não ver. Agora
  vida e escudo dividem a mesma barra: a escala é `total = max(hpMax, hp + escudo)`; o PV ocupa
  `hp/total` na cor de sempre (verde do nosso lado, vermelho do inimigo, laranja abaixo de 34% —
  **da vida**, não do total) e o escudo ocupa `escudo/total` em AZUL (`#6fb8ff`, com uma risca
  clara separando-o do PV), encostado no fim do PV. Enquanto o escudo cabe no que falta de vida
  ele preenche o trecho vazio; quando `hp + escudo` passa de `hpMax` a barra não corta — **estica a
  escala** (um herói cheio de 150 com 80 de escudo mostra a vida em 150/230 e o azul no resto).
  Sem escudo `total = hpMax` e a barra é exatamente a de antes. A fita de cima saiu.
- **Onde mora a conta.** Duas funções gêmeas, de propósito uma em cada camada (a HUD não pode
  depender do renderer existir): `barraVida(hp, hpMax, shield)` em `js/render3d/renderer3d_v2.js`
  (exportada como `R.barraVida`, usada pelo `drawBar` do sprite em canvas da unidade) e
  `fracoesVida(u)` em `js/ui/hud.js` (`UI._fracoesVida`), que devolve também `rot`, o texto do PV:
  `"110 +30 / 150"` quando há escudo, `"110 / 150"` sem. A assinatura `sig` do `drawBar` já levava
  o escudo, então a barra repinta quando ele entra ou cai.
- **Toda barra de vida da batalha** segue a mesma conta: o sprite 3D (`drawBar`); o cartão da
  unidade da vez (`barraPv(u)` = `bar('bar-hp', pv, rot, esc)` — o `bar()` da HUD ganhou o 4º
  argumento `esc`, que acrescenta a `div.bar-esc` posicionada em `left = pv%` com `width = esc%`;
  o chip "🛡 N" do canto saiu, e com ele o css `.shield-chip`); a fila da vez (`.tl-hp i.esc`); e o
  painel do grupo (`.gl-vida i.esc` — `pintaGrupoLado` passou a carregar `esc` por linha, e ele
  entra na assinatura `glSig`). O css de `.tl-hp` e `.gl-vida` ganhou `position: relative` para o
  azul absoluto se encostar na vida. A ficha (`unitTipBody`) segue dizendo "Escudo: N" e o efeito
  `shield` continua fora da lista de efeitos do cartão, porque já está na barra.
- Prova: `tests/foto_escudo_barra.html` (título `ESCUDO NA BARRA n/n`, `window.__pronto`). Numa
  sala real da Estufa o Minotauro lança o Escudo de Ombro (80) no herói ao lado; a página lê a
  linha do meio do canvas da barra (`R._barraDe(uid)`, novo gancho só de prova) pixel a pixel e
  cobra: vida cheia +80 estica (PV = hp/(hp+80) e azul = 80/(hp+80), sem trilho vazio, nada na
  faixa da antiga fita); 40% +80 cabe (PV e azul em hp/total e 80/total, o resto trilho); o
  Minotauro sem escudo mede hp/hpMax e não tem um pixel azul. Na HUD confere `UI._barraPv` pelos
  estilos (`.bar-fill` em pv%, `.bar-esc` em left=pv% / width=esc%, o texto "hp +80 / hpMax", sem
  `.shield-chip`) e a fila da vez pintada de verdade (`UI.update` → só o aliado com escudo tem o
  `i.esc`, começando onde o PV acaba). A folha de foto cola as três barras em 2× e mostra a barra
  da HUD com o css do jogo.

## 9-A.23 O evento de XP vai até ×20 (09/10)

O dono: "o Mestre pode colocar evento de até ×20 de XP". O teto do tipo `xp` sobe de ×10 para ×20 nos três
lugares que o guardam — `AGENDA_TETOS` (servidor/api.py), `TETOS_AGENDA` (servidor/juiz/estado.js) e `Ag.TETOS`
(js/core/agenda.js); vintém, pedras e saque seguem em ×10. O formulário do painel lê o teto da agenda
("até ×20"), a leitura do servidor prende em 20 o que estiver acima, e o teto do XP comprado (×2) não muda.
Provas: `juiz_grupo_xp` (×30 vale ×20), `agenda.html`, `servidor_api` (tetos e a linha ×90 presa em 20).

## 9-A.24 A velocidade da batalha (09/10)

O dono: "queria ter um modo de colocar a velocidade mais rápida um pouco dos monstros de cada luta, para
agilizar as lutas". `js/core/ritmo.js` (`JOGO.Ritmo`): três níveis por aparelho — normal ×1, rápida ×1,5, muito
rápida ×2 — guardados em `localStorage` `soterra-ritmo-v1` (o normal não ocupa o armário). É coisa de tela:
o motor só conhece os lances e o juiz refaz a sala pelos lances, então nada muda de regra, nem o relógio de
30 s da vez do jogador, nem a vez de quem caiu; em dupla cada um escolhe a sua. O fator vale em três lugares:
a pausa entre os passos da IA (game.js, `AI_ACTION_DELAY / ritmoDaTela()`), a fila de animações e os clipes
das unidades na batalha (renderer3d_v2 `R.render`: `dtb = dtv × fator` em `updateAnims` e `updateUnitNodes`,
que também encurta a trava do golpe `animLock`) — o relógio geral da cena (clima, câmera) não. A opção fica
em Configurações › Batalha › "Velocidade da batalha". Provas: `node tests/ritmo.js`, `fichas_fotos` (a opção
na ficha e o fator ao trocar).

## 9-A.25 Os menus nativos escuros (09/10)

O dono, no painel do Mestre › Eventos: "esse menu do Mestre está ruim de enxergar". O `<select>` nativo abria
a lista do sistema em branco com a letra clara do controle por cima. `html { color-scheme: dark }` em
css/style.css faz o navegador desenhar a lista, a barra de rolagem e os `<input type=date|time>` no escuro, e
`select option` ganha fundo e letra explícitos. O jogo é sempre escuro, então vale para tudo; o site tem o
CSS próprio e não muda.

## 9-A.26 O inglês nas placas 3D e nos eventos da semana (09/10)

O dono, com três fotos do jogo em inglês: "coloquei para inglês e muita coisa em português ficou". As fotos
mostravam três sobras da etapa 2 dos idiomas (docs/IDIOMAS.md), que tinha deixado o 3D de fora de propósito:

- **As placas 3D** da praça ("Sede das Guildas", "Banco", "Mercadinho", "Barraquinha da Sorte", "Forja", "Arena",
  "Campo de PvP", "Poço sem Fundo", o portal "— fechado", a bandeirola "GUILDAS"), da antessala ("Para a batalha",
  "Sair do calabouço"), do Campo ("Voltar à praça") e do salão da guilda (cofre, mural, trono, mesa, banco, saída).
  `js/render3d/hub3d.js` ganhou o atalho `Tx()` de todo módulo e cada `rotulo(…)` e o `nome` do mesmo lugar passam
  por ele **na hora de desenhar** (a placa é canvas → textura, feita uma vez em `Hub.entrar`; o `i18n.js` e o
  `textos_<idioma>.js` já desceram muito antes, pela ordem do `index.html`). O `id`/`tipo` de cada lugar é chave e
  fica em português — a HUD nunca comparou pelo nome (`aoAproximar` lê `lugar.tipo`; os painéis escrevem o próprio
  título por `tr()`), só mostra `lugar.nome` no painel do portal. O nome do calabouço no portal já vinha traduzido
  do DATA (`aplicaDados`); o sufixo virou frase (`{a} — fechado`), não pedaço. Para as provas, o sprite guarda
  `userData.textoDaPlaca` e `Hub._lugares()` devolve `nome` e `placa`.
- **A semana do SOTERRA** na faixa de eventos: os títulos ("Sexta do Dia", "Domingo do Poço"…) e os textos vêm
  do **servidor** (`PROGRAMA_SEMANAL`, `servidor/api.py`) e a HUD os mostrava crus. A tradução é no cliente, pela
  mesma porta do Eco da semana: `JOGO.I18n.resposta` (o funil do `Sessao.api`) traduz título e texto de todo evento
  de `origem` `'supremo'` **ou `'programa'`** e da tabela `programa` da resposta (os sete dias da linha da faixa e da
  ficha). As 14 frases moram em `js/i18n/erros_*.js`, com as outras frases do servidor; `tools/erros_servidor.py`
  passou a colhê-las (um dicionário com `titulo`/`texto` e `dia`), então o `i18n_falta` cobra a tradução de uma
  frase nova do programa. O que o **Mestre** escreve (origem `pontual`/`calendario`) fica como ele escreveu, mesmo
  que coincida com um título do programa. O cache da agenda (`soterra-agenda-v1`) guarda o texto já traduzido,
  então ganhou o carimbo `idioma`: cache de outro idioma é descartado na leitura (sem carimbo = português) — trocar
  o idioma não mostra mais a faixa na língua de antes até a busca seguinte.
- **A varredura** do que mais chegava à tela fora do `tr()`/`Tx()`: a pílula "<b>N</b> evento(s)" e o "+N outros"
  da faixa, "{a} membro(s)" da porta da guilda, o `title` "recentrar a camera", o `placeholder` "quantia" e o aviso
  "digite a quantia" do banco, "recebe <b>…v</b> taxa …v" e "total <b>…v</b>" do mercadinho, "Arena — a Brasa",
  "excluindo…" da exclusão de conta, e no renderizador da batalha o motivo de a conjuração não sair ("Sem linha de
  visão: muro em (x,y).", "No escuro: …"), que vai ao registro — `renderer3d_v2.js` também ganhou o `Tx()`.

O que ficou em português **de propósito**: o painel do Mestre (`painel_mestre.js`, `debug.js`, `gm.js`); os
`console`/`throw`; as chaves de rede (`rede.js`, `contas.js`); o nome de jogador, de guilda e o chat (balão da praça
incluído); `tierOf()` (classe de CSS); os `'Enter'`/`'Escape'`/`'Tab'`; o seletor "Idioma · Language · Idioma"
(trilíngue de propósito); e os eventos que o Mestre escreve. Provas: `node tests/idiomas.js` 76 (a seção (h): os 14
do programa em en/es lidos do próprio `api.py`, o funil com origem programa/supremo/pontual e a tabela `programa`,
as 20 placas por `Tx()` com tradução, o `Tx` do 3D, o carimbo do cache); `node tools/i18n_falta.js` zero;
`tests/foto_idiomas_placas.html` (abre o jogo com `?lang=en`: as placas e os nomes da praça, o portal fechado, a
faixa com a Sexta do Dia e os sete dias injetados pelo funil, as placas da antessala e o painel da saída; `?lang=es`
prova o espanhol).

## 9-A.27 O Torneio da Arena — o servidor (10/10)

O dono: "a arena é o maior item do mapa e tem que ir além de procurar desafios, deve ter torneio; todo sábado
terá torneio de PvP e todo domingo torneio de guilda (ou quando o adm marcar)". O CONTRATO — as regras, a
tabela de prêmios, a progressão, as rotas e os formatos — é **docs/TORNEIO.md**; o que o servidor fez de
diferente (ou decidiu onde o texto calava) está na seção 4 de lá. Aqui fica só o mapa de onde cada coisa mora.

- **`servidor/torneio.py`** (`TorneioMixin`, entra na `Api` como os outros): as tabelas `torneios`,
  `torneio_inscritos`, `torneio_voluntarios`, `torneio_representantes`, `torneio_lutas` (uma linha por luta de
  cada rodada), `torneio_dids` (todo did que o torneio abriu), `torneio_desistentes`, `torneio_pagos` (a trava do
  "nada se paga duas vezes"), `torneio_conquistas`, `torneio_guilda_titulos` e `torneio_vigentes` — todas NOVAS,
  nenhum ALTER. As rotas `/api/torneios`, `/api/torneio` (públicas), `/api/torneio/meu`, `/inscrever`, `/sair`,
  `/presente`, `/voluntariar`, `/desvoluntariar`, `/representante` e as três do Mestre (`/api/mestre/torneios`,
  `/torneio/marcar`, `/torneio/cancelar`, com a trilha em `moderacao_auditoria` como toda ação dele).
- **O relógio** é `_torneio_passo`, idempotente: cria os três da semana (sábado 14:00 as duas faixas, domingo
  14:00 o de guilda, horário de Brasília com o deslocamento fixo de sempre; o seguinte só nasce quando o anterior
  da mesma vaga acaba, e nunca a menos de 6 dias), fecha as inscrições e sorteia (`secrets`; passes só na
  primeira rodada, cada um numa luta diferente), chama as lutas, vence os prazos de presença, abre a rodada
  seguinte e paga. Roda numa thread do servidor a cada 5 s (`liga_torneios`, no molde da varredura da Google
  Play) e em toda rota do torneio; tudo o que ele decide está no banco, então os dois contêineres do rolling
  update dão o mesmo passo. As durações saem do ambiente (`SOTERRA_TORNEIO_FECHA_S`, `_CHAMADA_S`, `_ENTRE_S`,
  `_LUTA_MAX_S`, `_PREVISAO_S`, `_DOBRO_S`, `_PASSO_S`, `_PASSO_MIN_S`) — as provas adiantam os relógios no banco.
- **A luta** reaproveita o que já existia. Os dois presentes: uma linha em `arena_partidas` JÁ `'pronta'` com o
  did `torneio-…` (`servidor/arena.py`: a partida de torneio aparece no `GET /api/arena/estado` com
  `torneio: <id>` até a luta fechar, e não só pelos 180 s do quadro). O duelo é o de sempre
  (`servidor/grupo.py`): no `duelo/abrir` o did de torneio entra com a vida CHEIA (os heróis a 0 PV não barram);
  no `duelo/fechar` ele não tem teto nem paridade, nunca ranqueia (a Brasa não muda) e não grava a vida do fim;
  e TODO desfecho guardado (`_duelo_guarda`) chama o gancho `_torneio_resultado` na mesma transação — vencedor
  A/B com o carimbo do torneio avança a chave (`como`: `luta`, `desistencia` ou `wo`), e todo o resto (foto,
  regras que mudaram, replay recusado, W.O. sem prova, a espera que venceu, empate) abre a revanche; a revanche
  sem vencedor e a luta de mais de 30 minutos decidem por sorteio. Um lado só NÃO fecha "sem vencedor": a foto,
  o replay recusado e o W.O. sem prova de um lado esperam 90 s o registro do outro (`torneio_fechos`); o
  recusado contra o limpo é derrota, e o reincidente perde por W.O. (docs/TORNEIO.md §4.5).
- **O prêmio** sai na transação que encerra o torneio: as barras por `barras_move` (ref `torneio:<id>`), os
  vinténs por `credita` e as Gemas Enterradas por um pedido de preço 0 — a mesma fila do Eco e do prêmio diário,
  com a entrega na hora pelo juiz (`servidor/loja.py` dá o nome e a origem `torneio`; `js/core/loja.js` deixa a
  Gema inteira passar só com `origem: 'torneio'`).
- **A progressão**: `torneio_conquistas` conta para sempre. Os títulos são `js/core/titulos.js`
  (`T.ARENA`, `T.ARENA_GUILDA`, fonte `arena`, `estado.arena = {pvp, guilda}`) e o juiz os confere com as
  conquistas que a API lê do banco (`contexto.arena` em `servidor/salas.py`, `definirTitulo` em
  `servidor/juiz/economia.js`). A moldura `arena` entra em `molduras.tem` (`servidor/loja.py`) de quem venceu
  em chave de 8 ou 16, e o Relé (`servidor/rele_ident.py`) carimba `arena: {n, vigente}` no perfil e
  `campea`/`titulos` na guilda do perfil — do banco, nunca da página.
- **A guilda campeã**: o XP em dobro é um fator próprio — `_guilda_contexto` manda `fatorXp: 2` ao juiz por 7
  dias e `Guilda.fatorXp()` (`servidor/juiz/estado.js`) o põe no LUGAR do +15% do cofre (a única linha mexida em
  `js/core/game.js` é a que lê esse fator); o XP da guilda soma em `guildas.xp`; a ficha da guilda leva
  `torneio: {campea, titulos, fatorXp, xpDobroAteMs}`.
- **Provas**: `python tests/torneio_api.py` (14, com o juiz de verdade: os da semana, as públicas, o Mestre, a
  inscrição e as recusas, as vagas até 16 e o `cheio`, o cancelamento, a chave de 16 e a de 8 com 3 passes, a
  chamada, o W.O., o sorteio, a partida pronta, o duelo sem coroa nem vida, a revanche, a desistência, o W.O. do
  relé, o replay forjado, o prêmio pago uma vez, o título, a moldura, o carimbo, o torneio de guilda);
  `node tests/juiz_economia.js` (os títulos no juiz), `node tests/juiz_titulos_regua.js` (a régua) e
  `node tests/juiz_recompensa.js` (o XP em dobro no lugar do +15%). O que o servidor não acredita do cliente:
  docs/SEGURANCA.md §4.10.

## 9-A.28 O Torneio da Arena — o cliente, o site e o painel (10/10)

O dono: "a arena é o maior item do mapa e tem que ir além de procurar desafios, deve ter torneio; todo sábado
terá torneio de PvP e todo domingo torneio de guilda (ou quando o adm marcar)". O contrato é `docs/TORNEIO.md`
(as regras, as rotas e, na seção 4, o que o servidor decidiu); o servidor está em 9-A.27. Aqui fica quem
DESENHA e quem PEDE.

**O módulo — `js/core/torneio.js` (`JOGO.Torneio`).** A lista pública (`GET /api/torneios`, cache de 60 s; 15 s
com chave andando), o MEU (`GET /api/torneio/meu`: inscrições, a luta chamada, as conquistas, o lado da guilda)
e os pedidos (`inscrever`, `sair`, `presente`, `voluntariar`, `desvoluntariar`, `representante`). O MEU é relido
a cada ~20 s na praça com inscrição ou torneio do dia, a cada 3 s com chamada ou luta, e de 5 em 5 min sem nada
(as conquistas mudam pouco); fora da praça, só com luta. O relógio é o do servidor (`To.agora()`, o desvio
medido a cada resposta). `To.textoRecusa(r)` transforma cada `motivo` em frase; motivo desconhecido mostra a
frase do servidor. Servidor de antes do torneio (404): a lista fica vazia, a aba diz que ele ainda não chegou e
o MEU nem é pedido.

**A luta não é do módulo.** Quando `luta.did` aparece, ele chama `JOGO.Arena.consulta()`: a Arena de sempre lê
`fase: 'pronta'` (o servidor a marca com `torneio: <id>`) e entrega ao Duelo pela Rede, no modo `arena`. Um
`did` é entregue UMA vez (a revanche vem com outro); fora da praça ou com outro duelo aberto a entrega espera e
`luta.bloqueio` diz o porquê. Em `js/core/grupo.js` entrou só o necessário: a pronta passa `torneio` ao
`Duelo.iniciaArena`, que o guarda em `dst.arena.torneio`, e o `Duelo.escolher` deixa o herói a 0 PV entrar e
não manda o carry local quando a luta é do torneio ("começa com a vida CHEIA dos dois lados"); o duelo comum
segue recusando por `vida-zero`.

**A tela — `js/ui/hud.js`.**
- A Arena tem duas abas (`abasArena`): **Desafios** (o quadro) e **Torneio** (a ficha `torneio`). O painel do
  lugar mostra a linha do próximo torneio e a porta.
- A ficha: um cartão por torneio que vem (as duas faixas do PvP e o de guilda) — a data no fuso do aparelho, a
  contagem (anda a cada segundo), as vagas ("5 de 8 — enche e abrem mais 8"), o prêmio do tamanho de agora e o do
  torneio cheio, a minha situação (inscrito com tal dupla, trocar, sair). A inscrição usa a ficha de escolher os
  dois heróis do quadro (`sheetEscolheDupla`, com `semVida` e `aoCancelar`). A dupla da praça fora da faixa só
  AVISA: quem confere o nível é o servidor.
- A chave (`desenhaChave`): uma coluna por rodada (Oitavas, Quartas, Semifinal, Final), quem passou com ✔, quem
  caiu riscado, W.O./passe livre/sorteio/desistência no pé de cada luta, a previsão da hora das que faltam, a
  rodada em curso acesa e a minha linha com a borda de ouro. No celular a CAIXA rola para os lados; a ficha não.
- A guilda: voluntariar a dupla, a lista de voluntários, o líder ou oficial escolhendo (e desfazendo) o
  representante. Também pela Mesa do conselho do salão ("Torneio das Guildas"). A ficha da guilda mostra
  "campeã vigente · N título(s)" e "XP em dobro até …" (`JOGO.Guilda.torneio()` / `fatorXp()`, que o game.js
  usa na prévia do XP).
- A chamada (`.ui-torneio`, `pintaChamada`): um cartão FORA das telas e por cima das fichas, como o dos
  pedidos — "Sua luta do torneio: contra X", a rodada, os 3 minutos com a barra, o "Estou aqui", quem já
  confirmou, e "a luta vai começar!" (ou "volte à praça"). A praça remontada não o tira; ele só sai da frente
  enquanto a própria luta acontece. Na revanche o cartão diz que é revanche.
- O fim: a tela do campeão abre sozinha na praça com o prêmio recebido; os outros recebem um aviso, e a plateia
  (`tipo: 'torneio'`) escreve a linha no chat de todos. O prêmio que chega pela fila da loja sai como "Prêmio do
  torneio". O fim do duelo do torneio diz que a coroa não muda.
- Customizar: o grupo "Torneio da Arena" nos títulos (a régua é a do `js/core/titulos.js`, com
  `estado.arena = {pvp, guilda}` vindo do MEU) e a moldura "Campeão da Arena" com o grau.

**A moldura e a placa da guilda — `js/render3d/hub3d.js`.** A vitrine chama a moldura de `arena`; na placa ela
vira `campeao1..3` pelo `arena.n` do perfil (1–2 → I bronze liso; 3–4 → II prata com pilastras e gema; 5+ → III
ouro com pilastras duplas e a coroa de três pontas). A forma é dela: um FRONTÃO no alto e os cantos de baixo
cortados. Por cima vão as marcas (1 a 5, uma por conquista) e, só no campeão vigente, o louro deitado sobre a
borda de cima. A `arena` automática do pódio da Brasa (as pontas, "Top N Pvp") não mudou, e título do torneio
sem a moldura escolhida não acende moldura nenhuma. A placa da GUILDA campeã é discreta de propósito (o dono:
"não pode ser muito chamativa"): um segundo filete fino dourado e um raminho de louro em cada canto enquanto é
a vigente, e uma gema pequena por título (até 5) para sempre — sem forma nova, sem crescer a placa. O `arena`
dos outros chega no perfil pela Rede (`js/core/rede.js` só o deixa passar, limpo); o do próprio herói entra por
`Hub.arena()` e `Hub.guildaCampea()`. A página nunca manda `arena`: quem carimba é o Relé.

**O painel do Mestre — `js/ui/painel_mestre.js`, aba Torneios.** A lista de todos (com os cancelados e o
motivo), o formulário de marcar (tipo, faixa só no PvP, data e hora de BRASÍLIA, título opcional de 3 a 60
letras; nasce no próximo sábado/domingo às 14:00) e o cancelar em duas batidas para o que ainda não começou.

**O site — `site/torneio.html`.** O dono: "os desafios serão sorteios e ficarão públicos no site, o horário do
desafio de cada". A página lê `GET /api/torneios` sem conta: os torneios que vêm com data, contagem, vagas,
prêmios e inscritos; a chave com o HORÁRIO previsto de cada luta; os últimos campeões com a chave para abrir; e
as regras com a tabela do prêmio. Atualiza sozinha a cada 30 s com torneio sorteado, em andamento ou a menos de
uma hora do início; a cada 5 min fora disso. O menu de todas as páginas ganhou "Torneio".

**Armadilhas.**
- O nome dos torneios da semana sai do `tipo` e da `faixa`, NÃO do `titulo` (que vem em português do servidor);
  só o torneio do Mestre mostra o título como foi escrito.
- A lista e o MEU chegam em pedidos separados: a tela do campeão se refaz quando as conquistas chegam.
- As frases do HTML do site têm de estar em `site/i18n_<idioma>.js` mesmo quando já existem no dicionário do
  jogo: o HTML é traduzido ANTES de o `textos_<idioma>.js` descer. E o menu inteiro é UMA frase — mexer nele
  troca a chave nas dez páginas.
- A faixa de eventos da praça ainda não cita o torneio do dia (era opcional).

**Provas.** Node: `tests/torneio_cliente.js` (70 — o módulo e o grupo.js de verdade: o ritmo da consulta, os
pedidos, as recusas, a entrega à Arena, o did que não repete, a revanche, a vida, o campeão),
`tests/torneio_perfil.js` (12 — a Rede: o `arena` do perfil e a guilda campeã). Navegador:
`tests/torneio_hud.html` (a ficha, a inscrição, a chave de 8, a chamada, a guilda, o campeão, Customizar e a
régua de 390 px / 44 px), `tests/foto_moldura_arena.html` (os três graus, as marcas, o louro, a placa da
guilda), `tests/site_torneio.html` (a página do site com dados de mentira) e a seção Torneios de
`tests/painel_mestre.html`.

## 9-A.29 O painel da Arena limpo e a prateleira da forja sem pedra errada (10/10)

- **O painel da Arena** (o dono, com a foto: "está bem confuso isso, e o duelo de treino (mesmo teclado) pode
  sair; arrume esse menu da Arena"): dois blocos com nome — **Ranqueado** (uma linha do que é, Inscrever minha
  dupla, Ver o quadro) e **Torneio** (só o PRÓXIMO, numa linha com a data e as vagas, e um botão "Ver o torneio"
  / "Ver os N torneios") —, o placar num botão discreto no pé já com a conta dos duelos, e a dica do amistoso
  numa linha. O duelo de treino no mesmo teclado saiu do painel.
- **A prateleira da forja** (o dono, com a foto do "Pedra errada: Lasca da Lousa…": "não deve nem aparecer a
  lasca ali na forja, pra evitar confusão"): no Forjar, com a peça na bancada, a prateleira mostra só a pedra
  do elemento dela e a Âncora, e a pedra já vai escolhida (`forjaPedra = pedraCerta`). Sem peça na bancada, e
  no Quebrar, a prateleira inteira segue à vista. Prova: `tests/prova_forja.html?errada=1`.

## 9-A.30 Os ícones de feitiço, as molduras e as folhas de efeito do Blender (12/10)

O dono, na véspera das duas semanas até a Google Play: "mude os ícones dos ataques, vejo muitos repetidos",
"crie mais efeitos visuais nos ataques, tenho o Blender", "melhore os detalhes que ficam em volta dos nomes".
Três frentes, cada uma com a sua prova, e nenhuma mexe em regra de jogo (a `VERSAO_REGRAS` segue 10).

- **Os ícones de feitiço: um desenho por feitiço** (`js/render2d/art.js`, "ÍCONES DE FEITIÇO v2"). Até aqui o
  ícone saía de `glyphFor`: o primeiro efeito que não fosse dano escolhia entre 22 glifos, e todo feitiço de
  dano caía na chama/gota/pedra/sopro do elemento — numa árvore de 27 feitiços do mesmo herói, seis do mesmo
  caminho saíam com a MESMA chama. Agora o desenho tem três camadas: o **motivo**, pela tabela `MOTIVO_FX`
  (os 198 feitiços de classe nomeados um a um pelo `fxKey`: machado, grito, chifres, arpão, aljava, verruma,
  braseiro, pira, cisterna, grilhão, fenda, lousa, fonte, compressa, redoma, névoa, emboscada, cada invocação
  com o bicho dela, as armadilhas por elemento, muro, cerca, menir, cerco, labirinto, bigorna…), pela tabela
  `MOTIVO_FORMA` para as 147 formas de fusão (pelo NOME da forma — a barra de uma dupla tem sete formas com só
  quinze `fxShape` entre elas, então duas saíam iguais) e pela família do nome (`REGRAS_MOTIVO`, a mesma
  lógica do `fx3d_v2.js`) para monstros, bichos e itens, com o `glyphFor` de sempre no fim; a **marca da
  área** no canto de cima (círculo, cruz, cone, linha, anel); e o **distintivo** do efeito secundário no canto
  de baixo (veneno, marca, empurrão, puxão, raiz, invisível, escudo, cura, bônus, maldição, armadilha,
  teleporte) — os dois só de 40 px para cima, a 34 px vira sujeira. A fusão de dois elementos pinta o motivo
  metade em cada cor. `Art.spellMotif/spellBadge/spellForm` estão expostos para a prova.
  Prova: `tests/icones_feiticos.html` (30 de 30) — todo feitiço de classe nomeado, 90+ motivos, nenhum par
  igual DENTRO da árvore de cada classe a 48 e a 34 px, nenhuma barra de fusão repetida, monstros/bichos/itens
  desenham; a página é também a galeria.
  *Armadilha:* o ícone é CACHEADO por id+tamanho (`A.spellIcon`); mudou o desenho, `Art.clearCache()` ou
  recarregar. Feitiço novo de classe sem linha na `MOTIVO_FX` cai na família do nome — funciona, mas pode
  repetir o motivo do vizinho de caminho: a prova acusa.

- **As molduras da plaquinha** (`js/render3d/hub3d.js`, `bordaBiselada` nova + `desenhaMoldura`). Toda borda
  passou a ter BISEL (o aro de dentro claro em cima e à esquerda, escuro embaixo e à direita — a placa
  recortada por `clip`, só sobra a parte que invade o miolo; o fio escuro de fora por `clip('evenodd')`), o
  metal em degradê com um lustre diagonal, fio gravado duplo, CONTAS ao longo do fio de dentro, ROSETA nos
  cantos, gemas lapidadas em quatro facetas com a cintilação, rebites com luz e o vinhete do fundo. Cada forma
  ganhou o seu ornamento: volutas (Dourada), espinhos sombreados (Rubi), a vinha com folhinhas (Esmeralda),
  runas gravadas (Obsidiana), rosetas e contas (Arena), arcos góticos sobre pilastras com pedra de fecho (Eco),
  ameias com juntas de cantaria e torres com telhado e seteira (Chefe), caneluras e o medalhão com a estrela
  (pódio de classe). A placa comum (sem moldura, grupo, guilda) também passou pela `bordaBiselada`, e a do
  jogador ganhou cantoneiras. Continua SEM brilho (regra do dono: forma e metal). `tomDe` tolera `rgba()`.
  Provas: `foto_molduras` 12/12, `foto_moldura_arena` 17/17.

- **As folhas de efeito do Blender** (`tools/fx_blender.py` → `tools/embute_fx_blender.py` →
  `assets/embedded/fx-blender.js`, 332 KB). Sete folhas de 4×4 quadros a 192 px, renderizadas no Cycles (CPU,
  ~30 s cada) a partir de GEOMETRIA EMISSIVA animada por keyframe — nada de partículas nem simulação, o render
  é determinístico: **golpe** (a lâmina curva que varre), **impacto** (clarão, lascas radiais e anel),
  **rachadura** (o chão rachando, folha de chão), **raio** (o relâmpago que desce, ramifica e pisca), **jato**
  (a coluna d'água com gotas e o anel na base), **pilar** (a coluna de luz com faíscas subindo) e **selo** (o
  círculo de runas que gira, folha de chão). São BRANCAS (`<tipo>:branco`): `filme()` as tinge com a cor do
  elemento puxada para o branco (`corBranca`) — sete folhas em vez de trinta e cinco; `o.cor` força uma cor,
  `espelho` vira a folha de lado e `alt` estica a altura. `FILME_FAM` virou uma LISTA de filmes por família,
  com atraso (`'hit'` = o tempo do golpe chegar): o corte toca a lâmina no tempo do acerto, de um lado ou do
  outro, girada ao acaso; o terremoto racha o chão; a cura e a invocação sobem um pilar; a armadilha e a
  maldição assentam um selo; o estouro e o meteoro ganham o impacto; a flecha, a bola, a investida e os pingos
  da chuva estouram um impacto onde acertam; o AR traz o raio em todo tiro, feixe, anel e chuva; a ÁGUA, o jato
  em toda onda, anel e estouro. O teto de filmes subiu de 14 para 24.
  *Armadilha (medida em `tests/fx_sala.html?efeito=cast`):* a folha que ainda não abriu virava um QUADRADO da
  cor do elemento do tamanho do filme — `animTexture` cria a imagem na primeira vez que o tipo é pedido e ela
  decodifica depois, e o three desenha o plano com o mapa vazio. Duas defesas: `FX.preparaFilmes()` pede as
  sete folhas no primeiro evento do FX, e todo filme nasce invisível até a imagem da folha estar completa
  (`imagemPronta`, conferida a cada quadro). Como renderizar de novo: o comando está no topo de
  `tools/fx_blender.py` (Blender 5.2, `--background`); o Blender 5.2 não tem mais `Action.fcurves` — a
  interpolação linear vem da preferência `keyframe_new_interpolation_type`, e as máscaras radiais são medidas
  no UV (em coordenadas de objeto a gota saía quadrada).
  Provas: `fx_filme` 8/8 (com o teto novo), `efeitos_um_a_um` 7/7 com 213 feitiços (a página descia sem
  `{ direto: true }` desde a antessala e passava VAZIA, "0 de 0 · sem sala" — consertada), e as fotos de
  `tests/fx_sala.html?efeito=cast&spell=<id>&espera=<ms>&frames=<n>` (um lance de verdade, com os filmes que
  esperam o golpe em tempo real).

- **De quebra:** `vendor/capacitor/local-notifications.js` não existia (o `js/core/notificacoes.js` de 08/10
  o carrega; no aplicativo era 404 e os avisos locais ficavam calados) — entrou o dist do
  `@capacitor/local-notifications` 8.3.1; FALTA DO DONO `npm install` + `npx cap sync` e um AAB novo para a
  parte nativa. E as réguas envelhecidas: `art_gallery` (7 classes, 8 pedras, 91 itens, o 6º pet no 2D de
  reserva) e `icones_extras` (15 ícones).

## 9-A.31 Os efeitos do gênero: sete folhas, quatro famílias, a órbita e a matéria de cada elemento (15/10)

O dono: "gostaria que estivesse com mais efeitos principalmente nas skills e cada uma com uma característica…
os efeitos estão muito parecidos… gosto dos efeitos de jogos como o Laghaim". Não há cliente do Laghaim na
máquina para abrir, então o levantamento foi por referência: o que esse gênero (Laghaim, MU, Lineage, os
MMORPGs coreanos de 2000–2006) faz nas skills e o jogo não fazia, medido contra o inventário real do
`fx3d_v2.js` (21 famílias, 7 folhas do Blender, 4 do CGHEVEN, 5 do acervo, 16 placas, 16 tiles). Nada de regra
de jogo mudou (a `VERSAO_REGRAS` segue 10).

**O que o gênero tem e faltava — e o que entrou por cada um:**

| no gênero | o que o jogo fazia | o que entrou (15/10) |
|---|---|---|
| a **dupla hélice** que sobe em volta de quem recebe o bônus | a aura era o halo + três anéis fechando + um pilar | a folha `helice` (três fases da trança que se revezam a cada dois quadros, e o olho lê girando) no lugar do pilar da aura, e menor no escudo |
| os **anéis empilhados** subindo pelo corpo | nada | `shockRing` ganhou altura e subida (`y`, `vy`): a aura sobe três anéis fechando, um atrás do outro |
| os **orbes em órbita** com rastro | só o Invocador tinha espíritos lançados em círculo (`burst` + velocidade tangencial) | o **EMISSOR por quadro** (`emissor(dur, fn)`, teto 40) e a `orbita()`: a partícula nasce ONDE a espiral está agora, cada quadro, e o rastro curto desenha a órbita — a aura sobe três orbes, o escudo fecha três (`fecha`), o ciclone gira quatro cortes na cintura |
| **cristais/espinhos** brotando do chão | `slabSpike`, `spikeField`, `menhir`, `stoneRoots` caíam no terremoto (cascalho + rachadura) | a família **espinhos** (`/spike|menhir(?!shot|volley)|roots?$|thorn/`): a folha `cristais` (sete lascas em leque, clarão na base, lascas voando) com a base no chão, a coluna de cascalho que acende inteira, o detrito, o impacto |
| o **redemoinho** visto de cima que SUGA | `theMaelstrom`, `siphon`, `hungryPool`, `undertowMaw` eram o anel da nova (que abre) | a família **vortice**: a folha `redemoinho` (três braços em espiral girando, 320° em 16 quadros, o olho acende no fim) no chão, o anel que FECHA, o aro girando ao contrário e o emissor que faz as partículas nascerem na borda e correrem para dentro; depois o que foi sugado sobe pelo meio |
| as **correntes** que prendem | o gancho tinha o fio, as garras e o fio de volta; `rootShackle` era terremoto | a folha `correntes` (dois cordões de elos de frente/de lado alternados que nascem elo a elo, apertam e acendem; a algema no centro) no gancho; `/shackle|grapple|hook|tug/` entrou cedo nas regras (`rootShackle`, `tideTug` viraram gancho) |
| o **golpe triplo** cruzado | `sevenFlameCuts`, `thousandWindCuts`, `chainSlash` eram UMA meia-lua | a família **cortes** (`/cuts$|chainslash|flurry/`): a folha `cortes` (três lâminas em ângulos cruzados, uma atrás da outra) e três meias-luas a 130 ms, cada uma com o seu arco de partículas; as faíscas da preparação sobem em coluna do alvo antes |
| as **lâminas girando** em volta do guerreiro | `axeCyclone` era anel, `ironTyphoon` era cone | a família **ciclone** (`/cyclone|typhoon/`): a folha `laminas` (quatro gumes de machado presos a um aro, uma volta e meia) NO CHÃO DE QUEM ATACA, a órbita de cortes na cintura, e o alvo leva a lâmina no tempo do golpe |
| a **coluna de trovão** grossa com clarão na base | o `raio` fino (zigue-zague) em tiro, feixe, anel e chuva | a folha `trovao` (coluna com dois cotovelos que pisca três vezes, o clarão achatado e as lascas na base): o AR a traz nos grandes — anel, estouro, meteoro, terremoto, investida, cruz; o raio fino segue no tiro e no feixe |
| o **feixe vertical** do teleporte | o piscar era a estrela que some e a que nasce | o pilar de luz no sumiço (em `piscar()`) e na chegada (`FILME_FAM`) |
| a **matéria de cada elemento** | só o ar (raio) e a água (jato) tinham a sua; fogo e terra eram só cor | o FOGO traz a labareda (`chama`, do acervo) no corte, no triplo, no estouro, na investida, no meteoro e no ciclone; a TERRA, os cristais no terremoto, na investida, no estouro, no meteoro e no corte |

**As sete folhas** (`tools/fx_blender.py`, as funções `helice`, `cristais`, `redemoinho`, `correntes`, `cortes`,
`laminas`, `trovao`; `tools/embute_fx_blender.py` com os catorze tipos; `assets/embedded/fx-blender.js`, 332 →
684 KB) seguem a regra de 12/10: geometria emissiva branca, keyframe, Cycles CPU, 16 quadros a 256 px descidos
a 192, `tipo:branco` tingido pelo elemento em `filme()`. As catorze foram renderizadas de novo (o roteiro gera
todas; ~20 s por folha em prioridade baixa). Medido na folha de contato: os elos da corrente a 0,085 de raio
saíam miúdos num quadro de 2 — subiram a 0,125 com 9 elos por cordão.

**O que mudou no motor** (`js/render3d/fx3d_v2.js`):
- `REGRAS_FX`: as quatro famílias ANTES de quem as engolia (cortes e gancho logo depois do meteoro; ciclone,
  vortice e espinhos depois da armadilha — as armadilhas de vórtice seguem armadilha). De quebra, três buracos
  que já existiam: `warCry` (o Grito de Guerra, um bônus) caía na BOLA — `cry|roar|shout|howl` entrou na aura;
  `emberBurst` caía na bola (`/^burst$/`) — virou `/burst|explod/`; cercas, muralhas, dique, fundação,
  labirinto e bigorna (`fireFence`, `flyingFence`, `rampart`, `dike`, `foundation`, `labyrinth`, `livingAnvil`)
  caíam na bola — entraram no terremoto; `lightWard` no escudo. A bola ficou com 8 dos 219 (eram 17).
- `FILME_FAM` ganhou as quatro famílias e a opção `alto` por filme (a altura do centro de um filme de pé: a base
  da folha de cristais e do trovão está em −0,78 do quadro, e `altoDaBase(tam, alt)` = 0,05 + 0,39 × tam × alt
  põe a base no chão — sem isso metade do cristal ficava enterrada e o teste de profundidade a escondia).
- `filmesDaFamilia`: a matéria por elemento (fogo e terra, além do ar e da água de 12/10), com o atraso do
  golpe (`hd`) quando a família espera o acerto.
- `emissor`/`updateEmissores`/`orbita` (`FX.orbita` exposto), chamados antes das partículas no `FX.update`;
  `FX.reset` zera; `FX.stats().emissores`.
- `shockRing(pos, cor, r0, r1, dur, y, vy)`.
- `js/audio.js`: `cortes` e `ciclone` soam como golpe, `espinhos` como fogo (o grupo do terremoto), `vortice`
  como magia; `tests/som.html` cobra as 25.

**A armadilha da prova** (`tests/efeitos_um_a_um.html`, "famílias diferentes produzem desenhos diferentes"): a
assinatura de cada família é medida no quadro de MAIS partículas, que é sempre o da conjuração (a carga na mão
+ o que a família solta na hora), e os `setTimeout` do acerto são em tempo real — numa prova que bombeia 18
quadros em ~70 ms eles nem disparam. As quatro famílias novas saíam IGUAIS às velhas (o triplo = o corte, os
espinhos = a armadilha) e a régua caiu de 15/25 para 13–14/25. O conserto foi dar a cada uma o que é dela NO
PRIMEIRO QUADRO: as faíscas da preparação do triplo já nascem em coluna (3 de altura), a coluna de cristal
acende inteira (3), e os anéis do ciclone e do vórtice duram mais que a janela da prova (1,0 e 1,1 s), para a
peça "anel" não oscilar. Três rodadas seguidas verdes. Vale para a próxima família: o que ela tem de próprio
precisa existir na hora da conjuração, não só depois do golpe.

**O que o gênero ainda tem e ficou de fora** (decisão de orçamento, não de arte): a imagem-fantasma da
investida (clonar a `SkinnedMesh` no meio do clipe é caro e frágil), as asas de luz da cura, a mão do breu
subindo do chão na maldição, as linhas de velocidade na tela nos golpes grandes. Todas cabem no mesmo roteiro
do Blender ou num emissor; o julgamento das catorze no tabuleiro de verdade é do dono.

## 9-B. O balcão de vinténs (07/10)

O dono: "quero que o jogador comum tenha direito a crescer igual quem paga". O vintém das diárias e
das salas comprava pouco — poção, e barras a 80 por 1 (a Reescrita da loja, 250 barras, ficava a
20.000 vinténs). O mercador passou a vender, **só por vintém**, na aba das poções do Mercadinho
(`js/core/mercado.js`, `M.BALCAO`):

| o quê | preço | a trava |
|---|---|---|
| **Pergaminho da Reescrita** | 8.000 vinténs | um a cada **30 dias** (a mesma janela da loja: "um caminho por mês" é desenho, não preço) |
| **Pedras do dia** — 10 pedras do elemento do **chefe** do Calabouço do Dia | 1.500 vinténs | **um lote por dia** (o dia de Brasília) |

As travas moram no `Progress.state.balcao` (`reescritaEm` em segundos do relógio do servidor;
`pedrasDia` em AAAAMMDD) e entram no hash da economia; o relógio é o do **servidor**
(`JOGO.Agenda.agora`; no juiz, o instante do pedido — a op não aceita relógio do cliente). Paga com os
vinténs do saco, tudo ou nada, como a banca das poções; com a autoridade ligada a mesma função roda
no juiz (ops `comprarReescrita` e `comprarPedrasDoDia`). O lote de pedras fica abaixo do preço da loja
(25–40 barras = 2.000–3.200 vinténs) só porque é um lote, de um elemento, por dia: quem farma chega às
pedras; quem paga adianta. Prova: `node tests/juiz_balcao.js` (18).

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
Mestre (`js/ui/painel_mestre.js`). Desde 03/10 ele é o painel **único** do Mestre
(tecla M, F9 ou Ctrl+Alt+M, e os botões ⚔): a Caixa (peça com estrelas, forja e
quantidade, conjunto, bicho, pedras, selos, insígnias, cartas, pergaminhos e
bônus de XP — para o próprio Mestre ou para QUALQUER jogador, pelo servidor, com
aviso "O Mestre te enviou …" e carta da Equipe), moedas, contas, denúncias,
banimentos, auditoria, os eventos do mundo e o grimório — a regra disso mora no
servidor (`docs/SEGURANCA.md` §10.5).

---

## 11. O que está aberto

| assunto | estado |
|---|---|
| **Equilíbrio** | classes, caminhos, fusões e duelos medidos — ver `docs/EQUILIBRIO.md` (03/10, as duas decisões do dono de §6 de lá: o muro do Minotauro fere quem encosta, e a paridade da Arena caiu de 5 para 3 níveis) |
| **Efeitos** | 25 famílias, placas, filmes do Blender e órbitas ligados; falta julgar no tamanho real do tabuleiro |
| **Fogo na arma** | proposto, depende do resultado das placas |
| **Nomes das classes** | confirmados pelo dono — ficam como estão |
| **Elenco chibi** | decidido: **fica KayKit**, pela coerência com o cenário |
