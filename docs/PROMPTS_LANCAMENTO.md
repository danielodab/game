# Prompts prontos — o lote do lançamento (Sala de Guerra, Colossos, Eco Primordial, Santuário)

Escrito na noite de 02→03/10/2026 para o pacote de lançamento. São quatro
encomendas de arte, todas pelo caminho que funcionou desde a Mina Trêmula:
**a imagem sai primeiro do Gemini** (várias peças lado a lado, para economizar)
e **essa imagem entra no Meshy** (imagem→3D). Os prompts estão em inglês, como
os de `docs/PROMPTS_PORTAIS_FECHADOS.md`, porque é a língua em que os dois
geradores respondem melhor; a explicação de cada folha está em português.

| # | encomenda | prefixo / ids | folhas no Gemini | gerações no Meshy |
|---|---|---|---|---|
| 1 | Os Colossos do Poço | `colosso-fogo` … `colosso-ar` | 2 | 4 personagens |
| 2 | O Eco Primordial e os Ecos Menores | `boss-eco-primordial`, `eco-menor-*` | 3 | 5 personagens |
| 3 | A Sala de Guerra (a Sede) | `sd_` | 4 | 4 folhas de cenário |
| 4 | O Santuário dos Elementos — cenário | `el_` | 9 | 9 folhas de cenário |
| 4 | O Santuário dos Elementos — monstros | `el_fogo_1` … `el_ar_2` | 4 | 8 personagens |
| | **total** | | **22** | **30** (17 personagens + 13 folhas) |
| opc. | A Câmara do Eco (arena do chefe) | `ce_` | +1 | +1 folha |

Cada **personagem** é uma geração própria no Meshy e depois ganha **rig e
animação** (os seis clipes de sempre); cada **folha de cenário** é UMA geração
só, que o `tools/separa_pecas.py` corta em peças depois. É por isso que o
cenário vem em folha e o personagem vem recortado.

---

## A ordem de produção (e por quê)

1. **Os quatro Colossos** — o código já os espera: cada um tem a chave de
   modelo dele (`colosso-fogo`…) e, enquanto ela não existe, veste o corpo
   provisório de um monstro do mesmo elemento (`M.CORPO_PROVISORIO` em
   `js/render3d/models3d_v2.js` — desde a junção de 03/10, UMA tabela para os
   Colossos e o Eco; o aviso da revisão sobre as duas tabelas que se apagavam
   foi resolvido ali). Embutiu com a chave,
   o colosso troca de roupa sozinho. É o lote que aparece no jogo mais rápido.
2. **O Eco Primordial e os quatro Menores** — o evento semanal é vitrine do
   lançamento. Também já esperam pela chave (a mesma tabela): o Eco
   veste hoje o Coração Partido a 2,44×, os Menores vestem os Arautos.
3. **A Sala de Guerra** — hoje é toda primitiva desenhada no código. A arte
   entra, mas precisa de um catálogo novo no código para trocar as primitivas
   (ver *Pendências* no fim), então vem depois dos personagens.
4. **O Santuário dos Elementos** — por enquanto é SÓ arte: o mapa ainda não
   existe no código. Gerar por último, quando o saldo permitir; nada no jogo
   espera por ele.

Dentro de cada encomenda: primeiro a peça que o jogador olha por mais tempo
(o chefe, a parede), depois o resto.

---

## Onde salvar (o padrão do `docs/RECEBER_LOTE.md`)

```
C:\Users\danie\Downloads\assets_ok\mapa\
    Os Colossos do Poco\
        imagens\           as folhas do Gemini (png) e os recortes de cada personagem
        monstros\Colosso de Brasa\Colosso de Brasa idle.glb
                                  Colosso de Brasa walk.glb
                                  Colosso de Brasa run.glb      (só o da Ventania, que anda mais)
                                  Colosso de Brasa attack.glb
                                  Colosso de Brasa hit.glb
                                  Colosso de Brasa death.glb
                 \Colosso da Maré\...   \Colosso de Rocha\...   \Colosso da Ventania\...
    O Eco Primordial\
        imagens\
        monstros\O Eco Primordial\O Eco Primordial idle.glb ...
                 \Eco Menor de Brasa\...  \Eco Menor de Coral\...
                 \Eco Menor de Rocha\...  \Eco Menor de Vento\...
    A Sala de Guerra\
        imagens\
        muros\        a folha da parede
        itens mapa\   as três folhas de peças
    O Santuario dos Elementos\
        imagens\
        muros\        as duas folhas de muro
        itens mapa\   as sete folhas de peças
        monstros\<Nome do monstro>\<Nome do monstro> idle.glb ...
```

Os nomes de pasta de LOTE vão sem acento (as ferramentas já se perderam com
acento e maiúscula mais de uma vez); o nome de cada MONSTRO vai como está no
jogo, com acento, que é o padrão dos seis lotes.

**O nome do arquivo de cada folha de cenário é a contagem.** O
`separa_pecas.py` divide o nome pelo `-` e sabe quantas peças recortar e como
chamá-las, da esquerda para a direita. Cada folha abaixo traz o nome pronto.
Se preferir salvar como `folha1.glb`, `folha2.glb`…, tudo bem: aí a contagem vai
no `--conta`, na ordem ALFABÉTICA dos arquivos da pasta (é como o separador os
lê) — cada seção traz essa linha pronta também.

---

## As regras que decidem se o lote presta

Valem para TODAS as folhas. Já estão dentro de cada prompt; estão aqui para
você saber o que conferir na imagem do Gemini ANTES de gastar crédito no Meshy.

**Para cenário (aprendidas nos lotes da Mina e do Coração):**

1. **Vão claro entre as peças, nenhuma encostada.** Peça encostada na vizinha
   não se separa por distância nenhuma. É a regra mais importante.
2. **Fundo branco liso, sem chão, sem sombra projetada, sem degradê.** O Meshy
   reconstrói o que vê: sombra no fundo vira geometria.
3. **Mesma câmera para a folha inteira, bases na mesma linha.**
4. **Nada solto** — *no free-floating rings, no loose chain links*. Argola,
   elo, objeto pousado em cima de outro, lanterna pendurada: tudo vira "peça" e
   desarruma a contagem (foi o que custou a folha 2 da Mina). No Coração essa
   frase entrou e as quatro folhas saíram limpas.
5. **Peça rasteira pede câmera alta (~40°).** Vista de frente ela vira um
   risco no papel e sai do Meshy com sete centímetros.
6. **Muro em vista frontal reta.** Imagem→3D só vê um lado; a vista frontal é
   o que dá ponta reta para as cópias emendarem em fileira.
7. **Sem fogo, fumaça, brilho no ar ou água caindo.** Novidade deste lote: a
   lareira, o braseiro, a tocha e a coluna de vento têm efeito VIVO no jogo
   (chama que treme, luz que pisca, vento que gira) feito pelo código. Se a
   chama vier na imagem, o Meshy a transforma num cone sólido de massa. A peça
   vem APAGADA; quem acende é o jogo.
8. Fechar sempre com: sem texto, sem rótulo, sem número, sem marca-d'água, sem
   moldura, nada cortado na borda, 16:9 deitado.

**O cenário NÃO é tingido pelo jogo**: a cor que você assar é a cor final.

**Para personagem (as cinco regras dos monstros, adaptadas à imagem):**

1. **Humanoide, sempre.** O rig do Meshy tem ossos de gente e a biblioteca de
   animação é de gente. Bicho sem pernas, de quatro patas ou com asas E braços
   passa a luta deslizando. O truque que funcionou nos seis calabouços: **não
   humanize o bicho, vista o bicho num corpo** — asa no lugar do braço, concha
   nas costas, cauda como saia.
2. **Pose A, de pé, de frente, simétrico**, braços um pouco afastados do corpo,
   pés afastados. Nada atravessando a frente do corpo.
3. **Quase sem cor.** O jogo multiplica a textura do monstro por **52% da cor
   do elemento** (fogo laranja, água azul, terra verde, ar lilás). Volume é
   seu, matiz é do jogo. Modele em cinza-claro com o desenho no claro-escuro; o
   que tem de brilhar (lava, olho, núcleo) fica **quase branco** — a tinta
   transforma em luz da cor certa. Isso vale também para o Eco Primordial: ele
   é tingido pela cor da FASE, então ele muda de cor sozinho quando troca de
   elemento — mas só se vier cinza.
4. **Sem pedestal, sem chão, nada solto.** Corrente, argola e estilhaço vão
   COLADOS ao corpo (peça solta arruína o auto-rig — a correção que o
   Vendaval e o Coração precisaram em 21/09).
5. **Seis arquivos por personagem**, um por animação, nos nomes da árvore
   acima. Se o Meshy trocar ataque e reação de novo, o raio-X do embutidor
   corrige — aconteceu nos seis lotes.

### Como fazer um personagem, do Gemini ao jogo

1. **Gemini**: cole o prompt da folha. Cada folha traz **dois personagens**,
   cada um na sua metade da imagem (o Eco vem sozinho). Dois e não quatro:
   recortado, cada um fica com ~700 px de altura, que é o mínimo para o Meshy
   ler mão, rosto e detalhe. Confira na imagem: pose A, de frente, nada
   cortado, fundo branco, nada flutuando.
2. **Recortar** (Fotos do Windows → Editar → Recortar, ou o Paint): um
   retângulo por personagem, com uma **margem branca** de mais ou menos um
   décimo da altura em volta, sem pegar nem um pedaço do vizinho. Salve como
   `imagens\recortes\<Nome do monstro>.png`. O recorte é o que vai ao Meshy —
   **nunca a folha inteira**: imagem→3D com dois bichos na foto devolve um
   modelo só com os dois grudados.
3. **Meshy → Image to 3D** com o recorte. Se as costas vierem estranhas (só
   um lado é visto), o plano B é o caminho dos seis lotes: **Text to 3D** com a
   descrição daquele personagem copiada do prompt + o sufixo dos monstros de
   `PROMPTS_PORTAIS_FECHADOS.md` (*Full-body humanoid biped standing upright in a
   relaxed A-pose… Single character, no base, no pedestal, no ground*).
4. **Rig** (humanoide) e **animações**: idle · walk · run (opcional) · attack ·
   hit (reação) · death. Exporte um GLB por animação com os nomes da árvore.

**A altura não se controla no Meshy** — o código acerta depois (`MONSTER_LOOK`,
`scale = altura ÷ 1,80` para monstro comum e `altura ÷ 2,95` para chefe, que
é o caso do Eco: escala 2,00 = 5,90 m). O que você controla é a **proporção**, e é isso que
cada ficha pede. Para calibrar o olho: herói 2,05 m, casa 2,0 m, muro 3,10 m,
chefe de calabouço 2,95 a 3,60 m.

