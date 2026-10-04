# Prompts prontos — o lote do lançamento (Colossos, Eco Primordial, Sala de Guerra, Santuário)

Escrito na noite de 02→03/10/2026 para o pacote de lançamento, **refeito em
03/10** pela regra nova do dono e **cortado no mesmo dia para caber no saldo**:
ele tem umas **30 gerações** no Meshy, não as 41 da versão anterior.

A regra do dono:

> "os monstros preciso de prompt para cada um, é melhor; os itens de mapas podem
> ter entre 3 ou 4 em cada prompt; muros devem ser individuais."

Então:

1. **Personagem** (monstro, chefe, Colosso, Eco): **um prompt por personagem**,
   e cada prompt gera **uma imagem com só aquele personagem**. Nada de recorte:
   a imagem do Gemini vai inteira ao Meshy.
2. **Item de mapa** (tudo o que não é parede: trono, pilar, mesa, braseiro,
   peça de chão…): **de 3 a 4 peças por prompt**, nunca mais, nunca menos.
3. **Muro** (toda peça de parede): **um prompt por muro**, sozinho na imagem,
   em **vista frontal reta**, para as pontas emendarem em fileira.

O caminho continua o que funcionou desde a Mina Trêmula: **a imagem sai primeiro
do Gemini e é essa imagem que entra no Meshy** (imagem→3D). Os prompts estão em
inglês, como os de `docs/PROMPTS_PORTAIS_FECHADOS.md`, porque é a língua em que
os dois geradores respondem melhor; a explicação de cada um está em português.
**Cada prompt é completo**: copie o bloco inteiro, sem juntar com nenhum outro.

## A conta

| # | encomenda | prefixo / ids | personagens (1 por imagem) | muros (1 por imagem) | folhas de itens (3 a 4 peças) | imagens no Gemini | gerações no Meshy |
|---|---|---|---|---|---|---|---|
| 1 | Os Colossos do Poço | `colosso-fogo` … `colosso-ar` | 4 | — | — | 4 | 4 |
| 2 | O Eco Primordial e o Eco Menor | `boss-eco-primordial`, `eco-menor` | 2 | — | — | 2 | 2 |
| 3 | A Sala de Guerra (a Sede) | `sd_` | — | 3 | 3 (11 peças) | 6 | 6 |
| 4 | O Santuário dos Elementos — cenário | `el_` | — | 5 | 3 (12 peças) | 8 | 8 |
| 4 | O Santuário dos Elementos — monstros | `el_fogo_1`, `el_agua_2`, `el_terra_1`, `el_ar_1` | 4 | — | — | 4 | 4 |
| | **a leva de agora** | | **10** | **8** | **6 (23 peças)** | **24** | **24** |
| | **reserva para refazer** | | | | | o que precisar | **6** |
| | **total do saldo** | | | | | | **30** |
| apêndice | Para a próxima leva | | 8 | 8 | 5 (17 peças) | 21 | 21 |

**Uma imagem do Gemini = uma geração do Meshy.** Cada personagem ainda ganha
**rig e animação** no Meshy depois da geração (os seis clipes de sempre), e
isso não entra na conta acima. Refazer uma imagem no Gemini custa pouco; a
geração do Meshy é que gasta crédito, então confira a imagem antes (a lista
está no fim).

**A reserva de 6 é para refazer.** Toda leva até hoje teve alguma geração que
saiu ruim: as costas inventadas, duas peças fundidas, a folha partida em duas.
Gaste a reserva primeiro nisso. Se sobrar, ela vai para o apêndice *Para a
próxima leva*, na ordem P1, P2, P3…

**O que saiu desta leva** (e está inteiro no apêndice, pronto para colar): três
dos Ecos Menores próprios (o genérico serve aos quatro; o do Vento fica de
opcional), a parede com esteio e a com tocha da Sede (o salão repete a lisa),
as quatro brechas do Santuário, 14 itens do Santuário, o segundo monstro de
cada quadrante e a Câmara do Eco inteira.

**Como a conta andou.** A primeira versão pedia 22 imagens e 30 gerações, com
dois personagens por folha. A segunda, com um personagem e um muro por imagem,
pedia 41 e 41. Esta pede 24, mais 6 de reserva.

---

## A ordem de produção (e por quê)

1. **Os quatro Colossos** (C1 a C4). O código já os espera: cada um tem a
   chave de modelo dele (`colosso-fogo`…) e, enquanto ela não existe, veste o
   corpo provisório de um monstro do mesmo elemento (`M.CORPO_PROVISORIO` em
   `js/render3d/models3d_v2.js`, uma tabela só para os Colossos e o Eco desde a
   junção de 03/10). Quando a chave for embutida, o colosso troca de roupa
   sozinho. É o lote que aparece no jogo mais rápido.
2. **O Eco Primordial e o Eco Menor** (E1 e E2). O evento semanal é vitrine do
   lançamento. O Eco já espera pela chave dele (a mesma tabela) e veste hoje o
   Coração Partido a 2,44×. O Eco Menor é **um corpo só para os quatro**, e
   pede uma linha de código quando chegar (ver *Pendências do código*).
3. **A Sala de Guerra** (S1 a S6). Hoje é toda primitiva desenhada no código.
   A arte entra, mas precisa de um catálogo novo para trocar as primitivas, por
   isso vem depois dos personagens.
4. **O Santuário dos Elementos** (EL1 a EL8 e EM1 a EM4). Por enquanto é SÓ
   arte: o mapa ainda não existe no código. Nada no jogo espera por ele.
5. **A reserva** (até 6 gerações): refazer o que saiu ruim; se sobrar, o
   apêndice, de P1 em diante.

Dentro de cada encomenda, primeiro vem a peça que o jogador olha por mais tempo
(o chefe, a parede), depois o resto. A numeração das seções já está nessa ordem.

---

## Três tipos de arquivo, três caminhos

| tipo | a imagem do Gemini | o que vai ao Meshy | o que volta do Meshy | depois |
|---|---|---|---|---|
| **personagem** | `imagens\<Nome do monstro>.png` | a imagem inteira, sem recorte | `monstros\<Nome do monstro>\<Nome do monstro> idle.glb` e os outros cinco clipes | manifesto → raio-X → fusão (`tools/embute_monstros.py`) |
| **muro** | `imagens\<nome do muro>.png` | a imagem inteira | `muros\<nome do muro>.glb` | **sem separador**: uma cópia de `tools/normaliza_muros_fecho.py` (textura a 1024, JPEG) |
| **folha de itens** | `imagens\<nome>-<nome>-<nome>.png` | a imagem inteira | `itens mapa\<nome>-<nome>-<nome>.glb` | `tools/separa_pecas.py` com `--conta` |

**Por que o muro não passa pelo separador.** O `separa_pecas.py` corta a folha
em ilhas de geometria e devolve parte solta para a peça mais próxima. Num muro
sozinho não há o que separar, e ele ainda poderia descartar um pedaço legítimo
(a corda do prumo dos Andaimes, uma pedra do entulho). Muro e pilar dos portais
sempre entraram pelo `normaliza_muros_*`, que só reduz a textura e regrava. Por
isso **muro nunca vai para `itens mapa\`**: o separador lê TODOS os `.glb` da
pasta que recebe.

**O nome do arquivo de uma folha de itens é a contagem.** O separador divide o
nome pelo `-` e sabe quantas peças recortar e como chamá-las, da esquerda para
a direita. Cada folha abaixo traz o nome pronto e também o `--conta` (o número
de peças), que é o que vale se você salvar com outro nome (`folha1.glb`,
`folha2.glb`…). O `--conta` da pasta inteira segue a ordem ALFABÉTICA dos
arquivos, que é como o separador os lê. Salve os nomes **em minúsculas e sem
acento**, como estão aqui: maiúscula vem antes de minúscula na ordem do
separador e trocaria a conta.

Os comandos, para quem for embutir:

```
rem folha de itens (primeiro sem --recortar: é o ensaio, não grava nada)
"C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --factory-startup --python tools/separa_pecas.py -- "C:\Users\danie\Downloads\assets_ok\mapa\<lote>\itens mapa" --recortar --conta 4,4,3

rem muros (a cópia do normaliza_muros_fecho.py com ORIG e ARQUIVOS do lote)
"C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --factory-startup --python tools/normaliza_muros_<lote>.py
```

---

## Onde salvar (o padrão do `docs/RECEBER_LOTE.md`)

```
C:\Users\danie\Downloads\assets_ok\mapa\
    Os Colossos do Poco\
        imagens\Colosso de Brasa.png   Colosso da Maré.png   Colosso de Rocha.png   Colosso da Ventania.png
        monstros\Colosso de Brasa\Colosso de Brasa idle.glb
                                  Colosso de Brasa walk.glb
                                  Colosso de Brasa attack.glb
                                  Colosso de Brasa hit.glb
                                  Colosso de Brasa death.glb
                 \Colosso da Maré\...   \Colosso de Rocha\...
                 \Colosso da Ventania\...   (este leva também o run.glb)
    O Eco Primordial\
        imagens\O Eco Primordial.png   Eco Menor.png
        monstros\O Eco Primordial\O Eco Primordial idle.glb ...
                 \Eco Menor\Eco Menor idle.glb ...
    A Sala de Guerra\
        imagens\       as 6 imagens, cada uma com o nome do .glb que ela vai virar
        muros\         parede lisa.glb   parede cortada.glb   porta.glb
        itens mapa\    as 3 folhas de itens
    O Santuario dos Elementos\
        imagens\       as 8 imagens do cenário e as 4 dos monstros
        muros\         muro fogo.glb   muro agua.glb   muro terra.glb   muro ar.glb   pilar vivo.glb
        itens mapa\    as 3 folhas de itens
        monstros\Vigia de Pavio\...   \Garça de Galeria\...   \Pilarete\...   \Cata-Vento\...
