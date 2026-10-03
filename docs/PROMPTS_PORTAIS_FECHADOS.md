# Prompts prontos — os quatro portais fechados (monstros e cenário)

Os quatro calabouços trancados na praça — **Os Andaimes do Vento**, **O Fecho
de Brasa**, **A Mina Trêmula** e **O Coração Partido** — têm salas, feitiços,
IA e itens prontos. O que falta é a arte: hoje os 40 monstros vestem esqueleto
do KayKit ou bicho do Quaternius emprestado, e o cenário usa o kit genérico.

Este documento é o que falta, em ordem de produção: primeiro os 10 bichos dos
Andaimes, depois Fecho, Mina e Coração, e no fim os quatro kits de cenário.
Cada prompt é autossuficiente — copie o bloco inteiro no Meshy.

**Estado em 19/09/2026 (noite):** o Fecho de Brasa e os Andaimes do Vento já
entraram no jogo (monstros + cenário + salas novas, portais abertos). As seções
1, 2 e 6.1 ficam como registro do que foi pedido; o que ainda falta gerar é a
Mina Trêmula (seção 3 + 6.3) e o Coração Partido (seção 4 + 6.4).

**03/10/2026:** os prompts do conteúdo novo do lançamento — Sala de Guerra,
Colossos do Poço, Eco Primordial e Santuário dos Elementos — estão em
`docs/PROMPTS_LANCAMENTO.md`, já no caminho Gemini → Meshy e na regra que o dono
fixou em 03/10: um prompt por personagem, um por muro e de 3 a 4 itens por folha.

---

## As cinco regras que valem para todos os monstros

1. **Humanoide, sempre.** O rig do Meshy tem 24 ossos de gente e a biblioteca
   de animação é de gente. Bicho de quatro patas, sem pata ou com asas E braços
   só ganha clipe de andar e passa a luta inteira deslizando parado. O truque
   que funcionou na Estufa e na Cisterna: **não humanize o bicho, vista o bicho
   num corpo.** Asa no lugar do braço; cauda como saia que esconde as pernas;
   bicho enraizado com as pernas modeladas escondidas dentro da base.
2. **Pose A, de pé, de frente, simétrico**, braços um pouco afastados do corpo.
   É o que o auto-rig pede. Peças penduradas (pinça, corrente, chicote) vão no
   lugar do braço, para o osso do braço animá-las de graça.
3. **Quase sem cor.** O jogo multiplica a textura por **52% da cor do elemento**
   (fogo laranja, água azul, terra verde, ar lilás). Volume é seu, matiz é do
   jogo. Modele em cinza-claro com o desenho no claro-escuro; o que precisa
   brilhar (brasa, olho, fresta acesa) fica **quase branco** — o tingimento
   transforma em luz da cor certa. Só os de elemento **neutro** (tinta quase
   branca) podem carregar cor própria, sempre discreta.
4. **Sem pedestal, sem chão, um personagem só.** O embutidor remove a
   `Icosphere` do gerador, mas base esculpida no modelo fica.
5. **Seis arquivos por bicho**, um por animação, na pasta que o manifesto já
   espera (`tools/monstros/<calabouço>.json`):

   ```
   C:\Users\danie\Downloads\assets_ok\mapa\<Nome do calabouço>\monstros\<Nome do monstro>\
       <Nome do monstro> idle.glb
       <Nome do monstro> walk.glb      (voador: use o clipe de voo/planar aqui)
       <Nome do monstro> run.glb       (opcional — só quem é rápido)
       <Nome do monstro> attack.glb
       <Nome do monstro> hit.glb
       <Nome do monstro> death.glb
   ```

   Os nomes de pasta dos calabouços são exatamente estes (dois sem acento):
   `Os Andaimes do Vento` · `O Fecho de Brasa` · `A Mina Tremula` ·
   `O Coracao Partido`. O nome do monstro é o do jogo, com acento
   (`Tição`, `Cão-de-Têmpera`). Se o Meshy trocar ataque e reação de novo, o
   raio-X do embutidor corrige — aconteceu nos dez lotes anteriores.

**A régua de porte** (`tests/bestiario.html`): todo bicho entre 0,7 e 3,6 m,
e o chefe é o maior do calabouço. Para calibrar o olho: Ladino 1,75 m, herói
2,05 m, Minotauro 2,62 m, corpo fundido 3,00 m, casa 2,0 m, muro 3,10 m. A
altura não se controla no Meshy — ela é acertada depois em `MONSTER_LOOK`
(`scale = altura ÷ 1,80`; chefe `altura ÷ 2,95`). O que você controla é a
**proporção**, e é isso que cada ficha pede.

---

# 1 · OS ANDAIMES DO VENTO — Coro dos Andaimes