---

# 1 · OS COLOSSOS DO POÇO

Quatro gigantes que aparecem nos andares múltiplos de 5 do Poço, um por andar,
girando fogo → água → terra → ar. No jogo medem **2,88 m** (1,6× um monstro
comum, abaixo de todo chefe), então a silhueta precisa dizer "gigante" mesmo
sem a régua: **ombros e antebraços enormes, pernas curtas e grossas, cabeça
pequena afundada entre os ombros** — lê como uma montanha que anda. Os quatro
são irmãos de corpo (mesmo esqueleto de golem) e diferem no MATERIAL.

| colosso | id do monstro | chave do modelo (pasta) | elem | o que a arte tem de contar |
|---|---|---|---|---|
| Colosso de Brasa | `colosso_fogo` | `colosso-fogo` | fogo | fendas de lava; deixa a casa em brasa por onde passa |
| Colosso da Maré | `colosso_agua` | `colosso-agua` | água | coral e água viva; cura-se parado na poça |
| Colosso de Rocha | `colosso_terra` | `colosso-terra` | terra | couraça de lajes que cai aos pedaços |
| Colosso da Ventania | `colosso_ar` | `colosso-ar` | ar | correntes de ferro com vento preso; anda mais |

**Não confundir com o Colosso de Magma** (invocação de nível 30 do Invocador,
"rocha derretida numa forma que lembra um corpo"). O de Brasa é o contrário:
rocha SÓLIDA e velha, rachada, com a lava só nas frestas.

Animação: idle · walk · attack (soco de cima para baixo) · hit · death (desaba
em blocos). O da Ventania leva também **run** (ele anda mais que os outros).

### Folha C1 — Colosso de Brasa e Colosso da Maré · `colossos 1.png`

Esquerda: **Colosso de Brasa** — basalto em blocos, rachado de alto a baixo, a
lava nas frestas pintada quase branca, uma crista de rocha nas costas como a
borda de um vulcão, punhos de pedra enormes, pés que parecem pedras de
fundação. Direita: **Colosso da Maré** — corpo de coral ramificado e conchas,
"pele" de água vítrea esculpida (sólida, não respingando) entre os galhos de
coral, um nicho no peito com água escura parada, braços que terminam em massas
de coral como clavas.

```
A character design reference sheet for a 3D game: two separate full-body giant golem creatures standing side by side, each one centered in its own half of the image, with a wide empty white gap between them, not touching and not overlapping. Both share the same massive build: huge shoulders and forearms, enormous fists, short thick legs, a small head sunk low between the shoulders, so each one reads as a walking mountain. Left: a colossus of old solid volcanic basalt, the body built from heavy cracked stone blocks split from head to toe, glowing lava visible only inside the deep cracks (the lava painted almost white), a jagged ridge of rock along the back and shoulders like the rim of a volcano, feet like foundation stones, small eyes glowing almost white under a heavy stone brow. Right: a colossus of branching coral and shells, the spaces between the coral branches filled with smooth glassy sculpted water that is solid and part of the body, a hollow in the chest holding still dark water, forearms ending in heavy clubs of coral, barnacles along the shoulders, small pale eyes in a shell-like face. Both seen from a straight-on front view at eye level, the same camera, full body from head to feet, each one filling most of the image height, standing upright in a relaxed A-pose with both arms held slightly away from the body, feet apart, symmetrical, facing the viewer. Every part is solidly attached to the body: no free-floating rocks, no drops of water in the air, no free-floating rings, no loose chain links. Stylized hand-painted fantasy game creature look, clean readable silhouettes. Near-monochrome light grey materials, all detail in light-and-dark contrast, glowing parts painted almost white, no saturated colors. Soft even frontal studio lighting, no cast shadows, no dramatic highlights. Plain solid white background, completely empty, no floor, no ground, no pedestal, no base, no shadow on the background. Both creatures fully visible with a white margin around them, nothing cropped at the edges. No text, no labels, no numbers, no watermark, no frame. Wide landscape 16:9 image.
```

### Folha C2 — Colosso de Rocha e Colosso da Ventania · `colossos 2.png`

Esquerda: **Colosso de Rocha** — um gigante de pedra VESTIDO com uma couraça de
lajes: placas de pedra lisa encaixadas sobre o peito, os ombros e as canelas
como armadura, presas por cintas de pedra (coladas, nenhuma solta), e por
baixo a pedra bruta. A couraça tem de ler como camada que pode cair — é a
regra dele no jogo. Direita: **Colosso da Ventania** — mais alto e mais magro
que os outros três (é o que anda mais), corpo de pedra clara gasta pelo vento,
correntes de ferro grossas enroladas BEM APERTADAS no peito, nos braços e na
cintura, e entre os elos o vento preso esculpido como fitas espirais sólidas.

```
A character design reference sheet for a 3D game: two separate full-body giant golem creatures standing side by side, each one centered in its own half of the image, with a wide empty white gap between them, not touching and not overlapping. Left: a massive stone colossus with huge shoulders and forearms, enormous fists, short thick legs and a small head sunk between the shoulders, wearing a cuirass of smooth flat stone slabs fitted like plate armor over the chest, the shoulders, the forearms and the shins, the slabs held by carved stone straps that are part of the body, rough raw rock visible underneath between the slabs, so the armor clearly reads as a separate layer that could fall away; small eyes glowing almost white under a slab visor. Right: a taller and leaner stone colossus, long legs and long arms, wind-worn pale stone with smooth hollows carved by the wind, thick heavy iron chains wrapped very tightly around its chest, both arms and its waist, every chain lying flat against the stone with no loose ends hanging, spirals of trapped wind sculpted as solid swirling ribbons between the chain links and around the forearms, a narrow head with a long slit of pale light for a face. Both seen from a straight-on front view at eye level, the same camera, full body from head to feet, each one filling most of the image height, standing upright in a relaxed A-pose with both arms held slightly away from the body, feet apart, symmetrical, facing the viewer. Every part is solidly attached to the body: no free-floating stones, no free-floating rings, no loose chain links, no dangling chain ends. Stylized hand-painted fantasy game creature look, clean readable silhouettes. Near-monochrome light grey materials, all detail in light-and-dark contrast, glowing parts painted almost white, no saturated colors. Soft even frontal studio lighting, no cast shadows, no dramatic highlights. Plain solid white background, completely empty, no floor, no ground, no pedestal, no base, no shadow on the background. Both creatures fully visible with a white margin around them, nothing cropped at the edges. No text, no labels, no numbers, no watermark, no frame. Wide landscape 16:9 image.
```