```

O apêndice usa as mesmas pastas (cada entrada diz a sua). Os nomes de pasta de
LOTE vão sem acento (as ferramentas já se perderam com acento e maiúscula mais
de uma vez); o nome de cada MONSTRO vai como está no jogo, com acento, que é o
padrão dos seis lotes; o nome de muro e de folha vai em minúsculas e sem
acento. A imagem do Gemini leva o mesmo nome do `.glb` que ela vai virar:
assim, quando um modelo sair estranho, a imagem que o gerou está do lado.

---

## As regras que decidem se o lote presta

Elas já estão dentro de cada prompt. Estão aqui para você saber o que conferir
na imagem do Gemini ANTES de gastar crédito no Meshy.

**Valem para tudo:**

1. **Fundo branco liso, sem chão, sem sombra projetada, sem degradê.** O Meshy
   reconstrói o que vê: sombra no fundo vira geometria.
2. **Nada solto**, ou seja, *no free-floating rings, no loose chain links*.
   Argola, elo, gota, faísca, pedra no ar, objeto pousado em cima de outro:
   tudo vira peça (foi o que custou a folha 2 da Mina; no Coração essa frase
   entrou e as quatro folhas saíram limpas).
3. **Sem fogo, fumaça, brilho no ar ou água caindo.** A lareira, o braseiro, a
   tocha e a coluna de vento têm efeito VIVO no jogo, feito pelo código. Se a
   chama vier na imagem, o Meshy a transforma num cone sólido. A peça vem
   APAGADA; quem acende é o jogo.
4. **Fechar sempre com:** sem texto, sem rótulo, sem número, sem marca-d'água,
   sem moldura, nada cortado na borda.

**Para muro (um por imagem):**

5. **Vista frontal reta**, ortográfica: imagem→3D só vê um lado, e a vista de
   frente é o que dá ponta reta para as cópias emendarem em fileira. Se
   aparecer o topo ou a lateral do muro, a câmera girou: refaça no Gemini.
6. **As duas pontas são cortes verticais retos** e a base é reta. Tudo o que o
   muro tem (cornija, símbolo, raiz) fica DENTRO do contorno dele.
7. **A proporção é a do módulo** (escrita em cada prompt): o renderizador estica
   o muro para a casa, e quanto mais perto do módulo a arte vier, menos ela
   deforma. Imagem **1:1** para muro mais alto que largo e **16:9** para muro
   mais largo que alto.
8. **Muros irmãos se geram com a mesma descrição.** A parede lisa, a cortada e
   a porta da Sede repetem palavra por palavra a mesma pedra e o mesmo rodapé.
   Para travar o desenho ainda mais, você pode **anexar no Gemini a imagem da
   parede lisa** junto com o prompt da seguinte: o prompt continua completo, a
   imagem anexada só segura a pedra igual.

**Para folha de itens (3 a 4 por imagem):**

9. **Vão claro entre as peças, nenhuma encostada.** Peça encostada na vizinha
   não se separa por distância nenhuma. É a regra mais importante.
10. **Mesma câmera para a folha inteira, bases na mesma linha**, e as peças na
    ordem do nome do arquivo, da esquerda para a direita (o separador as nomeia
    nessa ordem).
11. **Peça rasteira pede câmera alta (~40°).** Vista de frente ela vira um risco
    no papel e sai do Meshy com sete centímetros. As de pé vão a 30°.
12. **16:9 deitado.**

**O cenário NÃO é tingido pelo jogo**: a cor que você assar é a cor final.

**Para personagem (um por imagem):**

13. **Um personagem só, uma vista só.** O Gemini gosta de fazer "ficha de
    personagem" com frente e costas lado a lado. O prompt pede *one view only*
    e *only one character*; se vierem duas vistas, refaça (imagem→3D com duas
    figuras na foto devolve um modelo com as duas grudadas).
14. **Humanoide, sempre.** O rig do Meshy tem ossos de gente e a biblioteca de
    animação é de gente. Bicho sem pernas, de quatro patas ou com asas E braços
    passa a luta deslizando. O truque que funcionou nos seis calabouços: **não
    humanize o bicho, vista o bicho num corpo**: asa no lugar do braço, concha
    nas costas, cauda como saia.
15. **Pose A, de pé, de frente, simétrico**, braços bem afastados do corpo,
    pernas separadas, mãos à vista. Nada atravessando a frente do corpo. O que
    fica nas costas (crista, coluna) é descrito como **visível acima dos
    ombros**, porque de frente o Gemini não mostra as costas.
16. **Quase sem cor.** O jogo multiplica a textura do monstro por **52% da cor
    do elemento** (fogo laranja, água azul, terra verde, ar lilás). O volume é
    seu e o matiz é do jogo. Modele em cinza-claro, com o desenho no
    claro-escuro; o que tem de brilhar (lava, olho, núcleo) fica **quase
    branco**, e a tinta o transforma em luz da cor certa. É essa regra que
    deixa o Eco Primordial trocar de cor a cada fase e **um só Eco Menor servir
    aos quatro elementos**: só funciona se vierem cinza.
17. **Sem pedestal, sem chão, sem poça.** Corrente, argola e estilhaço vão
    COLADOS ao corpo (peça solta arruína o auto-rig: foi a correção que o
    Vendaval e o Coração precisaram em 21/09).
18. **Da cabeça aos pés, ocupando uns 85% da altura, em imagem 1:1.** Sozinho
    na imagem, o personagem fica com quase toda a altura dela: é o que deixa o
    Meshy ler mão, rosto e detalhe.
19. **Seis arquivos por personagem**, um por animação, com os nomes da árvore
    acima. Se o Meshy trocar ataque e reação de novo, o raio-X do embutidor
    corrige (aconteceu nos seis lotes).

### Como fazer um personagem, do Gemini ao jogo

1. **Gemini**: cole o prompt do personagem. Confira a imagem (lista no fim) e
   salve como `imagens\<Nome do monstro>.png`.
2. **Meshy → Image to 3D** com essa imagem, inteira. Se as costas vierem
   estranhas (só um lado é visto), o plano B é o caminho dos seis lotes:
   **Text to 3D** com a descrição daquele personagem copiada do prompt mais o
   sufixo dos monstros de `PROMPTS_PORTAIS_FECHADOS.md` (*Full-body humanoid
   biped standing upright in a relaxed A-pose… Single character, no base, no
   pedestal, no ground*).
3. **Rig** (humanoide) e **animações**: idle · walk · run (só quem tem) ·
   attack · hit (reação) · death. Exporte um GLB por animação, com os nomes da
   árvore.

**A altura não se controla no Meshy**: o código acerta depois (`MONSTER_LOOK`,
`scale = altura ÷ 1,80` para monstro comum e `altura ÷ 2,95` para chefe, que
é o caso do Eco: escala 2,00 = 5,90 m). O que você controla é a **proporção**,
e é isso que cada prompt pede. Para calibrar o olho: herói 2,05 m, casa 2,0 m,
muro 3,10 m, chefe de calabouço 2,95 a 3,60 m.

---

# 1 · OS COLOSSOS DO POÇO — 4 gerações

Quatro gigantes que aparecem nos andares múltiplos de 5 do Poço, um por andar,
girando fogo → água → terra → ar. No jogo medem **2,88 m** (1,6× um monstro
comum, abaixo de todo chefe), então a silhueta precisa dizer "gigante" mesmo
sem a régua: **ombros e antebraços enormes, pernas curtas e grossas, cabeça
pequena afundada entre os ombros** (a cabeça é um décimo da altura). Lê como
uma montanha que anda. Os quatro são irmãos de corpo (o mesmo esqueleto de
golem) e diferem no MATERIAL; por isso os três primeiros prompts repetem a
mesma frase de proporção, palavra por palavra.

| prompt | colosso | id do monstro | chave do modelo (pasta) | elem | o que a arte tem de contar |
|---|---|---|---|---|---|
| C1 | Colosso de Brasa | `colosso_fogo` | `colosso-fogo` | fogo | fendas de lava; deixa a casa em brasa por onde passa |
| C2 | Colosso da Maré | `colosso_agua` | `colosso-agua` | água | coral e água viva; cura-se parado na poça |
| C3 | Colosso de Rocha | `colosso_terra` | `colosso-terra` | terra | couraça de lajes que cai aos pedaços |
| C4 | Colosso da Ventania | `colosso_ar` | `colosso-ar` | ar | correntes de ferro com vento preso; anda mais |

**Não confundir com o Colosso de Magma** (invocação de nível 30 do Invocador,
"rocha derretida numa forma que lembra um corpo"). O de Brasa é o contrário:
rocha SÓLIDA e velha, rachada, com a lava só nas frestas.

Animação: idle · walk · attack (soco de cima para baixo) · hit · death (desaba
em blocos). O da Ventania leva também **run** (ele anda mais que os outros).

### C1 · Colosso de Brasa · `colosso-fogo`

Imagem: `imagens\Colosso de Brasa.png` → Meshy (imagem inteira) →
`monstros\Colosso de Brasa\Colosso de Brasa idle.glb` e os outros clipes.

Basalto em blocos, rachado de alto a baixo, a lava só nas frestas e pintada
quase branca. Uma crista de rocha sobre os ombros, como a borda de um vulcão
(descrita acima dos ombros para aparecer de frente). Punhos de pedra enormes e
pés de pedra de fundação. **A regra dele no jogo** (a casa fica em brasa onde
ele pisa) vai na sola: os pés rachados e acesos.

```
A single full-body giant golem creature for a 3D game, alone in the image, one view only: a colossus of old, solid volcanic basalt. Its body is built from heavy stacked basalt blocks cracked from head to toe, with glowing lava visible only deep inside the cracks, the lava painted almost white. A jagged ridge of broken rock runs over both shoulders and rises behind the head like the rim of a volcano, clearly visible above the shoulders from the front. Enormous stone fists. Feet like square foundation stones, their soles and toes cracked and glowing almost white, as if every step leaves embers behind. Small eyes glowing almost white under a heavy stone brow. It is old solid rock, not molten: nothing drips or melts. Proportions of a giant: huge shoulders and forearms, the shoulder span about two thirds of its total height, short thick legs, a small head sunk low between the shoulders, the head only about one tenth of its total height, so it reads as a walking mountain. Standing upright in a relaxed A-pose, both arms held clearly away from the body, hands open and relaxed, feet apart at shoulder width, the two legs clearly separated, symmetrical, facing the viewer, nothing crossing in front of the body. Seen from a straight-on front view at eye level, full body from the top of the head to the soles of the feet, filling about 85 percent of the image height. Every part is solidly attached to the body: no free-floating rocks, no sparks or embers in the air, no free-floating rings, no loose chain links. Stylized hand-painted fantasy game creature look, clean readable silhouette. Near-monochrome light grey materials, all detail in light-and-dark contrast, glowing parts painted almost white, no saturated colors. Soft even frontal studio lighting, no cast shadows, no dramatic highlights. Plain solid white background, completely empty, no floor, no ground, no pedestal, no base, no shadow on the background. The whole figure fully visible with a white margin around it, nothing cropped at the edges. Only one character in the image. No text, no labels, no numbers, no watermark, no frame. Square 1:1 image.
```

### C2 · Colosso da Maré · `colosso-agua`

Imagem: `imagens\Colosso da Maré.png` → Meshy →
`monstros\Colosso da Maré\Colosso da Maré idle.glb` e os outros clipes.

Corpo de coral ramificado e conchas; entre os galhos, água vítrea esculpida
(sólida, parte do corpo, nunca respingando). **A regra dele** (refaz-se parado
na poça) vai no peito: um nicho com água escura parada, como uma poça que ele
carrega. Os antebraços terminam em clavas de coral. Os pingos que "nunca secam"
vêm esculpidos e colados ao corpo, nunca no ar e nunca no chão.

```
A single full-body giant golem creature for a 3D game, alone in the image, one view only: a colossus of the tide, built from thick branching coral and shells. Coral branches form its limbs and chest, and the spaces between the branches are filled with smooth glassy sculpted water that is solid and part of the body. In the middle of the chest a deep hollow holds still dark water like a small calm pool, its surface flat. Barnacles and shells crust the shoulders. The forearms end in heavy clubs of coral instead of fists. Solid sculpted drips run down its sides and stay attached to the body, as if it never stops dripping. Small pale eyes glowing almost white in a shell-like face. Proportions of a giant: huge shoulders and forearms, the shoulder span about two thirds of its total height, short thick legs, a small head sunk low between the shoulders, the head only about one tenth of its total height, so it reads as a walking mountain. Standing upright in a relaxed A-pose, both arms held clearly away from the body, feet apart at shoulder width, the two legs clearly separated, symmetrical, facing the viewer, nothing crossing in front of the body. Seen from a straight-on front view at eye level, full body from the top of the head to the soles of the feet, filling about 85 percent of the image height. Every part is solidly attached to the body: no drops of water in the air, no splashes, no puddle on the ground, no free-floating shells, no free-floating rings, no loose chain links. Stylized hand-painted fantasy game creature look, clean readable silhouette. Near-monochrome light grey materials, all detail in light-and-dark contrast, glowing parts painted almost white, no saturated colors. Soft even frontal studio lighting, no cast shadows, no dramatic highlights. Plain solid white background, completely empty, no floor, no ground, no pedestal, no base, no shadow on the background. The whole figure fully visible with a white margin around it, nothing cropped at the edges. Only one character in the image. No text, no labels, no numbers, no watermark, no frame. Square 1:1 image.
```

### C3 · Colosso de Rocha · `colosso-terra`

Imagem: `imagens\Colosso de Rocha.png` → Meshy →
`monstros\Colosso de Rocha\Colosso de Rocha idle.glb` e os outros clipes.

Um gigante de pedra bruta VESTIDO com uma couraça de lajes: placas de pedra
lisa encaixadas no peito, nos ombros, nos antebraços e nas canelas, presas por
cintas de pedra (coladas, nenhuma solta). **A regra dele** (enquanto a couraça
aguenta, golpe nenhum entra inteiro; depois ela cai) pede que a couraça leia
como camada à parte, que pode cair: a pedra bruta aparece entre as lajes, e
algumas lajes já vêm lascadas nos cantos.

```
A single full-body giant golem creature for a 3D game, alone in the image, one view only: a stone colossus wearing a cuirass of stone slabs. Its body is raw rough rock; over it, smooth flat stone slabs are fitted like plate armor on the chest, the shoulders, the forearms and the shins, held by carved stone straps that are part of the body. The raw rock shows between and around the slabs, so the armor clearly reads as a separate outer layer that could break off piece by piece, and a few slabs are already chipped at the corners. Small eyes glowing almost white under a slab visor. Proportions of a giant: huge shoulders and forearms, the shoulder span about two thirds of its total height, enormous stone fists, short thick legs, a small head sunk low between the shoulders, the head only about one tenth of its total height, so it reads as a walking mountain. Standing upright in a relaxed A-pose, both arms held clearly away from the body, hands open and relaxed, feet apart at shoulder width, the two legs clearly separated, symmetrical, facing the viewer, nothing crossing in front of the body. Seen from a straight-on front view at eye level, full body from the top of the head to the soles of the feet, filling about 85 percent of the image height. Every part is solidly attached to the body: no free-floating stones, no fallen slabs, no loose rubble, no free-floating rings, no loose chain links. Stylized hand-painted fantasy game creature look, clean readable silhouette. Near-monochrome light grey materials, all detail in light-and-dark contrast, glowing parts painted almost white, no saturated colors. Soft even frontal studio lighting, no cast shadows, no dramatic highlights. Plain solid white background, completely empty, no floor, no ground, no pedestal, no base, no shadow on the background. The whole figure fully visible with a white margin around it, nothing cropped at the edges. Only one character in the image. No text, no labels, no numbers, no watermark, no frame. Square 1:1 image.
```

### C4 · Colosso da Ventania · `colosso-ar`

Imagem: `imagens\Colosso da Ventania.png` → Meshy →
`monstros\Colosso da Ventania\Colosso da Ventania idle.glb` e os outros
clipes, **com o run**.

O irmão diferente: **mais alto e mais magro** que os outros três, porque é o
que anda mais (5 PP contra 2 e 3). Pedra clara gasta pelo vento, correntes de
ferro grossas enroladas BEM APERTADAS no peito, nos braços e na cintura, e
entre os elos o vento preso esculpido como fitas espirais sólidas. Nenhuma
ponta de corrente pendurada: elo solto é a argola da Mina por outro nome.

```
A single full-body giant golem creature for a 3D game, alone in the image, one view only: a tall, lean stone colossus bound in chains, with wind trapped inside them. It is clearly taller and leaner than a heavy golem, built to move fast: long legs and long arms, a narrow chest, the shoulder span only about half of its total height, a small narrow head about one tenth of its total height. Its body is pale wind-worn stone with smooth hollows carved by the wind. Thick heavy iron chains are wrapped very tightly around its chest, both upper arms and its waist, every chain lying flat against the stone with no loose ends hanging. Between the chain links, spirals of trapped wind are sculpted as solid swirling ribbons that are part of the body, and more solid wind ribbons coil tightly around both forearms. The face is a long vertical slit of pale light, painted almost white. Standing upright in a relaxed A-pose, both arms held clearly away from the body, hands open and relaxed, feet apart at shoulder width, the two legs clearly separated, symmetrical, facing the viewer, nothing crossing in front of the body. Seen from a straight-on front view at eye level, full body from the top of the head to the soles of the feet, filling about 85 percent of the image height. Every part is solidly attached to the body: no free-floating stones, no wind effects in the air, no free-floating rings, no loose chain links, no dangling chain ends. Stylized hand-painted fantasy game creature look, clean readable silhouette. Near-monochrome light grey materials, all detail in light-and-dark contrast, glowing parts painted almost white, no saturated colors. Soft even frontal studio lighting, no cast shadows, no dramatic highlights. Plain solid white background, completely empty, no floor, no ground, no pedestal, no base, no shadow on the background. The whole figure fully visible with a white margin around it, nothing cropped at the edges. Only one character in the image. No text, no labels, no numbers, no watermark, no frame. Square 1:1 image.
```

### O manifesto dos Colossos (à mão)

O `embute_monstros.py --manifesto` lê `js/core/data/monsters.js` pelo
`dungeonId`, e os Colossos têm `dungeonId: null`. **Não rode `--manifesto`
para eles**: salve este arquivo como `tools/monstros/colossos.json`. Cada
personagem é uma entrada, com a pasta e o prefixo iguais ao nome da imagem. O
campo `id` é a **chave do modelo** (`colosso-fogo`, não `colosso_fogo`),
porque é com ela que o embutidor escreve `JOGO.MODELS[...]` e é por ela que o
corpo provisório sai de cena sozinho. O `run` que não existir (só a Ventania
tem) é só avisado como faltante na fusão; não atrapalha.

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

Depois é o caminho de sempre do `docs/RECEBER_LOTE.md` (passos 2 a 4, com
`--calabouco colossos`): o `--raio-x`, a fusão, o `index.html` e o
`extrai_assets.py`, com as duas exceções que estão em *Pendências do código*
no fim (o grupo de download e a régua do bestiário).

---

# 2 · O ECO PRIMORDIAL E O ECO MENOR — 2 gerações

### E1 · O Eco Primordial · chave `boss-eco-primordial` · `eco_primordial`

Imagem: `imagens\O Eco Primordial.png` → Meshy →
`monstros\O Eco Primordial\O Eco Primordial idle.glb` e os outros clipes.

A primeira voz do mundo enterrado: uma entidade colossal montada com pedaços
dos seis calabouços, com um núcleo que pulsa no peito. **Não anda**: ocupa
2×2 casas no centro da Câmara do Eco, e o jogo o mostra a **~5,9 m** (o dobro
de um chefe). Ele troca de elemento a cada 25% da vida perdida, Fogo → Água →
Terra → Ar, e **o jogo o pinta com a cor da fase**. Por isso ele vem CINZA:
cinza, ele fica laranja, azul, verde e lilás sozinho; colorido, ele fica sujo
nas quatro fases.

O que faz ele parecer COLOSSAL (e não um monstro grande):
- **cabeça pequena** afundada entre ombros imensos, braços longos e pesados;
- **arquitetura em miniatura presa ao corpo**: um arco partido no ombro, uma
  escadinha de pedra na coxa, uma coluna caída cravada nas costas e visível
  acima do ombro. É a régua do olho: escada pequena = corpo enorme;
- **os seis calabouços no corpo**, um por região: cristal (Mina) num ombro,
  coral (Cisterna) no outro, lava nas frestas (Fecho), vento preso em
  correntes nos antebraços (Andaimes), raízes de espinho na cintura (Estufa) e
  o núcleo rachado no peito (Coração);
- **pernas enterradas até o joelho** num saiote de entulho que É do corpo: ele
  parece brotar do chão, e o rig ainda acha duas pernas (a regra da Vergasta:
  o bicho enraizado continua tendo pernas para o esqueleto).

Animação: **idle** (o núcleo pulsa, os ombros respiram) · **attack** (golpe de
braço que bate no chão à frente: é o "golpe grande avisado") · **hit** ·
**death** (desmorona em blocos, o núcleo apaga). **Não precisa de walk nem
run**: ele não sai do lugar. Para a régua do embutidor não reclamar, salve uma
cópia do `idle` como `walk` (é o que o jogo já faz com quem se arrasta).

```
A single colossal primordial titan boss character for a 3D game, alone in the image, one view only: the first voice of a buried underground world, a gigantic humanoid assembled from fragments of six underground realms. Enormous broad shoulders, the shoulder span about two thirds of its total height, long heavy arms with huge hands, and a small head sunk low between the shoulders, the head only about one twelfth of its total height, with a cracked stone face mask and two pale glowing eye slits. The body is made of stacked layered bedrock slabs with deep cracks of lava running through them, the lava painted almost white. The left shoulder is crusted with big crystal clusters; the right shoulder is grown over with branching coral and shells; heavy iron chains are wrapped very tightly around both forearms, with spirals of trapped wind sculpted as solid ribbons between the links; thorny roots are braided around the waist; in the center of the chest a large round core is set in a ring of cracked rock, glowing almost white, the brightest point of the figure. For a sense of enormous scale, tiny ruined architecture is embedded in its body: a small broken stone arch on one shoulder, a little stone staircase carved up one thigh, and a fallen column fused across its back with both ends showing above the shoulders. The two legs are thick and short, two separate columns sunk to the knees in a rough skirt of fused rubble, broken beams and stones that is part of its body. Standing upright in a relaxed A-pose, both arms held clearly away from the body, hands open, symmetrical, facing the viewer, nothing crossing in front of the body. Seen from a straight-on front view at eye level, full body from the top of the head to the bottom of the rubble skirt, filling about 85 percent of the image height. Every part is solidly attached to the body: no free-floating rocks, no free-floating crystals, no free-floating rings, no loose chain links, no dangling chain ends. Stylized hand-painted fantasy game boss look, clean readable silhouette, monumental and ancient. Near-monochrome light grey materials, all detail in light-and-dark contrast, glowing parts painted almost white, no saturated colors. Soft even frontal studio lighting, no cast shadows, no dramatic highlights. Plain solid white background, completely empty, no floor, no ground plane, no pedestal, no shadow on the background. The whole figure fully visible with a white margin around it, nothing cropped at the edges. Only one character in the image. No text, no labels, no numbers, no watermark, no frame. Square 1:1 image.
```

### E2 · O Eco Menor (um corpo para os quatro) · chave nova `eco-menor`

Imagem: `imagens\Eco Menor.png` → Meshy →
`monstros\Eco Menor\Eco Menor idle.glb` e os outros clipes, **com o run**.

A cada troca de fase o Eco chama Ecos Menores: **pedaços dele que ganharam
pernas**, do porte de um monstro comum (**1,80 m**). São quatro no jogo, um por
elemento, e nesta leva **os quatro vestem o MESMO corpo**: ele vem cinza e o
jogo o pinta com 52% da cor do elemento de cada um, como faz com todo monstro.
As frestas acesas, pintadas quase brancas, saem laranja no de Brasa, azuis no
de Coral, verdes no de Rocha e lilases no de Vento. Por isso o corpo **não
pode carregar nenhum elemento**: nada de lava, coral, cristal ou corrente; só a
pedra do Eco e a luz nas frestas.

| nome no jogo | id | chave hoje | elem | papel |
|---|---|---|---|---|
| Eco Menor de Brasa | `eco_menor_fogo` | `eco-menor-fogo` | fogo | distância |
| Eco Menor de Coral | `eco_menor_agua` | `eco-menor-agua` | água | distância |
| Eco Menor de Rocha | `eco_menor_terra` | `eco-menor-terra` | terra | corpo a corpo, tanque |
| Eco Menor de Vento | `eco_menor_ar` | `eco-menor-ar` | ar | corpo a corpo, rápido |

**Um corpo esguio serve aos quatro papéis**: braços longos, que tanto
arremessam quanto golpeiam, e pernas de quem corre. Na animação, escolha um
**attack** que sirva para os dois jeitos de lutar (um golpe de braço para a
frente, que lê como arremesso de longe e como soco de perto). O porte de cada
um pode ser diferente na linha dele do `MONSTER_LOOK` (o de Rocha um pouco
maior, para ler como tanque). Animação: idle · walk · run · attack · hit ·
death.

```
A single full-body small creature for a 3D game, alone in the image, one view only: a fragment of a colossal primordial titan that broke off and grew legs. A lean humanoid of ordinary size with slightly rounded shoulders, long arms and long legs, light enough to be quick and strong enough to strike: the shoulder span about one third of its total height, the head about one sixth of its total height. Its body is smooth pale layered stone, like a slab broken off a giant statue, with a few flat broken faces on the shoulders and forearms where it came off the titan, and it is split by thin cracks that glow almost white. In the middle of the chest a small round core glows almost white, set in a ring of cracked rock, the brightest point of the figure. Its face is a cracked stone mask with two thin slits of pale light. Long fingers with short blunt stone tips. Only stone and pale light: no lava, no coral, no crystals, no chains, no roots, no ornaments. Standing upright in a relaxed A-pose, both arms held clearly away from the body, hands open and relaxed, feet apart at shoulder width, the two legs clearly separated, symmetrical, facing the viewer, nothing crossing in front of the body. Seen from a straight-on front view at eye level, full body from the top of the head to the soles of the feet, filling about 85 percent of the image height. Every part is solidly attached to the body: no free-floating stones, no sparks in the air, no free-floating rings, no loose chain links. Stylized hand-painted fantasy game creature look, clean readable silhouette. Near-monochrome light grey materials, all detail in light-and-dark contrast, glowing parts painted almost white, no saturated colors. Soft even frontal studio lighting, no cast shadows, no dramatic highlights. Plain solid white background, completely empty, no floor, no ground, no pedestal, no base, no shadow on the background. The whole figure fully visible with a white margin around it, nothing cropped at the edges. Only one character in the image. No text, no labels, no numbers, no watermark, no frame. Square 1:1 image.
```

### O manifesto do Eco (à mão)

O Eco e os Menores moram em `js/core/data/eco.js`, sem calabouço: o
`--manifesto` não os acha. Salve como `tools/monstros/eco.json` e rode os
passos 2 a 4 do `docs/RECEBER_LOTE.md` com `--calabouco eco`. São **duas
entradas**: o Eco (o único `"boss": true`; o `walk` dele é a cópia do `idle`
que você salvou, e o `run` que falta só sai como aviso) e o Eco Menor, com a
**chave nova `eco-menor`**.

```json
{
  "calabouco": "eco",
  "origem": "C:\\Users\\danie\\Downloads\\assets_ok\\mapa\\O Eco Primordial\\monstros",
  "saida": "assets/embedded/models-meshy-eco.js",
  "monstros": [
    {"id": "boss-eco-primordial", "nome": "O Eco Primordial", "boss": true,  "pasta": "O Eco Primordial", "prefixo": "O Eco Primordial", "mapa": {"idle": "idle", "walk": "walk", "run": "run", "attack": "attack", "hit": "hit", "death": "death"}},
    {"id": "eco-menor",           "nome": "Eco Menor",        "boss": false, "pasta": "Eco Menor",        "prefixo": "Eco Menor",        "mapa": {"idle": "idle", "walk": "walk", "run": "run", "attack": "attack", "hit": "hit", "death": "death"}}
  ]
}
```

**As chaves `eco-menor-fogo`, `eco-menor-agua`, `eco-menor-terra` e
`eco-menor-ar` vão apontar para o mesmo modelo, cada uma com a tinta do seu
elemento.** É mudança de código, para fazer QUANDO a arte chegar (ver
*Pendências do código*): antes disso, cada Menor continua no Arauto
provisório do elemento dele. Se um dia vierem os Menores próprios do apêndice,
cada um ganha a sua entrada neste manifesto e a sua linha volta para a chave
própria.

---

# 3 · A SALA DE GUERRA (a Sede da guerra de guilda) — prefixo `sd_` — 6 gerações

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
- `sd_rack_armas`: um cavalete de armas, ALTO como o pilar (≤ 2,64 m), que pode
  trocar alguns dos 42 pilares nas alas, para a sala parecer quartel e não
  floresta de colunas;
- `sd_trofeu`: um pedestal de troféu (crânio de monstro e lanças partidas),
  BAIXO como o baú (≤ 1,2 m), que pode trocar baús nos cantos.

E o **mapa de guerra** fica **esculpido no tampo da mesa**, em relevo
(montanhas, rio, torrezinhas), em vez de pergaminho solto: peça pousada em cima
de outra é a "peça solta" que desarruma o separador.

O que **continua no código** (não pedir à arte): o chão de tábuas e o tapete
(são textura sobre as casas), a soleira da porta, o pano das bandeiras (pintado
com a cor e o emblema de cada guilda, `R.setGuildasSede`), o peito da chaminé
(ele segue o recorte da parede do lado da câmera) e o fogo e a luz da lareira.

Paleta (a mesma das primitivas de hoje, `matsSede`): pedra de castelo
cinza-pardo quente, carvalho escuro envelhecido, pano carmesim profundo, ouro
velho polido nos frisos, ferro escuro, aço claro, mármore creme.

**Os 6 arquivos desta encomenda:**

| prompt | tipo | imagem (`imagens\`) | arquivo do Meshy | caminho |
|---|---|---|---|---|
| S1 | muro | `parede lisa.png` | `muros\parede lisa.glb` | normalizador |
| S2 | muro | `parede cortada.png` | `muros\parede cortada.glb` | normalizador |
| S3 | muro | `porta.png` | `muros\porta.glb` | normalizador |
| S4 | 3 itens | `trono-lareira-estandarte.png` | `itens mapa\trono-lareira-estandarte.glb` | separador, conta 3 |
| S5 | 4 itens | `pilar-armadura-rack de armas-estatua.png` | `itens mapa\pilar-armadura-rack de armas-estatua.glb` | separador, conta 4 |
| S6 | 4 itens | `mesa do conselho-banco-bau-trofeu.png` | `itens mapa\mesa do conselho-banco-bau-trofeu.glb` | separador, conta 4 |

## Os muros da Sala de Guerra — três, um por imagem, vista frontal reta

Nesta leva o salão tem **uma parede inteira só, a lisa, repetida** em todo o
contorno. A parede com esteio e a com tocha, que quebravam a monotonia da
fileira, estão no apêndice (P2 e P3). A lisa é o módulo de UMA casa: **2 m de
largura e 4 m de altura, duas vezes mais alta que larga**. A cortada é o mesmo
módulo com 1 m, **duas vezes mais larga que alta**, com o topo reto como
fatiado: é a que o jogo mostra no lado da parede que fica entre a câmera e o
salão. A porta é o vão de três casas, **uma vez e meia mais larga que alta**.
As três repetem a mesma pedra e o mesmo rodapé, palavra por palavra, para
emendarem lado a lado; gere a S1 primeiro e, se quiser, anexe a imagem dela no
Gemini junto com o prompt da S2 e da S3.

### S1 · Parede lisa · `sd_parede_lisa` · `muros\parede lisa.glb`

O módulo do contorno inteiro. Pedra lisa, sem nada no meio.

```
A single stylized fantasy castle hall wall section for a 3D game, alone in the image and centered, one view only: a modular tall interior wall built of warm grey-brown fitted castle stone blocks laid in regular horizontal courses, a dark aged oak skirting board along the bottom, and a carved stone cornice with a thin line of old gold along the top, ending in a flat straight top edge. The face of the wall is plain stone with no decoration in the middle. About twice as tall as it is wide. Seen in a straight-on front elevation at eye level, flat orthographic framing with no perspective distortion, so neither the top surface nor the side faces of the wall are visible. Both side ends are perfectly straight vertical cuts, clean and flush, so identical copies can be lined up edge to edge into one continuous wall, and the bottom edge is straight and level on an invisible ground line. Every part is solidly attached to the wall: no free-floating rings, no loose chain links, no separate pieces resting on top. Stylized hand-painted low-poly game art, matte surfaces, clean readable silhouette. Colors: warm grey-brown castle stone, dark aged oak, a thin line of old gold. Soft even frontal studio lighting, no cast shadows, no dramatic highlights. No fire, no smoke, no glow. Plain solid white background, completely empty, no floor, no horizon, no gradient, no shadow on the background. The whole wall fully visible with a white margin around it, nothing cropped at the edges. Only this one object in the image. No text, no labels, no letters, no numbers, no watermark, no frame, no people. Square 1:1 image.
```

### S2 · Parede cortada · `sd_parede_cortada` · `muros\parede cortada.glb`

A mesma parede baixada a 1 m, sem cornija, com o topo cortado reto e limpo:
é o que deixa a câmera ver o salão por cima da parede da frente.

```
A single stylized fantasy castle hall wall section for a 3D game, alone in the image and centered, one view only: a modular interior wall built of warm grey-brown fitted castle stone blocks laid in regular horizontal courses, with a dark aged oak skirting board along the bottom, cut down to a low section: only about half as tall as it is wide, with no cornice, its top cut perfectly flat and level as if sliced clean through the stone blocks. Seen in a straight-on front elevation at eye level, flat orthographic framing with no perspective distortion, so neither the top surface nor the side faces of the wall are visible. Both side ends are perfectly straight vertical cuts, clean and flush, so identical copies can be lined up edge to edge into one continuous low wall, and the bottom edge is straight and level on an invisible ground line. Every part is solidly attached to the wall: no free-floating rings, no loose chain links, no separate pieces resting on top, no broken stones on the top edge. Stylized hand-painted low-poly game art, matte surfaces, clean readable silhouette. Colors: warm grey-brown castle stone, dark aged oak. Soft even frontal studio lighting, no cast shadows, no dramatic highlights. No fire, no smoke, no glow. Plain solid white background, completely empty, no floor, no horizon, no gradient, no shadow on the background. The whole wall fully visible with a white margin around it, nothing cropped at the edges. Only this one object in the image. No text, no labels, no letters, no numbers, no watermark, no frame, no people. Wide landscape 16:9 image.
```

### S3 · Porta · `sd_porta` · `muros\porta.glb`

O vão de três casas da saída sul, da altura da parede inteira. Vão ABERTO até
o chão, sem folha de porta nem grade: passa gente. A soleira é do código.

```
A single stylized fantasy castle hall doorway wall section for a 3D game, alone in the image and centered, one view only: a wide doorway built into a tall interior castle wall, with two stone door jambs of warm grey-brown fitted castle stone blocks at the sides, a dark aged oak skirting board along the bottom of both jambs, a heavy dark aged oak lintel beam across the top of the opening, fitted stone blocks above the lintel, and a carved stone cornice with a thin line of old gold along the top, ending in a flat straight top edge. The opening is completely empty and open all the way down to the ground, with no door leaves, no gate, no bars and no threshold step. The whole piece is about one and a half times as wide as it is tall, and the opening takes up most of its width. Seen in a straight-on front elevation at eye level, flat orthographic framing with no perspective distortion, so neither the top surface nor the side faces are visible. Both outer side ends are perfectly straight vertical cuts, clean and flush, so the doorway lines up edge to edge with plain wall sections on both sides, and the bottom edges of the jambs are straight and level on an invisible ground line. Every part is solidly attached: no free-floating rings, no loose chain links, no separate pieces resting on top, nothing hanging in the opening. Stylized hand-painted low-poly game art, matte surfaces, clean readable silhouette. Colors: warm grey-brown castle stone, dark aged oak, a thin line of old gold. Soft even frontal studio lighting, no cast shadows, no dramatic highlights. No fire, no smoke, no glow. Plain solid white background, completely empty, no floor, no horizon, no gradient, no shadow on the background. The whole doorway fully visible with a white margin around it, nothing cropped at the edges. Only this one object in the image. No text, no labels, no letters, no numbers, no watermark, no frame, no people. Wide landscape 16:9 image.
```

**O normalizador destes três** (quem embutir cria `tools/normaliza_muros_sede.py`
copiando o `normaliza_muros_fecho.py` e trocando só estas linhas; as duas
linhas comentadas entram se o P2 e o P3 do apêndice chegarem):

```python
ORIG = r"C:\Users\danie\Downloads\assets_ok\mapa\A Sala de Guerra\muros"
ARQUIVOS = {
    "parede lisa.glb":       "parede_lisa.glb",
    "parede cortada.glb":    "parede_cortada.glb",
    "porta.glb":             "porta.glb",
    # "parede com esteio.glb": "parede_com_esteio.glb",   (apêndice, P2)
    # "parede com tocha.glb":  "parede_com_tocha.glb",    (apêndice, P3)
}
```

## Os itens da Sala de Guerra — três folhas

As 11 peças da sala que não são parede, em 3 + 4 + 4. O agrupamento é por
altura, porque a câmera de cada folha serve às peças dela: as altas do fundo
do salão, as que ficam de pé no meio e as baixas a 40°.

### S4 · O fundo do salão (3 peças) · três-quartos, 30° acima

Arquivo: `itens mapa\trono-lareira-estandarte.glb` · `--conta` desta folha: **3**.

Da esquerda para a direita: `sd_trono` (3 casas de largura: estrado de pedra
com degrau, painel alto de carvalho escuro com o pano carmesim e frisos de
ouro, dois postes com pomo de ouro nas pontas, a cadeira de espaldar alto no
meio) · `sd_lareira` (3 casas de largura, até a altura do consolo: moldura de
pedra com a boca escura, consolo de carvalho, lenha empilhada SEM fogo; nada de
chaminé, que é do código) · `sd_estandarte` (base redonda de pedra, mastro de
carvalho, travessa com pomos de ouro nas pontas e no topo, **sem pano**: a
bandeira é pintada pelo jogo com as cores da guilda).

```
A game asset reference sheet: three separate stylized fantasy castle hall props arranged in one horizontal row, evenly spaced, with a wide clear empty gap between every object, none touching and none overlapping. From left to right: (1) a grand throne set, wider than it is tall: a long low stone dais with one step in front, a tall dark oak back panel behind it hung with a deep crimson cloth framed by old gold strips, a tall oak post topped with a gold orb at each end of the dais, and in the middle a high-backed carved oak throne chair with a crimson cushion and a small gold crest on top, everything joined into one solid piece; (2) a wide stone fireplace, wider than it is tall: a stone hearth slab, a stone surround with a dark empty firebox, a heavy dark oak mantel beam across the top, two split logs lying inside the firebox, no fire and no flames, no chimney above the mantel; (3) a tall banner pole: a round stone base, a tall dark oak pole, a horizontal crossbar near the top with small gold orbs on both ends and a gold orb on the very top, no cloth and no flag hanging from it, much taller than it is wide. Every part of every object is solidly attached to it: no free-floating rings, no loose chain links, no separate pieces resting on top. All three seen from the same three-quarter view about thirty degrees above eye level, the same camera for every object, all standing on the same invisible ground line with their bases aligned. Stylized hand-painted low-poly game art, matte surfaces, clean readable silhouettes. Colors: warm grey-brown castle stone, dark aged oak, deep crimson cloth, polished old gold trim. Soft even studio lighting, no cast shadows, no dramatic highlights. No fire, no smoke, no glow. Plain solid white background, completely empty, no floor, no horizon, no gradient, no shadow on the background. Every object fully visible, nothing cropped at the edges. No text, no labels, no numbers, no watermark, no frame, no people. Wide landscape 16:9 image.
```

### S5 · O que fica de pé (4 peças) · três-quartos, 30° acima

Arquivo: `itens mapa\pilar-armadura-rack de armas-estatua.glb` · `--conta` desta folha: **4**.

Da esquerda para a direita: `sd_pilar` (base quadrada, plinto, fuste redondo,
capitel e ábaco, **pouco mais de duas vezes mais alto que largo**: no jogo ele
não passa de 2,64 m) · `sd_armadura` (armadura de placas num suporte de
carvalho, tabardo carmesim, escudo redondo preso no braço esquerdo, alabarda de
pé na mão direita; a alabarda é a parte mais alta) · `sd_rack_armas` (cavalete
de carvalho com espadas, lanças e um machado encaixados, cada arma TOCANDO o
cavalete; mais ou menos da altura do pilar) · `sd_estatua` (o busto do
fundador num plinto de pedra: busto, não corpo inteiro; a peça é baixa, quase
tão larga quanto alta).

```
A game asset reference sheet: four separate stylized fantasy castle hall props arranged in one horizontal row, evenly spaced, with a wide clear empty gap between every object, none touching and none overlapping. From left to right: (1) a stone hall column: a square stone base, a plinth, a short round shaft, a round capital and a square abacus on top, a little more than twice as tall as it is wide; (2) a suit of plate armor displayed on a dark oak stand: steel greaves, breastplate and pauldrons, a closed helmet with a short crimson plume, a crimson tabard over the chest, a round crimson shield strapped to the left arm, a tall halberd held upright in the right gauntlet with its foot on the stand, every part touching and attached, much taller than it is wide; (3) a dark oak weapon rack about as tall as the column: an upright frame with two crossbars holding three swords, two spears and a battle axe standing in their slots, every weapon resting firmly in the rack and touching it; (4) a low stone bust of a bearded founder on a square stone plinth, cream marble head and shoulders, only the bust and no full body, about as wide as it is tall. Every part of every object is solidly attached to it: no free-floating rings, no loose chain links, no separate pieces resting on top. All four seen from the same three-quarter view about thirty degrees above eye level, the same camera for every object, all standing on the same invisible ground line with their bases aligned. Stylized hand-painted low-poly game art, matte surfaces, clean readable silhouettes. Colors: warm grey-brown castle stone, cream marble, dark aged oak, bright steel, deep crimson cloth, old gold trim. Soft even studio lighting, no cast shadows, no dramatic highlights. Plain solid white background, completely empty, no floor, no horizon, no gradient, no shadow on the background. Every object fully visible, nothing cropped at the edges. No text, no labels, no numbers, no watermark, no frame, no people. Wide landscape 16:9 image.
```

### S6 · O que fica baixo (4 peças) · três-quartos, 40° acima

Arquivo: `itens mapa\mesa do conselho-banco-bau-trofeu.glb` · `--conta` desta folha: **4**.

A câmera sobe para 40° porque as quatro são baixas e a mesa só "conta" o mapa
de guerra se o tampo aparecer. Da esquerda para a direita: `sd_mesa` (mesa
comprida e larga de carvalho, pernas grossas, o tampo inteiro esculpido como
**mapa de guerra em relevo**, com morros, um rio, estradas e torrezinhas que
fazem parte do tampo; **sem bancos grudados**, que são peça própria) ·
`sd_banco` (banco corrido de tábua com dois pés e uma travessa) · `sd_bau`
(baú de carvalho com tampa abaulada, cintas de ferro e fecho de ouro, FECHADO) ·
`sd_trofeu` (pedestal baixo de pedra com um crânio de monstro chifrudo preso no
topo e duas lanças partidas cruzadas cravadas nele).

```
A game asset reference sheet: four separate stylized fantasy castle hall props arranged in one horizontal row, evenly spaced, with a wide clear empty gap between every object, none touching and none overlapping, all four low, about knee to waist height. From left to right: (1) a long wide war council table of dark oak on thick legs, much wider than it is tall, its whole tabletop carved as a raised relief war map with small hills, a winding river, roads and tiny tower shapes that are all carved into the wood of the tabletop itself, a thin old gold trim along the edge, no benches attached and nothing placed on top; (2) a plain long wooden bench, a plank seat on two solid legs joined by a crossbar; (3) a closed dark oak treasure chest with a rounded lid, iron bands around it and a gold lock plate on the front; (4) a low square stone trophy pedestal with a large horned monster skull fixed on top and two broken spears crossed and driven into the pedestal, everything attached. Every part of every object is solidly attached to it: no free-floating rings, no loose chain links, no separate pieces resting on top. All four seen from the same elevated three-quarter view about forty degrees above the ground, high enough that the carved map on the tabletop reads clearly, the same camera for every object, all standing on the same invisible ground line with their bases aligned. Stylized hand-painted low-poly game art, matte surfaces, clean readable silhouettes. Colors: dark aged oak, warm grey-brown stone, dark iron, old gold, bone white. Soft even studio lighting, no cast shadows, no dramatic highlights. Plain solid white background, completely empty, no floor plane, no horizon, no gradient, no shadow on the background. Every object fully visible, nothing cropped at the edges. No text, no labels, no numbers, no watermark, no frame, no people. Wide landscape 16:9 image.
```

### Como separar a Sala de Guerra

```
muros\       sem separador: tools/normaliza_muros_sede.py (a tabela acima)
itens mapa\  --conta 4,4,3   (ordem alfabética: mesa do conselho…, pilar…, trono…)
             --conta 3,4,4   (se salvou como folha1, folha2, folha3 na ordem S4, S5, S6)