Pasta: `...\assets_ok\mapa\Os Andaimes do Vento\monstros\`. Tinta do
calabouço: lilás (ar) em quase todos; verde no Golem de Lastro; o
Enforca-Corda é neutro e fica com a cor dele. Tudo aqui é corda, tábua, nó,
lona e vento: o vocabulário visual é **obra inacabada**.

| monstro | id | elem | papel | altura | scale |
|---|---|---|---|---|---|
| Pregolim | `nail-sprite` | ar | invocado pelo chefe | 0,80 m | 0,44 |
| Motinho | `mote-bit` | ar | metade do Enxame · explode | 0,90 m | 0,50 |
| Gremlin de Rajada | `gust-gremlin` | ar | corpo a corpo · empurra | 1,10 m | 0,61 |
| Picanço-de-Tábua | `plank-shrike` | ar | corpo a corpo · mergulha | 1,40 m | 0,78 |
| Enxame de Motes | `mote-swarm` | ar | corpo a corpo · racha em dois | 1,50 m | 0,83 |
| Coro-Assobio | `whistle-choir` | ar | APOIO · cura em aura | 1,90 m | 1,06 |
| Enforca-Corda | `rope-hanger` | neutro | distância · não sai do lugar | 2,20 m | 1,22 |
| Serpe-Pipa | `kite-serpent` | ar | distância | 2,30 m | 1,28 |
| Golem de Lastro | `ballast-golem` | terra | tanque · imune a empurrão | 2,60 m | 1,44 |
| Cambota, o Mestre-de-Obras | `boss-windwright` | ar | CHEFE | 3,40 m | 1,15 |

### Picanço-de-Tábua · `plank-shrike`
Pássaro cinzento de bico curvo que empala a caça nos pregos das tábuas. Vive
nos vãos, desce em queda livre e some. **As asas são os braços** (regra da
Vespa-Lustre: nunca braços E asas). A despensa dele — coisas espetadas em
pregos — vai no peito, como uma bandoleira. Animação: idle · walk (planar) ·
attack (mergulho de bico) · hit · death. Não faça fofo: é um carniceiro.

```
A shrike bird-creature as a humanoid biped: lean upright body, hooked predatory beak, sharp eyes, sleek short feathers, wings in place of arms with long primary feathers ending in claw-like tips, short scaly legs with talons, stiff fan tail. Across the chest a bandolier of bent iron nails with small bones and scraps impaled on them. Full-body humanoid biped standing upright in a relaxed A-pose, wings held slightly open like arms, feet apart, facing forward, symmetrical. Stylized fantasy game creature, clean readable silhouette, hand-painted look. Near-monochrome light grey materials, all detail in light-and-dark contrast, no saturated colors. Single character, no base, no pedestal, no ground, nothing else in the scene.
```

### Gremlin de Rajada · `gust-gremlin`
Bichinho de orelhas enormes que usa as orelhas como velas. Não bate para
matar: bate para ver a pessoa cair, e conta as quedas em voz alta. A silhueta
é **as orelhas** — maiores que o tronco, abertas como velas de barco. Corpo já
humanoide. Animação: idle · run · attack (empurrão de duas mãos) · hit · death.

```
A small mischievous wind gremlin: skinny goblin-like humanoid with a big grinning head, enormous ears shaped like ship sails stretched wide open and taut as if catching wind, membranous ear skin with visible ribs, wide toothy grin, large round eyes, thin arms with long fingers, bare feet, ragged short trousers. Full-body humanoid biped standing upright in a relaxed A-pose, two arms and two legs, symmetrical, arms slightly away from the body, feet apart, facing forward. Stylized fantasy game creature, clean readable silhouette, hand-painted look. Near-monochrome light grey materials, all detail in light-and-dark contrast, no saturated colors. Single character, no base, no pedestal, no ground, nothing else in the scene.
```

### Enforca-Corda · `rope-hanger`
Novelo de cordas de obra amarrado num nó que ninguém desfaz, pendurado na
roldana mestra. Não desce nunca; lança laços e recolhe o que pegou. **A
roldana é a cabeça**, os braços terminam em laços, as pernas são um rabo de
corda trançada (saia que esconde os pés — modele as pernas dentro). Neutro:
fica com a cor de cânhamo dele. Animação: idle (balança) · walk · attack
(lança o laço) · hit · death (o nó desfaz).

```
A hangman-knot creature made entirely of thick hemp construction rope: a humanoid figure of tangled, knotted rope with a heavy wooden pulley block as its head, rope torso wound in a dense impossible knot, two arms of rope ending in open lasso loops, legs merged into a long braided rope tail that spreads on the floor and hides the feet. Frayed fibers, wrapped bindings, a few iron hooks. Full-body humanoid biped standing upright in a relaxed A-pose, two arms, symmetrical, arms slightly away from the body, facing forward. Stylized fantasy game creature, clean readable silhouette, hand-painted look. Muted desaturated colors: faded hemp beige, dark weathered wood, rusty iron, all detail in light-and-dark contrast. Single character, no base, no pedestal, no ground, nothing else in the scene.
```

### Serpe-Pipa · `kite-serpent`
Serpente chata e comprida de papel encerado e ripas, com cauda de fitas
revestida de vidro moído. Sobe nas correntes de ar e desce riscando. **A pipa
é o tronco**: losango de ripas e papel, cabeça de serpente no topo, braços =
varas com papel esticado, pernas juntas numa cauda comprida de fitas (saia).
Animação: idle (tremula) · walk (plana) · attack (chicote da cauda) · hit ·
death (papel rasga).

```
A kite-serpent: a tall humanoid creature built like a diamond-shaped paper kite, torso made of thin wooden slats with waxed paper stretched between them, translucent and creased, a flat snake head with small eyes and a forked tongue at the top, arms made of long wooden spars with paper fins, legs joined into a long tail of ribbons and streamers that hides the feet, the ribbons edged with sparkling crushed glass. Full-body humanoid biped standing upright in a relaxed A-pose, two arms, symmetrical, arms slightly away from the body, facing forward. Stylized fantasy game creature, clean readable silhouette, hand-painted look. Near-monochrome light grey materials, all detail in light-and-dark contrast, no saturated colors. Single character, no base, no pedestal, no ground, nothing else in the scene.
```

### Golem de Lastro · `ballast-golem`
Armação de vigas cheia de sacos de brita, feita para segurar o andaime quando
o poço sopra. Segurou por mil anos; agora anda, devagar, sempre contra o vento.
Imune a empurrão, tanque, o único de terra da casa (tinta verde). **Peso**:
ombros largos, pernas grossas, sacos transbordando pelas frestas da armação.
Animação: idle · walk (cada passo custa) · attack (soca com o saco) · hit
(balança e volta) · death.

```
A ballast golem: a massive humanoid built from a lashed timber frame of square wooden beams tied with rope at every joint, the frame stuffed with bulging burlap sacks of gravel that spill small stones through the gaps, broad heavy shoulders, thick short legs, huge fists made of bundled sacks, a small blocky head of beams with two dark hollow eyes. Full-body humanoid biped standing upright in a relaxed A-pose, two arms and two legs, symmetrical, arms slightly away from the body, feet apart, facing forward. Stylized fantasy game creature, clean readable silhouette, hand-painted look. Near-monochrome light grey materials, all detail in light-and-dark contrast, no saturated colors. Single character, no base, no pedestal, no ground, nothing else in the scene.
```

### Coro-Assobio · `whistle-choir`
Feixe de tubos de respiradouro amarrado com arame, flutuando de lado. Cada
tubo assobia uma nota; juntos remendam os companheiros. É o **único que cura**
nos Andaimes — precisa ser reconhecido de longe. Tronco = tubos verticais de
comprimentos diferentes, como flauta de pã; cabeça = boca de sino de
ventilação; braços = dutos sanfonados; pernas escondidas numa saia de bocas de
tubo. Flutua: o andar é deslizar, e está certo. Animação: idle (oscila) ·
walk (deriva) · attack = cast (as bocas abrem e sopram) · hit · death (os tubos
caem soltos).

```
A floating choir of ventilation pipes as a humanoid: torso made of a bundle of vertical metal pipes of different lengths bound with twisted wire like a pan flute, head is a flared bell-shaped vent mouth, arms are flexible corrugated ducts ending in smaller pipe mouths, legs hidden inside a skirt of hanging pipe ends, riveted sheet metal, dents and patina. Full-body humanoid biped standing upright in a relaxed A-pose, two arms, symmetrical, arms slightly away from the body, facing forward. Stylized fantasy game creature, clean readable silhouette, hand-painted look. Near-monochrome light grey materials, all detail in light-and-dark contrast, no saturated colors. Single character, no base, no pedestal, no ground, nothing else in the scene.
```

### Enxame de Motes · `mote-swarm`
Nuvem compacta de bichinhos de poeira luminosa que se move como um corpo só.
Bata forte e ela vira duas. A leitura é **nuvem com forma de gente**: corpo
denso no meio, bordas soltas em grumos, muitos olhinhos. Os pontos de luz
quase brancos, que o tingimento acende de lilás. Animação: idle (fervilha) ·
run · attack (avança em bloco) · hit · death (se parte ao meio — importa).

```
A swarm of glowing dust motes clumped into a humanoid shape: a dense cloud body with a vague head, two arms and two legs formed by tighter clusters of tiny fuzzy particles, loose puffs and stray specks around the edges, dozens of tiny bright eyes scattered through the cloud, soft fluffy surface like compacted lint and pollen. Full-body humanoid biped standing upright in a relaxed A-pose, two arms and two legs, symmetrical, arms slightly away from the body, feet apart, facing forward. Stylized fantasy game creature, clean readable silhouette, hand-painted look. Near-monochrome light grey materials with the glowing specks painted almost white, all detail in light-and-dark contrast, no saturated colors. Single character, no base, no pedestal, no ground, nothing else in the scene.
```

### Motinho · `mote-bit`
Metade da nuvem, o dobro da pressa. Ao morrer, o pó pega fogo por um instante.
Mesmo vocabulário do Enxame, **menor, mais ralo e mais esticado para a
frente**, como quem corre. Animação: idle · run · attack · hit · death (estoura).

```
A small half-swarm of glowing dust motes shaped like a hurried little humanoid: a thin sparse cloud body leaning forward, long spindly arms and legs of loose particle clusters, a small head with a few bright eyes, wispy trailing edges, fluffy lint-like surface. Full-body humanoid biped standing upright in a relaxed A-pose, two arms and two legs, symmetrical, arms slightly away from the body, feet apart, facing forward. Stylized fantasy game creature, clean readable silhouette, hand-painted look. Near-monochrome light grey materials with the glowing specks painted almost white, all detail in light-and-dark contrast, no saturated colors. Single character, no base, no pedestal, no ground, nothing else in the scene.
```

### Pregolim · `nail-sprite`
Prego de quinze centímetros com dois olhinhos e muita convicção. Cambota os
finca na armação e eles saem andando. **Cabeça = cabeça do prego** (disco
chato), tronco = haste, levemente torta ("nasce torto, entra reto"), bracinhos
e perninhas finos. No jogo ele mede 0,80 m — a proporção de prego é o que
importa. Animação: idle · run · attack (finca) · hit · death.

```
A nail sprite: a tiny humanoid whose body is a long iron nail, flat round nail head as its head with two big bright eyes and a determined frown, slightly bent shaft as the torso, thin stick arms and legs of hammered iron, pointed tip visible below the waist between the legs, rusty scratched metal with a few dents. Full-body humanoid biped standing upright in a relaxed A-pose, two arms and two legs, symmetrical, arms slightly away from the body, feet apart, facing forward. Stylized fantasy game creature, clean readable silhouette, hand-painted look. Near-monochrome light grey materials, all detail in light-and-dark contrast, no saturated colors. Single character, no base, no pedestal, no ground, nothing else in the scene.
```

### Cambota, o Mestre-de-Obras · `boss-windwright` — CHEFE
O capataz que jamais entregou a obra: esqueleto de vigas e cordame com uma
roldana no lugar da cabeça e um prumo eterno balançando do braço. Constrói o
andaime enquanto luta em cima dele. A três metros e meio ele precisa ser lido
em três tempos: **a roldana no alto, o vazado do tronco, o prumo na mão.** Alto
e magro, treliça de vigas que se vê através, cordas amarrando cada junta, um
cinto de ferramentas com rebites. Não faça musculoso: ele é uma torre de
andaime que aprendeu a andar. Animação: idle · walk · attack (martelada /
rajada de rebites) · cast (ergue a armação) · hit · death (a ala desaba).

```
A towering scaffold foreman boss: a tall gaunt humanoid skeleton built from timber beams and rope, an open lattice torso you can see through, joints wrapped in knotted cord, a large wooden pulley block with an iron wheel in place of a head, long beam arms with rope tendons, one hand holding a heavy plumb bob hanging from a cord, a tool belt of rivets and a hammer at the hip, planks and hanging ropes on the back, tattered canvas strips. Full-body humanoid biped standing upright in a relaxed A-pose, two arms and two legs, symmetrical, arms slightly away from the body, feet apart, facing forward. Stylized fantasy game boss creature, clean readable silhouette, hand-painted look. Near-monochrome light grey materials, all detail in light-and-dark contrast, no saturated colors. Single character, no base, no pedestal, no ground, nothing else in the scene.
```

---

# 2 · O FECHO DE BRASA — Prole da Fornalha

Pasta: `...\assets_ok\mapa\O Fecho de Brasa\monstros\`. Tinta laranja (fogo)
na maioria; verde na Bigorna (terra), lilás no Cinzento (ar), azul no
Cão-de-Têmpera (água); o Puxa-Corrente é neutro. Vocabulário: **ferro, carvão,
fuligem e ferramenta grande demais para um homem só.** Tudo que arde fica
quase branco na textura.

| monstro | id | elem | papel | altura | scale |
|---|---|---|---|---|---|
| Fagulha | `spark-whelp` | fogo | invocada pelo chefe · explode | 0,75 m | 0,42 |
| Escorinha | `slag-bit` | fogo | metade do Monte · explode | 0,80 m | 0,44 |
| Tição | `ember-imp` | fogo | corpo a corpo · explode | 1,10 m | 0,61 |
| Cão-de-Têmpera | `quench-hound` | água | corpo a corpo · apaga brasa | 1,30 m | 0,72 |
| Monte de Escória | `slag-mound` | fogo | corpo a corpo · racha em dois | 1,40 m | 0,78 |
| Bigorna Ambulante | `walking-anvil` | terra | tanque · imune a empurrão | 1,60 m | 0,89 |
| Cinzento | `ash-wraith` | ar | distância · some no ar | 1,95 m | 1,08 |
| Ferreiro Sem-Rosto | `faceless-smith` | fogo | APOIO · tempera aliados | 2,10 m | 1,17 |
| Puxa-Corrente | `chain-hauler` | neutro | distância · ancorado | 2,50 m | 1,39 |
| Magno, o Acendedor | `boss-heartforge` | fogo | CHEFE | 3,50 m | 1,19 |

### Tição · `ember-imp`
Carvão em brasa com braços finos e um sorriso rachado de luz alaranjada. Corre
rindo; a risada é o estopim. Corpo = pedaço de carvão anguloso, rachaduras
quase brancas (viram brasa), pernas e braços de graveto queimado. Animação:
idle · run · attack (arranhão) · hit · death (estoura).

```
A small ember imp: a humanoid lump of angular black charcoal with deep glowing cracks running across its body, a huge cracked grin and two slit eyes glowing from inside, thin spindly arms and legs like burnt twigs, clawed fingers, a few embers stuck to its back. Full-body humanoid biped standing upright in a relaxed A-pose, two arms and two legs, symmetrical, arms slightly away from the body, feet apart, facing forward. Stylized fantasy game creature, clean readable silhouette, hand-painted look. Near-monochrome materials: dark charcoal grey body with the cracks, eyes and grin painted almost white, all detail in light-and-dark contrast, no saturated colors. Single character, no base, no pedestal, no ground, nothing else in the scene.
```

### Bigorna Ambulante · `walking-anvil`
Bigorna centenária que criou pernas atarracadas e um rancor proporcional às
marteladas que levou. Imune a empurrão, lenta. **A bigorna é o tronco E a
cabeça**: o chifre vira o rosto, a base vira a pelve, pernas curtas e grossas,
braços curtos de ferro batido. Tinta verde (terra): ferro cinza-claro, marcas
de martelo escuras. Animação: idle · walk (pesado) · attack (esmaga) · hit
(nem recua) · death.

```
A walking anvil: a squat humanoid whose torso and head are a single massive old iron anvil, the anvil horn pointing forward as a snout with two small angry eyes above it, the flat face dented by centuries of hammer strikes, the anvil base forming wide hips, short thick stumpy legs of forged iron, short heavy arms with blunt fist-like hammer heads, rivets and chipped edges. Full-body humanoid biped standing upright in a relaxed A-pose, two arms and two legs, symmetrical, arms slightly away from the body, feet apart, facing forward. Stylized fantasy game creature, clean readable silhouette, hand-painted look. Near-monochrome light grey materials, all detail in light-and-dark contrast, no saturated colors. Single character, no base, no pedestal, no ground, nothing else in the scene.
```

### Cinzento · `ash-wraith`
Contorno de um ferreiro antigo desenhado em fuligem suspensa, dois pontos de
brasa no lugar dos olhos. Atira setas de cinza e se desmancha no ar. É um
ferreiro **de fumaça**: avental, braços grossos, sem pernas — o corpo se desfaz
numa cauda de fuligem (saia; pernas modeladas dentro). Tinta lilás (ar).
Animação: idle (tremula) · walk (flutua) · attack (arremessa) · hit · death
(dispersa).

```
An ash wraith: the ghostly silhouette of an ancient blacksmith drawn in suspended soot, a broad-shouldered humanoid upper body of dense dark smoke wearing a leather apron shape, thick smoky arms with clenched fists, a featureless head with two small glowing ember eyes, the lower body dissolving into a trailing skirt of soot and ash wisps that hides the legs, loose flakes drifting around it. Full-body humanoid biped standing upright in a relaxed A-pose, two arms, symmetrical, arms slightly away from the body, facing forward. Stylized fantasy game creature, clean readable silhouette, hand-painted look. Near-monochrome soft grey materials with the two eyes painted almost white, all detail in light-and-dark contrast, no saturated colors. Single character, no base, no pedestal, no ground, nothing else in the scene.
```

### Monte de Escória · `slag-mound`
Pilha de refugo de forja que aprendeu a se arrastar, deixando rastro
vitrificado. Quebre-a e ela desmorona em duas escorinhas que explodem. Baixo e
largo, **corcunda de escória**, braços curtos, pernas escondidas na base do
monte (modeladas dentro), frestas quase brancas entre as placas. Animação:
idle · walk (arrasta) · attack (baque) · hit · death (racha em dois — importa).

```
A slag mound creature: a hunched low wide humanoid made of a heap of forge slag, lumpy vitrified crust in layered plates with glowing cracks between them, a small head sunk into the shoulders with two glowing pits for eyes, short thick arms ending in crusty fists, the legs hidden inside the spreading base of the mound, bits of half-melted metal and cinders stuck in the surface. Full-body humanoid biped standing upright in a relaxed A-pose, two arms, symmetrical, arms slightly away from the body, facing forward. Stylized fantasy game creature, clean readable silhouette, hand-painted look. Near-monochrome materials: dark grey crust with the cracks and eyes painted almost white, all detail in light-and-dark contrast, no saturated colors. Single character, no base, no pedestal, no ground, nothing else in the scene.
```

### Ferreiro Sem-Rosto · `faceless-smith`
Avental de couro e dois braços musculosos pendurados em nada: onde deveria
haver corpo, só calor tremulando. Tempera os aliados como lâminas. É o
**apoio** do Fecho — precisa ser reconhecido de longe: o avental é a silhueta.
Sem cabeça, sem tronco: avental (casca fechada por trás), braços com luvas,
martelo de forja numa mão, botas pesadas. Animação: idle · walk · attack =
cast (martelada de têmpera) · hit · death (o avental cai vazio).

```
A faceless smith: a humanoid figure that is only a heavy leather blacksmith apron, two thick muscular bare arms in leather gloves and heavy boots, with no head and no body — the apron is a closed shell hanging in the air as if worn by nothing, the neck and the gap between apron and boots empty, one hand holding a large forge hammer, a chain of tongs at the waist, scorched leather with rivets and stitching. Full-body humanoid biped standing upright in a relaxed A-pose, two arms and two legs, symmetrical, arms slightly away from the body, feet apart, facing forward. Stylized fantasy game creature, clean readable silhouette, hand-painted look. Near-monochrome light grey materials, all detail in light-and-dark contrast, no saturated colors. Single character, no base, no pedestal, no ground, nothing else in the scene.
```

### Cão-de-Têmpera · `quench-hound`
Cão de vapor condensado nascido no fosso onde as lâminas eram mergulhadas
ainda vermelhas. O pelo goteja, a mordida chia, e onde ele passa a brasa apaga.
A única água do Fecho (tinta azul). **Cão de pé** (a regra do Selinho: rig
humanoide só dá ataque em bípede): tronco de cachorro magro ereto, mandíbula
aberta, patas dianteiras como braços, rabo curto, gotejando. Animação: idle ·
run · attack (bote de mordida) · hit · death.

```
A quench hound as an upright biped: a lean dog-like creature standing on its hind legs, body made of condensed steam and dripping water, wet slick surface with droplets running down, open jaws full of thin teeth with steam curling out, long snout, folded ears, forelegs held like arms with clawed paws, short tail, faint ripples across the chest. Full-body humanoid biped standing upright in a relaxed A-pose, two arms and two legs, symmetrical, arms slightly away from the body, feet apart, facing forward. Stylized fantasy game creature, clean readable silhouette, hand-painted look. Near-monochrome light grey materials, all detail in light-and-dark contrast, no saturated colors. Single character, no base, no pedestal, no ground, nothing else in the scene.
```

### Puxa-Corrente · `chain-hauler`
Guindaste de forja que criou vontade: carretel de ferro pendurado no trilho do
teto com três correntes que ele lança como anzóis. Não persegue — traz todo
mundo até ele. Ancorado, neutro (fica com o ferro dele). **O carretel é o
tronco**, um toco de trilho em cima da cabeça como coroa, dois braços de
corrente com ganchos, a terceira corrente cai como cauda e esconde as pernas.
Animação: idle (correntes balançam) · walk · attack (lança o gancho) · hit ·
death (despenca).

```
A forge crane creature: a humanoid whose torso is a big iron winch drum wound with heavy chain, a short segment of overhead rail with a trolley wheel mounted above its head like a crown, a small riveted iron block head with one round lens eye, two long arms made of chain links ending in large iron hooks, a third chain hanging down between the legs as a tail that hides the feet, gears, bolts and grease stains. Full-body humanoid biped standing upright in a relaxed A-pose, two arms, symmetrical, arms slightly away from the body, facing forward. Stylized fantasy game creature, clean readable silhouette, hand-painted look. Muted desaturated colors: dark oiled iron, rust, brass fittings, all detail in light-and-dark contrast. Single character, no base, no pedestal, no ground, nothing else in the scene.
```

### Fagulha · `spark-whelp`
Faísca com pernas e opinião. Vive pouco, termina alto. Magno as fabrica sem
olhar. Bicho mínimo (0,75 m em jogo): cabeça = chama pontuda quase branca,
corpinho de carvão, membros de graveto. Animação: idle · run · attack · hit ·
death (estoura).

```
A spark whelp: a tiny humanoid made of a single flying spark, head shaped like a pointed flickering flame with two dot eyes, small round charcoal body, thin stick arms and legs with pointed tips, a short trail of sparks behind it. Full-body humanoid biped standing upright in a relaxed A-pose, two arms and two legs, symmetrical, arms slightly away from the body, feet apart, facing forward. Stylized fantasy game creature, clean readable silhouette, hand-painted look. Near-monochrome materials: dark grey body with the flame head painted almost white, all detail in light-and-dark contrast, no saturated colors. Single character, no base, no pedestal, no ground, nothing else in the scene.
```

### Escorinha · `slag-bit`
Caco de escória ainda rubro, rastejando com propósito. Ato dois de três.
Mesmo vocabulário do Monte, **pequeno e anguloso**: uma lasca de crosta com
membros curtos. Animação: idle · run · attack · hit · death (estoura).

```
A slag bit: a small humanoid shard of forge slag, jagged angular crust body with glowing cracks, a pointed head with two glowing pits for eyes, short stubby arms and legs of cooled slag, sharp edges, tiny cinders stuck to the surface. Full-body humanoid biped standing upright in a relaxed A-pose, two arms and two legs, symmetrical, arms slightly away from the body, feet apart, facing forward. Stylized fantasy game creature, clean readable silhouette, hand-painted look. Near-monochrome materials: dark grey crust with the cracks and eyes painted almost white, all detail in light-and-dark contrast, no saturated colors. Single character, no base, no pedestal, no ground, nothing else in the scene.
```

### Magno, o Acendedor · `boss-heartforge` — CHEFE
O coração do último Fecho em forma de titã: forno a lenha de quatro metros com
grelha no peito, martelo-chaminé ao ombro e a primeira chama do mundo queimando
lá dentro. Ele não guarda o portão — ele É o portão. Três tempos de leitura: **a
grelha acesa no peito, a chaminé no ombro, o martelo.** Corpo de tijolo
refratário e ferro rebitado, cabeça = porta de forno com visor, pernas como
pilares de fornalha. A chama interna quase branca. Animação: idle (respira
fogo pela grelha) · walk · attack (martelo) · cast (sopro de fole) · hit ·
death (a chama apaga antes de cair).

```
A colossal furnace titan boss: a massive humanoid built like a wood-fired forge furnace, torso of refractory brick and riveted iron plates with a large iron grate in the chest glowing from the fire inside, a squat head shaped like an iron furnace door with a slit viewing window glowing, a tall brick chimney rising from one shoulder with soot stains, the other hand holding an enormous forge hammer with a chimney-like handle, thick legs like furnace pillars with ash pits at the feet, heavy iron shoulder bands and chains. Full-body humanoid biped standing upright in a relaxed A-pose, two arms and two legs, symmetrical, arms slightly away from the body, feet apart, facing forward. Stylized fantasy game boss creature, clean readable silhouette, hand-painted look. Near-monochrome light grey materials with the fire inside the grate and window painted almost white, all detail in light-and-dark contrast, no saturated colors. Single character, no base, no pedestal, no ground, nothing else in the scene.
```

---

# 3 · A MINA TRÊMULA — Turno da Noite

Pasta: `...\assets_ok\mapa\A Mina Tremula\monstros\` (sem acento). Tinta verde
(terra) na maioria; laranja no Fogaréu (fogo), lilás no Morcego (ar), azul na
Escorrência (água). Vocabulário: **rocha bruta, poeira compactada, ferramenta
de mineiro abandonada no meio da tarefa.**

> **20/09/2026 — o lote da Mina são OITO gerações, não dez** (saldo do Meshy).
> O Assombro de Picareta já está feito; faltam **sete**. Dois monstros ficam
> sem 3D próprio e **vestem corpo emprestado de lote já embutido** — não se
> apaga monstro do motor, só se aponta a arte para outro corpo. Os dois foram
> escolhidos por aparecerem menos no mapa e por terem o doador mais bem
> casado. Os prompts deles ficam aqui caso o saldo volte.
>
> | não gerado | veste | de onde | por que fecha |
> |---|---|---|---|
> | Lasca de Veio `ore-chip` | `slag-bit` (Escorinha) a `0.44` = 0,79 m | Fecho de Brasa | a ficha dos dois é quase a mesma palavra por palavra (caco anguloso de crosta, veio quase branco, membros curtos), os dois são o caco que sai de um corpão que racha, e a tinta difere: **laranja lá, verde aqui**. Encolher o Rolo NÃO serve: a ficha do Rolo é "esfera lisa de tanto rolar", e meia esfera lisa lê como bolinha, não como caco — fora que amarraria dois bichos a um modelo ainda não gerado |
> | Cantor de Cristal `crystal-chanter` | `whistle-choir` (Coro-Assobio) a `1.06` = 1,91 m | Andaimes do Vento | mesmo papel (o único curandeiro da casa, aura de cura nos dois), altura quase igual (1,91 contra 1,90 m), feixe vertical com domo no alto nos dois, e a tinta difere: **lilás lá, verde aqui**. O jogador aprendeu nos Andaimes que feixe-de-tubos cura, e lê o curandeiro na hora na sala do chefe |
>
> As duas linhas de `MONSTER_LOOK` (`js/render3d/models3d_v2.js`), para entrar
> junto com o lote:
>
> ```js
> 'ore-chip':       { model: 'slag-bit',      scale: 0.44 },  // 0,79 m — a Escorinha do Fecho: caco anguloso de split. terra sobre modelo de fogo: sai verde
> 'crystal-chanter':{ model: 'whistle-choir', scale: 1.06 },  // 1,91 m — o Coro-Assobio dos Andaimes: mesmo papel de apoio. terra sobre modelo de ar: sai verde
> ```
>
> O que isso cobra quando o lote chegar, e que os lotes anteriores não cobraram
> (este é o primeiro 8-para-10 da casa): `tests/bestiario.html` reprova nas duas
> checagens que exigem kit próprio para TODOS, e precisa de uma lista de
> empréstimo declarada — a régua passa a cobrar que os emprestados vistam
> exatamente o corpo declarado, e que os emprestados sejam exatamente os sem
> kit. `tools/retratos_site.html` precisa carregar também os pacotes do Fecho e
> dos Andaimes no lote `bichos-mina`, senão esses dois ficam sem retrato e a
> wiki mostra duas letras no meio de oito fotos. O manifesto
> `tools/monstros/quakemine.json` já foi cortado para oito.

| monstro | id | elem | papel | altura | scale |
|---|---|---|---|---|---|
| ~~Lasca de Veio~~ | `ore-chip` | terra | **NÃO GERAR** · veste `slag-bit` | 0,80 m | 0,44 |
| Fogaréu de Grisu | `firedamp-wisp` | fogo | distância · explode | 1,30 m | 0,72 |
| Morcego-de-Poço | `shaft-bat` | ar | corpo a corpo · mergulha | 1,50 m | 0,83 |
| Rolo de Minério | `ore-tumbler` | terra | corpo a corpo · racha em dois | 1,60 m | 0,89 |
| Escorrência | `damp-seeper` | água | distância · dissolve escudo | 1,70 m | 0,94 |
| Assombro de Picareta | `pick-revenant` | terra | corpo a corpo · marca e cobra | 1,85 m | 1,03 |
| ~~Cantor de Cristal~~ | `crystal-chanter` | terra | **NÃO GERAR** · veste `whistle-choir` | 1,90 m | 1,06 |
| Verme de Abatimento | `sinkhole-worm` | terra | distância · ancorado | 2,10 m | 1,17 |
| Bocarra | `cave-jaw` | terra | tanque · imune a empurrão | 2,90 m | 1,61 |
| Batepedra, o Que Bate Embaixo | `boss-deepknock` | terra | CHEFE | 3,50 m | 1,19 |

### Assombro de Picareta · `pick-revenant`
O turno da noite nunca subiu. Restou o gesto: um mineiro de poeira compactada
que ainda bate na mesma parede, no mesmo ritmo, há mil anos. Já é gente: um
mineiro **feito de pó prensado**, capacete com lampião apagado, picareta
fundida às mãos, roupa e pele do mesmo material. Animação: idle (bate no
ritmo, sozinho) · walk · attack (picaretada) · hit · death (desfaz em poeira).

```
A miner revenant made of compacted dust: a humanoid figure of packed grey dust and grit shaped like an old miner, rough crumbling surface, a battered mining helmet with a dead carbide lamp, hollow eye sockets, a heavy pickaxe fused into both hands, torn work clothes and boots all formed from the same dust, loose grains falling from the shoulders. Full-body humanoid biped standing upright in a relaxed A-pose, two arms and two legs, symmetrical, arms slightly away from the body, feet apart, facing forward. Stylized fantasy game creature, clean readable silhouette, hand-painted look. Near-monochrome light grey materials, all detail in light-and-dark contrast, no saturated colors. Single character, no base, no pedestal, no ground, nothing else in the scene.
```

### Fogaréu de Grisu · `firedamp-wisp`
Chama azul e silenciosa boiando à altura do peito, do tamanho de uma cabeça: o
gás da mina que ganhou vontade. Não persegue; espera você entrar na galeria
errada. **A chama é a cabeça**, o corpo é gás ralo com braços de fumaça, sem
pernas (saia de vapor; pernas modeladas dentro). Tinta laranja: a chama quase
branca. Animação: idle (tremula) · walk (flutua) · attack (lança chama) · hit ·
death (explode).

```
A firedamp wisp: a floating humanoid spirit of mine gas, head is a single teardrop-shaped silent flame the size of a head, a thin translucent body of drifting gas below it, two long wispy arms of smoke ending in soft flame tips, the lower body tapering into a skirt of vapor that hides the legs, faint swirling wisps around it. Full-body humanoid biped standing upright in a relaxed A-pose, two arms, symmetrical, arms slightly away from the body, facing forward. Stylized fantasy game creature, clean readable silhouette, hand-painted look. Near-monochrome soft grey materials with the flame head painted almost white, all detail in light-and-dark contrast, no saturated colors. Single character, no base, no pedestal, no ground, nothing else in the scene.
```

### Bocarra · `cave-jaw`
Um trecho de galeria que virou bicho: túnel com dentes de estalactite e gosto
adquirido por carne com capacete. Fica parada até você achar que é caminho. O
tanque da mina e também a porta. **O tronco é a boca do túnel**: o peito se
abre num arco de rocha cheio de estalactites e estalagmites como dentes, sem
cabeça (a boca é o rosto), braços enormes de rocha, pernas curtas e grossas.
Animação: idle (a boca respira) · walk · attack (mordida do peito inteiro) ·
hit (nem recua) · death.

```
A cave-jaw brute: a hulking humanoid of raw grey rock whose entire chest is a gaping tunnel mouth, an arched opening ringed with stalactite and stalagmite teeth, dark inside, no head above the shoulders — the mouth is the face, with two small glinting mineral eyes on the upper edge of the arch, massive boulder arms with cracked knuckles, short thick legs of stone, an old miner's helmet and pick stuck between the teeth. Full-body humanoid biped standing upright in a relaxed A-pose, two arms and two legs, symmetrical, arms slightly away from the body, feet apart, facing forward. Stylized fantasy game creature, clean readable silhouette, hand-painted look. Near-monochrome light grey materials, all detail in light-and-dark contrast, no saturated colors. Single character, no base, no pedestal, no ground, nothing else in the scene.
```

### ~~Cantor de Cristal~~ · `crystal-chanter` — **NÃO GERAR: veste o Coro-Assobio**
Aglomerado de quartzo do tamanho de um homem, crescido dentro de um capacete
abandonado. Vibra numa nota baixa que costura a pedra dos companheiros. É o
**apoio** da Mina: a silhueta que denuncia é o **capacete** no alto de um corpo
de cristais. Tronco = feixe de prismas, braços = agulhas de quartzo, pernas =
colunas de cristal. Animação: idle (vibra) · walk · attack = cast (o canto:
cristais se acendem) · hit · death (estilhaça).

```
A crystal chanter: a humanoid cluster of quartz crystals, torso and limbs made of long hexagonal prisms growing in bundles, translucent faceted surfaces, arms ending in sharp crystal points, legs as thick crystal columns, a small featureless crystal head wearing a battered old mining helmet with a dead lamp, a few smaller crystals sprouting from the shoulders. Full-body humanoid biped standing upright in a relaxed A-pose, two arms and two legs, symmetrical, arms slightly away from the body, feet apart, facing forward. Stylized fantasy game creature, clean readable silhouette, hand-painted look. Near-monochrome light grey materials with the crystal cores painted almost white, all detail in light-and-dark contrast, no saturated colors. Single character, no base, no pedestal, no ground, nothing else in the scene.
```

### Verme de Abatimento · `sinkhole-worm`
Boca circular de anéis que vive sob o piso solto e só mostra o funil. Não
anda: reorganiza o chão até você chegar por gravidade. Ancorado. **O funil de
cascalho é a base** (esconde as pernas, modeladas dentro), o tronco é um corpo
anelado saindo dele, a cabeça é a boca circular de anéis de dentes virada para
a frente, os braços são dois vermes menores. Animação: idle (a boca pulsa) ·
walk · attack (cospe / puxa) · hit · death (afunda).

```
A sinkhole worm: a segmented worm-creature rising upright from a funnel of loose gravel and sand, the funnel forming a wide base that hides the legs, a thick ringed body as the torso with overlapping leathery segments, the head is a round circular mouth of concentric rings of teeth facing forward with no eyes, two smaller worm tendrils sprouting from the sides as arms with tiny toothed mouths at the ends, dust and pebbles sliding down the funnel. Full-body humanoid biped standing upright in a relaxed A-pose, two arms, symmetrical, arms slightly away from the body, facing forward. Stylized fantasy game creature, clean readable silhouette, hand-painted look. Near-monochrome light grey materials, all detail in light-and-dark contrast, no saturated colors. Single character, no base, no pedestal, no ground, nothing else in the scene.
```

### Rolo de Minério · `ore-tumbler`
Bola de minério bruto do tamanho de um vagonete, lisa de tanto rolar. Ganha
embalo em linha reta e não tem plano para depois. Regra do Bufo-de-Pólen:
**esfera com membros enfiados**, sem pescoço nem cintura, veios de metal quase
brancos. Animação: idle · run (rola/corre) · attack (investida) · hit · death
(racha em dois — importa).

```
An ore tumbler: a big round boulder of raw ore as a humanoid body, a smooth polished sphere with veins of bright metal running across it and a few rough chipped patches, two small eyes and a crack for a mouth on the front, short stubby arms and legs of stone stuck into the sphere with no neck and no waist. Full-body humanoid biped standing upright in a relaxed A-pose, two arms and two legs, symmetrical, arms slightly away from the body, feet apart, facing forward. Stylized fantasy game creature, clean readable silhouette, hand-painted look. Near-monochrome light grey materials with the metal veins painted almost white, all detail in light-and-dark contrast, no saturated colors. Single character, no base, no pedestal, no ground, nothing else in the scene.
```

### ~~Lasca de Veio~~ · `ore-chip` — **NÃO GERAR: veste a Escorinha**
Caco de minério com uma veia de metal brilhando no meio, rolando com
propósito. Pequeno, denso, sem freio. Nasce de dois jeitos: quando o Rolo
racha e quando Batepedra "chama o veio" — por isso aparece muito. Mesmo
vocabulário do Rolo, **anguloso**. Animação: idle · run · attack · hit · death.

```
An ore chip: a small angular chunk of raw ore as a tiny humanoid, jagged faceted stone body with one bright vein of metal running through the middle, two small eyes, short stubby stone arms and legs, no neck. Full-body humanoid biped standing upright in a relaxed A-pose, two arms and two legs, symmetrical, arms slightly away from the body, feet apart, facing forward. Stylized fantasy game creature, clean readable silhouette, hand-painted look. Near-monochrome light grey materials with the metal vein painted almost white, all detail in light-and-dark contrast, no saturated colors. Single character, no base, no pedestal, no ground, nothing else in the scene.
```

### Morcego-de-Poço · `shaft-bat`
Asas de couro fino esticadas em ossos longos demais, guincho que faz a poeira
desenhar o túnel. Desce em espiral. **Asas no lugar dos braços**, dedos ósseos
compridos, orelhas enormes, pernas curtas com garras. Tinta lilás. Animação:
idle · walk (voo) · attack (mergulho) · hit · death.

```
A shaft bat as a humanoid biped: a lean upright bat-creature with huge leathery wings in place of arms stretched on overly long thin finger bones, tattered wing membrane, enormous cupped ears, a wrinkled snub-nosed face with a wide screeching mouth full of needle teeth, small eyes, short hind legs with hooked claws, fine fur on the chest. Full-body humanoid biped standing upright in a relaxed A-pose, wings held slightly open like arms, feet apart, facing forward, symmetrical. Stylized fantasy game creature, clean readable silhouette, hand-painted look. Near-monochrome light grey materials, all detail in light-and-dark contrast, no saturated colors. Single character, no base, no pedestal, no ground, nothing else in the scene.
```

### Escorrência · `damp-seeper`
Poça vertical que escorre pela parede contra a gravidade, carregada de mineral
dissolvido. Dissolve escudos como dissolveu a rocha. Tinta azul. **Água que
sobe**: base = poça (esconde as pernas), tronco = coluna de água mineral com
gotas subindo, braços = filetes que pingam para cima, cabeça = uma gota grande
invertida. Animação: idle (escorre) · walk · attack (jato) · hit · death (se
espalha no chão).

```
A damp seeper: a humanoid column of mineral-laden water flowing upward against gravity, rising from a puddle base that hides the legs, a torso of rippling water with streaks of dissolved mineral and small droplets climbing up its surface, two thin arms of dripping streams, a head shaped like a large inverted drop with two dark spots for eyes, crusty white mineral deposits at the edges. Full-body humanoid biped standing upright in a relaxed A-pose, two arms, symmetrical, arms slightly away from the body, facing forward. Stylized fantasy game creature, clean readable silhouette, hand-painted look. Near-monochrome light grey materials, all detail in light-and-dark contrast, no saturated colors. Single character, no base, no pedestal, no ground, nothing else in the scene.
```

### Batepedra, o Que Bate Embaixo · `boss-deepknock` — CHEFE
A coisa que os mineiros ouviam batendo do outro lado da parede e fingiam ser
eco. Torso de rocha-mãe com dois punhos de estéril e nenhum rosto onde procurar
intenção. Bate; o mundo responde. Três tempos: **os dois punhos enormes, o
tronco de rocha bruta, o vazio onde seria o rosto.** Corcunda, ombros mais
largos que a sala, pernas curtas e grossas, veios de cristal quase brancos nas
rachaduras. Animação: idle (respira devagar) · walk · attack (a Batida: dois
punhos no chão) · cast (postura de tremor) · hit · death (desaba em blocos).

```
A colossal deep-rock boss: a hunched massive humanoid carved from raw bedrock, torso of layered stone strata with cracks glowing faintly from crystal veins, two gigantic fists of loose stacked waste rock and rubble bigger than its head, no face at all — a smooth blank slab of stone where the head would be, set low between the enormous shoulders, short thick legs like stone pillars, stalagmites growing on the back, dust falling from every crack. Full-body humanoid biped standing upright in a relaxed A-pose, two arms and two legs, symmetrical, arms slightly away from the body, feet apart, facing forward. Stylized fantasy game boss creature, clean readable silhouette, hand-painted look. Near-monochrome light grey materials with the crystal veins painted almost white, all detail in light-and-dark contrast, no saturated colors. Single character, no base, no pedestal, no ground, nothing else in the scene.
```

---

# 4 · O CORAÇÃO PARTIDO — Guarda do Coração

Pasta: `...\assets_ok\mapa\O Coracao Partido\monstros\` (sem acento). Aqui o
elemento muda de bicho para bicho — os **quatro Arautos** são a MESMA armadura
vazia com recheio diferente, e o jogo os tinge de laranja, azul, verde e lilás.
Modele a armadura uma vez em cinza-claro e varie só o recheio. Os neutros
(Zelador, Gêmeo, Estilha, chefe) ficam com a cor própria.

| monstro | id | elem | papel | altura | scale |
|---|---|---|---|---|---|
| Mote do Tempo | `weather-mote` | ar | distância · muda o clima | 0,90 m | 0,50 |
| Estilha-Espelho | `mirror-sliver` | neutro | metade do Gêmeo · explode | 1,10 m | 0,61 |
| Zelador Nulo | `null-warden` | neutro | APOIO · apaga e remenda escudos | 1,85 m | 1,03 |
| Gêmeo-Espelho | `mirror-twin` | neutro | corpo a corpo · racha em dois | 1,95 m | 1,08 |
| Arauto de Vendaval | `gale-herald` | ar | corpo a corpo · rápido | 2,00 m | 1,11 |
| Arauto de Brasa | `cinder-herald` | fogo | distância · semeia brasas | 2,10 m | 1,17 |
| Arauto de Maré | `tide-herald` | água | APOIO · cura em aura | 2,10 m | 1,17 |
| Arauto de Alicerce | `stone-herald` | terra | tanque · imune a empurrão | 2,30 m | 1,28 |
| Raiz-do-Coração | `heartroot` | terra | distância · ancorada | 2,40 m | 1,33 |
| O Coração Partido | `boss-riftheart` | neutro | CHEFE | 3,60 m | 1,22 |

**ENTREGUE em 21/09/2026, de noite — e com isso não falta mais nenhum
monstro no jogo.** Os DEZ saíram do Meshy (o único 10-de-10 desde os
Andaimes): `models-meshy-brokenheart.js`, 16,9 MB, seis clipes em cada um,
1,18 a 1,38 MB por kit. O raio-X achou `attack.glb` com a reação e `hit.glb`
com o golpe **nos dez**, como em todos os lotes anteriores. `MONSTER_LOOK`
recebeu a escada de porte abaixo (0,90 m a 3,60 m, o Coração o maior bicho do
jogo) e nenhum deles veste corpo emprestado — `tests/bestiario.html?calabouco=brokenheart`
fecha 8/8 com `EMPRESTADOS` e `ARRASTA` vazios.

O texto abaixo fica como registro do que foi pedido. Os prompts abaixo são de **texto→3D no Meshy**, que é como os dez
lotes anteriores foram feitos. Se quiser passar um deles pelo Gemini antes
(imagem→3D), acrescente ao fim do prompt: *Single character seen from a
straight-on front view at eye level, plain solid white background, completely
empty, no floor, no shadow on the background, nothing cropped at the edges, no
text, no watermark.* — e lembre que imagem→3D só vê um lado: as costas são
chute.

**Duas correções de 21/09, já aplicadas abaixo:** o Vendaval tinha as placas
"flutuando soltas" (peça solta arruína o auto-rig — agora elas se ligam por
fios de vento) e o chefe tinha estilhaços "orbitando" os ombros (agora presos
por correntes curtas).

**A armadura dos Arautos** (base comum aos quatro prompts): armadura de placas
antiga, cerimonial, vazia — elmo fechado sem rosto, peitoral com uma fresta em
forma de coração no meio, ombreiras largas, manoplas, grevas, uma capa curta
rasgada. Cada Arauto muda só o que sai pela fresta e pelas juntas.

### Arauto de Brasa · `cinder-herald`
Armadura vazia com uma fresta acesa no peito, que semeia brasas no chão como
quem prepara a casa para visitas. Recheio: brasa (quase branca nas frestas),
mão direita com um turíbulo/lança de brasa. Animação: idle · walk · attack
(arremessa brasa) · hit · death.

```
An empty ceremonial suit of ancient plate armor standing on its own as a humanoid herald, closed faceless helmet, breastplate with a heart-shaped crack in the center, wide pauldrons, gauntlets, greaves, a short tattered cape. Glowing embers fill the inside: bright light leaks from the chest crack, the eye slit and every joint, small cinders drifting out. One hand holds a short iron brand with a glowing tip. Full-body humanoid biped standing upright in a relaxed A-pose, two arms and two legs, symmetrical, arms slightly away from the body, feet apart, facing forward. Stylized fantasy game creature, clean readable silhouette, hand-painted look. Near-monochrome light grey materials with the glowing interior painted almost white, all detail in light-and-dark contrast, no saturated colors. Single character, no base, no pedestal, no ground, nothing else in the scene.
```

### Arauto de Maré · `tide-herald`
A mesma armadura, cheia de água escura em movimento. Cura os irmãos e
reorganiza o campo com ressacas. É o **apoio** — precisa ler de longe: água
escorrendo pelas juntas, ondas saindo da fresta, um cajado de coral/âncora.
Animação: idle · walk · attack = cast (hino da maré) · hit · death (a água
escoa e a armadura cai vazia).

```
An empty ceremonial suit of ancient plate armor standing on its own as a humanoid herald, closed faceless helmet, breastplate with a heart-shaped crack in the center, wide pauldrons, gauntlets, greaves, a short tattered cape. Dark moving water fills the inside: water pours from the chest crack and drips from every joint, small waves and foam curling out of the helmet slit, wet streaks down the plates. One hand holds a tall staff topped with a coral-encrusted anchor. Full-body humanoid biped standing upright in a relaxed A-pose, two arms and two legs, symmetrical, arms slightly away from the body, feet apart, facing forward. Stylized fantasy game creature, clean readable silhouette, hand-painted look. Near-monochrome light grey materials with the water inside painted almost white, all detail in light-and-dark contrast, no saturated colors. Single character, no base, no pedestal, no ground, nothing else in the scene.
```

### Arauto de Alicerce · `stone-herald`
A armadura preenchida por fundação: pedra, cal e teimosia de mil anos. Fica
entre você e a sala e considera isso trabalho honesto. O **tanque**: mais
largo, escudo-torre de pedra, pedra e argamassa saindo das juntas. Animação:
idle · walk (pesado) · attack (soco) · hit (nem recua) · death.

```
An empty ceremonial suit of ancient plate armor standing on its own as a humanoid herald, closed faceless helmet, breastplate with a heart-shaped crack in the center, wide pauldrons, gauntlets, greaves, a short tattered cape. Packed stone and mortar fill the inside: rough masonry blocks bulge out of the chest crack and every joint, lime dust on the plates, the armor visibly heavier and broader than it should be. One arm carries a huge tower shield made of a single slab of foundation stone. Full-body humanoid biped standing upright in a relaxed A-pose, two arms and two legs, symmetrical, arms slightly away from the body, feet apart, facing forward. Stylized fantasy game creature, clean readable silhouette, hand-painted look. Near-monochrome light grey materials, all detail in light-and-dark contrast, no saturated colors. Single character, no base, no pedestal, no ground, nothing else in the scene.
```

### Arauto de Vendaval · `gale-herald`
A armadura vazia de verdade — só o vento dentro dela é que a mantém de pé, e o
vento tem pressa. Chega, corta e já está em outro lugar. **As placas flutuam
separadas**, com vãos de ar entre elas, capa esvoaçando, duas lâminas curvas.
Animação: idle (as placas oscilam) · run · attack (corte duplo) · hit · death
(as placas caem soltas).

```
An empty ceremonial suit of ancient plate armor standing on its own as a humanoid herald, closed faceless helmet, breastplate with a heart-shaped crack in the center, wide pauldrons, gauntlets, greaves. This one is truly hollow: the plates sit slightly apart from each other with visible gaps of air between helmet, chest, arms and legs and nothing inside, but every plate is joined to its neighbour by thick twisting streams of wind so the whole figure is one connected body, a long cape and ribbons streaming as if in strong wind. Each hand holds a thin curved blade. Full-body humanoid biped standing upright in a relaxed A-pose, two arms and two legs, symmetrical, arms slightly away from the body, feet apart, facing forward. Stylized fantasy game creature, clean readable silhouette, hand-painted look. Near-monochrome light grey materials, all detail in light-and-dark contrast, no saturated colors. Single character, no base, no pedestal, no ground, nothing else in the scene.
```

### Zelador Nulo · `null-warden`
O funcionário que sobrou: um vulto cinzento de avental, sem elemento nenhum,
que apaga proteções alheias e remenda as dos irmãos. Neutro (fica cinza
mesmo). Um **zelador**: avental, chaveiro pesado, vassoura de cerdas de pedra
ou esfregão, lanterna apagada, rosto liso sem traços. Animação: idle · walk ·
attack = cast (varre) · hit · death.

```
A grey caretaker wraith: a tall thin humanoid figure in a long worn work apron over a plain tunic, a completely smooth featureless grey face, bald head, thin arms, one hand holding a long-handled broom with stiff stone bristles, a heavy ring of old keys and a dead lantern hanging from the belt, dust on the shoulders, worn boots. Full-body humanoid biped standing upright in a relaxed A-pose, two arms and two legs, symmetrical, arms slightly away from the body, feet apart, facing forward. Stylized fantasy game creature, clean readable silhouette, hand-painted look. Muted desaturated colors: cool grey skin, faded grey-brown cloth, dull brass keys, all detail in light-and-dark contrast. Single character, no base, no pedestal, no ground, nothing else in the scene.
```

### Gêmeo-Espelho · `mirror-twin`
Caco de espelho do tamanho de uma pessoa que anda de lado e mostra, com um
turno de atraso, a sua própria silhueta batendo em você. Quebrá-lo só cria
mais superfícies. Neutro. **Vulto chapado e afiado**: corpo humanoide de vidro
espelhado, fino como uma placa visto de lado, bordas quebradas, uma silhueta
humana vaga refletida dentro. Animação: idle · walk · attack (corte com a
borda) · hit · death (racha em dois — importa).

```
A mirror twin: a humanoid figure made of a single large shard of mirror glass, flat and thin like a standing pane, with jagged broken edges along the outline, a reflective silvered surface showing a faint blurred human silhouette inside it, cracks spreading from the chest, arms and legs as narrower glass shards, a head as a pointed shard with no face. Full-body humanoid biped standing upright in a relaxed A-pose, two arms and two legs, symmetrical, arms slightly away from the body, feet apart, facing forward. Stylized fantasy game creature, clean readable silhouette, hand-painted look. Muted desaturated colors: silver, pale grey and dark reflections, all detail in light-and-dark contrast. Single character, no base, no pedestal, no ground, nothing else in the scene.
```

### Estilha-Espelho · `mirror-sliver`
Caco menor, mais afiado, com metade do seu rosto ainda preso na superfície.
Ao se despedaçar, corta quem está perto. Mesmo vocabulário do Gêmeo, **menor e
mais pontudo**. Animação: idle · run · attack · hit · death (estoura).

```
A mirror sliver: a small humanoid made of a sharp splinter of mirror glass, thin flat body with jagged pointed edges, silvered reflective surface with half of a blurred face reflected in the chest, thin shard arms and legs, a pointed shard head. Full-body humanoid biped standing upright in a relaxed A-pose, two arms and two legs, symmetrical, arms slightly away from the body, feet apart, facing forward. Stylized fantasy game creature, clean readable silhouette, hand-painted look. Muted desaturated colors: silver, pale grey and dark reflections, all detail in light-and-dark contrast. Single character, no base, no pedestal, no ground, nothing else in the scene.
```

### Mote do Tempo · `weather-mote`
Bolinha de ar comprimido do tamanho de um punho, girando devagar, com um
pedacinho de céu velho preso dentro. Muda o clima da sala sozinho. Bicho
pequeno (0,90 m): **a esfera de céu é o tronco e a cabeça**, braços de vento,
pernas de nuvem. Tinta lilás; o céu dentro quase branco. Animação: idle (gira)
· walk (flutua) · attack = cast (vira o tempo) · hit · death (a esfera estoura).

```
A weather mote: a tiny humanoid whose head and torso are one glassy sphere of compressed air with a small fragment of old sky trapped inside — a swirl of cloud and a glimmer of sunlight — two thin arms of curling wind wisps, two short legs made of small cloud puffs, faint spiral lines around the sphere showing slow rotation. Full-body humanoid biped standing upright in a relaxed A-pose, two arms and two legs, symmetrical, arms slightly away from the body, feet apart, facing forward. Stylized fantasy game creature, clean readable silhouette, hand-painted look. Near-monochrome light grey materials with the sky inside painted almost white, all detail in light-and-dark contrast, no saturated colors. Single character, no base, no pedestal, no ground, nothing else in the scene.
```

### Raiz-do-Coração · `heartroot`
Raiz grossa que saiu da parede e atravessou o salão para abraçar o Coração e
mantê-lo colado. Falhou; continua tentando e agarra o que passa. Ancorada.
**Regra da Vergasta**: torso que sobe de uma base de raízes (pernas modeladas
escondidas dentro), braços = duas raízes compridas com gavinhas que agarram,
cabeça = um nó de raiz partido ao meio. Animação: idle · walk · attack (agarra)
· hit · death (seca e cai).

```
A heartroot: a humanoid mass of thick twisted tree roots rising from a knotted root base that hides the legs, torso of braided roots with bark and moss, two very long root arms ending in grasping tendrils and hooked rootlets, a head that is a large split knot of root with a dark crack down the middle, small stones and dust caught in the bark, a few fine hair roots trailing. Full-body humanoid biped standing upright in a relaxed A-pose, two arms, symmetrical, arms slightly away from the body, facing forward. Stylized fantasy game creature, clean readable silhouette, hand-painted look. Near-monochrome light grey materials, all detail in light-and-dark contrast, no saturated colors. Single character, no base, no pedestal, no ground, nothing else in the scene.
```

### O Coração Partido · `boss-riftheart` — CHEFE
O último Coração do mundo enterrado, rachado em quatro quartos que ainda batem
fora de compasso — brasa, água, pedra, ar. Cada batida troca o clima da sala.
Ele É o que sobrou do céu, e está morrendo alto. É o maior bicho do jogo
(3,60 m, o teto). Três tempos: **o coração de pedra rachado em quatro no
tronco, as correntes que o seguram, o vazio onde seria a cabeça.** Neutro: aqui
a cor pode entrar — cada quarto com o seu matiz discreto (laranja, azul, verde,
lilás) sobre a pedra cinza. Animação: idle (bate fora de compasso) · walk ·
attack (batida de um quarto) · cast (tempestade de estilhaços) · hit · death
(os quatro quartos se separam).

```
A colossal broken-heart boss: a giant humanoid whose entire torso is an enormous stone heart cracked into four quarters held together by heavy chains and roots, each quarter of a different nature — one quarter glowing with ember cracks, one streaming with dark water, one of rough packed rock, one hollow and carved by wind with air gaps — the cracks between quarters glowing, no head, just an empty gap of light above the shoulders, thick arms of layered stone wrapped in chain, legs of cracked basalt, small stone shards held out from the shoulders by short taut chains, every shard attached. Full-body humanoid biped standing upright in a relaxed A-pose, two arms and two legs, symmetrical, arms slightly away from the body, feet apart, facing forward. Stylized fantasy game boss creature, clean readable silhouette, hand-painted look. Mostly grey stone with subtle muted tints on the four quarters: dim orange, dim blue, dim green, dim lilac, the cracks painted almost white, all detail in light-and-dark contrast. Single character, no base, no pedestal, no ground, nothing else in the scene.
```

---

# 5 · Um extra do Rebanho do Invocador — Esporinho

O `sporeling` (Esporinho, terra, invocação do Invocador) é o único do Rebanho
que ainda veste sapo emprestado — os outros nove são seus. Fica em
`...\assets_ok\mapa\<qualquer lote>\...` ou na pasta das invocações; o
embutidor das invocações (`tools/embute_invocacoes_meshy.py`) é quem o recebe.
Altura 0,85 m (`scale` 0,47). Animação: idle · run · attack (mordida) · hit ·
death (estoura em esporos).

```
A baby mushroom sporeling: a tiny humanoid with a big round mushroom cap as its head, huge oversized eyes and a wide mouth with small sharp teeth on the stem-face below the cap, a short plump stem body, little stubby arms and legs, a few tiny mushrooms sprouting from the cap, soft spore puffs around it. Full-body humanoid biped standing upright in a relaxed A-pose, two arms and two legs, symmetrical, arms slightly away from the body, feet apart, facing forward. Stylized fantasy game creature, clean readable silhouette, hand-painted look. Near-monochrome light grey materials, all detail in light-and-dark contrast, no saturated colors. Single character, no base, no pedestal, no ground, nothing else in the scene.
```

---

# 6 · O CENÁRIO — quatro kits, um por portal

O kit de cada calabouço segue o formato da Estufa e da Cisterna
(`JOGO.CENARIO[tema]`), com estes papéis:

| papel | o que é | tamanho em jogo | quantas |
|---|---|---|---|
| `baixo` / `alto` | **muro**: módulo que emenda em fileira; o renderizador o usa a 0,95 m (divisória) e o estica a 3,10 m (parede) | módulo ~2 m de largura, ~1 m de altura, topo reto, laterais retas, base em y=0 | 2 obrigatórios (inteiro e com brecha) + 1 ou 2 variantes |
| `pilar` | poste isolado, esbelto | 3,10 m, estreito | 1 ou 2 |
| `marco` | a peça monumental que aparece **uma vez por sala** (regra do aquário) | ~3,4 m de largura, até 3,10 m de altura; pode ter partes soltas dentro | 1 |
| `sotaque` | enfeite pontual no miolo de uma fileira de muretas; **volume vertical, nunca tampo plano** | 0,85 a 1,60 m | 4 a 6 |
| `sotaque_alto` | enfeite alto no meio das paredes | ~3,10 m | 3 |
| `chao` | enfeite de piso, sem colisão | baixo, até 0,25–0,50 m | 3 ou 4 |
| `borda` | fora da arena; pode reaproveitar sotaques | livre | 2 ou 3 |

Diferente dos monstros, **o cenário NÃO é tingido pelo jogo** — a cor da peça
é a que você assar. Use a paleta do calabouço, discreta, com o desenho no
claro-escuro para casar com os monstros. Enfeites podem vir **vários por
folha** (a regra do Jardim: peças enfileiradas, vão claro entre elas, cada uma
apoiada no chão, `separa_cenario.py` recorta). **Muro, pilar e marco vão um por
arquivo.** Sem animação, sem esqueleto.

Pasta: `...\assets_ok\mapa\<Nome do calabouço>\muros\`.

Sufixo que fecha todo prompt de peça única:

> Game-ready environment prop, stylized hand-painted look, clean readable
> silhouette, standing on the ground with its base flat at floor level, single
> object, no ground plane, no background, nothing else in the scene.

E o de folha com várias peças:

> Several separate game-ready environment props arranged in a single row side
> by side with clear empty gaps between them, each standing on the ground with
> its base flat at the same floor level, front three-quarter view, stylized
> hand-painted look, clean readable silhouettes, no ground plane, no background,
> nothing else in the scene.

## 6.1 · Andaimes do Vento (`scaffold`) — prefixo sugerido `av_`

**Estado em 19/09:** os dez monstros já estão gerados em
`assets_ok\mapa\Andaimes do vento\`. Este é o kit de cenário, no mesmo formato
que o Fecho entregou: **muro, muro quebrado e pilar um por arquivo**, e os
enfeites em **três folhas**, com o nome de cada peça no nome do arquivo
separado por `-` (é assim que `tools/separa_pecas.py` sabe quantas peças
recortar).

```
C:\Users\danie\Downloads\assets_ok\mapa\Andaimes do vento\
    muros\muro.glb
    muros\muro quebrado.glb
    muros\pilar.glb
    itens mapa\Caixa de ferramentas aberta-Saco de brita de lastro-Roldana caída-Rolo de cabo de aço-Estrado de tábuas com balde.glb
    itens mapa\Chaminé de ventilação-Mastro com bandeirola-Torre de andaime com escada-Guindaste travado.glb
    itens mapa\Grade de respiradouro-Tábuas soltas com pregos-Ninho de picanço na serragem-Elevador de obra parado-Passarela quebrada-Barraca de turno.glb