**Recorte:** quatro PNGs em `imagens\recortes\` — `Colosso de Brasa.png`,
`Colosso da Maré.png`, `Colosso de Rocha.png`, `Colosso da Ventania.png`.

---

# 2 · O ECO PRIMORDIAL E OS ECOS MENORES

### O Eco Primordial · chave `boss-eco-primordial` · `eco_primordial`

A primeira voz do mundo enterrado: uma entidade colossal montada com pedaços
dos seis calabouços, com um núcleo que pulsa no peito. **Não anda** — ocupa
2×2 casas no centro da Câmara do Eco, e o jogo o mostra a **~5,9 m** (o dobro
de um chefe). Ele troca de elemento a cada 25% da vida perdida, Fogo → Água →
Terra → Ar, e **o jogo o pinta com a cor da fase** — por isso ele vem CINZA:
cinza, ele fica laranja, azul, verde e lilás sozinho; colorido, ele fica sujo
nas quatro fases.

O que faz ele parecer COLOSSAL (e não um monstro grande):
- **cabeça pequena** afundada entre ombros imensos, braços longos e pesados;
- **arquitetura em miniatura presa ao corpo** — um arco partido no ombro, uma
  escadinha de pedra na perna, uma coluna caída cravada nas costas. É a régua
  do olho: escada pequena = corpo enorme;
- **os seis calabouços no corpo**, um por região: cristal (Mina) num ombro,
  coral (Cisterna) no outro, lava nas frestas (Fecho), vento preso em
  correntes nos antebraços (Andaimes), raízes de espinho na cintura (Estufa) e
  o núcleo rachado no peito (Coração);
- **pernas enterradas até o joelho** num saiote de entulho que É do corpo —
  ele parece brotar do chão, e o rig ainda acha duas pernas (a regra da
  Vergasta: o bicho enraizado continua tendo pernas para o esqueleto).

Sozinho na folha, em **1:1**, para o Meshy ter o máximo de pixels.

Animação: **idle** (o núcleo pulsa, os ombros respiram) · **attack** (golpe de
braço que bate no chão à frente — é o "golpe grande avisado") · **hit** ·
**death** (desmorona em blocos, o núcleo apaga). **Não precisa de walk nem
run**: ele não sai do lugar. Para a régua do embutidor não reclamar, salve uma
cópia do `idle` como `walk` (é o que o jogo já faz com quem se arrasta).

### Folha E0 — o Eco Primordial · `eco primordial.png`

```
A single colossal primordial titan boss character for a 3D game, alone in the image: the first voice of a buried underground world, a gigantic humanoid assembled from fragments of six underground realms. Enormous broad shoulders and long heavy arms with huge hands, a small head sunk low between the shoulders with a cracked stone face mask and two pale glowing eye slits. The body is made of stacked layered bedrock slabs with deep cracks of lava running through them (the lava painted almost white); the left shoulder crusted with big crystal clusters; the right shoulder grown over with branching coral and shells; heavy iron chains wrapped very tightly around both forearms with spirals of trapped wind sculpted as solid ribbons between the links; thorny roots braided around the waist; in the center of the chest a large round core set in a ring of cracked rock, glowing almost white, the brightest point of the figure. For a sense of enormous scale, tiny ruined architecture is embedded in its body: a small broken stone arch on one shoulder, a little stone staircase carved up one thigh, a fallen column fused across its back. The two legs are thick and short, sunk to the knees in a rough skirt of fused rubble, broken beams and stones that is part of its body. Seen from a straight-on front view at eye level, full body from head to the bottom of the rubble, filling most of the image height, standing upright in a relaxed A-pose with both arms held slightly away from the body, symmetrical, facing the viewer. Every part is solidly attached to the body: no free-floating rocks, no free-floating crystals, no free-floating rings, no loose chain links, no dangling chain ends. Stylized hand-painted fantasy game boss look, clean readable silhouette, monumental and ancient. Near-monochrome light grey materials, all detail in light-and-dark contrast, glowing parts painted almost white, no saturated colors. Soft even frontal studio lighting, no cast shadows, no dramatic highlights. Plain solid white background, completely empty, no floor, no ground plane, no pedestal, no shadow on the background. The whole figure fully visible with a white margin around it, nothing cropped at the edges. No text, no labels, no numbers, no watermark, no frame. Square 1:1 image.
```

Não precisa recortar: a imagem inteira vai ao Meshy (salve também como
`imagens\recortes\O Eco Primordial.png`, para a pasta ficar igual às outras).

### Os Ecos Menores · chaves `eco-menor-fogo/agua/terra/ar`

A cada troca de fase o Eco chama Ecos Menores: **pedaços dele que ganharam
pernas**. Têm o porte de um monstro comum (**1,80 m**) e precisam ler como
FILHOS do Eco e IRMÃOS entre si — a regra dos Arautos do Coração: **um corpo
só, recheio diferente**. A base comum dos quatro: um humanoide curvado, magro,
com um **núcleo pequeno aceso no peito** (o mesmo do Eco, em miniatura) e uma
**máscara de pedra rachada** com duas fendas de luz no lugar do rosto. Cada um
muda o material do corpo.

| nome no jogo | id | chave (pasta) | elem | papel | recheio |
|---|---|---|---|---|---|
| Eco Menor de Brasa | `eco_menor_fogo` | `eco-menor-fogo` | fogo | distância | um pedaço de lava solidificada, rachada, brasa nas frestas |
| Eco Menor de Coral | `eco_menor_agua` | `eco-menor-agua` | água | distância | galhos de coral com água presa que não escorre |
| Eco Menor de Rocha | `eco_menor_terra` | `eco-menor-terra` | terra | corpo a corpo, tanque | um bloco do ombro do Eco: atarracado, pesado |
| Eco Menor de Vento | `eco_menor_ar` | `eco-menor-ar` | ar | corpo a corpo, rápido | um fio de vento preso numa corrente, leve, esguio |

Animação: idle · walk · run (Brasa, Coral e Vento) · attack · hit · death
(desfaz-se no elemento dele).

### Folha E1 — Brasa e Coral · `ecos menores 1.png`

```
A character design reference sheet for a 3D game: two separate full-body small creatures standing side by side, each one centered in its own half of the image, with a wide empty white gap between them, not touching and not overlapping. They are siblings with the same base body: a lean, slightly hunched humanoid with long thin arms, a small round core glowing almost white in the middle of the chest, and a cracked stone mask for a face with two thin slits of pale light. Left: the body is a chunk of cooled lava rock, rough and porous, split by cracks that glow almost white, sharp ridges on the shoulders and knuckles. Right: the body is made of branching coral with smooth glassy sculpted water trapped between the branches as part of the body, small shells on the shoulders, fingers like coral twigs. Both seen from a straight-on front view at eye level, the same camera, full body from head to feet, each one filling most of the image height, standing upright in a relaxed A-pose with both arms held slightly away from the body, feet apart, symmetrical, facing the viewer. Every part is solidly attached to the body: no free-floating rocks, no drops of water in the air, no free-floating rings, no loose chain links. Stylized hand-painted fantasy game creature look, clean readable silhouettes. Near-monochrome light grey materials, all detail in light-and-dark contrast, glowing parts painted almost white, no saturated colors. Soft even frontal studio lighting, no cast shadows, no dramatic highlights. Plain solid white background, completely empty, no floor, no ground, no pedestal, no base, no shadow on the background. Both creatures fully visible with a white margin around them, nothing cropped at the edges. No text, no labels, no numbers, no watermark, no frame. Wide landscape 16:9 image.
```

### Folha E2 — Rocha e Vento · `ecos menores 2.png`

```
A character design reference sheet for a 3D game: two separate full-body small creatures standing side by side, each one centered in its own half of the image, with a wide empty white gap between them, not touching and not overlapping. They are siblings with the same base body: a humanoid with a small round core glowing almost white in the middle of the chest and a cracked stone mask for a face with two thin slits of pale light. Left: a squat, heavy version, the body a single thick block of layered bedrock broken off a larger statue, very broad shoulders, short thick legs, big blocky fists, flat stone plates on the forearms. Right: a slender, light version, the body of smooth wind-worn pale stone with a thin iron chain wrapped tightly in a spiral around the torso and both arms, lying flat against the body, and a spiral of trapped wind sculpted as a solid ribbon around the chest, long narrow limbs, a narrow head. Both seen from a straight-on front view at eye level, the same camera, full body from head to feet, each one filling most of the image height, standing upright in a relaxed A-pose with both arms held slightly away from the body, feet apart, symmetrical, facing the viewer. Every part is solidly attached to the body: no free-floating stones, no free-floating rings, no loose chain links, no dangling chain ends. Stylized hand-painted fantasy game creature look, clean readable silhouettes. Near-monochrome light grey materials, all detail in light-and-dark contrast, glowing parts painted almost white, no saturated colors. Soft even frontal studio lighting, no cast shadows, no dramatic highlights. Plain solid white background, completely empty, no floor, no ground, no pedestal, no base, no shadow on the background. Both creatures fully visible with a white margin around them, nothing cropped at the edges. No text, no labels, no numbers, no watermark, no frame. Wide landscape 16:9 image.
```

**Recorte:** `Eco Menor de Brasa.png`, `Eco Menor de Coral.png`,
`Eco Menor de Rocha.png`, `Eco Menor de Vento.png`.

### Os manifestos destes dois lotes (para quem for embutir)

O `embute_monstros.py --manifesto` lê `js/core/data/monsters.js` pelo
`dungeonId` — e nem os Colossos (`dungeonId: null`) nem o Eco (que mora em
`js/core/data/eco.js`) têm calabouço. **Não rode `--manifesto` para eles**:
escreva o manifesto à mão em `tools/monstros/<lote>.json`. O campo `id` é a
**chave do modelo** (`colosso-fogo`, não `colosso_fogo`), porque é com ela que o
embutidor escreve `JOGO.MODELS[...]` e é por ela que o corpo provisório sai de
cena sozinho. Depois é o caminho de sempre: `--raio-x`, a fusão, o
`index.html` e o `extrai_assets.py`, com as duas exceções que estão em
*Pendências do código* no fim (o grupo de download no `extrai_assets.py` e a
régua do bestiário, que não serve para quem não tem calabouço).

```json
{
  "calabouco": "colossos",
  "origem": "C:\\Users\\danie\\Downloads\\assets_ok\\mapa\\Os Colossos do Poco\\monstros",
  "saida": "assets/embedded/models-meshy-colossos.js",
  "monstros": [
    {"id": "colosso-fogo",  "nome": "Colosso de Brasa",    "boss": false, "pasta": "Colosso de Brasa",    "prefixo": "Colosso de Brasa",    "mapa": {"idle": "idle", "walk": "walk", "run": "run", "attack": "attack", "hit": "hit", "death": "death"}},
    {"id": "colosso-agua",  "nome": "Colosso da Maré",     "boss": false, "pasta": "Colosso da Maré",     "prefixo": "Colosso da Maré",     "mapa": {"idle": "idle", "walk": "walk", "run": "run", "attack": "attack", "hit": "hit", "death": "death"}},
    {"id": "colosso-terra", "nome": "Colosso de Rocha",    "boss": false, "pasta": "Colosso de Rocha",    "prefixo": "Colosso de Rocha",    "mapa": {"idle": "idle", "walk": "walk", "run": "run", "attack": "attack", "hit": "hit", "death": "death"}},
    {"id": "colosso-ar",    "nome": "Colosso da Ventania", "boss": false, "pasta": "Colosso da Ventania", "prefixo": "Colosso da Ventania", "mapa": {"idle": "idle", "walk": "walk", "run": "run", "attack": "attack", "hit": "hit", "death": "death"}}
  ]
}
```

O do Eco é igual, com `"calabouco": "eco"`, `"origem": "...\\O Eco Primordial\\monstros"`,
`"saida": "assets/embedded/models-meshy-eco.js"` e as cinco entradas
`boss-eco-primordial` (`"boss": true`, nome `O Eco Primordial`),
`eco-menor-fogo` (`Eco Menor de Brasa`), `eco-menor-agua` (`Eco Menor de Coral`),
`eco-menor-terra` (`Eco Menor de Rocha`) e `eco-menor-ar` (`Eco Menor de Vento`).

---

# 3 · A SALA DE GUERRA (a Sede da guerra de guilda) — prefixo `sd_`

Hoje o Salão da Sede (`js/core/data/arenas.js`, mapa "A Arena do Trono", 25×19)
é todo feito de caixas e cilindros desenhados no código
(`js/render3d/renderer3d_v2.js`, de `chaoDaSede` a `montaPecaDaSede`). Cada peça
abaixo substitui uma dessas primitivas e **herda o papel tático dela**: a
altura de cada uma foi medida contra a câmera e contra a visão dos
nascimentos, então a PROPORÇÃO pedida no prompt importa.

| peça hoje (código) | papel no mapa | casas | altura no jogo | regra que a arte não pode quebrar |
|---|---|---|---|---|
| `paredesDoSalao` | o contorno do salão | borda | 4,03 m (inteira) / 1,05 m (cortada, do lado da câmera) | pontas retas para emendar; existe nas DUAS alturas |
| a porta (dentro de `paredesDoSalao`) | a saída sul | 3 casas | 4,03 m | vão aberto, passa gente |
| `tronoDaSede` | o fundo da sala do trono | 3×1 | ~4,2 m (painel) | alto, mais largo que alto |
| `lareiraDaSede` | uma em cada ala | 1×3 na parede | 2,3 m + chaminé até a parede | a chaminé e o fogo continuam no código |
| `estandarteDaSede` | 4, com a bandeira de cada guilda | 1×1 | 4,74 m | o PANO é do código (cor e emblema da guilda) |
| `pilarDaSede` | 42 no mapa, cobertura alta | 1×1 | **2,64 m, no máximo** | mais alto que isso esconde casa de nascimento |
| `armaduraDaSede` | 4 (colunata e átrio) | 1×1 | 3,98 m | conta como pilar ('#') |
| `mesaDaSede` | a mesa do conselho, no centro | 3×3 | **≤ 1,2 m** | baixa: herói vê por cima; hoje traz os DOIS bancos corridos dentro da pegada |
| `bancoDaSede` | 6, cobertura baixa | 1×1 | 0,51 m | baixo ('=') |
| `estatuaDaSede` | 2, o busto do fundador | 1×1 | **≤ 1,2 m** | baixa ('='), não é estátua de corpo inteiro |
| `bauDaSede` | 6, a 2 casas dos nascimentos | 1×1 | 0,9 m | baixo ('=') |

**Duas peças a mais**, que enriquecem a sala sem mexer na régua tática porque
cada uma entra NO LUGAR de uma peça da mesma altura:
- `sd_rack_armas` — um cavalete de armas, ALTO como o pilar (≤ 2,64 m): pode
  trocar alguns dos 42 pilares nas alas, para a sala parecer quartel e não
  floresta de colunas;
- `sd_trofeu` — um pedestal de troféu (crânio de monstro e lanças partidas),
  BAIXO como o baú (≤ 1,2 m): pode trocar baús nos cantos.
E o **mapa de guerra** que você pediu fica **esculpido no tampo da mesa**, em
relevo (montanhas, rio, torrezinhas), em vez de pergaminho solto — peça pousada
em cima de outra é a "peça solta" que desarruma o separador.

O que **continua no código** (não pedir à arte): o chão de tábuas e o tapete
(são textura sobre as casas), a soleira da porta, o pano das bandeiras (pintado
com a cor e o emblema de cada guilda, `R.setGuildasSede`), o peito da chaminé
(ele segue o recorte da parede do lado da câmera) e o fogo e a luz da lareira.

Paleta (a mesma das primitivas de hoje, `matsSede`): pedra de castelo
cinza-pardo quente, carvalho escuro envelhecido, pano carmesim profundo, ouro
velho polido nos frisos, ferro escuro, aço claro, mármore creme.

### Folha S1 — a parede (5 peças) · vista frontal reta

Arquivo: `muros\parede lisa-parede com esteio-parede com tocha-parede cortada-porta.glb`
(ou `muros\folha1.glb` com `--conta 5`).

Da esquerda para a direita: `sd_parede_lisa` · `sd_parede_esteio` ·
`sd_parede_tocha` · `sd_parede_cortada` · `sd_porta`. As três primeiras são o
módulo de UMA casa (2 m de largura, 4 m de altura: duas vezes mais alto que
largo); a cortada é o mesmo módulo a 1 m, com o topo reto como fatiado, que o
jogo mostra no lado da parede que fica entre a câmera e o salão; a porta é o
vão de três casas.

```
A game asset reference sheet: five separate stylized fantasy castle hall wall pieces arranged in one horizontal row, evenly spaced, with a wide clear empty gap between every object, none touching and none overlapping. From left to right: (1) a modular tall interior castle wall section of warm grey-brown fitted stone blocks, a dark oak skirting board along the bottom, a carved stone cornice along the top, a flat straight top edge, straight vertical flush ends, about twice as tall as it is wide; (2) the same tall wall section with a thick dark oak timber post running up the middle from the skirting board to a horizontal oak beam under the cornice, straight vertical flush ends, about twice as tall as it is wide; (3) the same tall wall section with an iron torch bracket bolted to the middle at head height holding an unlit torch, the bracket and torch solidly attached to the wall, no flame, straight vertical flush ends, about twice as tall as it is wide; (4) the same wall cut down to a low section, the same stone blocks and skirting board but only about half as tall as it is wide, its top cut perfectly flat and clean as if sliced, straight vertical flush ends; (5) a wide castle hall doorway, two stone door jambs and a heavy dark oak lintel beam with stone blocks above it, the opening completely empty and open with no door leaves, as tall as the wall sections and about one and a half times as wide as it is tall. Every part of every object is solidly attached to it: no free-floating rings, no loose chain links, no separate pieces resting on top. All five seen from a straight-on front view at eye level, flat orthographic framing with no perspective distortion, the same camera for every object, all standing on the same invisible ground line with their bases aligned. Stylized hand-painted low-poly game art, matte surfaces, clean readable silhouettes. Colors: warm grey-brown castle stone, dark aged oak, dark iron, a thin line of old gold on the cornice. Soft even frontal studio lighting, no cast shadows, no dramatic highlights. No fire, no smoke, no glow. Plain solid white background, completely empty, no floor, no horizon, no gradient, no shadow on the background. Every object fully visible, nothing cropped at the edges. No text, no labels, no numbers, no watermark, no frame, no people. Wide landscape 16:9 image.
```

### Folha S2 — o fundo do salão (3 peças) · três-quartos, 30° acima

Arquivo: `itens mapa\trono-lareira-estandarte.glb`.

`sd_trono` (3 casas de largura: estrado de pedra com degrau, painel alto de
carvalho escuro com o pano carmesim e frisos de ouro, dois postes com pomo de
ouro nas pontas, a cadeira de espaldar alto no meio) · `sd_lareira` (3 casas de
largura, até a altura do consolo: moldura de pedra com a boca escura, consolo de
carvalho, lenha empilhada SEM fogo; nada de chaminé — ela é do código) ·
`sd_estandarte` (base redonda de pedra, mastro de carvalho, travessa com pomos
de ouro nas pontas e no topo, **sem pano** — a bandeira é pintada pelo jogo com
as cores da guilda).

```
A game asset reference sheet: three separate stylized fantasy castle hall props arranged in one horizontal row, evenly spaced, with a wide clear empty gap between every object, none touching and none overlapping. From left to right: (1) a grand throne set, wider than it is tall: a long low stone dais with one step in front, a tall dark oak back panel behind it hung with a deep crimson cloth framed by old gold strips, a tall oak post topped with a gold orb at each end of the dais, and in the middle a high-backed carved oak throne chair with a crimson cushion and a small gold crest on top, everything joined into one solid piece; (2) a wide stone fireplace, wider than it is tall: a stone hearth slab, a stone surround with a dark empty firebox, a heavy dark oak mantel beam across the top, two split logs lying inside the firebox, no fire and no flames, no chimney above the mantel; (3) a tall banner pole: a round stone base, a tall dark oak pole, a horizontal crossbar near the top with small gold orbs on both ends and a gold orb on the very top, no cloth and no flag hanging from it, much taller than it is wide. Every part of every object is solidly attached to it: no free-floating rings, no loose chain links, no separate pieces resting on top. All three seen from the same three-quarter view about thirty degrees above eye level, the same camera for every object, all standing on the same invisible ground line with their bases aligned. Stylized hand-painted low-poly game art, matte surfaces, clean readable silhouettes. Colors: warm grey-brown castle stone, dark aged oak, deep crimson cloth, polished old gold trim. Soft even studio lighting, no cast shadows, no dramatic highlights. No fire, no smoke, no glow. Plain solid white background, completely empty, no floor, no horizon, no gradient, no shadow on the background. Every object fully visible, nothing cropped at the edges. No text, no labels, no numbers, no watermark, no frame, no people. Wide landscape 16:9 image.
```

### Folha S3 — o que fica de pé (4 peças) · três-quartos, 30° acima

Arquivo: `itens mapa\pilar-armadura-rack de armas-estatua.glb`.

`sd_pilar` (base quadrada, plinto, fuste redondo, capitel e ábaco — **pouco
mais de duas vezes mais alto que largo**: no jogo ele não passa de 2,64 m) ·
`sd_armadura` (armadura de placas num suporte de carvalho, tabardo carmesim,
escudo redondo preso no braço esquerdo, alabarda de pé na mão direita — a
alabarda é a parte mais alta) · `sd_rack_armas` (cavalete de carvalho com
espadas, lanças e um machado encaixados, cada arma TOCANDO o cavalete; mais ou
menos da altura do pilar) · `sd_estatua` (o busto do fundador num plinto de
pedra — busto, não corpo inteiro: a peça é baixa, quase tão larga quanto alta).

```
A game asset reference sheet: four separate stylized fantasy castle hall props arranged in one horizontal row, evenly spaced, with a wide clear empty gap between every object, none touching and none overlapping. From left to right: (1) a stone hall column: a square stone base, a plinth, a short round shaft, a round capital and a square abacus on top, a little more than twice as tall as it is wide; (2) a suit of plate armor displayed on a dark oak stand: steel greaves, breastplate and pauldrons, a closed helmet with a short crimson plume, a crimson tabard over the chest, a round crimson shield strapped to the left arm, a tall halberd held upright in the right gauntlet with its foot on the stand, every part touching and attached, much taller than it is wide; (3) a dark oak weapon rack about as tall as the column: an upright frame with two crossbars holding three swords, two spears and a battle axe standing in their slots, every weapon resting firmly in the rack and touching it; (4) a low stone bust of a bearded founder on a square stone plinth, cream marble head and shoulders, only the bust and no full body, about as wide as it is tall. Every part of every object is solidly attached to it: no free-floating rings, no loose chain links, no separate pieces resting on top. All four seen from the same three-quarter view about thirty degrees above eye level, the same camera for every object, all standing on the same invisible ground line with their bases aligned. Stylized hand-painted low-poly game art, matte surfaces, clean readable silhouettes. Colors: warm grey-brown castle stone, cream marble, dark aged oak, bright steel, deep crimson cloth, old gold trim. Soft even studio lighting, no cast shadows, no dramatic highlights. Plain solid white background, completely empty, no floor, no horizon, no gradient, no shadow on the background. Every object fully visible, nothing cropped at the edges. No text, no labels, no numbers, no watermark, no frame, no people. Wide landscape 16:9 image.
```

### Folha S4 — o que fica baixo (4 peças) · três-quartos, 40° acima

Arquivo: `itens mapa\mesa do conselho-banco-bau-trofeu.glb`.

A câmera sobe para 40° porque as quatro são baixas e a mesa só "conta" o mapa
de guerra se o tampo aparecer. `sd_mesa` (mesa comprida e larga de carvalho,
pernas grossas, o tampo inteiro esculpido como **mapa de guerra em relevo** —
morros, um rio, estradas e torrezinhas que fazem parte do tampo; **sem bancos
grudados**, que são peça própria) · `sd_banco` (banco corrido de tábua com dois
pés e uma travessa) · `sd_bau` (baú de carvalho com tampa abaulada, cintas de
ferro e fecho de ouro, FECHADO) · `sd_trofeu` (pedestal baixo de pedra com um
crânio de monstro chifrudo preso no topo e duas lanças partidas cruzadas
cravadas nele).

```
A game asset reference sheet: four separate stylized fantasy castle hall props arranged in one horizontal row, evenly spaced, with a wide clear empty gap between every object, none touching and none overlapping, all four low, about knee to waist height. From left to right: (1) a long wide war council table of dark oak on thick legs, much wider than it is tall, its whole tabletop carved as a raised relief war map with small hills, a winding river, roads and tiny tower shapes that are all carved into the wood of the tabletop itself, a thin old gold trim along the edge, no benches attached and nothing placed on top; (2) a plain long wooden bench, a plank seat on two solid legs joined by a crossbar; (3) a closed dark oak treasure chest with a rounded lid, iron bands around it and a gold lock plate on the front; (4) a low square stone trophy pedestal with a large horned monster skull fixed on top and two broken spears crossed and driven into the pedestal, everything attached. Every part of every object is solidly attached to it: no free-floating rings, no loose chain links, no separate pieces resting on top. All four seen from the same elevated three-quarter view about forty degrees above the ground, high enough that the carved map on the tabletop reads clearly, the same camera for every object, all standing on the same invisible ground line with their bases aligned. Stylized hand-painted low-poly game art, matte surfaces, clean readable silhouettes. Colors: dark aged oak, warm grey-brown stone, dark iron, old gold, bone white. Soft even studio lighting, no cast shadows, no dramatic highlights. Plain solid white background, completely empty, no floor plane, no horizon, no gradient, no shadow on the background. Every object fully visible, nothing cropped at the edges. No text, no labels, no numbers, no watermark, no frame, no people. Wide landscape 16:9 image.
```

### Como separar a Sala de Guerra

```
muros\       --conta 5          (a parede)
itens mapa\  --conta 4,4,3      (ordem alfabética: mesa…, pilar…, trono…)
```

| papel na Sede | peça |
|---|---|
| `parede_salao` | `sd_parede_lisa`, `sd_parede_esteio`, `sd_parede_tocha` (inteira) · `sd_parede_cortada` (lado da câmera) · `sd_porta` |
| `trono` · `lareira` · `estandarte` | `sd_trono` · `sd_lareira` · `sd_estandarte` |
| `pilar` · `armadura` | `sd_pilar` (e `sd_rack_armas` como variante) · `sd_armadura` |
| `mesa` · `banco_salao` · `estatua` · `bau` | `sd_mesa` · `sd_banco` · `sd_estatua` · `sd_bau` (e `sd_trofeu` como variante) |

---

# 4 · O SANTUÁRIO DOS ELEMENTOS — prefixo `el_`

**Esta noite é só arte e desenho: o mapa ainda não existe no código.** Quatro
quadrantes, cada um com uma regra de terreno, e um centro comum:

| quadrante | nome | regra (a arte tem de mostrá-la) |
|---|---|---|
| Fogo | **Câmara Apagada** | escuridão: quem segue o caminho do Fogo enxerga longe, os outros só 2 casas; **braseiros acesos** iluminam uma área |
| Água | **Galeria Alagada** | casa alagada custa 2 PP (menos para Água); **correnteza** empurra 1 casa no fim do turno |
| Terra | **Salão dos Pilares Vivos** | **muros de pedra sobem e descem** a cada 2 turnos, com aviso, mudando a visão |
| Ar | **Terraço da Ventania** | **rajadas** empurram numa direção que muda; feitiço de Ar ganha +1 de alcance |

**Sem armadilhas neste mapa** (decisão do dono: armadilha aleatória fica no
Poço). As peças "de mecânica" vêm PARADAS e APAGADAS — quem acende o braseiro,
levanta o pilar, sopra o vento e mostra a correnteza é o código:

| peça de mecânica | o que o código faz com ela | o que a arte precisa garantir |
|---|---|---|
| `el_braseiro` | acende a luz e o fogo | bacia com carvão, sem chama |
| `el_pilar_vivo` | sobe e desce o bloco inteiro | bloco ÚNICO, topo reto, base reta, nada pendurado |
| `el_soquete` | fica no chão onde o pilar desce | moldura rasteira com o encaixe quadrado |
| `el_respiro` | solta a coluna de vento (efeito) | pedestal com respiro; o vento NÃO vem na imagem |
| `el_cata_vento` | gira a peça toda para onde a rajada sopra | base redonda, para o giro não aparecer |
| `el_bica` | a correnteza sai dela (efeito) | carranca com a boca aberta, sem água caindo |
| `el_poca` / `el_ponte` | a casa alagada e a passagem por cima | rasteiras, a água esculpida e parada |

**Paleta por quadrante** (o cenário NÃO é tingido pelo jogo — a cor é a final),
amarrada por uma pedra de santuário comum, entalhada com o símbolo de cada
elemento (chama, onda, montanha, espiral — **símbolos, nunca letras**):
- **Fogo**: basalto quase negro, ferro, ouro velho fosco, brasa escura nas frestas — sala ESCURA;
- **Água**: pedra azul-acinzentada molhada, bronze com verdete, musgo de água;
- **Terra**: granito e arenito ocre, musgo verde, raiz, cristal;
- **Ar**: mármore claro gasto pelo vento, lilás pálido, bronze polido, pano claro.

### Folha EL1 — os muros inteiros (4 peças) · vista frontal reta

Arquivo: `muros\muro fogo-muro agua-muro terra-muro ar.glb`.

`el_muro_fogo` · `el_muro_agua` · `el_muro_terra` · `el_muro_ar` — o mesmo
módulo (duas vezes mais largo que alto, topo reto, pontas retas) em quatro
pedras. O renderizador usa a 0,92 m (`LOW_H`) como divisória e estica a
3,10 m como parede, sempre com 3 m de largura (`LARG_MURO`).

```
A game asset reference sheet: four separate stylized fantasy sanctuary wall sections arranged in one horizontal row, evenly spaced, with a wide clear empty gap between every object, none touching and none overlapping. All four are the same modular low wall shape, about twice as wide as it is tall, with a flat straight top edge and straight vertical flush ends, each carved with one small elemental symbol in the middle, and each built from a different stone. From left to right: (1) near-black volcanic basalt blocks with thin dark ember-red veins in the joints, a dark iron band along the top, a small carved flame symbol; (2) blue-grey wet-looking stone blocks with a carved water channel running along the face, verdigris bronze trim along the top, patches of water moss, a small carved wave symbol; (3) huge rough ochre granite and sandstone blocks fitted without mortar, moss in the joints, a thin root crossing the face and sunk into the stone, a small carved mountain symbol; (4) pale weathered marble with round openings carved clean through the wall where the wind passes, polished bronze trim along the top, a small carved spiral symbol. Every part of every object is solidly attached to it: no free-floating rings, no loose chain links, no separate pieces resting on top. All four seen from a straight-on front view at eye level, flat orthographic framing with no perspective distortion, the same camera for every object, all standing on the same invisible ground line with their bases aligned. Stylized hand-painted low-poly game art, matte surfaces, clean readable silhouettes. Soft even frontal studio lighting, no cast shadows, no dramatic highlights. No fire, no smoke, no glow, no flowing water. Plain solid white background, completely empty, no floor, no horizon, no gradient, no shadow on the background. Every object fully visible, nothing cropped at the edges. No text, no labels, no letters, no numbers, no watermark, no frame, no people. Wide landscape 16:9 image.
```

### Folha EL2 — os muros com brecha (4 peças) · vista frontal reta

Arquivo: `muros\brecha fogo-brecha agua-brecha terra-brecha ar.glb`.

`el_brecha_fogo` · `el_brecha_agua` · `el_brecha_terra` · `el_brecha_ar` — o
mesmo módulo da EL1, cada um com uma brecha no meio (todo kit tem um muro
inteiro e um com brecha). **Se o saldo apertar, esta é a folha que pode cair**:
o kit vive com o muro inteiro repetido, só fica mais monótono.

```
A game asset reference sheet: four separate stylized fantasy sanctuary wall sections arranged in one horizontal row, evenly spaced, with a wide clear empty gap between every object, none touching and none overlapping. All four are the same modular low wall shape, about twice as wide as it is tall, with straight vertical flush ends and a flat straight top on the remaining sections, each with a collapsed breach in the middle where the top blocks have fallen away leaving a jagged gap, the fallen blocks fused into a low heap at the foot of the gap, and each built from a different stone. From left to right: (1) near-black volcanic basalt blocks with thin dark ember-red veins in the joints and a dark iron band along the top; (2) blue-grey wet-looking stone blocks with a carved water channel along the face and verdigris bronze trim; (3) huge rough ochre granite and sandstone blocks fitted without mortar, moss in the joints, a root growing through the breach and sunk into the stone; (4) pale weathered marble with round wind holes carved through it and polished bronze trim. Every part of every object is solidly attached to it: no free-floating rings, no loose chain links, no separate pieces resting on top, no loose rubble apart from the heap fused to the wall. All four seen from a straight-on front view at eye level, flat orthographic framing with no perspective distortion, the same camera for every object, all standing on the same invisible ground line with their bases aligned. Stylized hand-painted low-poly game art, matte surfaces, clean readable silhouettes. Soft even frontal studio lighting, no cast shadows, no dramatic highlights. No fire, no smoke, no glow, no flowing water. Plain solid white background, completely empty, no floor, no horizon, no gradient, no shadow on the background. Every object fully visible, nothing cropped at the edges. No text, no labels, no letters, no numbers, no watermark, no frame, no people. Wide landscape 16:9 image.
```

### Folha EL3 — Fogo, a Câmara Apagada (4 peças) · três-quartos, 30° acima

Arquivo: `itens mapa\pilar de basalto-braseiro-estatua cega-velas.glb`.

`el_fogo_pilar` (**pilar**: coluna de basalto com cinta de ferro) ·
`el_braseiro` (**mecânica**, ~1,4 m: tripé de ferro com bacia de carvão,
APAGADO) · `el_estatua_cega` (**sotaque_alto**, ~3,1 m: figura de pedra com os
olhos vendados segurando uma lanterna fechada e fria junto ao peito — a sala
onde só quem é do Fogo enxerga) · `el_velas` (**sotaque**, ~1 m: bloco de pedra
coberto de velas derretidas e apagadas, cera escorrida).

```
A game asset reference sheet: four separate stylized fantasy dark sanctuary props arranged in one horizontal row, evenly spaced, with a wide clear empty gap between every object, none touching and none overlapping. From left to right: (1) a tall narrow column of near-black volcanic basalt with a dark iron band around the middle and a carved flame symbol on its square base, much taller than it is wide; (2) a waist-high iron brazier on three legs, a wide iron bowl heaped with dark unlit coals, no fire, no flames, no smoke; (3) a tall narrow stone statue of a robed figure with a cloth blindfold carved over its eyes, holding a closed cold iron lantern against its chest with both hands, the lantern carved as part of the statue, standing on a square plinth; (4) a waist-high block of black stone covered in a cluster of many melted unlit candles of different heights, thick wax dripping down the sides of the block and fused to it, no flames. The first and third are tall and narrow, the second and fourth are about waist height. Every part of every object is solidly attached to it: no free-floating rings, no loose chain links, no separate pieces resting on top. All four seen from the same three-quarter view about thirty degrees above eye level, the same camera for every object, all standing on the same invisible ground line with their bases aligned. Stylized hand-painted low-poly game art, matte surfaces, clean readable silhouettes. Colors: near-black basalt, dark iron, dull old gold, cream wax, the faintest dark ember red in the coals. Soft even studio lighting, no cast shadows, no dramatic highlights. No fire, no smoke, no glow. Plain solid white background, completely empty, no floor, no horizon, no gradient, no shadow on the background. Every object fully visible, nothing cropped at the edges. No text, no labels, no letters, no numbers, no watermark, no frame, no people. Wide landscape 16:9 image.
```

### Folha EL4 — Água, a Galeria Alagada (4 peças) · três-quartos, 30° acima

Arquivo: `itens mapa\pilar da mare-bica-regua da mare-jarros.glb`.

`el_agua_pilar` (**pilar**: coluna de pedra azul com marcas de nível d'água e
craca na base) · `el_bica` (**sotaque_alto** + **mecânica**, ~3,1 m: estela alta
com uma carranca de peixe de bronze de boca aberta — de onde sai a correnteza;
sem água caindo) · `el_regua_mare` (**sotaque**, ~1,5 m: poste de bronze com
marcas de nível, como régua de maré) · `el_jarros` (**sotaque**, ~1 m: três
ânforas de pedra fundidas numa base, uma tombada e colada às outras).

```
A game asset reference sheet: four separate stylized fantasy flooded sanctuary props arranged in one horizontal row, evenly spaced, with a wide clear empty gap between every object, none touching and none overlapping. From left to right: (1) a tall narrow column of blue-grey wet-looking stone with horizontal water level marks carved along it, barnacles and water moss around its base, a carved wave symbol, much taller than it is wide; (2) a tall narrow stone stele with a large verdigris bronze fish head carved at the top, its mouth wide open as a water spout, a carved channel running down the face of the stele, no water pouring out; (3) a chest-high verdigris bronze post marked with notched horizontal level lines like a tide gauge, on a round stone foot; (4) a waist-high cluster of three stone amphorae fused onto one low stone base, one of them tipped over and leaning against the others, all joined together. The first two are tall and narrow, the last two are about waist to chest height. Every part of every object is solidly attached to it: no free-floating rings, no loose chain links, no separate pieces resting on top. All four seen from the same three-quarter view about thirty degrees above eye level, the same camera for every object, all standing on the same invisible ground line with their bases aligned. Stylized hand-painted low-poly game art, matte surfaces, clean readable silhouettes. Colors: blue-grey wet stone, verdigris bronze, dark green water moss, pale barnacles. Soft even studio lighting, no cast shadows, no dramatic highlights. No flowing water, no splashes, no glow. Plain solid white background, completely empty, no floor, no horizon, no gradient, no shadow on the background. Every object fully visible, nothing cropped at the edges. No text, no labels, no letters, no numbers, no watermark, no frame, no people. Wide landscape 16:9 image.
```

### Folha EL5 — Terra, o Salão dos Pilares Vivos (4 peças) · três-quartos, 30° acima

Arquivo: `itens mapa\pilar vivo-pilar de raiz-menir-geodo.glb`.

`el_pilar_vivo` (**mecânica**: o muro que sobe e desce — um monólito quadrado
de granito com um rosto antigo entalhado, sulcos verticais e o topo e a base
retos; o código o sobe inteiro) · `el_terra_pilar` (**pilar** fixo: coluna de
arenito abraçada por raízes) · `el_menir` (**sotaque_alto**, ~3,1 m: menir alto
com musgo e um cinturão de cristais crescendo nele) · `el_geodo` (**sotaque**,
~1,2 m: geodo aberto em pé, cristais por dentro).

```
A game asset reference sheet: four separate stylized fantasy earth sanctuary props arranged in one horizontal row, evenly spaced, with a wide clear empty gap between every object, none touching and none overlapping. From left to right: (1) a tall square monolith of rough ochre granite, one solid block with a perfectly flat top and a perfectly flat bottom, an ancient calm face carved in low relief on its front, deep vertical grooves along its sides, a carved mountain symbol, nothing hanging from it, much taller than it is wide; (2) a tall narrow sandstone column wrapped by thick tree roots that grip it and sink into its base, moss in the cracks; (3) a tall narrow standing menhir of grey granite covered in moss, a band of pale crystals growing out of its side and part of the stone; (4) a waist-high geode split open and standing upright on its round side, rough grey stone outside and a hollow lined with pale crystals inside. The first three are tall and narrow, the last is about waist height. Every part of every object is solidly attached to it: no free-floating rings, no loose chain links, no separate pieces resting on top, no loose pebbles. All four seen from the same three-quarter view about thirty degrees above eye level, the same camera for every object, all standing on the same invisible ground line with their bases aligned. Stylized hand-painted low-poly game art, matte surfaces, clean readable silhouettes. Colors: ochre granite and sandstone, grey stone, mossy green, dark brown roots, pale crystal. Soft even studio lighting, no cast shadows, no dramatic highlights. No glow. Plain solid white background, completely empty, no floor, no horizon, no gradient, no shadow on the background. Every object fully visible, nothing cropped at the edges. No text, no labels, no letters, no numbers, no watermark, no frame, no people. Wide landscape 16:9 image.
```

### Folha EL6 — Ar, o Terraço da Ventania (4 peças) · três-quartos, 30° acima

Arquivo: `itens mapa\pilar de marmore-respiro de vento-cata vento-flamula.glb`.

`el_ar_pilar` (**pilar**: coluna esbelta de mármore claro, canelada, gasta pelo
vento) · `el_respiro` (**mecânica**, ~1 m: tambor de pedra redondo com fendas
em espiral no topo, de onde o jogo solta a coluna de vento — o vento NÃO vem na
imagem) · `el_cata_vento` (**sotaque_alto**, ~3,1 m: poste de bronze com uma
seta de cata-vento no alto, sobre base REDONDA) · `el_flamula` (**sotaque**,
~1,4 m: marco de pedra com fitas de pano claro rasgadas, duras de vento, presas
ao topo).

```
A game asset reference sheet: four separate stylized fantasy windy terrace props arranged in one horizontal row, evenly spaced, with a wide clear empty gap between every object, none touching and none overlapping. From left to right: (1) a tall slender fluted column of pale weathered marble, smoothed and hollowed by the wind, a carved spiral symbol on its base, much taller than it is wide; (2) a knee-high round stone drum with spiral slots cut into its top like a vent, polished bronze rim, nothing coming out of it; (3) a tall polished bronze pole on a round stone base, topped by a large weathervane arrow with a feathered tail, the arrow fixed solidly to the pole; (4) a chest-high stone marker post with several long torn pale cloth ribbons attached to its top and frozen stiff sideways as if blown by a strong wind, every ribbon attached to the post. The first and third are tall and narrow, the second and fourth are about knee to chest height. Every part of every object is solidly attached to it: no free-floating rings, no loose chain links, no separate pieces resting on top, no loose leaves in the air. All four seen from the same three-quarter view about thirty degrees above eye level, the same camera for every object, all standing on the same invisible ground line with their bases aligned. Stylized hand-painted low-poly game art, matte surfaces, clean readable silhouettes. Colors: pale weathered marble, soft pale lilac stone accents, polished bronze, off-white cloth. Soft even studio lighting, no cast shadows, no dramatic highlights. No wind effects, no smoke, no glow. Plain solid white background, completely empty, no floor, no horizon, no gradient, no shadow on the background. Every object fully visible, nothing cropped at the edges. No text, no labels, no letters, no numbers, no watermark, no frame, no people. Wide landscape 16:9 image.
```

### Folha EL7 — o centro do santuário (3 peças) · três-quartos, 30° acima

Arquivo: `itens mapa\altar dos quatro-estela de divisa-portao do santuario.glb`.

`el_marco_altar` (**marco**, uma vez por sala: o Altar dos Quatro — tablado
redondo com quatro bacias, uma por elemento, em volta de um núcleo de pedra
adormecido; o mais largo, na ponta esquerda para garantir o vão) ·
`el_estela_divisa` (**sotaque_alto**: estela de quatro faces que marca a divisa
entre dois quadrantes, cada face com um símbolo) · `el_portao` (**borda**: o
arco de entrada do santuário, com quatro pedras-chave). A borda também pode
reaproveitar as quatro peças altas das folhas EL3–EL6 (licença que o Coração já
usou); o **marco nunca entra na borda** — é a peça de uma vez por sala.

```
A game asset reference sheet: three separate stylized fantasy sanctuary monuments arranged in one horizontal row, evenly spaced, with a wide clear empty gap between every object, none touching and none overlapping. From left to right: (1) a wide round stone altar dais with two steps, four carved basins set around its rim, one of black basalt with a flame symbol, one of blue-grey stone with a wave symbol, one of ochre granite with a mountain symbol, one of pale marble with a spiral symbol, and in the center a large round dormant stone core cracked into four quarters, about as wide as it is tall; (2) a tall narrow four-sided stone stele, each face carved with one large elemental symbol, flame, wave, mountain and spiral, a band of old gold near its top; (3) a tall stone gateway arch with four different keystones at the top, one of basalt, one of blue-grey stone, one of granite, one of marble, the opening empty and open. Every part of every object is solidly attached to it: no free-floating rings, no loose chain links, no separate pieces resting on top. All three seen from the same three-quarter view about thirty degrees above eye level, the same camera for every object, all standing on the same invisible ground line with their bases aligned. Stylized hand-painted low-poly game art, matte surfaces, clean readable silhouettes. Colors: neutral grey sanctuary stone with the four element stones, black basalt, blue-grey stone, ochre granite, pale marble, old gold. Soft even studio lighting, no cast shadows, no dramatic highlights. No fire, no flowing water, no wind effects, no glow. Plain solid white background, completely empty, no floor, no horizon, no gradient, no shadow on the background. Every object fully visible, nothing cropped at the edges. No text, no labels, no letters, no numbers, no watermark, no frame, no people. Wide landscape 16:9 image.
```

### Folha EL8 — chão de Fogo e Água (4 peças) · três-quartos, 40° acima

Arquivo: `itens mapa\grelha de brasa-cinzas-poca-ponte.glb`.

`el_grelha` (grelha de ferro no piso sobre carvão escuro) · `el_cinzas`
(mancha de cinza fria com tições apagados) · `el_poca` (a casa ALAGADA: poça
rasa de água esculpida, parada, com musgo na borda) · `el_ponte` (laje de pedra
baixa sobre dois apoios, a passagem por cima da água) — os quatro **chao**,
rasteiros, sem colisão.

```
A game asset reference sheet: four separate stylized fantasy floor props arranged in one horizontal row, evenly spaced, with a wide clear empty gap between every object, none touching and none overlapping, all four very low and lying flat on the ground. From left to right: (1) a square dark iron floor grate set in a frame of black basalt, dark unlit coals visible through the bars; (2) a low irregular patch of cold grey ash with a few burnt-out charred sticks pressed into it; (3) a shallow round puddle of still water sculpted smooth and glassy, set in a ring of blue-grey stones with water moss along the edge; (4) a low flat stone footbridge, a single wide slab resting on two short stone supports, with a carved wave symbol on its side. Every part of every object is solidly attached to it: no free-floating rings, no loose pieces resting on top, no loose pebbles. All four seen from the same elevated three-quarter view about forty degrees above the ground, high enough that the flat floor pieces read clearly as shapes and not as thin lines, the same camera for every object, all resting on the same invisible ground line. Stylized hand-painted low-poly game art, matte surfaces, clean readable silhouettes. Colors: black basalt, dark iron, grey ash, blue-grey stone, glassy dark water, green moss. Soft even studio lighting, no cast shadows, no dramatic highlights. No fire, no smoke, no glow, no flowing water. Plain solid white background, completely empty, no floor plane, no horizon, no gradient, no shadow on the background. Every object fully visible, nothing cropped at the edges. No text, no labels, no letters, no numbers, no watermark, no frame, no people. Wide landscape 16:9 image.
```

### Folha EL9 — chão de Terra e Ar (4 peças) · três-quartos, 40° acima

Arquivo: `itens mapa\soquete do pilar-rachas com raiz-rosa dos ventos-folhas no redemoinho.glb`.

`el_soquete` (o encaixe onde o pilar vivo desce: moldura quadrada de granito
rente ao chão, com o buraco escuro) · `el_rachas` (lajes rachadas com raízes
saindo das frestas) · `el_rosa_ventos` (rosa dos ventos de mármore e bronze
embutida no piso — **sem letras de norte/sul**) · `el_folhas` (folhas secas
num redemoinho baixo, coladas umas nas outras e no chão).

```
A game asset reference sheet: four separate stylized fantasy floor props arranged in one horizontal row, evenly spaced, with a wide clear empty gap between every object, none touching and none overlapping, all four very low and lying flat on the ground. From left to right: (1) a square frame of ochre granite slabs set flush in the floor around a deep square dark socket hole, grooves carved along its inner edges; (2) a patch of cracked grey floor slabs, slightly tilted, with thick roots pushing up through the cracks and moss in the joints; (3) a round compass rose inlaid in the floor, pale marble with polished bronze points, eight points of different lengths, no letters and no markings other than the points; (4) a low swirl of dry leaves pressed together into a spiral drift on the floor, all the leaves touching each other and the ground. Every part of every object is solidly attached to it: no free-floating rings, no loose pieces resting on top, no leaves in the air. All four seen from the same elevated three-quarter view about forty degrees above the ground, high enough that the flat floor pieces read clearly as shapes and not as thin lines, the same camera for every object, all resting on the same invisible ground line. Stylized hand-painted low-poly game art, matte surfaces, clean readable silhouettes. Colors: ochre granite, grey stone, dark brown roots, green moss, pale marble, polished bronze, dry brown and pale lilac leaves. Soft even studio lighting, no cast shadows, no dramatic highlights. No wind effects, no glow. Plain solid white background, completely empty, no floor plane, no horizon, no gradient, no shadow on the background. Every object fully visible, nothing cropped at the edges. No text, no labels, no letters, no numbers, no watermark, no frame, no people. Wide landscape 16:9 image.
```

### Como separar o cenário do Santuário

```
muros\       --conta 4,4                     (brecha…, muro…)
itens mapa\  --conta 3,4,4,4,4,4,4           (altar…, grelha…, pilar da mare…,
                                              pilar de basalto…, pilar de marmore…,
                                              pilar vivo…, soquete…)