```

| papel na Sede | peça |
|---|---|
| `parede_salao` | `sd_parede_lisa` (inteira, em todo o contorno) · `sd_parede_cortada` (lado da câmera) · `sd_porta` |
| `trono` · `lareira` · `estandarte` | `sd_trono` · `sd_lareira` · `sd_estandarte` |
| `pilar` · `armadura` | `sd_pilar` (e `sd_rack_armas` como variante) · `sd_armadura` |
| `mesa` · `banco_salao` · `estatua` · `bau` | `sd_mesa` · `sd_banco` · `sd_estatua` · `sd_bau` (e `sd_trofeu` como variante) |

---

# 4 · O SANTUÁRIO DOS ELEMENTOS — prefixo `el_` — 12 gerações

**Por enquanto é só arte e desenho: o mapa ainda não existe no código.** Quatro
quadrantes, cada um com uma regra de terreno, e um centro comum:

| quadrante | nome | regra (a arte tem de mostrá-la) |
|---|---|---|
| Fogo | **Câmara Apagada** | escuridão: quem segue o caminho do Fogo enxerga longe, os outros só 2 casas; **braseiros acesos** iluminam uma área |
| Água | **Galeria Alagada** | casa alagada custa 2 PP (menos para Água); **correnteza** empurra 1 casa no fim do turno |
| Terra | **Salão dos Pilares Vivos** | **muros de pedra sobem e descem** a cada 2 turnos, com aviso, mudando a visão |
| Ar | **Terraço da Ventania** | **rajadas** empurram numa direção que muda; feitiço de Ar ganha +1 de alcance |

**Sem armadilhas neste mapa** (decisão do dono: armadilha aleatória fica no
Poço). As peças "de mecânica" vêm PARADAS e APAGADAS; quem acende o braseiro,
levanta o pilar, sopra o vento e mostra a correnteza é o código. **Todas
entram nesta leva**, porque sem elas a regra do quadrante não tem onde morar:

| peça de mecânica | o que o código faz com ela | o que a arte precisa garantir | onde está |
|---|---|---|---|
| `el_braseiro` | acende a luz e o fogo | bacia com carvão, sem chama | EL6 |
| `el_bica` | a correnteza sai dela (efeito) | carranca com a boca aberta, sem água caindo | EL6 |
| `el_cata_vento` | gira a peça toda para onde a rajada sopra | base redonda, para o giro não aparecer | EL7 |
| `el_soquete` | fica no chão onde o pilar desce | moldura rasteira com o encaixe quadrado | EL8 |
| `el_poca` / `el_ponte` | a casa alagada e a passagem por cima | rasteiras, a água esculpida e parada | EL8 |
| `el_respiro` | solta a coluna de vento (efeito) | pedestal com respiro; o vento NÃO vem na imagem | EL8 |
| `el_pilar_vivo` | sobe e desce o bloco inteiro | bloco ÚNICO, topo reto, base reta, laterais retas, nada pendurado (é **muro**: prompt próprio) | EL5 |

**Paleta por quadrante** (o cenário NÃO é tingido pelo jogo: a cor é a final),
amarrada por uma pedra de santuário comum, entalhada com o símbolo de cada
elemento (chama, onda, montanha, espiral; **símbolos, nunca letras**):
- **Fogo**: basalto quase negro, ferro, ouro velho fosco, brasa escura nas frestas; sala ESCURA;
- **Água**: pedra azul-acinzentada molhada, bronze com verdete, musgo de água;
- **Terra**: granito e arenito ocre, musgo verde, raiz, cristal;
- **Ar**: mármore claro gasto pelo vento, lilás pálido, bronze polido, pano claro.

**Os 12 arquivos desta encomenda** (8 de cenário e 4 monstros):

| prompt | tipo | imagem (`imagens\`) | arquivo do Meshy | caminho |
|---|---|---|---|---|
| EL1 | muro | `muro fogo.png` | `muros\muro fogo.glb` | normalizador |
| EL2 | muro | `muro agua.png` | `muros\muro agua.glb` | normalizador |
| EL3 | muro | `muro terra.png` | `muros\muro terra.glb` | normalizador |
| EL4 | muro | `muro ar.png` | `muros\muro ar.glb` | normalizador |
| EL5 | muro | `pilar vivo.png` | `muros\pilar vivo.glb` | normalizador |
| EL6 | 4 itens | `estatua cega-braseiro-pilar da mare-bica.png` | `itens mapa\estatua cega-braseiro-pilar da mare-bica.glb` | separador, conta 4 |
| EL7 | 4 itens | `altar dos quatro-menir-pilar de marmore-cata vento.png` | `itens mapa\altar dos quatro-menir-pilar de marmore-cata vento.glb` | separador, conta 4 |
| EL8 | 4 itens | `soquete do pilar-poca-ponte-respiro de vento.png` | `itens mapa\soquete do pilar-poca-ponte-respiro de vento.glb` | separador, conta 4 |
| EM1 | personagem | `Vigia de Pavio.png` | `monstros\Vigia de Pavio\...` | manifesto |
| EM2 | personagem | `Garça de Galeria.png` | `monstros\Garça de Galeria\...` | manifesto |
| EM3 | personagem | `Pilarete.png` | `monstros\Pilarete\...` | manifesto |
| EM4 | personagem | `Cata-Vento.png` | `monstros\Cata-Vento\...` | manifesto |

## Os muros do Santuário — cinco, um por imagem, vista frontal reta

O muro de quadrante é o mesmo módulo nas quatro pedras: **duas vezes mais largo
que alto, topo reto, pontas retas**. O renderizador o usa a 0,92 m (`LOW_H`)
como divisória e o estica a 3,10 m como parede, sempre com 3 m de largura
(`LARG_MURO`). Nesta leva **cada quadrante tem só o muro inteiro, repetido**;
as quatro brechas estão no apêndice (P17 a P20). O quinto muro é o pilar vivo.

### EL1 · Muro de Fogo · `el_muro_fogo` · `muros\muro fogo.glb`

```
A single stylized fantasy sanctuary wall section for a 3D game, alone in the image and centered, one view only: a modular low wall built of near-black volcanic basalt blocks with thin dark ember-red veins in the joints, a dark iron band along the top, and one small flame symbol carved in the middle of its face. About twice as wide as it is tall, with a flat straight top edge. Seen in a straight-on front elevation at eye level, flat orthographic framing with no perspective distortion, so neither the top surface nor the side faces of the wall are visible. Both side ends are perfectly straight vertical cuts, clean and flush, so identical copies can be lined up edge to edge into one continuous wall, and the bottom edge is straight and level on an invisible ground line. Every part is solidly attached to the wall: no free-floating rings, no loose chain links, no separate pieces resting on top. Stylized hand-painted low-poly game art, matte surfaces, clean readable silhouette. Colors: near-black basalt, dark iron, dull old gold, the faintest dark ember red in the joints. Soft even frontal studio lighting, no cast shadows, no dramatic highlights. No fire, no smoke, no glow. Plain solid white background, completely empty, no floor, no horizon, no gradient, no shadow on the background. The whole wall fully visible with a white margin around it, nothing cropped at the edges. Only this one object in the image. No text, no labels, no letters, no numbers, no watermark, no frame, no people. Wide landscape 16:9 image.
```

### EL2 · Muro de Água · `el_muro_agua` · `muros\muro agua.glb`

```
A single stylized fantasy sanctuary wall section for a 3D game, alone in the image and centered, one view only: a modular low wall built of blue-grey wet-looking stone blocks, a carved water channel running along its face, verdigris bronze trim along the top, patches of dark green water moss in the joints, and one small wave symbol carved in the middle of its face. About twice as wide as it is tall, with a flat straight top edge. Seen in a straight-on front elevation at eye level, flat orthographic framing with no perspective distortion, so neither the top surface nor the side faces of the wall are visible. Both side ends are perfectly straight vertical cuts, clean and flush, so identical copies can be lined up edge to edge into one continuous wall, and the bottom edge is straight and level on an invisible ground line. Every part is solidly attached to the wall: no free-floating rings, no loose chain links, no separate pieces resting on top. Stylized hand-painted low-poly game art, matte surfaces, clean readable silhouette. Colors: blue-grey wet stone, verdigris bronze, dark green water moss. Soft even frontal studio lighting, no cast shadows, no dramatic highlights. No flowing water, no splashes, no glow. Plain solid white background, completely empty, no floor, no horizon, no gradient, no shadow on the background. The whole wall fully visible with a white margin around it, nothing cropped at the edges. Only this one object in the image. No text, no labels, no letters, no numbers, no watermark, no frame, no people. Wide landscape 16:9 image.
```

### EL3 · Muro de Terra · `el_muro_terra` · `muros\muro terra.glb`

```
A single stylized fantasy sanctuary wall section for a 3D game, alone in the image and centered, one view only: a modular low wall built of huge rough ochre granite and sandstone blocks fitted without mortar, green moss in the joints, one thin tree root crossing its face with both ends sunk into the stone, and one small mountain symbol carved in the middle of its face. About twice as wide as it is tall, with a flat straight top edge. Seen in a straight-on front elevation at eye level, flat orthographic framing with no perspective distortion, so neither the top surface nor the side faces of the wall are visible. Both side ends are perfectly straight vertical cuts, clean and flush, so identical copies can be lined up edge to edge into one continuous wall, and the bottom edge is straight and level on an invisible ground line. Every part is solidly attached to the wall: no free-floating rings, no loose chain links, no separate pieces resting on top, no loose pebbles. Stylized hand-painted low-poly game art, matte surfaces, clean readable silhouette. Colors: ochre granite and sandstone, mossy green, dark brown root. Soft even frontal studio lighting, no cast shadows, no dramatic highlights. No glow. Plain solid white background, completely empty, no floor, no horizon, no gradient, no shadow on the background. The whole wall fully visible with a white margin around it, nothing cropped at the edges. Only this one object in the image. No text, no labels, no letters, no numbers, no watermark, no frame, no people. Wide landscape 16:9 image.
```

### EL4 · Muro de Ar · `el_muro_ar` · `muros\muro ar.glb`

```
A single stylized fantasy sanctuary wall section for a 3D game, alone in the image and centered, one view only: a modular low wall built of pale weathered marble blocks smoothed by the wind, with a few round openings carved clean through the wall where the wind passes, polished bronze trim along the top, soft pale lilac stone accents, and one small spiral symbol carved in the middle of its face. About twice as wide as it is tall, with a flat straight top edge. Seen in a straight-on front elevation at eye level, flat orthographic framing with no perspective distortion, so neither the top surface nor the side faces of the wall are visible. Both side ends are perfectly straight vertical cuts, clean and flush, so identical copies can be lined up edge to edge into one continuous wall, and the bottom edge is straight and level on an invisible ground line. Every part is solidly attached to the wall: no free-floating rings, no loose chain links, no separate pieces resting on top. Stylized hand-painted low-poly game art, matte surfaces, clean readable silhouette. Colors: pale weathered marble, soft pale lilac stone, polished bronze. Soft even frontal studio lighting, no cast shadows, no dramatic highlights. No wind effects, no smoke, no glow. Plain solid white background, completely empty, no floor, no horizon, no gradient, no shadow on the background. The whole wall fully visible with a white margin around it, nothing cropped at the edges. Only this one object in the image. No text, no labels, no letters, no numbers, no watermark, no frame, no people. Wide landscape 16:9 image.
```

### EL5 · O pilar vivo · `el_pilar_vivo` · `muros\pilar vivo.glb`

O muro que sobe e desce no Salão dos Pilares Vivos. Apesar do nome, ele faz o
papel de **muro**: levanta, fecha a visão e, com dois ou três de pé lado a lado,
vira parede. Por isso vem sozinho e de frente, com as laterais retas para
emendar, e com a proporção da caixa do muro alto (3 m de largura por 3,10 m de
altura): **um pouco mais alto que largo**. O topo e a base são retos porque o
código desce o bloco inteiro para dentro do `el_soquete`; nada pendurado,
nada saindo para fora.

```
A single stylized fantasy living stone wall block for a 3D game, alone in the image and centered, one view only: one solid square monolith of rough ochre granite that rises out of the floor as a moving wall, square in plan, a little taller than it is wide, with a perfectly flat top and a perfectly flat bottom. An ancient calm face is carved in low relief in the middle of its front, one small mountain symbol is carved below the face, deep vertical grooves run down near its edges, and green moss sits in the grooves. Nothing hangs from it and nothing sticks out of its outline. Seen in a straight-on front elevation at eye level, flat orthographic framing with no perspective distortion, so neither the top surface nor the side faces are visible. Both side faces are perfectly straight vertical planes, clean and flush, so two or three of these blocks raised side by side join into one continuous wall, and the bottom edge is straight and level on an invisible ground line. Every part is solidly attached to the block: no free-floating rings, no loose chain links, no separate pieces resting on top, no loose pebbles. Stylized hand-painted low-poly game art, matte surfaces, clean readable silhouette. Colors: ochre granite, grey stone, mossy green. Soft even frontal studio lighting, no cast shadows, no dramatic highlights. No glow, no dust in the air. Plain solid white background, completely empty, no floor, no horizon, no gradient, no shadow on the background. The whole block fully visible with a white margin around it, nothing cropped at the edges. Only this one object in the image. No text, no labels, no letters, no numbers, no watermark, no frame, no people. Square 1:1 image.
```

**O normalizador destes cinco** (quem embutir cria
`tools/normaliza_muros_santuario.py` copiando o do Fecho; as linhas comentadas
entram se as brechas do apêndice chegarem):

```python
ORIG = r"C:\Users\danie\Downloads\assets_ok\mapa\O Santuario dos Elementos\muros"
ARQUIVOS = {
    "muro fogo.glb":    "muro_fogo.glb",
    "muro agua.glb":    "muro_agua.glb",
    "muro terra.glb":   "muro_terra.glb",
    "muro ar.glb":      "muro_ar.glb",
    "pilar vivo.glb":   "pilar_vivo.glb",
    # "brecha fogo.glb":  "brecha_fogo.glb",    (apêndice, P17)
    # "brecha agua.glb":  "brecha_agua.glb",    (apêndice, P18)
    # "brecha terra.glb": "brecha_terra.glb",   (apêndice, P19)
    # "brecha ar.glb":    "brecha_ar.glb",      (apêndice, P20)
}
```

## Os itens do Santuário — três folhas de quatro

São 12 peças. Oito são obrigatórias: as sete peças de mecânica que não são
muro (braseiro, bica, cata-vento, soquete, poça, ponte e respiro) e o
**marco**, o Altar dos Quatro, que é a peça de uma vez por sala e não se
reaproveita de nenhuma outra. As outras quatro vagas são **uma peça de
identidade por quadrante**, alta (`sotaque_alto`, ~3,1 m) e estreita, para
servir também de `borda`, onde o renderizador a cresce para 2,2 a 4,6 m:

| quadrante | peça de identidade | por quê |
|---|---|---|
| Fogo | `el_estatua_cega` | conta a regra do quadrante sem o jogador ler nada: uma figura vendada segurando uma lanterna fria é "aqui ninguém enxerga". É alta, estreita e maciça, sem parte fina, e aguenta crescer para a borda. |
| Água | `el_agua_pilar` (a coluna da maré) | a única peça alta de Água, a bica, já está na conta como mecânica. A coluna com marcas de nível d'água e craca na base diz "esta galeria enche", que é a regra da casa alagada. De quebra, preenche o papel `pilar` das fileiras de muro. |
| Terra | `el_menir` | a regra (os muros que sobem) já está no pilar vivo; o menir dá ao quadrante a pedra em pé, com musgo e cristal, que lê "terra" de longe. É estreito, e não se confunde com o bloco largo do pilar vivo. |
| Ar | `el_ar_pilar` (a coluna de mármore) | a rajada já está no cata-vento, que é de bronze. A coluna traz o MATERIAL do quadrante, o mármore claro cavado pelo vento, e é maciça. A flâmula, a outra candidata, depende de fitas finas, que são justamente as partes que saem soltas do Meshy. Também preenche o `pilar`. |

A divisão segue a câmera. As peças de pé vão em duas folhas a 30°. As três
rasteiras (soquete, poça e ponte) vão a 40° junto com o **respiro**, que é um
tambor na altura do joelho com o respiro em espiral NO TOPO: a câmera alta
mostra melhor justamente a parte que a mecânica usa.

### EL6 · Fogo e Água, de pé (4 peças) · três-quartos, 30° acima

Arquivo: `itens mapa\estatua cega-braseiro-pilar da mare-bica.glb` · `--conta` desta folha: **4**.

`el_estatua_cega` (**sotaque_alto** e **borda**, ~3,1 m: figura de pedra com
os olhos vendados segurando uma lanterna fechada e fria junto ao peito) ·
`el_braseiro` (**mecânica**, ~1,4 m: tripé de ferro com bacia de carvão,
APAGADO) · `el_agua_pilar` (**sotaque_alto**, **borda** e **pilar**: coluna de
pedra azul com marcas de nível d'água e craca na base) · `el_bica`
(**sotaque_alto** + **mecânica**, ~3,1 m: estela alta com uma carranca de peixe
de bronze de boca aberta, de onde sai a correnteza; sem água caindo).

```
A game asset reference sheet: four separate stylized fantasy sanctuary props arranged in one horizontal row, evenly spaced, with a wide clear empty gap between every object, none touching and none overlapping. From left to right: (1) a tall narrow stone statue of a robed figure with a cloth blindfold carved over its eyes, holding a closed cold iron lantern against its chest with both hands, the lantern carved as part of the statue, standing on a square plinth of near-black basalt, much taller than it is wide; (2) a waist-high iron brazier on three legs, a wide iron bowl heaped with dark unlit coals, no fire, no flames, no smoke; (3) a tall narrow column of blue-grey wet-looking stone with horizontal water level marks carved along it, barnacles and water moss around its base, a carved wave symbol, much taller than it is wide; (4) a tall narrow stone stele with a large verdigris bronze fish head carved at the top, its mouth wide open as a water spout, a carved channel running down the face of the stele, no water pouring out. The first, third and fourth are tall and narrow, the second is about waist height. Every part of every object is solidly attached to it: no free-floating rings, no loose chain links, no separate pieces resting on top. All four seen from the same three-quarter view about thirty degrees above eye level, the same camera for every object, all standing on the same invisible ground line with their bases aligned. Stylized hand-painted low-poly game art, matte surfaces, clean readable silhouettes. Colors: dark grey stone and near-black basalt, dark iron, dull old gold, the faintest dark ember red in the coals, blue-grey wet stone, verdigris bronze, dark green water moss, pale barnacles. Soft even studio lighting, no cast shadows, no dramatic highlights. No fire, no smoke, no glow, no flowing water, no splashes. Plain solid white background, completely empty, no floor, no horizon, no gradient, no shadow on the background. Every object fully visible, nothing cropped at the edges. No text, no labels, no letters, no numbers, no watermark, no frame, no people. Wide landscape 16:9 image.
```

### EL7 · O centro, Terra e Ar, de pé (4 peças) · três-quartos, 30° acima

Arquivo: `itens mapa\altar dos quatro-menir-pilar de marmore-cata vento.glb` · `--conta` desta folha: **4**.

`el_marco_altar` (**marco**, uma vez por sala: o Altar dos Quatro, tablado
redondo com quatro bacias, uma por elemento, em volta de um núcleo de pedra
adormecido; o mais largo, na ponta esquerda para garantir o vão) · `el_menir`
(**sotaque_alto** e **borda**, ~3,1 m: menir alto com musgo e um cinturão de
cristais) · `el_ar_pilar` (**sotaque_alto**, **borda** e **pilar**: coluna
esbelta de mármore claro, canelada, gasta pelo vento) · `el_cata_vento`
(**sotaque_alto** + **mecânica**, ~3,1 m: poste de bronze com uma seta de
cata-vento no alto, sobre base REDONDA). O **marco nunca entra na borda**.

```
A game asset reference sheet: four separate stylized fantasy sanctuary monuments arranged in one horizontal row, evenly spaced, with a wide clear empty gap between every object, none touching and none overlapping. From left to right: (1) a wide round stone altar dais with two steps, four carved basins set around its rim, one of black basalt with a flame symbol, one of blue-grey stone with a wave symbol, one of ochre granite with a mountain symbol, one of pale marble with a spiral symbol, and in the center a large round dormant stone core cracked into four quarters, about as wide as it is tall; (2) a tall narrow standing menhir of grey granite covered in moss, a band of pale crystals growing out of its side and part of the stone, a carved mountain symbol at its foot; (3) a tall slender fluted column of pale weathered marble, smoothed and hollowed by the wind, a carved spiral symbol on its base, much taller than it is wide; (4) a tall polished bronze pole on a round stone base, topped by a large weathervane arrow with a feathered tail, the arrow fixed solidly to the pole. The first is wide, the other three are tall and narrow. Every part of every object is solidly attached to it: no free-floating rings, no loose chain links, no separate pieces resting on top, no loose pebbles. All four seen from the same three-quarter view about thirty degrees above eye level, the same camera for every object, all standing on the same invisible ground line with their bases aligned. Stylized hand-painted low-poly game art, matte surfaces, clean readable silhouettes. Colors: neutral grey sanctuary stone with the four element stones, black basalt, blue-grey stone, ochre granite, grey granite, mossy green, pale crystal, pale weathered marble, soft pale lilac accents, polished bronze, old gold. Soft even studio lighting, no cast shadows, no dramatic highlights. No fire, no flowing water, no wind effects, no glow. Plain solid white background, completely empty, no floor, no horizon, no gradient, no shadow on the background. Every object fully visible, nothing cropped at the edges. No text, no labels, no letters, no numbers, no watermark, no frame, no people. Wide landscape 16:9 image.
```

### EL8 · O chão da mecânica e o respiro (4 peças) · três-quartos, 40° acima

Arquivo: `itens mapa\soquete do pilar-poca-ponte-respiro de vento.glb` · `--conta` desta folha: **4**.

`el_soquete` (**chao** + **mecânica**: o encaixe onde o pilar vivo desce,
moldura quadrada de granito rente ao chão, com o buraco escuro) · `el_poca`
(**chao** + **mecânica**: a casa ALAGADA, poça rasa de água esculpida, parada,
com musgo na borda) · `el_ponte` (**chao** + **mecânica**: laje de pedra baixa
sobre dois apoios, a passagem por cima da água) · `el_respiro` (**sotaque** +
**mecânica**, ~1 m: tambor de pedra redondo com fendas em espiral no topo, de
onde o jogo solta a coluna de vento; o vento NÃO vem na imagem).

```
A game asset reference sheet: four separate stylized fantasy floor props arranged in one horizontal row, evenly spaced, with a wide clear empty gap between every object, none touching and none overlapping. From left to right: (1) a square frame of ochre granite slabs set flush in the floor around a deep square dark socket hole, grooves carved along its inner edges; (2) a shallow round puddle of still water sculpted smooth and glassy, set in a ring of blue-grey stones with water moss along the edge; (3) a low flat stone footbridge, a single wide slab resting on two short stone supports, with a carved wave symbol on its side; (4) a knee-high round stone drum with spiral slots cut into its top like a vent, a polished bronze rim around the top, nothing coming out of it. The first three are very low and lie flat on the ground, the last is knee-high. Every part of every object is solidly attached to it: no free-floating rings, no loose pieces resting on top, no loose pebbles. All four seen from the same elevated three-quarter view about forty degrees above the ground, high enough that the flat floor pieces read clearly as shapes and not as thin lines and the spiral slots on top of the drum are clearly visible, the same camera for every object, all resting on the same invisible ground line. Stylized hand-painted low-poly game art, matte surfaces, clean readable silhouettes. Colors: ochre granite, blue-grey stone, glassy dark water, green moss, pale weathered marble, polished bronze. Soft even studio lighting, no cast shadows, no dramatic highlights. No wind effects, no smoke, no glow, no flowing water. Plain solid white background, completely empty, no floor plane, no horizon, no gradient, no shadow on the background. Every object fully visible, nothing cropped at the edges. No text, no labels, no letters, no numbers, no watermark, no frame, no people. Wide landscape 16:9 image.
```

### Como separar o cenário do Santuário

```
muros\       sem separador: tools/normaliza_muros_santuario.py (a tabela acima)
itens mapa\  --conta 4,4,4                 (só esta leva: altar…, estatua cega…, soquete…)
             --conta 4,4,3,3,4,4,4         (com as quatro folhas do apêndice na mesma pasta:
                                            altar…, estatua cega…, geodo…, grelha…,
                                            pilar de basalto…, portao…, soquete…)