```

Paleta da casa (o cenário não leva tinta do jogo, a cor é sua): madeira
envelhecida oliva-parda, ferro cinza-azulado, corda de cânhamo, lona quase
branca. Tudo range, nada foi feito para durar. Três regras de sempre: nada de
tampo plano sem coisa em cima, volume vertical, base apoiada no chão.

### Os muros — um por arquivo

**Muro com uma viga em cada lado** · `muros\muro.glb` · papel `alto`/`baixo`
O módulo que se enfileira. As duas vigas nas pontas sobem um pouco acima das
tábuas, como as pilastras do muro do Fecho: o renderizador mede o corpo e
estica até 3,10 m (`alto_corpo: 'auto'`). Topo reto, laterais retas, sem
beirada, para cinco cópias lerem como um tapume só.
```
A modular construction hoarding wall segment: a row of vertical weathered wooden planks nailed side by side, with a thick square timber beam standing upright at each end rising a little above the planks, a horizontal rope-and-plank guard rail along the top edge, exposed bent nail heads and rope lashings around the beams, flat straight top, straight flush sides so copies join end to end seamlessly, about twice as wide as it is tall, weathered olive-brown timber, grey-blue iron nails, hemp rope, stylized 3D cartoon game prop, toon shading, hand-painted look, bold clean silhouette, single object, no ground, no base, no background
```

**Muro quebrado** · `muros\muro quebrado.glb` · papel `alto`/`baixo`
O mesmo módulo, com as tábuas do meio arrancadas pelo vento.
```
A modular construction hoarding wall segment broken in the middle: vertical weathered wooden planks between a thick square timber beam standing upright at each end, three planks in the center splintered and missing leaving a jagged gap, the rope guard rail along the top snapped and sagging into the gap, broken plank stubs and splinters at the foot, flat straight top on the remaining planks, straight flush sides so copies join end to end, about twice as wide as it is tall, weathered olive-brown timber, grey-blue iron nails, hemp rope, stylized 3D cartoon game prop, toon shading, hand-painted look, bold clean silhouette, single object, no ground, no base, no background
```

**Viga** · `muros\pilar.glb` · papel `pilar`
A pontuação da parede a cada quatro casas: uma viga só, de pé, muito mais alta
que larga, com o prumo pendurado — o adereço da casa.
```
A single tall square timber beam standing upright like a scaffold post, weathered olive-brown wood with visible grain and cracks, thick hemp rope lashed around it at two heights, a grey-blue iron strap with rivets near the top, a wooden wedge at the base, a small iron plumb bob hanging from a nail on a short cord, much taller than wide, stylized 3D cartoon game prop, toon shading, hand-painted look, bold clean silhouette, single object, no ground, no base, no background
```

### Folha 1 — sotaques (0,95 m, dentro da arena, no miolo das muretas)

`itens mapa\Caixa de ferramentas aberta-Saco de brita de lastro-Roldana caída-Rolo de cabo de aço-Estrado de tábuas com balde.glb`

**Caixa de ferramentas aberta** · `sotaque`
```
An open wooden toolbox standing on end with hammers, chisels and a hand saw sticking up out of it, iron corner brackets, a coil of rope hanging from the handle, weathered olive-brown wood and grey-blue iron, stylized 3D cartoon game prop, toon shading, hand-painted look, bold clean silhouette, single object, no ground, no base, no background
```

**Saco de brita de lastro** · `sotaque`
```
A tall bulging burlap sack of gravel ballast tied at the neck with rope, leaning slightly, a few small stones spilling from a torn seam near the bottom, coarse dusty burlap, stylized 3D cartoon game prop, toon shading, hand-painted look, bold clean silhouette, single object, no ground, no base, no background
```

**Roldana caída** · `sotaque`
```
A large wooden pulley block lying on its side with a thick coil of hemp rope spilling out of it, a grey-blue iron hook and axle, worn olive-brown wood, stylized 3D cartoon game prop, toon shading, hand-painted look, bold clean silhouette, single object, no ground, no base, no background
```

**Rolo de cabo de aço** · `sotaque`
```
A big wooden cable spool standing upright at knee height wound with dark steel cable, the loose cable end trailing off to one side, iron bands around the spool flanges, weathered olive-brown wood and grey-blue steel, stylized 3D cartoon game prop, toon shading, hand-painted look, bold clean silhouette, single object, no ground, no base, no background
```

**Estrado de tábuas com balde** · `sotaque` · o balde em cima quebra a leitura de placa
```
A waist-high stack of wooden scaffold planks bound with rope every hand-span, a dented iron bucket and a coiled rope resting on top, uneven plank ends sticking out, weathered olive-brown wood, hemp rope, grey-blue iron, stylized 3D cartoon game prop, toon shading, hand-painted look, bold clean silhouette, single object, no ground, no base, no background
```

### Folha 2 — sotaques altos (3,10 m) e o marco

`itens mapa\Chaminé de ventilação-Mastro com bandeirola-Torre de andaime com escada-Guindaste travado.glb`

**Chaminé de ventilação** · `sotaque_alto` · por onde os respiradouros sopram
```
A tall riveted sheet-metal ventilation chimney, a narrow vertical duct with a curved cowl hood at the top, dents and patina along its length, grey-blue metal with rust streaks, tall vertical prop, stylized 3D cartoon game prop, toon shading, hand-painted look, bold clean silhouette, single object, no ground, no base, no background
```

**Mastro com bandeirola** · `sotaque_alto` · o vento que se vê
```
A tall timber mast with a torn work flag at the top and a sheet of off-white canvas tied halfway up billowing as if in strong wind, rope guy lines tied to the pole, weathered olive-brown wood, hemp rope, tall vertical prop, stylized 3D cartoon game prop, toon shading, hand-painted look, bold clean silhouette, single object, no ground, no base, no background
```

**Torre de andaime com escada** · `sotaque_alto` · o parente parado de Cambota
```
A two-level scaffold tower of four upright timber poles lashed with rope and diagonal cross-braces, a plank platform on top, a wooden ladder leaning against one side, a hanging bucket on a rope, weathered olive-brown wood, hemp rope, grey-blue iron clamps, tall vertical prop, stylized 3D cartoon game prop, toon shading, hand-painted look, bold clean silhouette, single object, no ground, no base, no background
```

**Guindaste travado** · `marco` · um por sala, até 3,4 m
```
A large jammed construction crane: a tall wooden A-frame mast with a long horizontal jib arm, a big wooden pulley wheel at the tip, steel cable hanging down ending in an iron hook, a hand-cranked winch drum with a locked ratchet at the base, rope bindings, a torn flag on the mast, wide stable timber footprint, imposing front face, weathered olive-brown wood, grey-blue steel, hemp rope, stylized 3D cartoon game prop, toon shading, hand-painted look, bold clean silhouette, single object, no ground, no base, no background
```

### Folha 3 — chão (baixo, sem colisão) e borda (fora da arena)

`itens mapa\Grade de respiradouro-Tábuas soltas com pregos-Ninho de picanço na serragem-Elevador de obra parado-Passarela quebrada-Barraca de turno.glb`

Para o catálogo, `chao_alt: 0.4` como no Fecho — a 0,25 m a grade vira selo.

**Grade de respiradouro** · `chao`
```
A flat square floor grate of grey-blue perforated metal with thick crossing bars, two bars bent and broken, a scorched iron frame around it, very low profile floor prop, stylized 3D cartoon game prop, toon shading, hand-painted look, bold clean silhouette, single object, no ground, no base, no background
```

**Tábuas soltas com pregos** · `chao`
```
Three loose weathered wooden planks lying side by side on the floor with gaps between them, bent nails sticking up from the boards, a few splinters scattered around, olive-brown wood and grey-blue iron, very low profile floor prop, stylized 3D cartoon game prop, toon shading, hand-painted look, bold clean silhouette, single object, no ground, no base, no background
```

**Ninho de picanço na serragem** · `chao` · a despensa do Picanço
```
A low pile of pale sawdust swept into a spiral by wind with a small bird nest of twigs sitting in the middle, tiny bones and a few bent nails inside the nest, very low profile floor prop, stylized 3D cartoon game prop, toon shading, hand-painted look, bold clean silhouette, single object, no ground, no base, no background
```

**Elevador de obra parado** · `borda`
```
A construction hoist elevator: an iron mesh cage stopped between floors on a short section of two vertical guide rails, a chain hanging above the cage from a broken pulley, a plank floor inside, grey-blue riveted iron with rust, weathered olive-brown wood, large background prop, stylized 3D cartoon game prop, toon shading, hand-painted look, bold clean silhouette, single object, no ground, no base, no background
```

**Passarela quebrada** · `borda` · termina no ar
```
A short wooden footbridge of planks with rope railings on two timber posts that ends abruptly in splintered broken boards in mid-air, rope ends dangling, weathered olive-brown wood, hemp rope, large background prop, stylized 3D cartoon game prop, toon shading, hand-painted look, bold clean silhouette, single object, no ground, no base, no background
```

**Barraca de turno** · `borda`
```
A small work-shift tent of off-white canvas stretched over wooden poles and pegged with rope, one door flap loose and blowing open, a dead lantern hanging at the entrance, a stool just inside, weathered olive-brown wood, hemp rope, large background prop, stylized 3D cartoon game prop, toon shading, hand-painted look, bold clean silhouette, single object, no ground, no base, no background
```

Como o Fecho fez, a chaminé e a torre de andaime podem repetir na `borda` no
catálogo, sem gerar de novo.

## 6.2 · Fecho de Brasa (`forge`) — ENTREGUE em 19/09 (`cenario-fecho.js`, prefixo `fj_`)

Registro do que foi pedido; o kit real tem 2 muros + pilar, forno como marco,
3 sotaques altos, 6 sotaques, 3 de chão e 3 de borda.

Paleta: ferrugem alaranjada (`#c4502e`), marrom-escuro queimado (`#4a2a26`),
âmbar de brasa (`#ffb347`), ferro escuro. A luz vem de baixo, das grelhas.