```

| papel | peças |
|---|---|
| muro (`baixo`/`alto`) | `el_muro_*` (inteiros) e `el_brecha_*` — um par por quadrante |
| `pilar` | `el_fogo_pilar`, `el_agua_pilar`, `el_terra_pilar`, `el_ar_pilar` |
| `marco` | `el_marco_altar` |
| `sotaque_alto` | `el_estatua_cega`, `el_bica`, `el_menir`, `el_cata_vento`, `el_estela_divisa` |
| `sotaque` | `el_velas`, `el_regua_mare`, `el_jarros`, `el_geodo`, `el_flamula`, `el_braseiro`, `el_respiro` |
| `chao` | `el_grelha`, `el_cinzas`, `el_poca`, `el_ponte`, `el_soquete`, `el_rachas`, `el_rosa_ventos`, `el_folhas` |
| `borda` | `el_portao` + as quatro `sotaque_alto` dos quadrantes |
| mecânica (código) | `el_braseiro`, `el_pilar_vivo`, `el_soquete`, `el_respiro`, `el_cata_vento`, `el_bica`, `el_poca`, `el_ponte` |

35 peças em 9 folhas.

As alturas em metros das fichas acima são **proposta para o mapa novo**. O
renderizador de hoje não as respeita: ele põe todo `sotaque` a 0,95 m e todo
`sotaque_alto` a 3,10 m. Por isso o braseiro (~1,4 m), a régua da maré
(~1,5 m) e a flâmula (~1,4 m) só saem na altura pedida se o código do
Santuário der a elas uma altura própria. O que a imagem tem de acertar é a
PROPORÇÃO de cada peça, e essa os prompts já pedem.

### Os oito monstros do Santuário

Dois por quadrante, tingidos pelo elemento do quadrante (então vêm cinza). Os
ids são os fixados para esta noite; **os nomes, papéis e alturas são proposta
minha** — o mapa ainda não tem código, troque à vontade antes de gerar. Cada
um foi pensado para não repetir silhueta de bicho que já existe (a vespa da
Estufa, a água-viva da Cisterna, o picanço dos Andaimes, o Colosso de Magma).

| id | nome (proposta) | elem | papel (proposta) | altura | o que ele conta |
|---|---|---|---|---|---|
| `el_fogo_1` | Vigia de Pavio | fogo | distância · enxerga no escuro | 2,10 m | a cabeça é um toco de vela com um olho só na cera |
| `el_fogo_2` | Mariposa de Cinza | fogo | corpo a corpo · rápida | 1,50 m | mariposa que persegue a luz dos braseiros |
| `el_agua_1` | Caramujo-Comporta | água | tanque | 1,90 m | caramujo de pé com a concha feita de comporta de bronze |
| `el_agua_2` | Garça de Galeria | água | distância · arpoa | 2,00 m | garça pescadora, bico de arpão |
| `el_terra_1` | Pilarete | terra | tanque · imune a empurrão | 2,20 m | um pedaço de pilar vivo que levantou e andou |
| `el_terra_2` | Toupeira-Sentinela | terra | corpo a corpo · sai do chão | 1,60 m | toupeira de capacete de pedra, garras de cavar |
| `el_ar_1` | Cata-Vento | ar | distância · empurra | 2,30 m | corpo de chapas de bronze, cabeça de hélice de quatro pás |
| `el_ar_2` | Arraia de Rajada | ar | corpo a corpo · plana | 1,80 m | arraia de pé: as asas são os braços |

Animação: idle · walk (a Arraia: planar) · run (Mariposa, Toupeira e Arraia) ·
attack · hit · death.

Os dois de cada quadrante dividem a folha (mesma paleta de forma, mesmo
recorte). As alturas são acertadas no código (`scale = altura ÷ 1,80`); no
Gemini **cada um ocupa a altura toda da sua metade**.

### Folha EM1 — Fogo · `santuario monstros fogo.png`

```
A character design reference sheet for a 3D game: two separate full-body creatures standing side by side, each one centered in its own half of the image, with a wide empty white gap between them, not touching and not overlapping. Left: a tall gaunt humanoid watchman in a long tattered robe, its head is a thick stub of melted candle wax with a single large round eye set in the wax and a short burnt wick on top, wax dripping down onto its shoulders and fused to the robe, long thin hands with knobbly fingers, the eye painted almost white. Right: a moth creature as a humanoid biped, a fuzzy rounded body, large feathery antennae, big round compound eyes painted almost white, its two arms are broad moth wings with eye-spot patterns ending in small clawed hands at the wing tips, short furry legs. Both seen from a straight-on front view at eye level, the same camera, full body from head to feet, each one filling most of the image height, standing upright in a relaxed A-pose with both arms held slightly away from the body, feet apart, symmetrical, facing the viewer. Every part is solidly attached to the body: no flames, no free-floating sparks, no free-floating rings, no loose chain links. Stylized hand-painted fantasy game creature look, clean readable silhouettes. Near-monochrome light grey materials, all detail in light-and-dark contrast, glowing parts painted almost white, no saturated colors. Soft even frontal studio lighting, no cast shadows, no dramatic highlights. Plain solid white background, completely empty, no floor, no ground, no pedestal, no base, no shadow on the background. Both creatures fully visible with a white margin around them, nothing cropped at the edges. No text, no labels, no numbers, no watermark, no frame. Wide landscape 16:9 image.
```

### Folha EM2 — Água · `santuario monstros agua.png`

```
A character design reference sheet for a 3D game: two separate full-body creatures standing side by side, each one centered in its own half of the image, with a wide empty white gap between them, not touching and not overlapping. Left: a large snail creature as an upright humanoid biped, a thick soft body with two stalk eyes, a heavy shell on its back shaped like a riveted bronze sluice gate with a round valve wheel fixed flat on it, the soft foot of the snail hanging down like a skirt over two short thick legs, two thick arms with broad flat hands. Right: a tall wading heron creature as a humanoid biped, a long curved neck, a long straight beak shaped like a harpoon point, its two arms are long folded wings with feathers ending in clawed fingers at the tips, long thin legs with webbed feet, a crest of long feathers on the head. Both seen from a straight-on front view at eye level, the same camera, full body from head to feet, each one filling most of the image height, standing upright in a relaxed A-pose with both arms held slightly away from the body, feet apart, symmetrical, facing the viewer. Every part is solidly attached to the body: no drops of water in the air, no free-floating rings, no loose chain links. Stylized hand-painted fantasy game creature look, clean readable silhouettes. Near-monochrome light grey materials, all detail in light-and-dark contrast, eyes painted almost white, no saturated colors. Soft even frontal studio lighting, no cast shadows, no dramatic highlights. Plain solid white background, completely empty, no floor, no ground, no pedestal, no base, no shadow on the background. Both creatures fully visible with a white margin around them, nothing cropped at the edges. No text, no labels, no numbers, no watermark, no frame. Wide landscape 16:9 image.
```

### Folha EM3 — Terra · `santuario monstros terra.png`

```
A character design reference sheet for a 3D game: two separate full-body creatures standing side by side, each one centered in its own half of the image, with a wide empty white gap between them, not touching and not overlapping. Left: a living stone column segment as a humanoid biped, its torso is a thick carved column drum with vertical grooves, its head is a small square capital with an ancient calm face carved in it, thick stubby stone arms and legs made of stacked smaller drums, moss in the joints, very heavy and solid. Right: a mole creature as a humanoid biped, a stocky furry body, a pointed snout, tiny eyes, a round helmet of carved stone fitted on its head, huge spade-like digging claws on both hands, short strong legs, a stone plate strapped over the chest with carved straps that are part of the body. Both seen from a straight-on front view at eye level, the same camera, full body from head to feet, each one filling most of the image height, standing upright in a relaxed A-pose with both arms held slightly away from the body, feet apart, symmetrical, facing the viewer. Every part is solidly attached to the body: no free-floating stones, no free-floating rings, no loose chain links. Stylized hand-painted fantasy game creature look, clean readable silhouettes. Near-monochrome light grey materials, all detail in light-and-dark contrast, eyes painted almost white, no saturated colors. Soft even frontal studio lighting, no cast shadows, no dramatic highlights. Plain solid white background, completely empty, no floor, no ground, no pedestal, no base, no shadow on the background. Both creatures fully visible with a white margin around them, nothing cropped at the edges. No text, no labels, no numbers, no watermark, no frame. Wide landscape 16:9 image.
```

### Folha EM4 — Ar · `santuario monstros ar.png`

```
A character design reference sheet for a 3D game: two separate full-body creatures standing side by side, each one centered in its own half of the image, with a wide empty white gap between them, not touching and not overlapping. Left: a tall thin construct humanoid made of riveted bronze sheets, its head is a four-bladed propeller vane fixed flat facing forward with a round hub in the middle and two small eyes in the hub, long thin arms ending in flat vane-shaped hands, a short tattered cloth skirt attached at the waist, long thin legs. Right: a manta ray creature as a humanoid biped, a flat diamond-shaped body held upright, two small eyes on the front, its two arms are the broad flat wings of the ray ending in small clawed hands at the wing tips, the long thin tail hanging down behind like a cape attached to the back, two slim legs. Both seen from a straight-on front view at eye level, the same camera, full body from head to feet, each one filling most of the image height, standing upright in a relaxed A-pose with both arms held slightly away from the body, feet apart, symmetrical, facing the viewer. Every part is solidly attached to the body: no wind effects, no free-floating pieces, no free-floating rings, no loose chain links. Stylized hand-painted fantasy game creature look, clean readable silhouettes. Near-monochrome light grey materials, all detail in light-and-dark contrast, eyes painted almost white, no saturated colors. Soft even frontal studio lighting, no cast shadows, no dramatic highlights. Plain solid white background, completely empty, no floor, no ground, no pedestal, no base, no shadow on the background. Both creatures fully visible with a white margin around them, nothing cropped at the edges. No text, no labels, no numbers, no watermark, no frame. Wide landscape 16:9 image.
```

**Recorte:** oito PNGs em `imagens\recortes\`, com o nome de cada um
(`Vigia de Pavio.png`, `Mariposa de Cinza.png`, …). Se você trocar os nomes,
troque também o da pasta em `monstros\`: o manifesto lê a pasta pelo nome.

---

# Opcional · A Câmara do Eco (a arena do chefe) — prefixo `ce_`

Hoje a Câmara do Eco veste o kit do Coração Partido (`theme: 'heart'`). Ela
funciona assim, mas se sobrar UMA geração, esta folha dá a ela cara própria:
câmara circular sobre o vazio, pilares quebrados de cobertura.

Arquivo: `...\O Eco Primordial\itens mapa\pilar quebrado-entulho-borda do abismo-cristal do eco.glb`.

`ce_pilar_quebrado` (**alto**: os pares cardeais e as diagonais do mapa) ·
`ce_entulho` (**baixo**: o entulho que dá meia cobertura) ·
`ce_borda_abismo` (**borda**: rochedo da beira do círculo, quebrado para o
vazio) · `ce_cristal_eco` (**borda** também: cristal com o mesmo núcleo do Eco
preso dentro).

**Por que o "pilar" vem largo e o entulho comprido.** Na Câmara os `#` são
pares e casas soltas, nunca uma fileira de 3. Então quem os veste é o papel
`alto`, e não o `pilar`. O `alto` é esticado para uma caixa de **3 m de
largura por 3,10 m de altura** (`muroDaCasa`, `LARG_MURO`). Uma coluna fina
esticada a 3 m vira um bloco gordo. Por isso a peça é pedida já com a
proporção da caixa: um trecho de colunata quebrada **mais ou menos tão largo
quanto alto**. Pelo mesmo motivo, o `baixo` vira **3 m por 0,92 m**, e o
entulho é pedido **umas três vezes mais largo que alto**. O cristal vai para a
`borda` porque esta sala não tem fileira `=` de 3 casas. Sem essa fileira, um
`sotaque` nunca aparece.