```

| papel | peças desta leva |
|---|---|
| muro (`baixo`/`alto`) | `el_muro_fogo`, `el_muro_agua`, `el_muro_terra`, `el_muro_ar` (sem brecha: o muro inteiro se repete) |
| `pilar` | `el_agua_pilar`, `el_ar_pilar` (sem `pilar` num tema, a fileira segue só de muro: o renderizador cai no `alto`) |
| `marco` | `el_marco_altar` |
| `sotaque_alto` | `el_estatua_cega`, `el_agua_pilar`, `el_menir`, `el_ar_pilar`, `el_bica`, `el_cata_vento` |
| `sotaque` | `el_braseiro`, `el_respiro` |
| `chao` | `el_soquete`, `el_poca`, `el_ponte` |
| `borda` | `el_estatua_cega`, `el_agua_pilar`, `el_menir`, `el_ar_pilar` (as quatro de identidade; nunca o marco) |
| mecânica (código) | `el_braseiro`, `el_pilar_vivo`, `el_soquete`, `el_respiro`, `el_cata_vento`, `el_bica`, `el_poca`, `el_ponte` |

17 peças nesta leva: 5 muros em 5 imagens e 12 itens em 3 folhas.

As alturas em metros das fichas acima são **proposta para o mapa novo**. O
renderizador de hoje não as respeita: ele põe todo `sotaque` a 0,95 m e todo
`sotaque_alto` a 3,10 m. Por isso o braseiro (~1,4 m) só sai na altura pedida
se o código do Santuário der a ele uma altura própria. O que a imagem tem de
acertar é a PROPORÇÃO de cada peça, e essa os prompts já pedem.

## Os monstros do Santuário — um por quadrante

Os oito ids foram fixados em 02/10; **os nomes, papéis e alturas são
proposta**: o mapa ainda não tem código, troque à vontade antes de gerar.
Nesta leva entra **um por quadrante**, o que melhor mostra a regra do
quadrante; o segundo de cada um está no apêndice (P9 a P12), e até ele chegar o
mapa usa um monstro que já existe, do mesmo elemento. Os quatro escolhidos
também são os de corpo mais perto de gente, que é o que o rig do Meshy faz
melhor.

| prompt | id | nome (proposta) | elem | papel (proposta) | altura | por que ele e não o outro |
|---|---|---|---|---|---|---|
| EM1 | `el_fogo_1` | Vigia de Pavio | fogo | distância · enxerga no escuro | 2,10 m | ele É a regra da Câmara Apagada: o bicho que te vê no escuro enquanto você só enxerga 2 casas, e atira de longe. A Mariposa só gira em volta dos braseiros. |
| EM2 | `el_agua_2` | Garça de Galeria | água | distância · arpoa | 2,00 m | a ave que anda na água rasa é a imagem da casa alagada, que custa 2 PP para o herói e não atrapalha a dona da casa. Ela arpoa de longe quem ficou lento na água. O Caramujo é um tanque que não depende da água. |
| EM3 | `el_terra_1` | Pilarete | terra | tanque · imune a empurrão | 2,20 m | é um pedaço do pilar vivo que levantou e andou: carrega no corpo a regra dos muros que sobem. A Toupeira "sai do chão", que é outra ideia. |
| EM4 | `el_ar_1` | Cata-Vento | ar | distância · empurra | 2,30 m | empurra como a rajada empurra, e é de distância, o papel que ganha com o +1 de alcance do Ar. A Arraia é corpo a corpo e planar pede um clipe que o rig de gente faz mal. |

Animação dos quatro: idle · walk · attack · hit · death (nenhum dos quatro
corre). As alturas são acertadas no código (`scale = altura ÷ 1,80`); no
Gemini **cada um ocupa a altura da imagem**, e o que diz se ele é alto e magro
ou baixo e largo é a proporção escrita no prompt.

Cada um vai em `imagens\<Nome>.png` e volta do Meshy em
`monstros\<Nome>\<Nome> idle.glb` (e os outros clipes), com o nome da tabela.
Se você trocar um nome, troque também o da imagem e o da pasta em `monstros\`:
o manifesto lê a pasta pelo nome. Quando o mapa existir no código, o manifesto
sai do `--manifesto` se os monstros ganharem `dungeonId`; se não ganharem, ele
se escreve à mão como o dos Colossos.

### EM1 · Vigia de Pavio · `el_fogo_1` · `imagens\Vigia de Pavio.png`

Alto e magro, de túnica esfarrapada que acaba nos joelhos (as pernas têm de
aparecer, para o rig). A cabeça é um toco de vela derretida com UM olho grande
na cera e o pavio queimado, APAGADO. **O que ele conta:** enxerga no escuro da
Câmara Apagada, então o olho é o ponto mais claro do corpo.

```
A single full-body creature for a 3D game, alone in the image, one view only: a tall gaunt humanoid watchman of a dark sanctuary. It wears a long tattered robe that ends at the knees, with two thin legs clearly visible below it. Its head is a thick stub of melted candle wax with a single large round eye set in the wax, painted almost white, the brightest point of the figure, and a short burnt wick on top with no flame; wax drips down from the head onto its shoulders and is fused to the robe. Long thin arms with long thin hands and knobbly fingers. Proportions: tall and thin, the shoulder span about one third of its total height, the head about one seventh of its total height. Standing upright in a relaxed A-pose, both arms held clearly away from the body, hands open and relaxed, feet apart at shoulder width, the two legs clearly separated, symmetrical, facing the viewer, nothing crossing in front of the body. Seen from a straight-on front view at eye level, full body from the top of the wick to the soles of the feet, filling about 85 percent of the image height. Every part is solidly attached to the body: no flames, no free-floating sparks, no drops of wax in the air, no free-floating rings, no loose chain links. Stylized hand-painted fantasy game creature look, clean readable silhouette. Near-monochrome light grey materials, all detail in light-and-dark contrast, glowing parts painted almost white, no saturated colors. Soft even frontal studio lighting, no cast shadows, no dramatic highlights. Plain solid white background, completely empty, no floor, no ground, no pedestal, no base, no shadow on the background. The whole figure fully visible with a white margin around it, nothing cropped at the edges. Only one character in the image. No text, no labels, no numbers, no watermark, no frame. Square 1:1 image.
```

### EM2 · Garça de Galeria · `el_agua_2` · `imagens\Garça de Galeria.png`

Garça pescadora vestida num corpo: asas no lugar dos braços, pernas longas,
crista de penas. O bico de arpão, apontado para você, sumiria na vista de
frente; por isso ele vem **inclinado para baixo, ao longo do pescoço**, como a
garça em repouso, e mostra o comprimento inteiro. **O que ela conta:** a água
rasa é a casa dela, e ela arpoa de longe.

```
A single full-body creature for a 3D game, alone in the image, one view only: a tall wading heron creature dressed as a humanoid biped. A long curved neck and a long straight beak shaped like a barbed harpoon point; the beak is angled down along the front of the neck, so its whole length is clearly visible from the front. A crest of long feathers swept back on the head, eyes painted almost white. Its two arms ARE long feathered wings, held open slightly away from the body like arms in an A-pose, ending in clawed fingers at the wing tips; it has no other arms. Long thin legs with webbed feet. Proportions: tall and thin, the shoulder span about one third of its total height, the head small. Standing upright in a relaxed A-pose, feet apart at shoulder width, the two legs clearly separated, symmetrical, facing the viewer, nothing crossing in front of the body. Seen from a straight-on front view at eye level, full body from the top of the crest to the soles of the feet, filling about 85 percent of the image height. Every part is solidly attached to the body: no drops of water in the air, no loose feathers, no free-floating rings, no loose chain links. Stylized hand-painted fantasy game creature look, clean readable silhouette. Near-monochrome light grey materials, all detail in light-and-dark contrast, eyes painted almost white, no saturated colors. Soft even frontal studio lighting, no cast shadows, no dramatic highlights. Plain solid white background, completely empty, no floor, no ground, no pedestal, no base, no shadow on the background. The whole figure fully visible with a white margin around it, nothing cropped at the edges. Only one character in the image. No text, no labels, no numbers, no watermark, no frame. Square 1:1 image.
```

### EM3 · Pilarete · `el_terra_1` · `imagens\Pilarete.png`

Um pedaço de pilar vivo que levantou e andou: o tronco é um tambor de coluna
canelado, a cabeça é um capitel quadrado com o mesmo rosto antigo do EL5, e
braços e pernas são tambores menores empilhados. **O que ele conta:** pesado e
plantado, imune a empurrão.

```
A single full-body creature for a 3D game, alone in the image, one view only: a living stone column walking as a humanoid biped. Its torso is a thick carved column drum with vertical grooves; its head is a small square column capital with an ancient calm face carved in it, the eyes painted almost white; its thick stubby arms and legs are made of stacked smaller stone drums, and its feet are square column bases. Green moss sits in the joints. Proportions: very heavy, solid and planted, the shoulder span about half of its total height, short thick legs, the head about one sixth of its total height. Standing upright in a relaxed A-pose, both arms held clearly away from the body, hands open, feet apart at shoulder width, the two legs clearly separated, symmetrical, facing the viewer, nothing crossing in front of the body. Seen from a straight-on front view at eye level, full body from the top of the head to the soles of the feet, filling about 85 percent of the image height. Every part is solidly attached to the body: no free-floating stones, no loose rubble, no free-floating rings, no loose chain links. Stylized hand-painted fantasy game creature look, clean readable silhouette. Near-monochrome light grey materials, all detail in light-and-dark contrast, eyes painted almost white, no saturated colors. Soft even frontal studio lighting, no cast shadows, no dramatic highlights. Plain solid white background, completely empty, no floor, no ground, no pedestal, no base, no shadow on the background. The whole figure fully visible with a white margin around it, nothing cropped at the edges. Only one character in the image. No text, no labels, no numbers, no watermark, no frame. Square 1:1 image.
```

### EM4 · Cata-Vento · `el_ar_1` · `imagens\Cata-Vento.png`

Um autômato alto e fino de chapas de bronze rebitadas. A cabeça é uma hélice
de quatro pás **virada para a frente**, chata, com um cubo redondo e dois
olhinhos no cubo; as mãos são pás. Uma saia curta de pano rasgado, presa na
cintura. **O que ele conta:** empurra de longe com o vento da hélice.

```
A single full-body creature for a 3D game, alone in the image, one view only: a tall thin construct humanoid made of riveted bronze sheets. Its head is a four-bladed propeller vane facing forward, flat and fixed, with a round hub in the middle and two small eyes in the hub painted almost white. Long thin arms ending in flat vane-shaped hands, a short tattered cloth skirt attached at the waist, and long thin legs with flat feet. Proportions: tall and thin, the shoulder span about one third of its total height, the propeller head about as wide as the shoulders. Standing upright in a relaxed A-pose, both arms held clearly away from the body, feet apart at shoulder width, the two legs clearly separated, symmetrical, facing the viewer, nothing crossing in front of the body. Seen from a straight-on front view at eye level, full body from the top of the propeller to the soles of the feet, filling about 85 percent of the image height. Every part is solidly attached to the body: no wind effects, no free-floating pieces, no free-floating rings, no loose chain links. Stylized hand-painted fantasy game creature look, clean readable silhouette. Near-monochrome light grey materials, all detail in light-and-dark contrast, eyes painted almost white, no saturated colors. Soft even frontal studio lighting, no cast shadows, no dramatic highlights. Plain solid white background, completely empty, no floor, no ground, no pedestal, no base, no shadow on the background. The whole figure fully visible with a white margin around it, nothing cropped at the edges. Only one character in the image. No text, no labels, no numbers, no watermark, no frame. Square 1:1 image.
```

---

## O que conferir na imagem do Gemini antes de gastar crédito no Meshy

Um minuto de olho aqui economiza uma geração inteira, e com 6 de reserva cada
uma conta. Refazer no Gemini custa pouco; a geração do Meshy, não.

**Em toda imagem:**

- [ ] **fundo branco liso**, sem chão desenhado, sem sombra, sem degradê;
- [ ] **nada cortado** na borda da imagem, com margem branca em volta;
- [ ] **sem letra nenhuma**: nem nome embaixo da peça, nem número, nem marca
      (o Gemini adora escrever o nome da coisa);
- [ ] **nada flutuando**: argola, elo, pedrinha, folha, faísca, gota, fita de vento;
- [ ] **sem chama, fumaça ou água caindo**, sobretudo no braseiro, na lareira,
      na bica e no respiro.

**Personagem (C1–C4, E1–E2, EM1–EM4 e os do apêndice):**

- [ ] **um personagem só e uma vista só**: sem as costas ao lado, sem rosto
      ampliado num quadradinho, sem paleta de cores (se vier "ficha", refaça);
- [ ] **de frente, olhando para você, em pose A**: braços bem afastados do
      corpo, mãos à vista, pernas separadas; nada cruzando o peito;
- [ ] **da cabeça aos pés**, ocupando quase a altura toda;
- [ ] **cinza**, com só o que brilha quase branco (colorido, ele sai sujo
      depois da tinta do jogo: refaça);
- [ ] **o Eco Menor sem elemento nenhum**: se o Gemini puser lava, coral,
      cristal ou corrente nele, refaça, senão três dos quatro Menores saem com
      o material errado;
- [ ] **sem chão, pedestal, poça ou sombra** debaixo dos pés;
- [ ] **a proporção conta a história**: o Colosso tem a cabeça pequena e os
      ombros enormes? A Ventania é mais alta e magra que os outros?
- [ ] o que fica nas costas (crista do Colosso de Brasa, coluna do Eco)
      **aparece acima dos ombros**, e o bico da Garça aparece inteiro.

**Muro (S1–S3, EL1–EL5 e os do apêndice):**

- [ ] **sozinho** na imagem;
- [ ] **de frente reta**: não aparece o topo nem a face lateral (se aparecer,
      a câmera girou: refaça);
- [ ] **as duas pontas são cortes verticais retos**, sem pedra saindo para o
      lado, e a base é reta;
- [ ] **a proporção do módulo**: parede da Sede duas vezes mais alta que
      larga; parede cortada e muros do Santuário duas vezes mais largos que
      altos; porta uma vez e meia mais larga que alta; pilar vivo um pouco mais
      alto que largo;
- [ ] **a parede cortada e a porta combinam com a lisa** (a mesma pedra e o
      mesmo rodapé; se não, gere de novo anexando a S1).

**Folha de itens (S4–S6, EL6–EL8 e as do apêndice):**

- [ ] **contei as peças** (3 ou 4) e bate com o nome do arquivo (o Gemini às
      vezes junta duas ou inventa uma a mais);
- [ ] **a ordem da esquerda para a direita é a do nome do arquivo**: o
      separador nomeia nessa ordem;
- [ ] **nenhuma peça encosta na vizinha**, nem por uma ponta;
- [ ] **mesma câmera** para todas e **bases na mesma linha**;
- [ ] **as peças de chão leem como forma**, não como risco (câmera de 40°), e
      as fendas do respiro aparecem no topo dele;
- [ ] **nada pousado em cima de outra peça** (pergaminho na mesa, vela solta
      no bloco, lanterna pendurada).

Se uma folha vier com uma peça a mais que você queira aproveitar (o braseiro
extra do Fecho de Brasa entrou assim), é só usar o `--conta` com o número real
em vez do nome do arquivo.

---

## Pendências do código quando a arte chegar

> **03/10 à noite — os PERSONAGENS chegaram e entraram** (frente `arte/monstros`):
> os 4 Colossos (`models-meshy-colossos.js`), os Ecos Menores de Brasa, Coral e
> Rocha (`models-meshy-eco.js`, cada um com a chave PRÓPRIA `eco-menor-<elem>`)
> e os OITO do Santuário (`models-meshy-santuario.js`, `el-fogo-1` … `el-ar-2`).
> Os manifestos estão em `tools/monstros/colossos.json`, `eco.json` e
> `santuario.json`; as sete linhas dos que chegaram saíram do
> `M.CORPO_PROVISORIO`. O que muda nos itens abaixo:
> - **Colossos**: feito, com retrato no site (`retratos_site.py --lote bichos-colossos`);
> - **Eco Menor único**: NÃO vale mais. O dono gerou três Menores com cara
>   própria e não gerou o genérico `eco-menor`; cada linha do `MONSTER_LOOK`
>   continua na chave dela. Faltam o **Eco Primordial** (`boss-eco-primordial`)
>   e o **Eco Menor de Vento** (`eco-menor-ar`), que seguem no provisório;
>   quando chegarem, entram no `tools/monstros/eco.json` e a linha de cada um
>   sai do provisório;
> - **Santuário**: os oito vieram, então NENHUM empréstimo de `MONSTER_LOOK`.
>   O modelo de cada chave está pronto; as fichas (`DATA.monsters`) e o mapa
>   são da frente do Santuário;
> - a régua destes lotes é `tests/corpos_lancamento.html` e
>   `tests/corpos_tabuleiro.html` (o bestiário não os alcança).

O texto abaixo é o plano de ANTES da arte chegar, guardado para os lotes que faltam:

- **Colossos e Eco**: os manifestos à mão (acima), `--raio-x`, fusão, o
  embutido no `index.html`, `extrai_assets.py` e conferir o porte. A troca do
  provisório é automática para os Colossos e para o Eco Primordial (a chave
  própria vence); a linha do `M.CORPO_PROVISORIO` de cada um pode ser apagada
  depois. Duas armadilhas do caminho de sempre:
  · o `tools/extrai_assets.py` só sabe QUANDO baixar um embutido pela tabela
    `GRUPO_DA_PASTA`. Pasta que não está lá cai no grupo `base`, que todo
    jogador baixa ao abrir o jogo. Antes de rodar, acrescente
    `models-meshy-colossos` e `models-meshy-eco` com um grupo próprio (o Poço
    e a Câmara do Eco), senão os kits engordam a primeira carga (ver a
    pré-busca em `js/assets_bundle.js`);
  · o `tests/bestiario.html?calabouco=…` escolhe os bichos pelo `dungeonId` e
    procura o kit pelo id do MONSTRO (`colosso_fogo`), não pela chave do
    modelo (`colosso-fogo`). Os Colossos e o Eco não têm calabouço, então a
    régua reprova logo na primeira linha e não confere nada. O porte e os
    clipes destes dois lotes se conferem de outro jeito: o relatório da fusão
    e uma foto no jogo (ou uma régua nova).
- **O Eco Menor único** (mudança de código, só QUANDO o `eco-menor` estiver
  embutido): as quatro linhas `eco_menor_fogo/agua/terra/ar` do `MONSTER_LOOK`
  (`js/render3d/models3d_v2.js`) passam de `model: 'eco-menor-<elem>'` para
  `model: 'eco-menor'`, cada uma com a sua escala (a de Rocha um pouco maior).
  A tinta não precisa de nada: o jogo já pinta cada monstro com 52% da cor do
  ELEMENTO dele (`md.element`), então o mesmo modelo sai laranja, azul, verde e
  lilás. As quatro linhas `eco-menor-*` do `M.CORPO_PROVISORIO` deixam de ser
  usadas e podem sair. Antes da arte chegar, não mexer: a chave `eco-menor`
  ainda não tem corpo, e os Menores ficariam sem nenhum.
- **Os muros, em todos os lotes de cenário**: o muro agora vem um por arquivo e
  não passa pelo separador. Cada lote ganha a sua cópia do
  `tools/normaliza_muros_fecho.py` (`normaliza_muros_sede.py`,
  `normaliza_muros_santuario.py` e, se a Câmara sair do apêndice,
  `normaliza_muros_eco.py`) com as tabelas `ORIG`/`ARQUIVOS` que estão em cada
  seção. O embutidor de cenário de cada lote junta as duas saídas:
  `muros\_separado\` e `itens mapa\_separado\`.
- **Sala de Guerra**: o salão hoje não lê catálogo nenhum, monta as
  primitivas direto (`montaPecaDaSede`). A arte pede um `cenario-sede.js`
  (catálogo `JOGO.CENARIO['sede']`, nome `cenario-*` obrigatório para o jogo
  servido o achar) e um ramo em `montaPecaDaSede` que use a peça quando ela
  existir e caia na primitiva quando não. Com uma parede inteira só, o
  `parede_salao` inteiro usa `sd_parede_lisa` em todo o contorno. A régua
  continua a da `tests/prova_sede_tatica.html`: peça alta ≥ 2,6 m e peça baixa
  ≤ 1,3 m. Mais a da câmera, que a prova não cobra sozinha: o pilar (e o
  cavalete que o substituir) não passa de 2,64 m. A mesa da arte vem sem
  bancos, e a de hoje tem os dois bancos corridos dentro da pegada 3×3. O ramo
  novo tem de pôr `sd_banco` dos dois lados compridos da mesa, senão a mesa do
  conselho fica sem bancos.
- **Santuário dos Elementos**: tudo: o mapa, as quatro regras de terreno e os
  monstros nos dados. O pilar vivo é muro (sobe e desce o bloco inteiro sobre o
  `el_soquete`). Nesta leva há um monstro por quadrante; o segundo de cada um
  (`el_fogo_2`, `el_agua_1`, `el_terra_2`, `el_ar_2`) veste, até a arte dele
  chegar, um monstro que já existe, do mesmo elemento (o empréstimo de
  `MONSTER_LOOK`, como a Mina fez). Lembre a regra da tinta da Mina: doador do
  MESMO elemento sai idêntico na tela ao dono do corpo, então escolha um doador
  que não apareça no mesmo quadrante.

---

## Decisões tomadas nesta revisão

- **Pilar fixo é item, não muro.** `sd_pilar`, os `el_*_pilar`, a
  `sd_armadura` e o `sd_rack_armas` ficam de pé sozinhos numa casa e não
  emendam em fileira; vão nas folhas de itens, a 30°.
- **O pilar vivo é muro.** Ele é "o muro que sobe e desce": levanta, fecha a
  visão, e dois ou três lado a lado viram parede. Ganhou prompt próprio (EL5),
  de frente, com as laterais retas e a proporção da caixa do muro alto (um
  pouco mais alto que largo).
- **O portão do Santuário é item** (está no apêndice). `el_portao` é um arco de
  pé fora da arena, no papel `borda`; não emenda em parede. Já a `sd_porta` é
  muro, porque faz parte da fileira de paredes do salão.
- **Na Câmara do Eco (apêndice), pilar quebrado e entulho são muro.** São eles
  que vestem os papéis `alto` e `baixo`, esticados para a caixa de uma casa, e
  ficam em pares lado a lado.
- **Um Eco Menor só.** Os quatro dividem um corpo de pedra do Eco sem elemento
  nenhum, e a cor sai da tinta de cada um. O genérico é esguio, o que serve aos
  dois de distância e ao de Vento; o de Rocha é o que mais perde (é o tanque),
  por isso é o primeiro a voltar no apêndice.
- **O respiro foi para a folha de 40°.** As peças de pé eram nove e as
  rasteiras três; com quatro por folha, uma das de pé tinha de ir para a câmera
  alta, e o respiro é a que ganha com isso (a mecânica dele está no topo).
- **Personagem em 1:1, "one view only", sem "reference sheet".** A palavra
  "sheet" puxa o Gemini para a ficha com frente e costas; para personagem
  sozinho ela saiu do prompt. As folhas de itens continuam com ela, porque lá
  é o que se quer.

---

# Para a próxima leva

Tudo o que saiu do corte está aqui, **completo e pronto para colar**. Se a
reserva de 6 não for gasta refazendo, ela começa por P1 e desce. A ordem segue
o que o jogador vê: primeiro o que já está no jogo toda semana (o evento do
Eco e a guerra de guilda), depois a Câmara (que hoje funciona com o kit do
Coração), e por fim o Santuário, que ainda não tem mapa no código.

| ordem | o quê | tipo | gerações | por que nesta posição |
|---|---|---|---|---|
| P1 | Eco Menor de Rocha | personagem | 1 | é o tanque, e o corpo genérico esguio é o que menos serve a ele |
| P2 | Parede com esteio (Sede) | muro | 1 | quebra a parede lisa repetida em todo o salão |
| P3 | Parede com tocha (Sede) | muro | 1 | idem |
| P4 | Eco Menor de Coral | personagem | 1 | cara própria para o de distância de Água |
| P5 | Eco Menor de Brasa | personagem | 1 | cara própria para o de distância de Fogo |
| P6 | Câmara: pilar quebrado | muro | 1 | só vale junto com o P7 (os dois papéis de muro da Câmara) |
| P7 | Câmara: entulho | muro | 1 | idem |
| P8 | Câmara: a borda | folha de 3 | 1 | se faltar, a borda reaproveita o pilar quebrado |
| P9 | Mariposa de Cinza | personagem | 1 | o segundo monstro de Fogo |
| P10 | Caramujo-Comporta | personagem | 1 | o segundo de Água |
| P11 | Toupeira-Sentinela | personagem | 1 | o segundo de Terra |
| P12 | Arraia de Rajada | personagem | 1 | o segundo de Ar |
| P13 | Fogo e Água, o resto | folha de 4 | 1 | variedade de enfeite nos dois quadrantes |
| P14 | Terra, Ar e o centro, o resto | folha de 4 | 1 | traz o portão e a estela da divisa |
| P15 | Chão de Fogo e Terra | folha de 3 | 1 | chão de enfeite (o da mecânica já veio) |
| P16 | Chão de Ar e o geodo | folha de 3 | 1 | idem |
| P17–P20 | as quatro brechas | muro | 4 | o kit vive com o muro inteiro repetido |
| P21 | Eco Menor de Vento | personagem | 1 | opcional: o genérico já é o corpo esguio dele |
| | **total** | | **21** | |

Quando um personagem destes chegar, ele ganha a sua entrada no manifesto do
lote dele; quando um muro chegar, a sua linha na tabela `ARQUIVOS` (as linhas
já estão comentadas nas seções). As folhas de itens vão na mesma pasta
`itens mapa\` e o `--conta` de cada pasta já está escrito nas seções.

### P1 · Eco Menor de Rocha · `eco-menor-terra` · `imagens\Eco Menor de Rocha.png`

Volta para `O Eco Primordial\monstros\Eco Menor de Rocha\Eco Menor de Rocha idle.glb`
e os outros clipes (sem run: é lento). Entrada no manifesto do Eco com
`"id": "eco-menor-terra"`, e a linha `eco_menor_terra` do `MONSTER_LOOK` volta
para a chave própria.

O irmão atarracado: um bloco do ombro do Eco que caiu e levantou. A base comum
continua (núcleo, máscara), mas o corpo é largo e baixo, de punhos quadrados e
placas de pedra nos antebraços. "Não sai da frente."

```
A single full-body small creature for a 3D game, alone in the image, one view only. It is one of a family of sibling creatures broken off a colossal titan, and it has their shared base body: a humanoid of ordinary size with a small round core glowing almost white in the middle of the chest, and a cracked stone mask for a face with two thin slits of pale light. This one is the squat, heavy sibling: the body is a single thick block of layered bedrock broken off the shoulder of a giant statue, with one flat broken face on top of each shoulder, very broad shoulders about half of its total height across, short thick legs, big blocky fists, and flat stone plates on the forearms; the head is small, about one seventh of its total height, sunk a little between the shoulders. Standing upright in a relaxed A-pose, both arms held clearly away from the body, hands open and relaxed, feet apart at shoulder width, the two legs clearly separated, symmetrical, facing the viewer, nothing crossing in front of the body. Seen from a straight-on front view at eye level, full body from the top of the head to the soles of the feet, filling about 85 percent of the image height. Every part is solidly attached to the body: no free-floating stones, no loose rubble, no free-floating rings, no loose chain links. Stylized hand-painted fantasy game creature look, clean readable silhouette. Near-monochrome light grey materials, all detail in light-and-dark contrast, glowing parts painted almost white, no saturated colors. Soft even frontal studio lighting, no cast shadows, no dramatic highlights. Plain solid white background, completely empty, no floor, no ground, no pedestal, no base, no shadow on the background. The whole figure fully visible with a white margin around it, nothing cropped at the edges. Only one character in the image. No text, no labels, no numbers, no watermark, no frame. Square 1:1 image.
```

### P2 · Parede com esteio (Sede) · `sd_parede_esteio` · `muros\parede com esteio.glb`

O mesmo módulo da parede lisa com um esteio de carvalho subindo pelo meio até
uma viga sob a cornija. Anexe a imagem da S1 no Gemini para a pedra sair igual.

```
A single stylized fantasy castle hall wall section for a 3D game, alone in the image and centered, one view only: a modular tall interior wall built of warm grey-brown fitted castle stone blocks laid in regular horizontal courses, a dark aged oak skirting board along the bottom, and a carved stone cornice with a thin line of old gold along the top, ending in a flat straight top edge. A thick dark oak timber post runs up the middle of the wall face from the skirting board to a horizontal dark oak beam set just under the cornice, the post and the beam set into the stone and part of the wall, not sticking out past its sides. About twice as tall as it is wide. Seen in a straight-on front elevation at eye level, flat orthographic framing with no perspective distortion, so neither the top surface nor the side faces of the wall are visible. Both side ends are perfectly straight vertical cuts, clean and flush, so identical copies can be lined up edge to edge into one continuous wall, and the bottom edge is straight and level on an invisible ground line. Every part is solidly attached to the wall: no free-floating rings, no loose chain links, no separate pieces resting on top. Stylized hand-painted low-poly game art, matte surfaces, clean readable silhouette. Colors: warm grey-brown castle stone, dark aged oak, a thin line of old gold. Soft even frontal studio lighting, no cast shadows, no dramatic highlights. No fire, no smoke, no glow. Plain solid white background, completely empty, no floor, no horizon, no gradient, no shadow on the background. The whole wall fully visible with a white margin around it, nothing cropped at the edges. Only this one object in the image. No text, no labels, no letters, no numbers, no watermark, no frame, no people. Square 1:1 image.
```

### P3 · Parede com tocha (Sede) · `sd_parede_tocha` · `muros\parede com tocha.glb`

O mesmo módulo com um suporte de ferro e uma tocha APAGADA, presos à pedra. O
fogo e a luz, se o salão os quiser, são do código. Anexe a imagem da S1.

```
A single stylized fantasy castle hall wall section for a 3D game, alone in the image and centered, one view only: a modular tall interior wall built of warm grey-brown fitted castle stone blocks laid in regular horizontal courses, a dark aged oak skirting board along the bottom, and a carved stone cornice with a thin line of old gold along the top, ending in a flat straight top edge. In the middle of the wall face, a little above half its height, a dark iron torch bracket is bolted flat to the stone and holds an unlit wooden torch with a wrapped head, the bracket and the torch solidly attached to the wall, with no flame. About twice as tall as it is wide. Seen in a straight-on front elevation at eye level, flat orthographic framing with no perspective distortion, so neither the top surface nor the side faces of the wall are visible. Both side ends are perfectly straight vertical cuts, clean and flush, so identical copies can be lined up edge to edge into one continuous wall, and the bottom edge is straight and level on an invisible ground line. Every part is solidly attached to the wall: no free-floating rings, no loose chain links, no separate pieces resting on top, nothing hanging. Stylized hand-painted low-poly game art, matte surfaces, clean readable silhouette. Colors: warm grey-brown castle stone, dark aged oak, dark iron, a thin line of old gold. Soft even frontal studio lighting, no cast shadows, no dramatic highlights. No fire, no flames, no smoke, no glow. Plain solid white background, completely empty, no floor, no horizon, no gradient, no shadow on the background. The whole wall fully visible with a white margin around it, nothing cropped at the edges. Only this one object in the image. No text, no labels, no letters, no numbers, no watermark, no frame, no people. Square 1:1 image.
```

### P4 · Eco Menor de Coral · `eco-menor-agua` · `imagens\Eco Menor de Coral.png`

Volta para `O Eco Primordial\monstros\Eco Menor de Coral\...`, com o run.
Entrada no manifesto com `"id": "eco-menor-agua"`.

Um galho de coral do Eco com água presa entre os ramos, sólida, que não
escorre. Conchinhas nos ombros, dedos de raminho de coral.

```
A single full-body small creature for a 3D game, alone in the image, one view only. It is one of a family of sibling creatures broken off a colossal titan, and it has their shared base body: a lean humanoid of ordinary size with slightly rounded shoulders and long thin arms, a small round core glowing almost white in the middle of the chest, and a cracked stone mask for a face with two thin slits of pale light; the head about one sixth of its total height. This one is made of branching coral: coral branches form its limbs and torso, smooth glassy sculpted water is trapped between the branches as a solid part of the body, small shells sit on its shoulders, and its fingers are like coral twigs. Standing upright in a relaxed A-pose, both arms held clearly away from the body, hands open and relaxed, feet apart at shoulder width, the two legs clearly separated, symmetrical, facing the viewer, nothing crossing in front of the body. Seen from a straight-on front view at eye level, full body from the top of the head to the soles of the feet, filling about 85 percent of the image height. Every part is solidly attached to the body: no drops of water in the air, no splashes, no free-floating shells, no free-floating rings, no loose chain links. Stylized hand-painted fantasy game creature look, clean readable silhouette. Near-monochrome light grey materials, all detail in light-and-dark contrast, glowing parts painted almost white, no saturated colors. Soft even frontal studio lighting, no cast shadows, no dramatic highlights. Plain solid white background, completely empty, no floor, no ground, no pedestal, no base, no shadow on the background. The whole figure fully visible with a white margin around it, nothing cropped at the edges. Only one character in the image. No text, no labels, no numbers, no watermark, no frame. Square 1:1 image.
```

### P5 · Eco Menor de Brasa · `eco-menor-fogo` · `imagens\Eco Menor de Brasa.png`

Volta para `O Eco Primordial\monstros\Eco Menor de Brasa\...`, com o run.
Entrada no manifesto com `"id": "eco-menor-fogo"`.

Lava que esfriou e ganhou pernas: rocha porosa rachada, as frestas quase
brancas, cristas afiadas nos ombros e nos nós dos dedos.

```
A single full-body small creature for a 3D game, alone in the image, one view only. It is one of a family of sibling creatures broken off a colossal titan, and it has their shared base body: a lean humanoid of ordinary size with slightly rounded shoulders and long thin arms, a small round core glowing almost white in the middle of the chest, and a cracked stone mask for a face with two thin slits of pale light; the head about one sixth of its total height. This one is made of a chunk of cooled lava rock: the body is rough and porous, split by cracks that glow almost white, with sharp ridges on the shoulders and on the knuckles and long thin fingers. Standing upright in a relaxed A-pose, both arms held clearly away from the body, hands open and relaxed, feet apart at shoulder width, the two legs clearly separated, symmetrical, facing the viewer, nothing crossing in front of the body. Seen from a straight-on front view at eye level, full body from the top of the head to the soles of the feet, filling about 85 percent of the image height. Every part is solidly attached to the body: no free-floating rocks, no sparks or embers in the air, no free-floating rings, no loose chain links. Stylized hand-painted fantasy game creature look, clean readable silhouette. Near-monochrome light grey materials, all detail in light-and-dark contrast, glowing parts painted almost white, no saturated colors. Soft even frontal studio lighting, no cast shadows, no dramatic highlights. Plain solid white background, completely empty, no floor, no ground, no pedestal, no base, no shadow on the background. The whole figure fully visible with a white margin around it, nothing cropped at the edges. Only one character in the image. No text, no labels, no numbers, no watermark, no frame. Square 1:1 image.
```

### P6 a P8 · A Câmara do Eco (a arena do chefe) — prefixo `ce_`

Hoje a Câmara do Eco veste o kit do Coração Partido (`theme: 'heart'` em
`js/core/data/arenas.js`). Ela funciona assim; estas três gerações dão a ela
cara própria: câmara circular sobre o vazio, pilares quebrados de cobertura.
Os arquivos ficam na pasta do Eco (`...\O Eco Primordial\`).

**Quais papéis a Câmara usa, e por que dois deles são muro.** Na Câmara os
`#` são pares lado a lado e casas soltas, nunca uma fileira de 3, e os `=` são
pares e casas soltas também. Então quem os veste são os papéis `alto` e
`baixo`, os do MURO, que o renderizador estica para a caixa de uma casa
(`muroDaCasa`, `LARG_MURO`): **3 m de largura por 3,10 m de altura** no alto e
**3 m por 0,92 m** no baixo. Por isso o pilar quebrado e o entulho seguem a
regra do muro: um por imagem, de frente, laterais retas para o par emendar, e
já na proporção da caixa (uma coluna fina esticada a 3 m vira um bloco gordo).
A Câmara não tem fileira de `=` de 3 casas, então nela nunca aparece `sotaque`
nem `marco`; o resto do kit é `borda`, e a borda vem numa folha de três.