**Muro inteiro: mureta de tijolo refratário** · `fb_muro_inteiro`
```
A modular low wall of refractory fire bricks, faces glazed and vitrified by heat with a glassy dark sheen, mortar joints cracked, a flat straight top course, straight flush ends so copies join seamlessly, a band of dark iron strapping along the top edge with rivets, soot streaks, about twice as wide as it is tall. Colors: burnt orange-red brick, dark brown scorch, dark iron. Game-ready environment prop, stylized hand-painted look, clean readable silhouette, standing on the ground with its base flat at floor level, single object, no ground plane, no background, nothing else in the scene.
```

**Muro com brecha** · `fb_muro_brecha`
```
A modular low wall of refractory fire bricks with a collapsed breach in the middle: bricks fallen away leaving a jagged gap down to a few courses, loose bricks piled at the foot of the gap, faces glazed by heat, flat straight top on the remaining sections, straight flush ends, iron strapping along the top broken at the gap, soot streaks, about twice as wide as it is tall. Colors: burnt orange-red brick, dark brown scorch, dark iron. Game-ready environment prop, stylized hand-painted look, clean readable silhouette, standing on the ground with its base flat at floor level, single object, no ground plane, no background, nothing else in the scene.
```

**Muro de lingotes** · `fb_muro_lingotes` (variante)
```
A modular low wall built from stacked iron ingots laid in a criss-cross pattern like a wood pile, dull dark metal with a few ingots still glowing faintly at the edges, flat straight top, straight flush ends so copies join seamlessly, about twice as wide as it is tall. Colors: dark iron grey, rust, faint amber glow. Game-ready environment prop, stylized hand-painted look, clean readable silhouette, standing on the ground with its base flat at floor level, single object, no ground plane, no background, nothing else in the scene.
```