```
A game asset reference sheet: four separate stylized fantasy ruin props arranged in one horizontal row, evenly spaced, with a wide clear empty gap between every object, none touching and none overlapping. From left to right: (1) a short ruined stretch of colonnade: two thick broken stone column shafts of different heights standing close together on one shared square plinth, both snapped off at an angle with jagged breaks, a cracked stone lintel fallen diagonally across them and fused to both, cracks with a faint pale line inside them, about as wide as it is tall; (2) a long low heap of fallen column drums and broken stone blocks fused together into one solid pile, about three times as wide as it is tall; (3) a rough rock outcrop broken off sharply on one side like the edge of a cliff, layered stone with a few pale crystals growing out of it; (4) a chest-high cluster of large crystals growing from a stone base, a small round core of pale light visible inside the biggest crystal. Every part of every object is solidly attached to it: no free-floating rings, no loose chain links, no separate pieces resting on top, no loose stones. All four seen from the same three-quarter view about thirty degrees above eye level, the same camera for every object, all standing on the same invisible ground line with their bases aligned. Stylized hand-painted low-poly game art, matte surfaces, clean readable silhouettes. Colors: violet-grey stone, deep indigo shadows, tarnished old gold, pale glow in the cracks and in the core. Soft even studio lighting, no cast shadows, no dramatic highlights. Plain solid white background, completely empty, no floor, no horizon, no gradient, no shadow on the background. Every object fully visible, nothing cropped at the edges. No text, no labels, no letters, no numbers, no watermark, no frame, no people. Wide landscape 16:9 image.
```

