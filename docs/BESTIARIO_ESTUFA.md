# BESTIÁRIO DE GERAÇÃO — A Estufa Soterrada

Primeira família de monstros do elenco **gerado**. Nove fichas: sete da **Flora
Voraz** e duas do **Enxame da Estufa**, as duas famílias do calabouço
`greenhouse`.

**De onde veio cada coisa.** Nome, id, elemento, família, chefe, invocado,
descrição e feitiços saíram de
`unity/SOTERRA-Tatico/Assets/Resources/dados/monsters.json` e
`monsterSpells.json`. A composição das salas saiu de `dungeons.json`. As cores
de elemento saíram de `elementInfo.json`; a paleta do calabouço, de
`dungeons.json`. Altura e largura vêm das regras de `FICHA_GERACAO_ELENCO.md` —
**`monsters.json` não tem campo de tamanho**, e onde o dado só dá uma medida
literária ("do tamanho de um cão") a ficha diz isso e não converte para metros.

Nada aqui é lembrança. O que não estava no dado está marcado **não informado**.

---

## 1. O que está sendo corrigido

`docs/CREDITS_3D.md` registra a aproximação, com todas as letras:

> a Flora Voraz (plantas carnívoras) usa serpente/aranha/sapo tingidos de verde
> — é o que existe em CC0 no mesmo estilo; um pacote de plantas animadas
> resolveria melhor

O mapa de aparências antigo (`M.MONSTER_LOOK`, em `js/render3d/models3d_v2.js`)
mostra o tamanho do problema por id:

| monstro | o que ele era | o que ele é no dado |
|---|---|---|
| Vergasta | `q_snake` — uma cobra | um chicote vegetal num vaso rachado |
| Bufo-de-Pólen | `q_frog` — um sapo | uma bola de pólen com perninhas de graveto |
| Carrapicho-Mãe | `q_spider` — uma aranha | um novelo de farpas |
| Seiveiro | `skeleton_mage` — um **esqueleto humano** com cajado | um toco de árvore com caldeirão |
| Brotinho-Voraz | `q_frog` — o mesmo sapo, 0,78× | uma muda germinada |
| Carrapichinho | `q_spider` — a mesma aranha, 0,58× | metade de um novelo de farpas |
| A Jardineira-Viúva | `q_mushnub`, e antes disso um veado pálido | treliça, véu de viúva e tesoura de poda |
| Vespa-Lustre | `q_wasp` — uma vespa | uma vespa |
| Aranha-de-Orvalho | `q_spider` — uma aranha | uma aranha |

Três coisas saem daí, e todas as três são consertadas nesta ficha:

**1. A Flora Voraz não era planta.** Sete monstros descritos como vegetais eram
bicho pintado de verde. Agora que a imagem é gerada, a desculpa acabou: **nenhum
dos sete tem cabeça de animal, tronco de animal, pata de animal ou coluna
vertebral.** Onde o dado pede olhos (Carrapicho-Mãe tem "dezenas de olhinhos
pretos"), os olhos são sementes escuras entre espinhos, não olhos de bicho.

**2. Havia três aranhas no mesmo tabuleiro.** `burr-mother`, `burrlet` e
`dew-strider` eram todos `q_spider`, separados só por escala (1,05 · 0,58 ·
0,85). Na sala **Os Canteiros Afundados** a Carrapicho-Mãe e a Aranha-de-Orvalho
lutam juntas; quando a mãe morre, ela vira mais dois carrapichinhos — três
aranhas de tamanhos parecidos na mesma tela. Era impossível saber em quem se
estava clicando. É exatamente o defeito que a seção 3 desta ficha existe para
não repetir.

**3. O Enxame da Estufa nunca errou.** Vespa era vespa, aranha era aranha. As
duas fichas do Enxame não corrigem conceito — corrigem só a **separação**: agora
que a Flora Voraz deixa de ser bicho, a sala passa a ler *planta contra
artrópode* em vez de *animal verde contra animal verde*, e as duas famílias
finalmente se distinguem no tabuleiro sem precisar da barra de vida.

A Jardineira-Viúva ganha uma quarta correção, de porte: como chefe, ela era um
modelo com altura-alvo de 2,95 m (`CREDITS_3D.md`), abaixo do teto de
personagem, que é 4,76 m. `SISTEMAS.md` §6 já mandou consertar isso — chefe fica
entre 5,16 e 5,46 m. Esta ficha gera nesse porte.

---

## 2. As regras de geração, aplicadas a plantas e bichos

As cinco regras de `FICHA_GERACAO_ELENCO.md` valem inteiras — uma figura por
imagem, T-pose, avulsos ao lado, nada grande já aberto, textura com UV. Duas
precisam de tradução para este elenco, e a tradução está aqui para não ser
reinventada monstro a monstro:

**T-pose em coisa sem braço.** A regra existe por causa do esqueleto: braços
abertos deixam o osso do ombro visível e a envergadura confere a escala. Bola de
pólen, novelo de farpas e toco de árvore não têm ombro. O equivalente é **pose
de descanso simétrica**: eixo do corpo vertical, apêndices (perninhas, pernas de
aranha, asas, cipós) abertos para os lados no mesmo ângulo dos dois lados, nada
cruzado, nada encostando em nada. Simetria é o que o rigger precisa; T-pose era
só a forma humana dela.

**A largura é consequência da altura.** Num T-pose correto a envergadura mede o
mesmo que a altura — 1,80 m de altura dá 1,80 célula de largura, dentro do teto
de ~2,0. O paladino estourou para 3,07 células porque as **asas** abriram mais
que o corpo. Regra da Estufa, então: **nenhum apêndice aberto pode passar da
altura da figura.** Isso morde três monstros de propósito — as pernas da
Aranha-de-Orvalho, os cipós laterais da Vergasta e a tesoura da Jardineira.

Para a Jardineira a conta é mais apertada ainda: 5,16 m de altura contra teto de
3,7 células de largura. A envergadura dela tem de ser **menor** que a altura. Por
isso, na ficha dela, véu e tesouras **caem**, não se abrem.

### Cor: o elemento é emissivo, não é tinta de corpo

`CREDITS_3D.md` fixa a regra para as classes e ela vale aqui: *"o elemento
escolhido entra como emissivo, não como cor de corpo"*.

Na Estufa isso deixa de ser preferência e vira necessidade de leitura. O chão do
calabouço é `#35513a` / `#3d5c41` — verde-escuro. O elemento terra é `#9bd06a` —
verde-limão. **Uma planta verde inteira sobre um chão verde some.** Então: corpo
em madeira, casca, fibra e folha seca (marrons, oliva morta, palha), e o verde
elemental só como **brilho** em seiva, brotos novos, rachaduras e nervuras.

| elemento | cor (`elementInfo.json`) | onde ela aparece nestes monstros |
|---|---|---|
| `terra` | `#9bd06a` verde-limão | seiva nova, broto, nervura de folha, fresta de vaso |
| `agua` | `#57c8ec` azul-claro | gota, orvalho, vapor de caldeirão, filme d'água |
| `ar` | `#c8b6ff` lilás | luz presa no vidro, poeira suspensa, rastro de asa |

Paleta do calabouço, para casar sem brigar: primária `#5a8f4d`, secundária
`#8a6b3e`, acento `#ffd76b` (a luz dos vagalumes em redoma), parede `#57452f`.

---

## 3. O mapa de silhuetas — o que separa cada um dos irmãos

Esta é a seção que vale mais que qualquer parágrafo bonito. Os monstros de uma
família aparecem juntos; se dois viram a mesma mancha, o jogador erra o clique.

### Quem divide o tabuleiro com quem (`dungeons.json`)

| sala | quem está lá |
|---|---|
| 1 — O Vestíbulo das Heras | Bufo-de-Pólen · Vergasta · Vespa-Lustre |
| 2 — Os Canteiros Afundados | Vergasta · Seiveiro · Carrapicho-Mãe · Aranha-de-Orvalho **+ Carrapichinho** (quando a mãe morre) |
| 3 — O Coreto da Viúva | A Jardineira-Viúva · Seiveiro · Aranha-de-Orvalho **+ Brotinho-Voraz** (semeado por ela) |

Duas folgas que o roteiro das salas dá de graça, e que valem ser sabidas: **as
duas bolas nunca se encontram** (Bufo-de-Pólen só na sala 1, Carrapicho-Mãe só
na sala 2) e **os dois artrópodes nunca se encontram** (Vespa na 1,
Aranha-de-Orvalho na 2 e 3). Mesmo assim as quatro fichas se separam, porque
elas convivem lado a lado na tela de bestiário e porque folga de roteiro não é
contrato — quem editar uma sala amanhã não vai reler isto.

### A marca de cada um, em uma linha

| monstro | a marca que o separa | mancha a 40 px |
|---|---|---|
| **Vergasta** | vaso na base + haste **única** que sobe e verga no topo | um cajado / bengala plantada |
| **Bufo-de-Pólen** | esfera **lisa** erguida sobre duas perninhas-graveto | pirulito: bola no ar com dois fios |
| **Carrapicho-Mãe** | esfera **serrilhada** apoiada no chão, sem apêndice nenhum | ouriço: contorno cheio de picos |
| **Carrapichinho** | mesma bola de espinhos, mas **desfiada** — fios soltos saindo do contorno | ouriço peludo, borda mole |
| **Seiveiro** | massa baixa e **larga**, mais deitada que em pé, com boca de caldeirão vazada no meio | trapézio com um buraco brilhante |
| **Brotinho-Voraz** | par de folhas erguidas como mandíbulas abertas em V | um V vertical, sem massa |
| **A Jardineira-Viúva** | **vazada**: dá para ver o chão através do tronco de treliça | torre estreita e furada, o dobro da altura de todo mundo |
| **Vespa-Lustre** | **não toca o chão** — a única figura com vão entre corpo e sombra | ponto aceso no ar |
| **Aranha-de-Orvalho** | quase toda **vazia** — corpo mínimo no meio de um vão largo de pernas-fio | asterisco / X |

### Os quatro pares de risco, resolvidos

1. **Bufo-de-Pólen × Carrapicho-Mãe** — as duas bolas. Separadas por **contorno e
   contato**: Bufo é liso, amarelo e está **erguido** do chão por perninhas;
   Carrapicho é serrilhado, marrom e **encosta** no chão. Contorno liso contra
   contorno picotado é a diferença que sobrevive a 40 px; a cor é só o reforço.
2. **Carrapicho-Mãe × Carrapichinho** — mãe e filho, iguais por desenho de
   sistema (`split`). Separados pelo **acabamento da borda**, não pelo tamanho:
   a mãe é um novelo **apertado**, o filho é um novelo **desfiado**, com fibras
   soltas passando do contorno. Isso é deliberado — escala é aplicada na
   importação e o jogador não tem régua na tela; borda dura contra borda mole,
   ele tem.
3. **Vespa-Lustre × Aranha-de-Orvalho** — os dois bichos pequenos e brilhantes.
   Separados por **massa e chão**: a Vespa é compacta, acesa em lilás e **voa**;
   a Aranha é rala, azul e **anda**, ocupando largura sem ocupar volume. Blob
   contra asterisco.
4. **Vergasta × Seiveiro** — as duas plantas paradas que atiram e curam na mesma
   sala. Separadas por **eixo**: a Vergasta é **vertical** (haste alta e fina, um
   traço); o Seiveiro é **horizontal** (corcunda baixa e larga, uma pilha). Alto e
   magro contra baixo e gordo, do outro lado da sala, sem cor nenhuma.

---

## 4. Fichas — Flora Voraz

**A Estufa Soterrada** (`greenhouse`) · clima padrão `chuva` · 7 monstros ·
elementos no dado: `terra` (6) e `agua` (1)

---

### 4.1 Vergasta — `thorn-lasher`

- **Família** Flora Voraz · **Elemento** `terra` (`#9bd06a`)
- **Chefe** não · **Invocado apenas** não · **IA** `ranged` · **Traço**
  `pushImmune` — o dado diz que ela é imune a empurrão, e a arte tem de mostrar
  por quê: ela está **enraizada**
- **Altura de geração** 1,80 m · **Largura** até 2,0 células
- **Escala no dado** não informada
- **Feitiços** Farpa (`m-thorn-shot`, terra, alcance 2–6) · Raiz-Trava
  (`m-root-grip`, terra, alcance 1–4, prende 1 turno)

> Um chicote vegetal enraizado num vaso rachado, coberto de farpas e flores mortas. Não sai do lugar — não precisa.

**Direção visual.** É a única figura da sala que se lê como uma **linha**. Uma
haste grossa sai de um vaso de barro rachado, sobe reta e verga no último terço
como cajado de pastor — a curva do topo é a marca, porque é o gesto de chicote
parado. Sem rosto, sem olhos, sem cabeça: o dado não dá nenhum, e dar um a
transformaria em bicho outra vez. O corpo é fibra lenhosa marrom-escura com
farpas curvas pretas em toda a extensão e flores mortas penduradas, cinza e
papel — flor **morta**, não flor viva, porque o vaso rachado e a flor seca são o
que conta que essa coisa foi jardim antes de ser monstro. O verde-limão do
elemento entra só nas frestas do vaso e nas farpas mais novas, brilhando de
dentro. A 40 px o jogador precisa ver **um traço vertical com base pesada**: se
enxergar a base, sabe que essa é a que não anda, e é essa informação que vale o
turno dele. A raiz visível saindo do vaso e agarrando o chão é o desenho de
`pushImmune` e de Raiz-Trava ao mesmo tempo. **Não pode ser confundida com o
Seiveiro**, que divide a sala 2 com ela: o Seiveiro é baixo, largo e corcunda; a
Vergasta é alta, fina e reta. Se as duas ficarem com a mesma massa no meio da
imagem, a ficha falhou.

**Prompt:**

> A single carnivorous plant creature, one figure only, centered, isolated on a
> plain pure white background. A thick woody barbed vine-whip 1.8 meters tall,
> rooted inside a cracked terracotta pot that forms its base; it has no legs and
> never leaves the pot. The stalk rises straight and vertical, then curves over
> in its top third like a shepherd's crook. Hooked black thorns run its entire
> length; dead dried flowers in grey and paper-brown hang from it. Two shorter
> barbed runners reach straight out sideways from just above the pot, held level
> and symmetrical like open arms, so the total spread is slightly less than the
> total height. Thick roots spill over the rim of the pot and grip the base.
> Absolutely no animal parts: no face, no eyes, no head, no snake body, no
> scales, no spine. Full body from the bottom of the pot to the tip of the
> stalk, front view, perfectly symmetrical neutral rest pose, T-shaped spread,
> even lighting from above, no cast shadow, no ground plane, no scenery, no
> frame, no text, no other figures. Beside the figure, separated on the same
> white background and not touching it: the cracked terracotta pot alone, and
> one detached barbed runner alone. Dark bark-brown and dead-olive body; the
> only bright color is a thin lime-green glow (#9bd06a) inside the pot cracks
> and along the newest thorns. UV unwrapped with 4096x4096 PBR texture maps.

---

### 4.2 Bufo-de-Pólen — `pollen-puff`

- **Família** Flora Voraz · **Elemento** `terra` (`#9bd06a`)
- **Chefe** não · **Invocado apenas** não · **IA** `melee` · **Traço**
  `explodeOnDeath` (terra, 18 de dano, raio 1) — ele **estoura**, e o desenho tem
  de prometer isso antes de acontecer
- **Altura de geração** 1,80 m · **Largura** até 2,0 células
- **Escala no dado** não informada
- **Feitiço** Mordiscada (`m-pollen-bite`, terra, corpo a corpo)

> Uma bola de pólen amarelo com perninhas de graveto e um sorriso costurado. Anda na sua direção balançando. Isso deveria ser um aviso.

**Direção visual.** Uma esfera quase perfeita de pólen compactado, amarela e
felpuda, equilibrada em duas perninhas de graveto **finas demais** para ela — a
desproporção é a piada e é a silhueta. A bola é **lisa** no contorno: felpa
curta e uniforme, nada de espinho, nada de ponta, porque o contorno liso é o
único jeito de não virar o Carrapicho-Mãe. O sorriso é **costurado**, literal:
uma linha grossa escura em pontos cruzados atravessando a bola, sem lábio e sem
dente — a boca de um brinquedo remendado, não a boca de um bicho. Sem olhos; o
sorriso sozinho é mais perturbador e é o que o dado dá. Amarelo aqui é cor de
corpo e não de elemento, e é o único amarelo grande do calabouço fora do acento
`#ffd76b` dos vagalumes — então ele **destaca** contra o chão verde-escuro, que é
justamente o que se quer de um monstro que você precisa matar longe. O
verde-limão elemental fica na poeira de esporo que escapa da superfície. A 40 px:
**bola clara no ar com dois fios embaixo** — o vão entre a bola e o chão é a
marca, porque é ele que diz "isso anda". **Não pode ser confundido com o
Carrapicho-Mãe** (contorno liso × contorno serrilhado, erguido × apoiado) nem
com o Brotinho-Voraz (massa cheia × V vazado).

**Prompt:**

> A single plant creature, one figure only, centered, isolated on a plain pure
> white background. A near-perfect sphere of packed yellow pollen, 1.8 meters
> tall overall, with a soft short even fuzz so its outline reads completely
> smooth and round — no spikes, no burrs, no spines anywhere. The sphere is
> balanced on two thin bare twig legs, comically too thin for it, ending in tiny
> forked twig feet, so the body is clearly lifted off the ground. A wide grin is
> stitched across the sphere in thick dark cross-stitch thread, like a mended
> cloth toy: no lips, no teeth, no tongue. No eyes at all. No animal parts: no
> frog, no toad, no legs with muscle, no skin. Full body head to feet, front
> view, perfectly symmetrical neutral rest pose, two short twig arms held
> straight out to the sides in a T shape, even lighting from above, no cast
> shadow, no ground plane, no scenery, no frame, no text, no other figures.
> Beside the figure, separated on the same white background and not touching it:
> one detached twig leg alone, and a small loose puff of pollen dust alone. Warm
> saturated yellow body, grey-brown twigs, dark brown stitching; a faint
> lime-green (#9bd06a) glow in the pollen dust escaping the surface. UV
> unwrapped with 4096x4096 PBR texture maps.

---

### 4.3 Carrapicho-Mãe — `burr-mother`

- **Família** Flora Voraz · **Elemento** `terra` (`#9bd06a`)
- **Chefe** não · **Invocado apenas** não · **IA** `melee` · **Traço** `split` →
  2 × `burrlet`
- **Altura de geração** 1,80 m · **Largura** até 2,0 células
- **Escala no dado** "do tamanho de um cão" (medida em metros **não informada**)
- **Feitiço** Abraço Farpado (`m-burr-hug`, terra, corpo a corpo)

> Um novelo de farpas do tamanho de um cão, com dezenas de olhinhos pretos entre os espinhos. Ao morrer, desfia-se em dois novelos menores e igualmente rancorosos.

**Direção visual.** Um novelo **apertado**: fibras vegetais secas enroladas umas
nas outras até virar uma bola densa, eriçada de espinhos ganchudos em todas as
direções. O contorno é o produto — serrilhado, agressivo, sem uma curva limpa em
lugar nenhum. Ela **encosta no chão**, sem pernas e sem apêndice de andar, e se
move rolando; a base ligeiramente achatada onde o peso apoia é o que a separa do
Bufo-de-Pólen à distância. Os "dezenas de olhinhos pretos entre os espinhos" do
dado são **sementes pretas e lustrosas** afundadas entre as fibras, espalhadas
sem simetria de rosto — não são olhos de aranha, não formam par, não formam
arco. Essa é a linha que não se cruza: bicho tem olhos arrumados em cara, planta
tem sementes espalhadas. Cor de corpo em marrom-carrapicho e palha; o
verde-limão só nas fibras mais novas, ainda vivas, no fundo do novelo. A 40 px:
**um ouriço marrom colado no chão**. **Não pode ser confundido com o
Bufo-de-Pólen** (que é liso e erguido) nem com a **Aranha-de-Orvalho**, com quem
ela realmente divide a sala 2: a aranha é vazada e ocupa largura sem massa, o
carrapicho é massa maciça sem largura. Este é o par que o acervo antigo
literalmente empatava — os dois eram `q_spider`.

**Prompt:**

> A single plant creature, one figure only, centered, isolated on a plain pure
> white background. A tight dense ball of dried tangled plant fiber, about 1.8
> meters across, bristling everywhere with hooked barbed burr spines so its
> outline is completely jagged and serrated with no smooth curve anywhere. It
> has no legs and no limbs; it rests directly on the ground with a slightly
> flattened underside where its weight sits. Dozens of small glossy black seeds
> are sunk between the fibers, scattered irregularly across the whole surface —
> they are seeds, not eyes: they are not paired, not arranged into a face, and
> form no symmetry. Absolutely no animal parts: no spider, no legs, no
> abdomen, no mandibles, no fur. Full body, front view, perfectly symmetrical
> radial rest pose, even lighting from above, no cast shadow, no ground plane,
> no scenery, no frame, no text, no other figures. Beside the figure, separated
> on the same white background and not touching it: one detached barbed burr
> spine alone, and a loose knot of dried fiber alone. Burr-brown, straw and dead
> ochre body; a faint lime-green (#9bd06a) glow only on the few still-living
> fibers deep inside the tangle. UV unwrapped with 4096x4096 PBR texture maps.

---

### 4.4 Seiveiro — `sap-shaman`

- **Família** Flora Voraz · **Elemento** `agua` (`#57c8ec`)
- **Chefe** não · **Invocado apenas** não · **IA** `support` · **Traço**
  `regenAura` (8 de cura, raio 2) — ele cura quem está perto, e a arte tem de
  dizer de onde a cura sai
- **Altura de geração** 1,80 m · **Largura** até 2,0 células
- **Escala no dado** não informada
- **Feitiços** Seiva Doce (`m-sap-mend`, agua, cura 12–16, alcance 0–4) · Açúcar
  Bruto (`m-sap-sugar`, agua, +15 de poder por 2 turnos)

> Um toco de árvore corcunda com um rosto entalhado a canivete e um caldeirão de seiva borbulhando no colo. Rega os aliados como quem cuida de um jardim — e o jardim morde.

**Direção visual.** O único da família que se lê **deitado**: uma massa baixa,
larga e corcunda, mais parecida com um monte que com uma figura em pé. Um toco
de árvore grosso, casca rachada, com uma corcunda de raiz nas costas que puxa
todo o volume para cima e para trás — o perfil é um trapézio inclinado. O rosto é
**entalhado a canivete**, e isso é uma instrução de material, não de expressão:
sulcos rasos e tortos cavados na casca, com marca de lâmina visível, olhos que
são dois cortes e boca que é um terceiro. Nada de crânio, nada de mandíbula,
nada de esqueleto — este é o monstro que o acervo antigo transformou num
esqueleto humano de mago, e é o que esta ficha corrige com mais raiva. No colo,
apoiado entre as raízes da frente, um caldeirão de ferro fundo com seiva
fervendo: a **boca do caldeirão é um círculo vazado brilhando no meio da
silhueta**, e é a marca dele. Vapor sobe dali — é o único vapor vertical da sala.
A seiva é âmbar (o feitiço a chama de dourada); o elemento é `agua`, então o azul
`#57c8ec` entra no **vapor** e no filme de chuva escorrendo pela casca, não na
seiva. A 40 px: **um trapézio baixo com um ponto quente no meio e um fio de vapor
subindo**. **Não pode ser confundido com a Vergasta** (vertical e magra × baixo e
largo) nem com **a Jardineira-Viúva**, com quem ele divide a sala 3: ela é o
triplo da altura e é **vazada**; ele é maciço e cabe embaixo do braço dela.

**Prompt:**

> A single plant creature, one figure only, centered, isolated on a plain pure
> white background. A squat hunched tree stump 1.8 meters tall but much wider
> than tall in profile, with thick cracked bark and a heavy root hump swelling
> over its back so the whole shape reads as a low leaning trapezoid, not a
> standing figure. A crude face is whittled into the bark with a pocket knife:
> shallow crooked gouges with visible blade marks, two slits for eyes and one
> for a mouth. Absolutely no skull, no jawbone, no skeleton, no human anatomy,
> no robe, no staff. Cradled in its lap between its front roots sits a deep
> black iron cauldron of boiling amber sap; the open mouth of the cauldron is a
> bright glowing circle in the middle of the silhouette, with steam rising
> straight up from it. Two short thick root arms reach straight out to the sides,
> held level and symmetrical in a T shape. Full body, front view, perfectly
> symmetrical neutral rest pose, even lighting from above, no cast shadow, no
> ground plane, no scenery, no frame, no text, no other figures. Beside the
> figure, separated on the same white background and not touching it: the iron
> cauldron alone, and a wooden ladle alone. Wet dark bark-brown and grey-green
> moss body, amber glowing sap; pale blue (#57c8ec) only in the rising steam and
> in the film of rainwater running down the bark. UV unwrapped with 4096x4096
> PBR texture maps.

---

### 4.5 Brotinho-Voraz — `sprout-feral`

- **Família** Flora Voraz · **Elemento** `terra` (`#9bd06a`)
- **Chefe** não · **Invocado apenas** **sim** — só entra em campo pela
  Semeadura (`m-seed-toss`) da Jardineira, logo só existe na sala 3
- **IA** `melee` · **Traços** nenhum
- **Altura de geração** 1,80 m · **Largura** até 2,0 células
- **Escala no dado** não informada (hp 30, o segundo mais baixo da família)
- **Feitiço** Dentinhos (`m-sprout-bite`, terra, corpo a corpo)

> Uma muda recém-germinada que é só folhas, pressa e dentes. A Jardineira os planta; eles fazem o resto.

**Direção visual.** O mais **vazio** da família e é assim de propósito: ele
aparece em bando, no meio da luta de chefe, e um bando de coisas maciças
esconderia a Jardineira e o anel da Coroa de Espinhos. Duas folhas grandes de
cotilédone erguidas em **V** a partir de um talo único e fino, como mandíbulas
abertas — a silhueta é literalmente a letra V, quase sem miolo. Entre as folhas,
na dobra, uma fileira de dentes de semente branca, pequena e apertada. A casca da
semente ainda está pendurada no talo, meio arrancada: é o detalhe que conta
"germinou agora", que é a única informação que o dado dá sobre ele. Este é o
único monstro da família que pode ser **verde vivo**, porque ele é broto novo e
porque some no chão de propósito só até o primeiro turno — e mesmo assim as
nervuras das folhas brilham em `#9bd06a` para arrancá-lo do fundo. Sem olhos, sem
cara. A 40 px: **um V claro, sem massa, em bando**. **Não pode ser confundido com
o Bufo-de-Pólen** (esfera cheia) nem com nada mais da sala 3 — ele é o único que
aparece em vários exemplares ao mesmo tempo, e a leitura correta é "isso é o
mato, não é o chefe".

**Prompt:**

> A single plant creature, one figure only, centered, isolated on a plain pure
> white background. A freshly germinated seedling 1.8 meters tall: one thin
> single stem carrying two large cotyledon leaves raised in a wide open V, like
> a pair of open jaws, so the whole silhouette reads as a hollow letter V with
> almost no body mass in the middle. A tight row of small white seed-teeth lines
> the inner fold where the two leaves meet. The split seed husk still hangs
> half-torn from the stem near the base. Two tiny leaf arms reach straight out
> to the sides, level and symmetrical in a T shape. No eyes, no face, no animal
> parts, no frog, no limbs with muscle. Full body from root tip to leaf tip,
> front view, perfectly symmetrical neutral rest pose, even lighting from above,
> no cast shadow, no ground plane, no scenery, no frame, no text, no other
> figures. Beside the figure, separated on the same white background and not
> touching it: the split seed husk alone, and one detached cotyledon leaf alone.
> Fresh young green body with pale stem; bright lime-green (#9bd06a) glowing
> along the leaf veins. UV unwrapped with 4096x4096 PBR texture maps.

---

### 4.6 Carrapichinho — `burrlet`

- **Família** Flora Voraz · **Elemento** `terra` (`#9bd06a`)
- **Chefe** não · **Invocado apenas** **sim** — nasce só do `split` da
  Carrapicho-Mãe, dois por morte, logo só existe na sala 2
- **IA** `melee` · **Traços** nenhum
- **Altura de geração** 1,80 m · **Largura** até 2,0 células
- **Escala no dado** não informada. O dado dá "Metade do rancor, o dobro da
  velocidade" — que é sobre temperamento, não sobre tamanho — e hp 22 contra 60
  da mãe. Diferença de porte fica com o `scale` da importação, não com esta
  ficha.
- **Feitiço** Farpinha (`m-burr-nip`, terra, corpo a corpo)

> Metade do rancor, o dobro da velocidade. Gruda e não solta.

**Direção visual.** Ele é a mãe **desfiada**, e essa palavra é do dado: ela "se
desfia em dois novelos menores". Então a diferença não é escala, é
**acabamento** — e isso é uma decisão de direção, tomada de propósito, porque
escala é aplicada na importação e some quando a câmera afasta. Onde a mãe é um
novelo apertado de contorno duro, o filho tem fibras **soltas** saindo do
contorno em todas as direções, pontas de fio que ninguém amarrou, como um nó que
alguém puxou pelo lado errado. A borda dele é **mole e peluda**; a dela é **dura
e picotada**. Espinhos menores e mais escassos, também de propósito: menos
espinho e mais fio. As sementes-olho da mãe aparecem em número muito menor —
duas ou três, não dezenas —, o que é escolha desta ficha e não do dado, e serve
para deixar o filho mais cego e mais burro que a mãe. Cor de corpo igual à dela
(marrom-carrapicho e palha), porque eles precisam ser lidos como **a mesma
coisa** partida ao meio; a informação nova está toda na borda. A 40 px: **ouriço
peludo de contorno mole**, contra o ouriço de contorno duro da mãe.

**Prompt:**

> A single plant creature, one figure only, centered, isolated on a plain pure
> white background. A loose unravelling ball of dried plant fiber, about 1.8
> meters across, the same material and the same colors as a larger tight burr
> but visibly frayed: long loose fiber ends trail out of its outline in every
> direction, like a knot pulled apart from the wrong side, so its silhouette
> reads soft and hairy rather than hard and jagged. Fewer and shorter barbed
> spines than a tight burr. Only two or three small glossy black seeds sunk
> between the fibers, scattered irregularly, not paired and forming no face. It
> has no legs and no limbs and rests directly on the ground. Absolutely no
> animal parts: no spider, no legs, no abdomen, no mandibles. Full body, front
> view, symmetrical radial rest pose, even lighting from above, no cast shadow,
> no ground plane, no scenery, no frame, no text, no other figures. Beside the
> figure, separated on the same white background and not touching it: one loose
> trailing fiber strand alone, and one detached barbed spine alone.
> Burr-brown, straw and dead ochre body; a faint lime-green (#9bd06a) glow deep
> inside the tangle. UV unwrapped with 4096x4096 PBR texture maps.

---

### 4.7 A Jardineira-Viúva — `boss-gardener` **· CHEFE**

- **Família** Flora Voraz · **Elemento** `terra` (`#9bd06a`)
- **Chefe** **sim** (`boss: true`) · **IA** `boss` · **Traços** `pushImmune` e
  `enrage` (a 40% de hp, +30 de poder)
- **Altura de geração** **5,16 a 5,46 m** · **Largura** até **3,7 células** —
  e, como o teto de largura é menor que a altura, **véu e tesouras caem, não se
  abrem** (ver §2)
- **Escala no dado** a descrição diz "um vulto de três metros", o que **não
  bate** com a regra de chefe. Ver §6 — a regra manda, a descrição fica verbatim.
- **Feitiços** Tesourada (`m-shears`, 24–30, alcance 1–2) · Cipó-Fisga
  (`m-vine-hook`, puxa 3 células) · Semeadura (`m-seed-toss`, invoca
  `sprout-feral`) · Coroa de Espinhos (`m-thorn-crown`, **anel** a 2 células:
  castiga o anel e poupa quem está colado nela)

> A guardiã da Estufa: um vulto de três metros feito de treliça, luvas de couro e véu de viúva, com uma tesoura de poda enferrujada no lugar das mãos. Ainda cuida do jardim. Você é a erva daninha.

**Direção visual.** A marca dela não tem par em lugar nenhum do jogo: ela é
**vazada**. O tronco é treliça de jardim — ripas de madeira cruzadas em losango,
com hera subindo por dentro — e **dá para ver o chão do coreto através dela**.
Isso resolve dois problemas ao mesmo tempo: nenhuma outra silhueta do calabouço
tem buraco, e um chefe de 5,4 m opaco taparia metade do tabuleiro numa luta cujo
truque é justamente **onde você está** (a Coroa de Espinhos poupa quem está
colado nela — o jogador precisa enxergar o anel a 2 células **através** dela).
Por cima da treliça, o véu de viúva: renda preta pesada caindo da altura do
ombro até a cintura, cobrindo onde haveria cabeça e não entregando cabeça
nenhuma. As luvas de couro rachado terminam em **tesouras de poda enferrujadas
no lugar das mãos** — as lâminas fechadas, apontando para baixo, coladas ao
corpo, porque abrir a tesoura para os lados estouraria as 3,7 células e porque
uma tesoura fechada é uma promessa mais fria que uma aberta. Cipós farpados
descem do quadril e se arrastam pelo chão: é o desenho de Cipó-Fisga e o de
`pushImmune` juntos. Corpo em madeira cinzenta de treliça, couro marrom rachado,
ferro enferrujado e renda preta — quase sem verde vivo, porque ela **poda** o
jardim, não é o jardim. O verde-limão elemental fica só na hera nova que sobe
pela treliça e nas farpas do cipó. Bolsos do avental carregados de sementes: é a
Semeadura, e o jogador tem de conseguir apontar de onde vieram os brotinhos. A
40 px: **uma torre estreita, escura e furada, com o dobro da altura de tudo em
volta**. **Não pode ser confundida com o Seiveiro**, que está na mesma sala: ele
é maciço, baixo e quente (o caldeirão aceso); ela é vazada, altíssima e fria.

**Prompt:**

> A single boss creature, one figure only, centered, isolated on a plain pure
> white background. A towering gardener figure 5.3 meters tall and no wider than
> 3.5 meters, so it is far taller than it is wide. Its torso and legs are a
> hollow garden trellis: crossed wooden lattice slats in a diamond pattern with
> ivy climbing through the openings, and the background is clearly visible
> straight through the body — the figure is open and see-through, not solid. A
> heavy black lace widow's veil hangs from shoulder height down to the waist,
> covering where a head would be and revealing no head or face at all. Its arms
> end in cracked brown leather gauntlets, and in place of hands are large rusted
> iron pruning shears, blades closed and pointing down, held close against the
> body, not spread outward. Barbed vines hang from its waist and trail on the
> ground. A gardener's apron with pockets full of seeds. Full body head to feet,
> front view, symmetrical neutral rest pose, arms held straight out to the sides
> in a T shape at shoulder height with the shear blades hanging downward, even
> lighting from above, no cast shadow, no ground plane, no scenery, no frame, no
> text, no other figures. Beside the figure, separated on the same white
> background and not touching it: one rusted pruning shear alone, one cracked
> leather gauntlet alone, and the black lace veil alone. Weathered grey trellis
> wood, cracked brown leather, rusted iron, dusty black lace; the only bright
> color is a lime-green glow (#9bd06a) on the young ivy climbing the lattice and
> on the vine barbs. UV unwrapped with 4096x4096 PBR texture maps.

---

## 5. Fichas — Enxame da Estufa

**A Estufa Soterrada** (`greenhouse`) · clima padrão `chuva` · 2 monstros ·
elementos no dado: `ar` (1) e `agua` (1) · **sem chefe próprio** — a família
divide a Jardineira-Viúva com a Flora Voraz

Esta é a família que o acervo antigo **acertou**: vespa era vespa, aranha era
aranha. As duas fichas abaixo não reinventam conceito. Elas fazem outra coisa:
agora que a Flora Voraz virou planta de verdade, o Enxame é o **contraponto de
artrópode** da sala, e as duas famílias precisam ser lidas como duas espécies de
coisa — dura, articulada e brilhante de um lado; fibrosa, mole e fosca do outro.

---

### 5.1 Vespa-Lustre — `lantern-wasp`

- **Família** Enxame da Estufa · **Elemento** `ar` (`#c8b6ff`)
- **Chefe** não · **Invocado apenas** não · **IA** `melee` · **Traços** nenhum
- **Altura de geração** 1,80 m · **Largura** até 2,0 células — as **asas contam**
  na largura, e este é o monstro em que o defeito do paladino (3,07 células por
  causa de asa aberta) volta a rondar. Asa recolhida ao corpo na geração
  (regra 4 de `FICHA_GERACAO_ELENCO.md`: asa aberta não se dobra depois).
- **Escala no dado** "do tamanho de um gato" (medida em metros **não informada**)
- **Feitiço** Ferrão Lustroso (`m-wasp-sting`, ar, corpo a corpo, dano + veneno
  4–6 por 2 turnos)

> Uma vespa do tamanho de um gato cujo abdômen é uma lanterna de vidro com uma luz presa dentro. Rápida, brilhante, venenosa: chega primeiro e vai embora antes da resposta.

**Direção visual.** A marca é a mais barata e a mais eficiente do calabouço:
**ela é a única coisa que não toca o chão**. Corpo suspenso, sombra separada
embaixo — a 40 px o jogador não precisa reconhecer vespa nenhuma, só precisa ver
um vão embaixo do bicho e saber que aquele voa. A segunda marca é o abdômen:
não é um abdômen de vespa listrado, é uma **lanterna de vidro de verdade** —
painéis de vidro com armação de metal, tampa e argola, do tipo que se pendura
num prego — soldada no lugar do abdômen, com uma luz presa se debatendo dentro
dela. A luz é lilás `#c8b6ff`, cor do elemento `ar`, e é a única fonte emissiva
grande do elenco da sala 1; o acento `#ffd76b` dos vagalumes em redoma fica com o
cenário, e a distinção entre "vagalume do cenário" e "vespa que morde" é
exatamente a diferença de cor entre âmbar e lilás. O tórax e a cabeça são secos,
quitinosos e escuros, com ferrão longo e curvo bem visível — dureza articulada,
o contrário da fibra da Flora Voraz. Iniciativa 75 e esquiva 30 são as maiores
da Estufa; a arte devolve isso em corpo pequeno e apertado, sem massa
desperdiçada. **Não pode ser confundida com a Aranha-de-Orvalho** — que nem
divide sala com ela, mas divide a tela do bestiário: a Vespa é uma **mancha
compacta e acesa no ar**, a Aranha é um **asterisco vazio no chão**.

**Prompt:**

> A single insect creature, one figure only, centered, isolated on a plain pure
> white background. A wasp 1.8 meters long, hovering with its body clearly lifted
> and airborne, legs tucked under it and not touching anything. Its abdomen is
> not a wasp abdomen: it is an actual hanging glass lantern — flat glass panes in
> a soldered metal frame, with a lid and a carrying ring on top — fused where the
> abdomen should be, with a small trapped light beating inside the glass. Dry
> dark chitinous thorax and head, large compound eyes, long curved stinger
> clearly visible below the lantern. Wings folded closed and tucked flat against
> the body, not spread open, so the total width stays under the body length.
> Full body, front view, perfectly symmetrical neutral rest pose, legs spread
> evenly and symmetrically to both sides, even lighting from above, no cast
> shadow, no ground plane, no scenery, no frame, no text, no other figures.
> Beside the figure, separated on the same white background and not touching it:
> the glass lantern alone, and one detached wing alone. Dark chitin brown and
> gunmetal body, dirty glass; the light inside the lantern glows pale lilac
> (#c8b6ff) and is the only bright source. UV unwrapped with 4096x4096 PBR
> texture maps.

---

### 5.2 Aranha-de-Orvalho — `dew-strider`

- **Família** Enxame da Estufa · **Elemento** `agua` (`#57c8ec`)
- **Chefe** não · **Invocado apenas** não · **IA** `ranged` · **Traços** nenhum
- **Altura de geração** 1,80 m · **Largura** até 2,0 células — as **pernas contam**
  na largura, e este é o monstro que mais tende a estourar o teto. O vão de
  pernas não pode passar da altura da figura (ver §2).
- **Escala no dado** não informada
- **Feitiços** Teia de Orvalho (`m-dew-web`, agua, alcance 2–5, prende 1 turno) ·
  Picada de Orvalho (`m-dew-bite`, agua, corpo a corpo, dano + veneno)

> Uma aranha de pernas finíssimas que anda sobre a água acumulada nas folhas sem afundar um milímetro. Tece com orvalho: as teias brilham, pesam e endurecem.

**Direção visual.** A marca dela é o **vazio**. Corpo minúsculo — um caroço, não
um bicho — no centro de oito pernas longas, finas como fio de cabelo, arqueadas
para cima e descendo em ponta de agulha. Ela ocupa uma célula inteira de largura
e quase não tem massa nenhuma: a 40 px, o jogador vê um **asterisco**, uma
estrela de riscos com um ponto no meio, e nenhuma outra coisa da Estufa se
parece com isso. A ponta de cada perna toca a superfície e **afunda a água sem
furar** — uma covinha de tensão superficial, com um filme d'água brilhante e uma
gota gorda pendurada em cada pé. As gotas são o desenho de Teia de Orvalho e são
o que impede a silhueta de sumir: oito pontos de luz azul `#57c8ec` nas
extremidades, marcando o vão que o corpo não preenche. Cabeça e corpo em cinza
translúcido, quase de vidro, molhado, com as quelíceras visíveis; nada de peludo,
nada de gordo, nada de aranha de casa. **Não pode ser confundida com o
Carrapicho-Mãe**, com quem ela divide a sala 2 e com quem o acervo antigo a
empatava literalmente (os dois eram `q_spider`): o Carrapicho é uma bola maciça e
opaca colada no chão, a Aranha é um vão de riscos brilhantes erguido sobre ele.
Massa contra vazio — é a diferença mais forte que duas silhuetas podem ter, e é
de propósito que esses dois ficaram nos extremos.

**Prompt:**

> A single arachnid creature, one figure only, centered, isolated on a plain pure
> white background. A water-strider spider spanning about 1.8 meters, with a tiny
> compact body — barely a seed-sized knot — at the center of eight extremely long
> hair-thin legs that arch up and then taper down to needle points, so the
> silhouette reads as a mostly empty asterisk of thin strokes with almost no
> mass. Each leg tip dimples a bright film of water without breaking it, and a
> fat glistening dew droplet hangs from every foot. Translucent glassy pale grey
> wet body, visible chelicerae; not furry, not fat, not a house spider. The leg
> spread must not exceed the body height. Full body, top-down-front view,
> perfectly symmetrical rest pose with all eight legs spread evenly at equal
> angles, even lighting from above, no cast shadow, no ground plane, no scenery,
> no frame, no text, no other figures. Beside the figure, separated on the same
> white background and not touching it: one detached leg alone, and a single
> hardened dew droplet alone. Cold translucent grey body; pale blue (#57c8ec)
> glow only in the water film and in the eight hanging droplets. UV unwrapped
> with 4096x4096 PBR texture maps.

---

## 6. Divergências e buracos no dado

Registrados aqui porque quem gerar as imagens vai bater nisso e precisa saber
qual lado manda.

### Divergências entre documento e dado

| onde | o que diz um | o que diz o outro | quem mandou nesta ficha |
|---|---|---|---|
| altura do chefe | `SISTEMAS.md` §6: os chefes ficam entre **5,16 e 5,46 m** | `monsters.json`, descrição de `boss-gardener`: "um vulto de **três metros**" | **a regra**. A ficha gera em 5,16–5,46 m e mantém a descrição verbatim. Três metros é menor que o teto de personagem (4,76 m, a fusão Bárbaro+Bruxo) — é o mesmo defeito que reprovou os chefes antigos. |
| elemento do calabouço | `SISTEMAS.md` §6: "Seis, cada um com **elemento**, clima próprio, bestiário e um chefe" | `dungeons.json` não tem campo `element` (o próprio §6 admite isso três parágrafos abaixo), e o `greenhouse` mistura `terra`, `agua` e `ar` entre seus 9 monstros | o dado. Não existe "o elemento da Estufa"; existe o elemento de cada monstro. |
| invocações do Xamã | `SISTEMAS.md` §7: "**Sete** criaturas, uma por conceito, nenhuma repetida", com tabela de 7 | `monsters.json`: a família "Rebanho do Invocador" tem **8** entradas — as 7 da tabela mais `sporeling` (Esporinho) | o dado. Fora do escopo desta ficha, mas quem for escrever o bestiário do Xamã precisa saber que falta uma linha na tabela. |
| modelo do chefe da Estufa | `CREDITS_3D.md`: Jardineira-Viúva → **Stag** (veado) | `js/render3d/models3d_v2.js`: `boss-gardener` → `q_mushnub`, com o comentário `// era veado palido` | o código. `CREDITS_3D.md` está desatualizado nesse ponto. Vira pó de qualquer jeito quando o elenco gerado entrar. |

Nada divergiu entre `SISTEMAS.md` §6 e `monsters.json` quanto a **quem é o chefe**
do `greenhouse`: os dois dizem `boss-gardener`, e `boss: true` só aparece nele
dentro do calabouço.

### O que o dado não informa

- **Tamanho.** `monsters.json` não tem campo de tamanho, escala, altura ou
  largura — os 15 campos são `id`, `name`, `family`, `element`, `dungeonId`,
  `description`, `flavor`, `stats`, `spells`, `ai`, `traits`, `boss`,
  `summonOnly`, `xp`, `stoneDrop`. Toda medida em metros e células desta ficha
  veio de `FICHA_GERACAO_ELENCO.md`, não do dado.
- **Escala em metros de Carrapicho-Mãe e Vespa-Lustre.** O dado só dá "do
  tamanho de um cão" e "do tamanho de um gato". Não convertido — a conversão
  seria número inventado.
- **Escala de Vergasta, Bufo-de-Pólen, Seiveiro, Brotinho-Voraz, Carrapichinho e
  Aranha-de-Orvalho.** Nem medida nem comparação. Não informado.
- **Tamanho relativo do Carrapichinho.** "Metade do rancor, o dobro da
  velocidade" é temperamento, não porte. O único par de números comparáveis é hp
  22 contra 60. Por isso a ficha dele separa por **borda desfiada**, não por
  tamanho.
- **Cor de corpo.** Nenhum monstro tem campo de cor. As cores desta ficha vêm de
  `elementInfo.json` (elemento) e de `dungeons.json.palette` (calabouço); todo o
  resto — marrom de casca, amarelo de pólen, preto de renda — é direção de arte
  desta ficha e está aberto a correção.
- **Quantidade de olhos do Carrapichinho.** O dado descreve "dezenas de
  olhinhos" só para a mãe. As duas ou três sementes do filho são escolha desta
  ficha, marcada como tal na ficha 4.6.
- **Aparência da Vespa-Lustre e da Aranha-de-Orvalho fora do que a descrição
  dá.** Número de asas, número de olhos, padrão do tórax: não informado.
- **Nada existe no dado sobre modelo, arquivo, textura ou animação.** O elenco
  gerado ainda não tem lugar nos dados; quando tiver, é este documento que fica
  velho.