**Cerca de correntes** · `fb_muro_correntes` (variante)
```
A modular low barrier of heavy iron chains hung in two sagging rows between two short square iron posts at the ends, thick links, hooks at the post tops, flat top line at post height, straight flush ends so copies join seamlessly, scorch marks on the posts, about twice as wide as it is tall. Colors: dark oiled iron, rust orange. Game-ready environment prop, stylized hand-painted look, clean readable silhouette, standing on the ground with its base flat at floor level, single object, no ground plane, no background, nothing else in the scene.
```

**Pilar: chaminé de tijolo** · `fb_pilar`
```
A tall narrow refractory brick forge chimney column, square section, soot running down from the top, iron bands around it at intervals, a small arched vent near the base glowing faintly, much taller than wide. Colors: burnt orange-red brick, black soot, dark iron, faint amber glow. Game-ready environment prop, stylized hand-painted look, clean readable silhouette, standing on the ground with its base flat at floor level, single object, no ground plane, no background, nothing else in the scene.
```

**Marco: fornalha apagada do tamanho de uma casa** · `fb_marco_fornalha` (1× por sala)
```
A huge dead foundry furnace like a small house: a wide squat brick body with a big arched iron furnace door standing half open showing a dark cold interior with a few faint embers, a heavy iron chimney stack rising from the top, bellows nozzle on one side, iron bands and rivets, ash spilling from the mouth, chains hanging from a beam above the door, about as wide as it is tall. Colors: burnt orange-red brick, dark iron, black soot, dim amber. Game-ready environment prop, stylized hand-painted look, clean readable silhouette, standing on the ground with its base flat at floor level, single object, no ground plane, no background, nothing else in the scene.
```