---

## O que conferir na imagem do Gemini antes de mandar ao Meshy

Um minuto de olho aqui economiza uma geração inteira:

- [ ] **contei as peças** e bate com o nome do arquivo (o Gemini às vezes junta
      duas ou inventa uma a mais);
- [ ] **nenhuma peça encosta na vizinha** — nem a sombra, nem uma ponta;
- [ ] **fundo branco liso**, sem chão desenhado, sem sombra, sem degradê;
- [ ] **nada flutuando** — argola, elo, pedrinha, folha, faísca, gota;
- [ ] **sem chama, fumaça ou água caindo** nas peças de mecânica;
- [ ] **nada cortado** na borda da imagem;
- [ ] **sem letra nenhuma** (o Gemini adora escrever o nome embaixo da peça);
- [ ] personagem: **de frente, pose A, braços longe do corpo**, nada cruzando
      o peito, e **cinza** (só o que brilha quase branco).

Se uma folha vier com uma peça a mais que você queira aproveitar (o braseiro
extra do Fecho de Brasa entrou assim), é só usar o `--conta` com o número real
em vez do nome do arquivo.

---

## Pendências do código quando a arte chegar

Nada disto é para fazer agora — é o que o lote vai pedir quando chegar:

- **Colossos e Eco**: manifesto à mão (acima), `--raio-x`, fusão, o embutido no
  `index.html`, `extrai_assets.py` e conferir o porte. A troca do provisório é
  automática (a chave própria vence); a linha do `M.CORPO_PROVISORIO` de cada um
  pode ser apagada depois. Duas armadilhas do caminho de sempre:
  · o `tools/extrai_assets.py` só sabe QUANDO baixar um embutido pela tabela
    `GRUPO_DA_PASTA`. Pasta que não está lá cai no grupo `base`, que todo
    jogador baixa ao abrir o jogo. Antes de rodar, acrescente
    `models-meshy-colossos` e `models-meshy-eco` com um grupo próprio (o Poço
    e a Câmara do Eco), senão os nove kits engordam a primeira carga (ver a
    pré-busca em `js/assets_bundle.js`);
  · o `tests/bestiario.html?calabouco=…` escolhe os bichos pelo `dungeonId` e
    procura o kit pelo id do MONSTRO (`colosso_fogo`), não pela chave do
    modelo (`colosso-fogo`). Os Colossos e o Eco não têm calabouço, então a
    régua reprova logo na primeira linha e não confere nada. O porte e os
    clipes destes dois lotes se conferem de outro jeito: o relatório da fusão
    e uma foto no jogo (ou uma régua nova).