| prompt | tipo | imagem (`imagens\`) | arquivo do Meshy | caminho |
|---|---|---|---|---|
| P6 | muro (`alto`) | `pilar quebrado.png` | `muros\pilar quebrado.glb` | normalizador |
| P7 | muro (`baixo`) | `entulho.png` | `muros\entulho.glb` | normalizador |
| P8 | 3 itens (`borda`) | `borda do abismo-cristal do eco-obelisco dos seis.png` | `itens mapa\borda do abismo-cristal do eco-obelisco dos seis.glb` | separador, conta 3 |

Se só der para duas gerações, faça P6 e P7: a borda pode reaproveitar o
pilar quebrado (a licença que o Coração usou), e o P8 fica para depois.

#### P6 · Pilar quebrado · `ce_pilar_quebrado` · `muros\pilar quebrado.glb`

Um trecho de colunata partida, **mais ou menos tão largo quanto alto**: dois
fustes de alturas diferentes num plinto só, com um lintel caído atravessado,
colado aos dois. As bordas de fora são retas para dois deles, lado a lado,
lerem como uma colunata só.

```
A single stylized fantasy ruined colonnade section for a 3D game, alone in the image and centered, one view only: two thick broken stone column shafts of different heights standing side by side on one shared square plinth, both snapped off at an angle with jagged breaks, and a cracked stone lintel fallen diagonally across them and fused to both. Thin cracks run through the stone with a faint pale line inside them. The whole piece is about as wide as it is tall. The outer edges of the piece, the ends of the plinth and the outer sides of the two shafts, are straight and vertical, so two of these placed side by side read as one broken colonnade. Seen in a straight-on front elevation at eye level, flat orthographic framing with no perspective distortion, so neither the top of the plinth nor the side faces are visible, and the bottom edge is straight and level on an invisible ground line. Every part is solidly attached to the piece: no free-floating rings, no loose chain links, no separate pieces resting on top, no loose stones. Stylized hand-painted low-poly game art, matte surfaces, clean readable silhouette. Colors: violet-grey stone, deep indigo shadows, tarnished old gold trim on the plinth, a faint pale line in the cracks. Soft even frontal studio lighting, no cast shadows, no dramatic highlights. Plain solid white background, completely empty, no floor, no horizon, no gradient, no shadow on the background. The whole piece fully visible with a white margin around it, nothing cropped at the edges. Only this one object in the image. No text, no labels, no letters, no numbers, no watermark, no frame, no people. Square 1:1 image.
```

#### P7 · Entulho · `ce_entulho` · `muros\entulho.glb`

O monte baixo que dá meia cobertura, **umas três vezes mais largo que alto**,
fechado nas duas pontas por um bloco quadrado em pé, para o par de `=` emendar
sem buraco no meio.

```
A single stylized fantasy rubble wall section for a 3D game, alone in the image and centered, one view only: a long low heap of fallen column drums and broken stone blocks fused together into one solid pile, about three times as wide as it is tall, with a squared fallen block standing upright at each end so both side ends are straight and vertical, and a low uneven top. Thin cracks with a faint pale line run through some of the blocks. Seen in a straight-on front elevation at eye level, flat orthographic framing with no perspective distortion, so neither the top surface nor the side faces are visible. Both side ends are straight vertical faces, clean and flush, so two of these placed side by side join into one continuous low barrier, and the bottom edge is straight and level on an invisible ground line. Every part is solidly attached to the heap: no free-floating rings, no loose chain links, no separate pieces resting on top, no loose stones apart from the fused heap. Stylized hand-painted low-poly game art, matte surfaces, clean readable silhouette. Colors: violet-grey stone, deep indigo shadows, tarnished old gold on a few fragments, a faint pale line in the cracks. Soft even frontal studio lighting, no cast shadows, no dramatic highlights. Plain solid white background, completely empty, no floor, no horizon, no gradient, no shadow on the background. The whole heap fully visible with a white margin around it, nothing cropped at the edges. Only this one object in the image. No text, no labels, no letters, no numbers, no watermark, no frame, no people. Wide landscape 16:9 image.
```

#### P8 · A borda da Câmara (3 peças) · três-quartos, 30° acima

Arquivo: `itens mapa\borda do abismo-cristal do eco-obelisco dos seis.glb` · `--conta` desta folha: **3**.

`ce_borda_abismo` (o rochedo da beira do círculo, quebrado para o vazio) ·
`ce_cristal_eco` (cristal com o mesmo núcleo do Eco preso dentro) ·
`ce_obelisco` (um obelisco rachado com seis faixas, uma por calabouço:
cristal, coral, lava, corrente entalhada, raízes e o núcleo; conta, do lado de
fora, de onde o Eco foi montado). Os três são `borda`: fora da arena o
renderizador os cresce para 2,2 a 4,6 m.

```
A game asset reference sheet: three separate stylized fantasy ruin props arranged in one horizontal row, evenly spaced, with a wide clear empty gap between every object, none touching and none overlapping. From left to right: (1) a rough rock outcrop broken off sharply on one side like the edge of a cliff above a void, layered stone with a few pale crystals growing out of it as part of the rock; (2) a chest-high cluster of large crystals growing from a stone base, a small round core of pale light visible inside the biggest crystal; (3) a tall cracked stone obelisk on a stepped square base, its shaft carved in six stacked bands, one crusted with crystal, one grown over with coral, one split by a lava crack, one with a chain carved in relief flat into the stone, one braided with thorny roots, and one with a small cracked round core, much taller than it is wide. Every part of every object is solidly attached to it: no free-floating rings, no loose chain links, no separate pieces resting on top, no loose stones. All three seen from the same three-quarter view about thirty degrees above eye level, the same camera for every object, all standing on the same invisible ground line with their bases aligned. Stylized hand-painted low-poly game art, matte surfaces, clean readable silhouettes. Colors: violet-grey stone, deep indigo shadows, tarnished old gold, a pale glow painted in the cracks and in the core. Soft even studio lighting, no cast shadows, no dramatic highlights. Plain solid white background, completely empty, no floor, no horizon, no gradient, no shadow on the background. Every object fully visible, nothing cropped at the edges. No text, no labels, no letters, no numbers, no watermark, no frame, no people. Wide landscape 16:9 image.
```

**Como separar a Câmara:**

```
muros\       sem separador: tools/normaliza_muros_eco.py
             ORIG = r"C:\Users\danie\Downloads\assets_ok\mapa\O Eco Primordial\muros"
             ARQUIVOS = {"pilar quebrado.glb": "pilar_quebrado.glb", "entulho.glb": "entulho.glb"}
itens mapa\  --conta 3
```

| papel | peças |
|---|---|
| `alto` | `ce_pilar_quebrado` |
| `baixo` | `ce_entulho` |
| `borda` | `ce_borda_abismo`, `ce_cristal_eco`, `ce_obelisco` (e `ce_pilar_quebrado`, se o P8 não sair) |

### P9 · Mariposa de Cinza · `el_fogo_2` · `imagens\Mariposa de Cinza.png`

Volta para `O Santuario dos Elementos\monstros\Mariposa de Cinza\...`, com o
run (corpo a corpo, rápida, 1,50 m).

Mariposa vestida num corpo: **as asas são os braços** (nunca asas E braços),
abertas um pouco como braços em pose A, com mãozinhas de garra na ponta. Corpo
peludo e redondo, antenas de pena, olhos compostos quase brancos. **O que ela
conta:** persegue a luz dos braseiros.

```
A single full-body creature for a 3D game, alone in the image, one view only: a moth creature dressed as a humanoid biped. A fuzzy rounded body covered in soft ash-grey fur, a fluffy collar of fur around the neck, two large feathery antennae, and big round compound eyes painted almost white. Its two arms ARE broad moth wings, with eye-spot patterns, held open slightly away from the body like arms in an A-pose, each wing ending in a small clawed hand at the wing tip; it has no other arms. Short furry legs with small clawed feet. Proportions: small and quick, the head about one fifth of its total height, the open wings spanning about as wide as the creature is tall. Standing upright in a relaxed A-pose, feet apart at shoulder width, the two legs clearly separated, symmetrical, facing the viewer, nothing crossing in front of the body. Seen from a straight-on front view at eye level, full body from the tips of the antennae to the soles of the feet, filling about 85 percent of the image height. Every part is solidly attached to the body: no flames, no free-floating sparks, no dust or scales in the air, no free-floating rings, no loose chain links. Stylized hand-painted fantasy game creature look, clean readable silhouette. Near-monochrome light grey materials, all detail in light-and-dark contrast, eyes painted almost white, no saturated colors. Soft even frontal studio lighting, no cast shadows, no dramatic highlights. Plain solid white background, completely empty, no floor, no ground, no pedestal, no base, no shadow on the background. The whole figure fully visible with a white margin around it, nothing cropped at the edges. Only one character in the image. No text, no labels, no numbers, no watermark, no frame. Square 1:1 image.
```

### P10 · Caramujo-Comporta · `el_agua_1` · `imagens\Caramujo-Comporta.png`

Volta para `O Santuario dos Elementos\monstros\Caramujo-Comporta\...` (tanque,
1,90 m, sem run).

Um caramujo de pé, pesado, com a concha feita de comporta de bronze rebitada.
A concha fica nas costas, então o prompt a faz **subir acima dos ombros e
aparecer dos dois lados** do corpo. A volante da comporta vem esculpida e chata
no alto da concha (aro solto é a argola da Mina). O pé de caramujo cai na
frente como saia sobre duas pernas curtas.

```
A single full-body creature for a 3D game, alone in the image, one view only: a large snail creature as an upright humanoid biped. A thick soft body with two stalk eyes on top of the head, the eyes painted almost white. On its back a heavy shell shaped like a riveted bronze sluice gate: the shell rises above and behind the shoulders, and its riveted rim is clearly visible on both sides of the body from the front; a round valve wheel is carved flat into the top of the shell as one solid piece with it. The soft foot of the snail hangs down in front like a short thick skirt over two short thick legs. Two thick arms with broad flat hands. Proportions: heavy, slow and broad, the shoulder span about half of its total height, the head about one sixth of its total height. Standing upright in a relaxed A-pose, both arms held clearly away from the body, hands open and relaxed, feet apart at shoulder width, the two legs clearly separated, symmetrical, facing the viewer, nothing crossing in front of the body. Seen from a straight-on front view at eye level, full body from the tips of the eye stalks to the soles of the feet, filling about 85 percent of the image height. Every part is solidly attached to the body: no drops of water in the air, no slime trail, no puddle on the ground, no free-floating rings, no loose chain links. Stylized hand-painted fantasy game creature look, clean readable silhouette. Near-monochrome light grey materials, all detail in light-and-dark contrast, eyes painted almost white, no saturated colors. Soft even frontal studio lighting, no cast shadows, no dramatic highlights. Plain solid white background, completely empty, no floor, no ground, no pedestal, no base, no shadow on the background. The whole figure fully visible with a white margin around it, nothing cropped at the edges. Only one character in the image. No text, no labels, no numbers, no watermark, no frame. Square 1:1 image.
```

### P11 · Toupeira-Sentinela · `el_terra_2` · `imagens\Toupeira-Sentinela.png`

Volta para `O Santuario dos Elementos\monstros\Toupeira-Sentinela\...`, com o
run (corpo a corpo, sai do chão, 1,60 m).

Toupeira atarracada de capacete de pedra e peitoral preso por cintas de pedra
(coladas ao corpo), com garras enormes de cavar: as garras de pá são a
silhueta dela.

```
A single full-body creature for a 3D game, alone in the image, one view only: a mole creature as a humanoid biped. A stocky furry body, a pointed snout with a pale nose, tiny eyes painted almost white, and a round helmet of carved stone fitted on its head. Huge spade-like digging claws on both hands, the clearest part of its silhouette. A stone breastplate over the chest held by carved stone straps that are part of the body. Short strong legs with wide clawed feet. Proportions: stocky and low, the shoulder span about half of its total height, the head about one fifth of its total height. Standing upright in a relaxed A-pose, both arms held clearly away from the body, claws open, feet apart at shoulder width, the two legs clearly separated, symmetrical, facing the viewer, nothing crossing in front of the body. Seen from a straight-on front view at eye level, full body from the top of the helmet to the soles of the feet, filling about 85 percent of the image height. Every part is solidly attached to the body: no free-floating stones, no dirt in the air, no free-floating rings, no loose chain links. Stylized hand-painted fantasy game creature look, clean readable silhouette. Near-monochrome light grey materials, all detail in light-and-dark contrast, eyes painted almost white, no saturated colors. Soft even frontal studio lighting, no cast shadows, no dramatic highlights. Plain solid white background, completely empty, no floor, no ground, no pedestal, no base, no shadow on the background. The whole figure fully visible with a white margin around it, nothing cropped at the edges. Only one character in the image. No text, no labels, no numbers, no watermark, no frame. Square 1:1 image.
```

### P12 · Arraia de Rajada · `el_ar_2` · `imagens\Arraia de Rajada.png`

Volta para `O Santuario dos Elementos\monstros\Arraia de Rajada\...`, com o
run e com o `walk` no clipe de planar (corpo a corpo, 1,80 m).

Uma arraia de pé: o corpo chato em losango, as asas largas são os braços (com
mãozinhas de garra na ponta), a cauda longa cai nas costas como capa, colada
ao corpo. Duas pernas finas.

```
A single full-body creature for a 3D game, alone in the image, one view only: a manta ray creature as a humanoid biped. A flat diamond-shaped body held upright, two small eyes on the front painted almost white. Its two arms ARE the broad flat wings of the ray, held open slightly away from the body like arms in an A-pose, each ending in a small clawed hand at the wing tip; it has no other arms. Its long thin tail hangs down behind the body like a cape, attached to the back. Two slim legs with small feet. Proportions: light and flat, the open wings spanning about as wide as the creature is tall, the head part of the flat body. Standing upright in a relaxed A-pose, feet apart at shoulder width, the two legs clearly separated, symmetrical, facing the viewer, nothing crossing in front of the body. Seen from a straight-on front view at eye level, full body from the top of the body to the soles of the feet, filling about 85 percent of the image height. Every part is solidly attached to the body: no wind effects, no drops of water in the air, no free-floating pieces, no free-floating rings, no loose chain links. Stylized hand-painted fantasy game creature look, clean readable silhouette. Near-monochrome light grey materials, all detail in light-and-dark contrast, eyes painted almost white, no saturated colors. Soft even frontal studio lighting, no cast shadows, no dramatic highlights. Plain solid white background, completely empty, no floor, no ground, no pedestal, no base, no shadow on the background. The whole figure fully visible with a white margin around it, nothing cropped at the edges. Only one character in the image. No text, no labels, no numbers, no watermark, no frame. Square 1:1 image.
```

### P13 · Fogo e Água, o resto (4 peças) · três-quartos, 30° acima

Arquivo: `O Santuario dos Elementos\itens mapa\pilar de basalto-velas-regua da mare-jarros.glb` · `--conta` desta folha: **4**.

`el_fogo_pilar` (**pilar**: coluna de basalto com cinta de ferro) · `el_velas`
(**sotaque**, ~1 m: bloco de pedra coberto de velas derretidas e apagadas, cera
escorrida) · `el_regua_mare` (**sotaque**, ~1,5 m: poste de bronze com marcas
de nível, como régua de maré) · `el_jarros` (**sotaque**, ~1 m: três ânforas
de pedra fundidas numa base, uma tombada e colada às outras).

```
A game asset reference sheet: four separate stylized fantasy sanctuary props arranged in one horizontal row, evenly spaced, with a wide clear empty gap between every object, none touching and none overlapping. From left to right: (1) a tall narrow column of near-black volcanic basalt with a dark iron band around the middle and a carved flame symbol on its square base, much taller than it is wide; (2) a waist-high block of black stone covered in a cluster of many melted unlit candles of different heights, thick wax dripping down the sides of the block and fused to it, no flames; (3) a chest-high verdigris bronze post marked with notched horizontal level lines like a tide gauge, on a round stone foot; (4) a waist-high cluster of three stone amphorae fused onto one low stone base, one of them tipped over and leaning against the others, all joined together. The first is tall and narrow, the other three are about waist to chest height. Every part of every object is solidly attached to it: no free-floating rings, no loose chain links, no separate pieces resting on top. All four seen from the same three-quarter view about thirty degrees above eye level, the same camera for every object, all standing on the same invisible ground line with their bases aligned. Stylized hand-painted low-poly game art, matte surfaces, clean readable silhouettes. Colors: near-black basalt, dark iron, cream wax, verdigris bronze, blue-grey stone, dark green water moss. Soft even studio lighting, no cast shadows, no dramatic highlights. No fire, no smoke, no glow, no flowing water. Plain solid white background, completely empty, no floor, no horizon, no gradient, no shadow on the background. Every object fully visible, nothing cropped at the edges. No text, no labels, no letters, no numbers, no watermark, no frame, no people. Wide landscape 16:9 image.
```

### P14 · Terra, Ar e o centro, o resto (4 peças) · três-quartos, 30° acima

Arquivo: `O Santuario dos Elementos\itens mapa\portao do santuario-pilar de raiz-flamula-estela de divisa.glb` · `--conta` desta folha: **4**.

`el_portao` (**borda**: o arco de entrada do santuário, com quatro
pedras-chave; o mais largo, na ponta esquerda para garantir o vão) ·
`el_terra_pilar` (**pilar**: coluna de arenito abraçada por raízes) ·
`el_flamula` (**sotaque**, ~1,4 m: marco de pedra com fitas de pano claro
rasgadas, duras de vento, presas ao topo) · `el_estela_divisa`
(**sotaque_alto**: estela de quatro faces que marca a divisa entre dois
quadrantes, cada face com um símbolo).

```
A game asset reference sheet: four separate stylized fantasy sanctuary props arranged in one horizontal row, evenly spaced, with a wide clear empty gap between every object, none touching and none overlapping. From left to right: (1) a tall stone gateway arch with four different keystones at the top, one of basalt, one of blue-grey stone, one of granite, one of marble, the opening empty and open; (2) a tall narrow sandstone column wrapped by thick tree roots that grip it and sink into its square base, moss in the cracks, a carved mountain symbol on the base, much taller than it is wide; (3) a chest-high stone marker post with several long torn pale cloth ribbons attached to its top and frozen stiff sideways as if blown by a strong wind, every ribbon attached to the post; (4) a tall narrow four-sided stone stele, each face carved with one large elemental symbol, flame, wave, mountain and spiral, a band of old gold near its top. The first, second and fourth are tall, the third is about chest height. Every part of every object is solidly attached to it: no free-floating rings, no loose chain links, no separate pieces resting on top, no loose leaves in the air. All four seen from the same three-quarter view about thirty degrees above eye level, the same camera for every object, all standing on the same invisible ground line with their bases aligned. Stylized hand-painted low-poly game art, matte surfaces, clean readable silhouettes. Colors: neutral grey sanctuary stone with the four element stones, ochre sandstone, dark brown roots, mossy green, pale weathered marble, off-white cloth, old gold. Soft even studio lighting, no cast shadows, no dramatic highlights. No wind effects, no glow. Plain solid white background, completely empty, no floor, no horizon, no gradient, no shadow on the background. Every object fully visible, nothing cropped at the edges. No text, no labels, no letters, no numbers, no watermark, no frame, no people. Wide landscape 16:9 image.
```

### P15 · Chão de Fogo e Terra (3 peças) · três-quartos, 40° acima

Arquivo: `O Santuario dos Elementos\itens mapa\grelha de brasa-cinzas-rachas com raiz.glb` · `--conta` desta folha: **3**.

`el_grelha` (grelha de ferro no piso sobre carvão escuro) · `el_cinzas`
(mancha de cinza fria com tições apagados) · `el_rachas` (lajes rachadas com
raízes saindo das frestas): os três **chao**, rasteiros, sem colisão.

```
A game asset reference sheet: three separate stylized fantasy floor props arranged in one horizontal row, evenly spaced, with a wide clear empty gap between every object, none touching and none overlapping, all three very low and lying flat on the ground. From left to right: (1) a square dark iron floor grate set in a frame of black basalt, dark unlit coals visible through the bars; (2) a low irregular patch of cold grey ash with a few burnt-out charred sticks pressed into it; (3) a patch of cracked grey floor slabs, slightly tilted, with thick roots pushing up through the cracks and moss in the joints. Every part of every object is solidly attached to it: no free-floating rings, no loose pieces resting on top, no loose pebbles. All three seen from the same elevated three-quarter view about forty degrees above the ground, high enough that the flat floor pieces read clearly as shapes and not as thin lines, the same camera for every object, all resting on the same invisible ground line. Stylized hand-painted low-poly game art, matte surfaces, clean readable silhouettes. Colors: black basalt, dark iron, grey ash, grey stone, dark brown roots, green moss. Soft even studio lighting, no cast shadows, no dramatic highlights. No fire, no smoke, no glow. Plain solid white background, completely empty, no floor plane, no horizon, no gradient, no shadow on the background. Every object fully visible, nothing cropped at the edges. No text, no labels, no letters, no numbers, no watermark, no frame, no people. Wide landscape 16:9 image.
```

### P16 · Chão de Ar e o geodo (3 peças) · três-quartos, 40° acima

Arquivo: `O Santuario dos Elementos\itens mapa\geodo-rosa dos ventos-folhas no redemoinho.glb` · `--conta` desta folha: **3**.

`el_geodo` (**sotaque**, ~1,2 m: geodo aberto em pé, cristais por dentro; vai
com o chão porque a câmera alta mostra o oco dele) · `el_rosa_ventos`
(**chao**: rosa dos ventos de mármore e bronze embutida no piso, **sem letras
de norte/sul**) · `el_folhas` (**chao**: folhas secas num redemoinho baixo,
coladas umas nas outras e no chão).

```
A game asset reference sheet: three separate stylized fantasy sanctuary props arranged in one horizontal row, evenly spaced, with a wide clear empty gap between every object, none touching and none overlapping. From left to right: (1) a waist-high geode split open and standing upright on its round side, rough grey stone outside and a hollow lined with pale crystals inside, the open hollow facing the viewer; (2) a round compass rose inlaid in the floor, pale marble with polished bronze points, eight points of different lengths, no letters and no markings other than the points; (3) a low swirl of dry leaves pressed together into a spiral drift on the floor, all the leaves touching each other and the ground. The first is waist-high, the other two are very low and lie flat on the ground. Every part of every object is solidly attached to it: no free-floating rings, no loose pieces resting on top, no leaves in the air. All three seen from the same elevated three-quarter view about forty degrees above the ground, high enough that the flat floor pieces read clearly as shapes and not as thin lines, the same camera for every object, all resting on the same invisible ground line. Stylized hand-painted low-poly game art, matte surfaces, clean readable silhouettes. Colors: grey stone, pale crystal, pale marble, polished bronze, dry brown and pale lilac leaves. Soft even studio lighting, no cast shadows, no dramatic highlights. No wind effects, no glow. Plain solid white background, completely empty, no floor plane, no horizon, no gradient, no shadow on the background. Every object fully visible, nothing cropped at the edges. No text, no labels, no letters, no numbers, no watermark, no frame, no people. Wide landscape 16:9 image.
```

### P17 a P20 · As quatro brechas do Santuário

O mesmo módulo do muro inteiro de cada quadrante, com uma brecha no meio que
não parte o muro em dois (a fiada de baixo segue inteira). Para cada uma,
anexe no Gemini a imagem do muro inteiro do mesmo quadrante (EL1 a EL4), para
a pedra sair igual. Vão para `O Santuario dos Elementos\muros\`, e as linhas
delas já estão comentadas na tabela do normalizador.

#### P17 · Brecha de Fogo · `el_brecha_fogo` · `muros\brecha fogo.glb`

```
A single stylized fantasy sanctuary wall section for a 3D game, alone in the image and centered, one view only: a modular low wall built of near-black volcanic basalt blocks with thin dark ember-red veins in the joints and a dark iron band along the top, with a collapsed breach in the middle: the top courses in the center have fallen away, leaving a jagged gap that goes down to about half the height of the wall, while the bottom courses stay whole and connect both sides. The fallen blocks are fused into a low heap against the foot of the wall, inside its outline. The remaining sections on both sides keep a flat straight top. About twice as wide as it is tall. Seen in a straight-on front elevation at eye level, flat orthographic framing with no perspective distortion, so neither the top surface nor the side faces of the wall are visible. Both side ends are perfectly straight vertical cuts, clean and flush, so the piece lines up edge to edge with whole wall sections, and the bottom edge is straight and level on an invisible ground line. Every part is solidly attached to the wall: no free-floating rings, no loose chain links, no separate pieces resting on top, no loose rubble apart from the heap fused to the wall. Stylized hand-painted low-poly game art, matte surfaces, clean readable silhouette. Colors: near-black basalt, dark iron, the faintest dark ember red in the joints. Soft even frontal studio lighting, no cast shadows, no dramatic highlights. No fire, no smoke, no glow. Plain solid white background, completely empty, no floor, no horizon, no gradient, no shadow on the background. The whole wall fully visible with a white margin around it, nothing cropped at the edges. Only this one object in the image. No text, no labels, no letters, no numbers, no watermark, no frame, no people. Wide landscape 16:9 image.
```

#### P18 · Brecha de Água · `el_brecha_agua` · `muros\brecha agua.glb`

```
A single stylized fantasy sanctuary wall section for a 3D game, alone in the image and centered, one view only: a modular low wall built of blue-grey wet-looking stone blocks with a carved water channel along its face, verdigris bronze trim along the top and patches of dark green water moss, with a collapsed breach in the middle: the top courses in the center have fallen away, leaving a jagged gap that goes down to about half the height of the wall, while the bottom courses stay whole and connect both sides. The fallen blocks are fused into a low heap against the foot of the wall, inside its outline. The remaining sections on both sides keep a flat straight top. About twice as wide as it is tall. Seen in a straight-on front elevation at eye level, flat orthographic framing with no perspective distortion, so neither the top surface nor the side faces of the wall are visible. Both side ends are perfectly straight vertical cuts, clean and flush, so the piece lines up edge to edge with whole wall sections, and the bottom edge is straight and level on an invisible ground line. Every part is solidly attached to the wall: no free-floating rings, no loose chain links, no separate pieces resting on top, no loose rubble apart from the heap fused to the wall. Stylized hand-painted low-poly game art, matte surfaces, clean readable silhouette. Colors: blue-grey wet stone, verdigris bronze, dark green water moss. Soft even frontal studio lighting, no cast shadows, no dramatic highlights. No flowing water, no splashes, no glow. Plain solid white background, completely empty, no floor, no horizon, no gradient, no shadow on the background. The whole wall fully visible with a white margin around it, nothing cropped at the edges. Only this one object in the image. No text, no labels, no letters, no numbers, no watermark, no frame, no people. Wide landscape 16:9 image.
```

#### P19 · Brecha de Terra · `el_brecha_terra` · `muros\brecha terra.glb`

```
A single stylized fantasy sanctuary wall section for a 3D game, alone in the image and centered, one view only: a modular low wall built of huge rough ochre granite and sandstone blocks fitted without mortar, with green moss in the joints, with a collapsed breach in the middle: the top courses in the center have fallen away, leaving a jagged gap that goes down to about half the height of the wall, while the bottom courses stay whole and connect both sides, and a thick tree root grows up through the breach with both ends sunk into the stone. The fallen blocks are fused into a low heap against the foot of the wall, inside its outline. The remaining sections on both sides keep a flat straight top. About twice as wide as it is tall. Seen in a straight-on front elevation at eye level, flat orthographic framing with no perspective distortion, so neither the top surface nor the side faces of the wall are visible. Both side ends are perfectly straight vertical cuts, clean and flush, so the piece lines up edge to edge with whole wall sections, and the bottom edge is straight and level on an invisible ground line. Every part is solidly attached to the wall: no free-floating rings, no loose chain links, no separate pieces resting on top, no loose pebbles, no loose rubble apart from the heap fused to the wall. Stylized hand-painted low-poly game art, matte surfaces, clean readable silhouette. Colors: ochre granite and sandstone, mossy green, dark brown root. Soft even frontal studio lighting, no cast shadows, no dramatic highlights. No glow. Plain solid white background, completely empty, no floor, no horizon, no gradient, no shadow on the background. The whole wall fully visible with a white margin around it, nothing cropped at the edges. Only this one object in the image. No text, no labels, no letters, no numbers, no watermark, no frame, no people. Wide landscape 16:9 image.
```

#### P20 · Brecha de Ar · `el_brecha_ar` · `muros\brecha ar.glb`

```
A single stylized fantasy sanctuary wall section for a 3D game, alone in the image and centered, one view only: a modular low wall built of pale weathered marble blocks smoothed by the wind, with a few round wind holes carved clean through it, polished bronze trim along the top and soft pale lilac stone accents, with a collapsed breach in the middle: the top courses in the center have fallen away, leaving a jagged gap that goes down to about half the height of the wall, while the bottom courses stay whole and connect both sides. The fallen blocks are fused into a low heap against the foot of the wall, inside its outline. The remaining sections on both sides keep a flat straight top. About twice as wide as it is tall. Seen in a straight-on front elevation at eye level, flat orthographic framing with no perspective distortion, so neither the top surface nor the side faces of the wall are visible. Both side ends are perfectly straight vertical cuts, clean and flush, so the piece lines up edge to edge with whole wall sections, and the bottom edge is straight and level on an invisible ground line. Every part is solidly attached to the wall: no free-floating rings, no loose chain links, no separate pieces resting on top, no loose rubble apart from the heap fused to the wall. Stylized hand-painted low-poly game art, matte surfaces, clean readable silhouette. Colors: pale weathered marble, soft pale lilac stone, polished bronze. Soft even frontal studio lighting, no cast shadows, no dramatic highlights. No wind effects, no smoke, no glow. Plain solid white background, completely empty, no floor, no horizon, no gradient, no shadow on the background. The whole wall fully visible with a white margin around it, nothing cropped at the edges. Only this one object in the image. No text, no labels, no letters, no numbers, no watermark, no frame, no people. Wide landscape 16:9 image.
```

### P21 · Eco Menor de Vento (opcional) · `eco-menor-ar` · `imagens\Eco Menor de Vento.png`

O genérico (E2) já é um corpo esguio de pedra clara, que é o deste irmão; por
isso ele é o último e é opcional. Se vier, volta para
`O Eco Primordial\monstros\Eco Menor de Vento\...`, com o run, e entra no
manifesto com `"id": "eco-menor-ar"`.

O irmão esguio e rápido: pedra clara gasta pelo vento, uma corrente fina
enrolada em espiral APERTADA no tronco e nos braços, e uma fita de vento
esculpida, sólida, em volta do peito.

```
A single full-body small creature for a 3D game, alone in the image, one view only. It is one of a family of sibling creatures broken off a colossal titan, and it has their shared base body: a lean humanoid of ordinary size with slightly rounded shoulders and long thin arms, a small round core glowing almost white in the middle of the chest, and a cracked stone mask for a face with two thin slits of pale light; the head about one sixth of its total height. This one is the slender, light, fast sibling: its body is smooth wind-worn pale stone with long narrow limbs and a narrow head; a thin iron chain is wrapped tightly in a spiral around the torso and both arms, every link lying flat against the body, and a spiral of trapped wind is sculpted as a solid ribbon coiled around the chest. Standing upright in a relaxed A-pose, both arms held clearly away from the body, hands open and relaxed, feet apart at shoulder width, the two legs clearly separated, symmetrical, facing the viewer, nothing crossing in front of the body. Seen from a straight-on front view at eye level, full body from the top of the head to the soles of the feet, filling about 85 percent of the image height. Every part is solidly attached to the body: no free-floating stones, no wind effects in the air, no free-floating rings, no loose chain links, no dangling chain ends. Stylized hand-painted fantasy game creature look, clean readable silhouette. Near-monochrome light grey materials, all detail in light-and-dark contrast, glowing parts painted almost white, no saturated colors. Soft even frontal studio lighting, no cast shadows, no dramatic highlights. Plain solid white background, completely empty, no floor, no ground, no pedestal, no base, no shadow on the background. The whole figure fully visible with a white margin around it, nothing cropped at the edges. Only one character in the image. No text, no labels, no numbers, no watermark, no frame. Square 1:1 image.
```

SOTERRA · prompts do lote do lançamento · leva de agora: 10 personagens, 8 muros e 6 folhas de itens (24 imagens, 24 gerações) + 6 de reserva = 30 · para a próxima leva: 21 · escrito na noite de 2 para 3 de outubro de 2026, refeito e cortado em 3 de outubro