**Folha de sotaques** (5 peças) · `fb_bigorna`, `fb_carrinho_carvao`, `fb_molde`, `fb_fosso`, `fb_fole`
```
Several separate game-ready environment props arranged in a single row side by side with clear empty gaps between them: (1) a heavy old anvil on a thick wooden stump with a hammer resting on it, (2) a small iron coal cart on two wheels heaped with coal, (3) a cracked sand casting mold, a rectangular wooden frame full of packed sand with a sword-shaped hollow, standing on end and leaning, (4) a square quenching pit with a raised brick rim and dry cracked mud inside, a broken blade sticking out, (5) a giant slumped leather bellows with wooden handles, collapsed and creased. Each standing on the ground with its base flat at the same floor level, front three-quarter view, stylized hand-painted look, clean readable silhouettes. Colors: dark iron, burnt orange brick, scorched dark brown leather and wood, black coal. No ground plane, no background, nothing else in the scene.
```

**Folha de sotaques altos** (3 peças) · `fb_feixe_correntes`, `fb_prensa`, `fb_rack`
```
Several separate game-ready environment props arranged in a single row side by side with clear empty gaps between them, all tall and narrow: (1) a bundle of heavy iron chains hanging straight down from an iron ceiling bracket to a coiled heap on the floor, hooks and shackles among the links, (2) a tall iron forge press frozen mid-stroke, a screw column with a big wheel on top and a flat die pressing down on a glowing ingot, (3) a tall iron tool rack with hammers, tongs, files and a huge sledgehammer hanging from hooks. Each standing on the ground with its base flat at the same floor level, front three-quarter view, stylized hand-painted look, clean readable silhouettes. Colors: dark oiled iron, rust, dim amber glow. No ground plane, no background, nothing else in the scene.
```

**Folha de chão** (4 peças baixas) · `fb_grelha`, `fb_poca_metal`, `fb_fuligem`, `fb_marca_bigorna`
```
Several separate flat low game-ready floor props arranged in a single row side by side with clear empty gaps between them, all very low and lying on the floor: (1) a square iron floor grate with embers glowing between the bars underneath, (2) a puddle of solidified metal spilled on the floor with a rough rippled surface and a few splashes, (3) a black scorch stain of soot in a ring with scattered metal filings and dead sparks, (4) a square stone floor slab with the deep imprint of an anvil base pressed into it and cracks radiating out. Each lying on the ground with its base flat at the same floor level, front three-quarter view, stylized hand-painted look, clean readable silhouettes. Colors: dark iron, amber ember glow, black soot, dark brown stone. No ground plane, no background, nothing else in the scene.
```