- **Sala de Guerra**: o salão hoje não lê catálogo nenhum — monta as
  primitivas direto (`montaPecaDaSede`). A arte pede um `cenario-sede.js`
  (catálogo `JOGO.CENARIO['sede']`, nome `cenario-*` obrigatório para o jogo
  servido o achar) e um ramo em `montaPecaDaSede` que use a peça quando ela
  existir e caia na primitiva quando não. A régua continua a da
  `tests/prova_sede_tatica.html`: peça alta ≥ 2,6 m e peça baixa ≤ 1,3 m. Mais
  a da câmera, que a prova não cobra sozinha: o pilar (e o cavalete que o
  substituir) não passa de 2,64 m. A mesa da arte vem sem bancos, e a de hoje
  tem os dois bancos corridos dentro da pegada 3×3. O ramo novo tem de pôr
  `sd_banco` dos dois lados compridos da mesa, senão a mesa do conselho fica
  sem bancos.
- **Santuário dos Elementos**: tudo — o mapa, as quatro regras de terreno, os
  oito monstros nos dados. A arte fica pronta esperando.

SOTERRA · prompts do lote do lançamento · 4 colossos, 5 ecos, 8 monstros do santuário · 2 kits de cenário + 1 opcional · escrito na noite de 2 para 3 de outubro de 2026