**Folha de borda** (3 peças) · `fb_forno_fundicao`, `fb_vagoneta_lingote`, `fb_sino`
```
Several separate game-ready environment props arranged in a single row side by side with clear empty gaps between them: (1) a dead smelting furnace, a round brick tower with a dark arched mouth at the base and a tapping spout, iron bands, (2) an iron ingot cart on a short piece of rail track heaped with dull ingots, (3) an end-of-shift bell hanging in a wrought iron arch on a stone base, rope hanging from the clapper. Each standing on the ground with its base flat at the same floor level, front three-quarter view, stylized hand-painted look, clean readable silhouettes. Colors: burnt orange brick, dark iron, rust, dull bronze. No ground plane, no background, nothing else in the scene.
```

## 6.3 · Mina Trêmula (`mine`) — prefixo `mt_` — **ENTREGUE em 21/09** (`cenario-mina.js`)

Paleta: ocre (`#8a7043`), marrom-escuro (`#3b3228`), latão dourado (`#c9a227`),
rocha cinza-parda. Tudo abandonado no meio de uma tarefa. Lembre que **o
cenário NÃO é tingido pelo jogo**: a cor que você assar é a cor final.

> **21/09/2026 — o caminho mudou.** O cenário da Mina não vai por texto no
> Meshy: o dono gera primeiro **uma imagem no Gemini** com as peças lado a
> lado, e essa imagem é que entra no Meshy (imagem→3D). São **três arquivos**,
> 19 peças no total. Os prompts abaixo são **prompts de imagem**, não de
> modelo: por isso falam de câmera, fundo, luz e enquadramento, que é o que o
> Meshy lê depois.
>
> Três regras que valem para as três folhas, e que decidem se o lote presta:
> 1. **Vão claro entre as peças, nenhuma encostada.** Peça encostada na
>    vizinha não se separa por distância nenhuma — foi o que custou caro no
>    Fecho de Brasa. É a regra mais importante das três.
> 2. **Fundo branco liso, sem chão, sem sombra projetada, sem degradê.** O
>    Meshy reconstrói o que vê; sombra no fundo vira geometria.
> 3. **Mesma câmera para todas as peças da folha, bases alinhadas na mesma
>    linha.** Na folha 3 a câmera é mais alta de propósito, porque peça
>    rasteira vista de frente vira um risco no papel.
>
> E uma coisa que o texto→3D não tinha: **imagem→3D só vê um lado**. As costas
> são chute do Meshy. Por isso os muros vão na folha 1 em **vista frontal
> reta** — é o que dá ponta reta para as cópias emendarem em fileira.

### Folha 1 — a parede (6 peças) · vista frontal reta

`mt_muro_inteiro` · `mt_muro_brecha` · `mt_muro_entulho` · `mt_muro_escora` ·
`mt_pilar` · `mt_marco_broca`

Papéis: os quatro primeiros são **muro** (o renderizador usa a 0,95 m como
divisória e estica a 3,10 m como parede); `mt_pilar` é **pilar**; a broca é o
**marco**, a peça monumental que aparece uma vez por sala.

```
A game asset reference sheet: six separate stylized fantasy mine structures arranged in one horizontal row, evenly spaced, with a clear empty gap between every object, none touching and none overlapping. From left to right: (1) a modular low wall of rough dry-stacked quarry stone, irregular blocks fitted without mortar, a flat straight top course of flatter stones, straight vertical flush ends, about twice as wide as it is tall; (2) the same modular low wall with a collapsed section in the middle, blocks tumbled into a low heap leaving a jagged gap, flat straight top on the remaining sections, straight vertical flush ends; (3) a modular low retaining wall of mine rubble held back by vertical wooden boards staked into the ground with a horizontal timber rail along the top, loose rock and gravel heaped behind and spilling through the gaps between boards, straight vertical flush ends; (4) a modular low mine shoring barrier, two thick square timber posts at the ends with a heavy horizontal timber beam across the top at waist height, diagonal wooden braces and hammered wedges, straight vertical flush ends; (5) a tall narrow mine shoring post, a thick squared timber column with a short cap beam stub on top and wooden wedges, rope-bound splits in the wood, a rusty iron bracket and a dead carbide lantern hanging from a nail, much taller than it is wide; (6) a large mining drill rig jammed into a boulder, a heavy iron machine on a timber sled base with a long steel drill bit driven halfway into a big rough rock outcrop, a flywheel and crank on the side, pipes and a pressure gauge, chains tied to the sled, ore chips around the bit. All six seen from a straight-on front view at eye level, flat orthographic framing with no perspective distortion, the same camera for every object, all standing on the same invisible ground line with their bases aligned. Stylized hand-painted low-poly game art, matte surfaces, clean readable silhouettes. Colors: ochre-brown and grey quarry stone, dark aged brown timber, rusty iron, a little brass. Soft even frontal studio lighting, no cast shadows, no dramatic highlights. Plain solid white background, completely empty, no floor, no horizon, no gradient, no shadow on the background. Every object fully visible, nothing cropped at the edges. No text, no labels, no numbers, no watermark, no frame, no people. Wide landscape 16:9 image.
```

### Folha 2 — o que fica de pé (7 peças) · três-quartos, 30° acima

`mt_estalagmite` · `mt_silo` · `mt_porta_lacrada` (os três **sotaque_alto**,
~3,10 m, no meio das paredes) · `mt_vagonete` · `mt_dinamite` · `mt_esteril` ·
`mt_gaiola_canario` (os quatro **sotaque**, 0,85 a 1,60 m, no miolo das
muretas — todos volume vertical, nenhum com tampo plano).

```
A game asset reference sheet: seven separate stylized fantasy mine props arranged in one horizontal row, evenly spaced, with a clear empty gap between every object, none touching and none overlapping. From left to right: (1) a thick tall stalagmite of layered rock with a ring of small pale crystals growing at its base; (2) a tall wooden ore silo, a narrow cylindrical tower of planks bound with iron hoops, a chute at the bottom with ore spilling out of it; (3) a sealed mine gallery door, a tall arched timber door frame boarded shut with crossed planks nailed over it, a heavy chain and a padlock; (4) a small iron mine cart tipped over on its side with ore spilling out and one wheel off; (5) a wooden crate of dynamite sticks standing upright, the lid half open, a coil of fuse hanging over the edge; (6) a tall conical pile of waste rock and gravel with a shovel stuck into it; (7) a canary cage on a tall wooden stand, an empty domed bird cage hanging from a hook at the top of the post, a mining helmet with a dead carbide lamp hung on the same post below it. The first three are tall and narrow, the last four are about waist to chest height. All seven seen from the same three-quarter view about thirty degrees above eye level, the same camera for every object, all standing on the same invisible ground line with their bases aligned. Stylized hand-painted low-poly game art, matte surfaces, clean readable silhouettes. Colors: ochre and grey rock, dark aged brown timber, rusty iron, brass, pale crystal. Soft even studio lighting, no cast shadows, no dramatic highlights. Plain solid white background, completely empty, no floor, no horizon, no gradient, no shadow on the background. Every object fully visible, nothing cropped at the edges. No text, no labels, no numbers, no watermark, no frame, no people. Wide landscape 16:9 image.
```

### Folha 3 — o chão e a borda (6 peças) · três-quartos, 40° acima

`mt_trilho` · `mt_rachadura` · `mt_cristal_aflorando` · `mt_pegadas` (os quatro
**chao**, rasteiros, sem colisão) · `mt_boca_galeria` · `mt_guindaste_poco`
(as duas **borda**, fora da arena).

A câmera desta folha é mais alta que a da folha 2 **de propósito**: peça
rasteira vista de frente vira um risco no papel, e sai do Meshy com sete
centímetros de altura. Foi o que aconteceu com a grade e as tábuas dos
Andaimes.

```
A game asset reference sheet: six separate stylized fantasy mine props arranged in one horizontal row, evenly spaced, with a clear empty gap between every object, none touching and none overlapping. From left to right: (1) a straight section of narrow mine cart rail track on wooden sleepers with gravel ballast, lying flat on the ground; (2) a deep jagged crack in the rock floor with a faint pale glow coming from inside, lying flat on the ground; (3) a low cluster of pale quartz crystals breaking up through the floor stone; (4) a patch of thick dust with a trail of boot prints pressed into it, lying flat on the ground; (5) a dark mine gallery entrance, a short tunnel mouth in rough rock framed by heavy timber posts and a lintel beam, pure blackness inside; (6) a mine shaft hoist, a timber A-frame with a hand winch and a rope going down to an iron bucket. The first four are very low and flat against the floor, the last two stand tall. All six seen from the same elevated three-quarter view about forty degrees above the ground, high enough that the four flat floor pieces read clearly as shapes and not as thin lines, the same camera for every object, all resting on the same invisible ground line. Stylized hand-painted low-poly game art, matte surfaces, clean readable silhouettes. Colors: ochre and grey rock, dark aged brown timber, rusty iron, pale crystal, a faint brass glow inside the crack. Soft even studio lighting, no cast shadows, no dramatic highlights. Plain solid white background, completely empty, no floor plane, no horizon, no gradient, no shadow on the background. Every object fully visible, nothing cropped at the edges. No text, no labels, no numbers, no watermark, no frame, no people. Wide landscape 16:9 image.
```

### O que de fato chegou — 21/09/2026, **ENTREGUE**

Vieram **quatro** arquivos, não três, em `...\assets_ok\mapa\Mina Trêmula\`
(o dono salvou a pasta sem o "A", e com acento — o `NOMES_CALABOUCO` do
`embute_monstros.py` foi corrigido):

| arquivo | peças |
|---|---|
| `muros\muros e pilar.glb` | mureta inteira, mureta com brecha, pilar |
| `muros\cercas e entulho.glb` | broca na rocha (o marco), escora, muro de entulho |
| `itens mapa\folha2.glb` | os sete que ficam de pé |
| `itens mapa\folha3.glb` | as quatro rasteiras e as duas de borda |

A folha 1 do briefing veio partida em dois arquivos, e o marco caiu no segundo.
As 19 peças finais ficaram em `...\Mina Trêmula\_pecas\`, já com o nome, e
`tools/embute_cenario_mina.py` as transforma em `cenario-mina.js`.

**Três arquivos saíram limpos** no `separa_pecas.py --recortar --conta 3,3` e
`--conta 7,6`: o separador por vértice achou o patamar sozinho.

**A folha 2 não.** O Meshy soltou as **três argolas de ferro do silo** como
objetos independentes, e cada uma é grande demais para o filtro de caco (0,115
da folha, acima do corte de 0,08). Com elas contando como peça, o separador
fundiu pares reais para fechar em sete: silo com estalagmite, porta com
vagonete, estéril com gaiola. **Cortar pelos vãos do eixo X também não
resolveu** — nesta folha as peças se sobrepõem em X (o vagonete fica na frente
da porta), e só apareceram 2 vãos internos para 6 necessários. O que resolveu
foi o caminho já documentado: `--bruto 0.0035` (11 grupos), olhar a folha de
contato do `contato_cenario.py`, e escrever o mapa à mão:

```
1a → estalagmite        1b+2+3+4 → silo (as argolas voltam para ele)
5+6+7 → porta lacrada   8 → vagonete      10 → dinamite
11a → estéril           11b → gaiola do canário
```

O grupo 9 é uma chapa chata avulsa entre o vagonete e o caixote — não é peça
de nada, e incluí-la na porta a deixava com 0,43 m de largura para 0,32 m de
altura. Ficou de fora.

**Para o Coração Partido:** peça com anel, aro ou cinta solta (silo, barril,
roda) é a armadilha desta rodada — o aro vira "peça" e desarruma a contagem
inteira. Ou peça ao Gemini que os aros sejam colados ao corpo, ou já entre de
`--bruto` com a contagem real (peças + aros) e escreva o mapa.

## 6.4 · Coração Partido (`heart`) — prefixo `cp_` — **ENTREGUE em 21/09** (`cenario-coracao.js`)

Paleta: violeta (`#8f6ad0`), índigo profundo (`#2a2440`), ouro velho
(`#ffd166`), basalto e mármore partido. Cada peça cita os quatro elementos sem
copiar nenhum calabouço. Lembre que **o cenário NÃO é tingido pelo jogo**: a
cor que você assar é a cor final.

> **O caminho é o da Mina:** a folha sai primeiro do **Gemini** (imagem) e é
> essa imagem que entra no **Meshy** (imagem→3D). Os prompts abaixo são
> **prompts de imagem** — por isso falam de câmera, fundo, luz e enquadramento.
>
> **São QUATRO arquivos, 15 peças** (a Mina teve 19 em quatro). O dono avisou
> em 21/09 que só dava para **a parede + 3 folhas**, então o lote foi apertado
> em cima dos papéis, não das folhas: a **folha de borda deixou de existir** e
> as três peças de `borda` saem por **reaproveitamento** das monumentais — que
> é o que a tabela de papéis já permitia ("borda: pode reaproveitar sotaques").
> Fora da arena o renderizador cresce a peça para 2,2–4,6 m, e arco, escadaria
> e coluna aguentam esse porte. O **marco** entrou na folha das monumentais em
> vez de sair sozinho: sem ele o tema cai no sotaque comum e o Coração fica
> sendo o único dos quatro portais sem peça monumental.
>
> **O que ficou de fora, e onde foi parar:** o relógio parado das estações, a
> lasca de céu petrificado, a armadura vazia em suporte, a fileira de braseiros
> e a estátua caída. O tema das quatro estações fica com a **coluna dos
> elementos** e com o **coração rachado do marco**; a ruína fica com o **arco
> partido** e a **escadaria que acaba no ar**.
>
> As regras que decidem se o lote presta:
> 1. **Vão claro entre as peças, nenhuma encostada** — a mais importante.
> 2. **Fundo branco liso, sem chão, sem sombra projetada, sem degradê.**
> 3. **Mesma câmera na folha inteira, bases alinhadas.** A folha do chão sobe
>    para 40° de propósito: peça rasteira vista de frente sai com 7 cm.
> 4. **NADA SOLTO.** Foi o que custou a folha 2 da Mina: as três argolas do
>    silo viraram "peça" e desarrumaram a contagem. Aqui o risco tem nome —
>    corrente, argola, engrenagem, lanterna pendurada. Todo prompt fecha com
>    *no free-floating rings, no loose chain links*, e as correntes vão
>    esticadas e coladas na pedra. (Foi por isso que a **barreira de
>    engrenagens** saiu do kit: dente de engrenagem solto é aro por outro nome.)
> 5. **Imagem→3D só vê um lado.** Os muros vão em **vista frontal reta**, que é
>    o que dá ponta reta para as cópias emendarem em fileira.

### Folha 1 — a parede (3 peças) · vista frontal reta

`cp_muro_inteiro` · `cp_muro_balaustrada` (os dois **muro**: o renderizador usa
a 0,95 m como divisória e estica a 3,10 m como parede — o segundo já traz a
brecha) · `cp_pilar` (**pilar**).

```
A game asset reference sheet: three separate stylized fantasy stone structures arranged in one horizontal row, evenly spaced, with a wide clear empty gap between every object, none touching and none overlapping. From left to right: (1) a modular low wall of ancient carved stone that changes material along its length in four sections — scorched cracked stone with faint ember lines, smooth dark wet-looking stone with flowing veins, rough packed brown rock, pale wind-hollowed stone with small round openings — the four sections joined by thin gold seams, a flat straight top edge, straight vertical flush ends, about twice as wide as it is tall; (2) a modular low broken balustrade, a flat straight top rail carried by a row of turned stone balusters, each baluster of a different stone (scorched black, smooth blue-grey, rough brown, pale hollowed), two balusters missing in the middle leaving a gap with broken stumps, a thin gold inlay line along the rail, straight vertical flush ends, about twice as wide as it is tall; (3) a tall narrow ancient pillar split vertically into four quarters that still stand together, each quarter a different material (scorched cracked stone, smooth dark wet stone, rough packed rock, pale wind-hollowed stone), thin glowing cracks between the quarters, a carved gold band near the top, much taller than it is wide. Every part of every object is solidly attached to it: no free-floating rings, no loose chain links, no separate pieces resting on top. All three seen from a straight-on front view at eye level, flat orthographic framing with no perspective distortion, the same camera for every object, all standing on the same invisible ground line with their bases aligned. Stylized hand-painted low-poly game art, matte surfaces, clean readable silhouettes. Colors: violet-grey carved stone, deep indigo shadows, old gold seams, a faint pale glow in the cracks. Soft even frontal studio lighting, no cast shadows, no dramatic highlights. Plain solid white background, completely empty, no floor, no horizon, no gradient, no shadow on the background. Every object fully visible, nothing cropped at the edges. No text, no labels, no numbers, no watermark, no frame, no people. Wide landscape 16:9 image.
```

### Folha 2 — sotaques (4 peças) · três-quartos, 30° acima

`cp_bacia` · `cp_caco_espelho` · `cp_raiz` · `cp_lampioes` — os quatro
**sotaque** (0,85 a 1,60 m, no miolo das muretas; todos volume vertical,
nenhum com tampo plano — foi por isso que o banco de pedra do plano antigo
caiu fora).

```
A game asset reference sheet: four separate stylized fantasy environment props arranged in one horizontal row, evenly spaced, with a wide clear empty gap between every object, none touching and none overlapping. From left to right: (1) a carved stone elemental basin on a short thick pedestal, the bowl overflowing with dark water that crusts into ice down one side and steams on the other, gold rim; (2) a large jagged shard of mirror glass standing upright, driven deep into a block of cracked violet-grey stone, the silvered face reflecting nothing, smaller splinters fused to the block at its foot; (3) a thick knotted tree root bursting out of a carved stone block and curling back down into it, bark, moss and a gold band nailed around the root; (4) a short stone post carrying four iron lanterns of different shapes, each lantern bolted and welded directly to the post with rigid iron brackets and none hanging from a ring, one lantern glowing with embers, one filled with water light, one dark and empty, one with a pale swirl of wind. All four are about waist to chest height, all taller than they are wide, none with a flat empty tabletop. Every part of every object is solidly attached to it: no free-floating rings, no loose chain links, no separate pieces resting on top. All four seen from the same three-quarter view about thirty degrees above eye level, the same camera for every object, all standing on the same invisible ground line with their bases aligned. Stylized hand-painted low-poly game art, matte surfaces, clean readable silhouettes. Colors: violet-grey stone, deep indigo shadows, tarnished old gold, silver glass, dark water, muted pale glows. Soft even studio lighting, no cast shadows, no dramatic highlights. Plain solid white background, completely empty, no floor, no horizon, no gradient, no shadow on the background. Every object fully visible, nothing cropped at the edges. No text, no labels, no numbers, no watermark, no frame, no people. Wide landscape 16:9 image.
```

### Folha 3 — as monumentais (4 peças) · três-quartos, 30° acima

`cp_marco_estatua` (**marco**, uma vez por sala) · `cp_arco` · `cp_escadaria` ·
`cp_coluna_elementos` (os três **sotaque_alto**, ~3,10 m, no meio das paredes,
e os mesmos três entram de novo como **borda**, fora da arena, onde o
renderizador os cresce para 2,2–4,6 m). O marco fica na **ponta esquerda** da
folha porque é o mais largo: é o que garante o vão até o vizinho.

```
A game asset reference sheet: four separate stylized fantasy stone monuments arranged in one horizontal row, evenly spaced, with a wide clear empty gap between every object, none touching and none overlapping. From left to right: (1) a monumental headless statue of a robed figure on a wide square plinth, both hands raised holding a large stone heart cracked into four quarters in front of its chest, faint light glowing in the cracks of the heart, the neck broken off cleanly, the robes carved with flame, wave, rock and wind, chains carved around the plinth with every link touching the stone, a few fallen fragments fused to the base, about as wide as it is tall; (2) a monumental stone arch broken at the top, the two halves not meeting, gold trim along the edges, the fallen keystone fused to the ground at the foot of one leg, tall and narrow; (3) a spiral stone staircase winding up around a solid central column and ending abruptly in broken steps in mid-air, a carved gold handrail following the curve, tall and narrow; (4) a column of the four elements: four stacked carved stone drums — flame, wave, rock, wind — each separated by a solid gold ring carved as part of the column, a cracked capital on top, tall and narrow. Every part of every object is solidly attached to it: no free-floating rings, no loose chain links, no separate pieces resting on top. All four seen from the same three-quarter view about thirty degrees above eye level, the same camera for every object, all standing on the same invisible ground line with their bases aligned. Stylized hand-painted low-poly game art, matte surfaces, clean readable silhouettes. Colors: violet-grey stone and marble, deep indigo shadows, tarnished old gold trim, pale glow in the cracks. Soft even studio lighting, no cast shadows, no dramatic highlights. Plain solid white background, completely empty, no floor, no horizon, no gradient, no shadow on the background. Every object fully visible, nothing cropped at the edges. No text, no labels, no numbers, no watermark, no frame, no people. Wide landscape 16:9 image.
```

### Folha 4 — o chão (4 peças) · três-quartos, 40° acima

`cp_mosaico` · `cp_rachadura_estrela` · `cp_veio_luz` · `cp_cinza_gelo` — os
quatro **chao** (rasteiros, sem colisão, `chao_alt` baixo). A câmera desta folha
é mais alta **de propósito**: peça rasteira vista de frente vira um risco no
papel e sai do Meshy com sete centímetros.

```
A game asset reference sheet: four separate stylized fantasy floor props arranged in one horizontal row, evenly spaced, with a wide clear empty gap between every object, none touching and none overlapping, all four very low and lying flat on the ground. From left to right: (1) a square broken floor mosaic of the four seasons, four quadrants of coloured tiles around a gold centre medallion, several tiles missing and the edge chipped; (2) a star-shaped crack in stone floor slabs radiating from one point, the slabs slightly tilted, a faint pale glow deep inside the crack; (3) a thin vein of pale light running diagonally across a worn stone slab like a glowing fissure, gold flecks along its edges; (4) a low patch of grey ash with a crust of white ice frozen over half of it and a few scorched pebbles. Every part of every object is solidly attached to it: no free-floating rings, no loose pieces resting on top. All four seen from the same elevated three-quarter view about forty degrees above the ground, high enough that the flat floor pieces read clearly as shapes and not as thin lines, the same camera for every object, all resting on the same invisible ground line. Stylized hand-painted low-poly game art, matte surfaces, clean readable silhouettes. Colors: violet-grey stone, deep indigo shadows, old gold tiles, pale glow, white ice, grey ash. Soft even studio lighting, no cast shadows, no dramatic highlights. Plain solid white background, completely empty, no floor plane, no horizon, no gradient, no shadow on the background. Every object fully visible, nothing cropped at the edges. No text, no labels, no numbers, no watermark, no frame, no people. Wide landscape 16:9 image.
```

### O catálogo que estas 15 peças dão

| papel | peças |
|---|---|
| `baixo` (muro) | `cp_muro_inteiro`, `cp_muro_balaustrada` |
| `pilar` | `cp_pilar` |
| `marco` | `cp_marco_estatua` |
| `sotaque` | `cp_bacia`, `cp_caco_espelho`, `cp_raiz`, `cp_lampioes` |
| `sotaque_alto` | `cp_arco`, `cp_escadaria`, `cp_coluna_elementos` |
| `chao` | `cp_mosaico`, `cp_rachadura_estrela`, `cp_veio_luz`, `cp_cinza_gelo` |
| `borda` | `cp_arco`, `cp_escadaria`, `cp_coluna_elementos` (as mesmas malhas) |

O marco **não** entra em `borda`: ele é a peça de uma vez por sala, e repeti-lo
do lado de fora desfaz a regra do aquário.

### Como salvar, para o separador não errar

Pasta: `...\assets_ok\mapa\O Coracao Partido\muros\` (a parede) e
`...\assets_ok\mapa\O Coracao Partido\itens mapa\` (as três folhas de enfeite).
**O nome do arquivo é a contagem**: peças separadas por `-`, na ordem da
esquerda para a direita, que é como `tools/separa_pecas.py` sabe quantas
recortar e já sai com os nomes certos.

```
muros\muro inteiro-balaustrada-pilar.glb
itens mapa\bacia-caco de espelho-raiz-lampioes.glb
itens mapa\marco estatua-arco-escadaria-coluna dos elementos.glb
itens mapa\mosaico-rachadura estrela-veio de luz-cinza e gelo.glb
```

Se o Meshy soltar objeto a mais (é o que as argolas fizeram na Mina), o
caminho já documentado: `--bruto 0.0035`, folha de contato do
`contato_cenario.py` e mapa à mão.

---

### O que de fato chegou — 21/09/2026, **ENTREGUE**

Vieram **quatro** arquivos, em `...\assets_ok\mapa\O Coração partido\` (o
dono salvou a pasta com acento e com "partido" em minúscula — o
`NOMES_CALABOUCO` do `embute_monstros.py` foi corrigido para essa grafia, e o
`embute_cenario_coracao.py` acha a pasta por glob para não depender mais
disso):

| arquivo | peças |
|---|---|
| `muros\muros e pilar.glb` | pilar, balaustrada partida, mureta de quatro materiais |
| `itens mapa\folha2.glb` | bacia, caco de espelho, raiz, lampiões |
| `itens mapa\folha3.glb` | estátua-marco, arco, escadaria, coluna dos elementos |
| `itens mapa\folha4.glb` | mosaico, rachadura, veio de luz, cinza e gelo |

**AS QUATRO SAÍRAM LIMPAS** no `separa_pecas.py --recortar --conta 3` e
`--conta 4,4,4`: o separador por vértice achou o patamar sozinho em todas
(0,028 · 0,040 · 0,020 · 0,020) e as peças vieram na **ordem exata do
briefing**, da esquerda para a direita — o `contato_cenario.py` só confirmou.
Nenhum aro solto, nenhuma folha partida em dois, nenhum mapa à mão: a regra
*no free-floating rings, no loose chain links*, escrita por causa das três
argolas do silo da Mina, pagou o preço dela. As 15 peças estão em
`...\O Coração partido\_pecas\`, já com o nome, e
`tools/embute_cenario_coracao.py` as transforma em `cenario-coracao.js`
(4,73 MB de binário, 6,31 MB de arquivo).

A única surpresa foi na medição: com a borda reaproveitando as três
monumentais, `tests/cenario_coracao.html` acusou **enfeite demais em duas
salas** (43 numa sala de teto 42, e 61 numa de teto 45). A culpa não é do
catálogo — é do LAYOUT: sala com muitos trechos curtos de parede ganha um
`sotaque_alto` em cada um, e A Sala dos Espelhos era um tabuleiro de blocos
pequenos. Entrou no mesmo lote a reforma tática das três salas, e a densidade
voltou para a faixa.

## Se for fazer em ordem

1. **Os dez dos Andaimes**, chefe primeiro (Cambota é quem o jogador olha por
   mais tempo), depois os quatro de silhueta única (Enforca-Corda, Serpe-Pipa,
   Coro-Assobio, Picanço), depois os três de poeira (Enxame, Motinho, Pregolim)
   e o Gremlin e o Golem por último.
2. **O kit de cenário dos Andaimes**: os dois muros e o pilar primeiro (são a
   regra do tabuleiro e o cantinho do portal na praça), o marco, e as quatro
   folhas de enfeite depois.
3. Fecho → Mina → Coração, na ordem em que o jogador desce. Nos Arautos, gere a
   armadura uma vez e varie o recheio: os quatro precisam ler como irmãos.
4. Ao entregar cada lote: `python tools/embute_monstros.py --calabouco <id>
   --manifesto`, raio-X, fusão, `extrai_assets.py`, `tests/bestiario.html`, e
   tirar o id de `JOGO.DATA.portaisFechados` — o passo a passo está em
   `docs/RECEBER_LOTE.md`.

SOTERRA · prompts dos quatro portais fechados · 40 monstros + 1 · 4 kits de cenário · escrito em 19 de setembro de 2026
