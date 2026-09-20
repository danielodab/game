# Prompt pronto — O Portal do Campo de PvP (o arco de espadas)

Pedido do dono (20/09, com a foto da praça): *"o campo pvp não vai ter esses muros, vou
fazer um específico para isso (inclusive esses muros que vou fazer, será usado também no
mapa de pvp) e não será um portal. me dê um prompt para criar um portal com espadas em
volta, para diferenciar dos demais"*.

Hoje a entrada do Campo é o **mesmo anel de pedra** dos seis portais de calabouço, só que
pintado de vermelho — e cor é o que menos se enxerga na vista de cima. Esta peça troca a
**silhueta**: onde os portais são discos, este é um retângulo de pedra com uma coroa
eriçada de lâminas em volta. Nenhuma outra peça da praça tem arma; "ferro de pé" passa a
ser o vocabulário exclusivo do PvP.

---

## O prompt (copie o bloco inteiro no Meshy)

```
A heavy stone portal arch with swords planted all around it: two thick square stone pillars carrying one plain massive stone lintel across the top, the middle an open empty doorway you can see straight through, no door, no gate, no bars, no portcullis, no grate, no curtain; the ground between the two pillars bare, flat and clear all the way through, with no step, no sill, no threshold and no slab bridging them; eight big swords planted point-down standing upright out of the floor, four on each side, spread in a wide half circle around each pillar, some in front of the arch and some behind it, no two at the same height and no two at the same angle, not mirrored left to right, their points ending flush with the floor, none of them floating above it and none sunk in past the crossguard, clear empty gaps between the blades, each sword separate and standing apart from the next, not fused into a wall or a comb of metal; two more swords driven into the stone, one in each pillar below the line of the lintel, with their hilts sticking out; two big two-handed swords laid crossed in an X flat against the front face of the lintel, their hilts and blade tips sticking out past the pillars on both sides; twelve swords in total; every blade thick chunky and slab-like, as thick as a brick and a hand's width wide, blunt-edged, plain crossguards, grips wrapped in dark leather, none of them thin, flat or needle-like; a few chips and nicks along the edges; wide stable footprint, imposing front face, about one and a third times wider than tall, and about one third as deep as it is wide; one single connected object, the swords joined to the ground and to the arch, not separate props arranged in a row; the silhouette reads clearly from directly above as well as from the front. Colors: pale light grey limestone, dark oiled iron with a little rust, worn dark brown leather, matte, dull and desaturated, no shiny or polished metal, no mirror-like blades, no gold, no bright colors, all detail in light-and-dark contrast. Game-ready environment prop, stylized hand-painted look, clean readable silhouette, standing on the ground with its base flat at floor level, single object, no rig, no skeleton, no animation, no ground plane, no background, no pedestal, no plinth, no base slab, no mound of earth, nothing else in the scene.
```

**Doze espadas**: oito fincadas no chão em meia-lua (quatro de cada lado), uma em cada
pilar, e duas cruzadas em X deitadas na frente da viga. O X é o que se lê na miniatura e
de cima; deitado na pedra, ele não depende de ponta de lâmina encostando no ar.

---

## Por que o prompt diz o que diz

Cada linha foi decidida contra um erro conhecido do gerador ou do nosso motor:

| o que o prompt pede | por quê |
|---|---|
| `the middle an open empty doorway you can see straight through` (forma positiva, antes das negativas) | O vão **tem de ficar vazio**: é ali que o jogo acende o disco vermelho. Lista de negativas sozinha não segura — arco de pedra volta com grade ou véu. |
| `the ground between the two pillars bare... no slab bridging them` | O hub assenta a peça **pelo pé da caixa**. Uma laje entre os pilares ergue o arco inteiro e o brilho do chão fica flutuando debaixo do vão. |
| `as thick as a brick and a hand's width wide` | Lâmina fina é o risco nº 1: sai com buraco na malha e some a cinco metros. Três réguas para a mesma grandeza seguram o gerador. |
| `clear empty gaps between the blades, each sword separate` | Leque fundido vira pente chato e perde a silhueta de cima, que é a razão de ser da peça. |
| `points ending flush with the floor, none floating, none sunk past the crossguard` | As lâminas nascem pairando ou afundadas até o punho se o texto não mandar. |
| `about one and a third times wider than tall` | O hub escala pela **altura** com teto de **largura**. Na proporção 1,5 o teto morde e a peça encolhe; 1⅓ deixa margem. |
| `about one third as deep as it is wide` | A medida usa o maior eixo do chão. Peça sem profundidade vira um traço visto de cima. |
| `one single connected object... not separate props arranged in a row` | A praça não passa por separador: se vier folha com peças lado a lado, é rodada perdida. |
| `matte, dull and desaturated... all detail in light-and-dark contrast` | A textura cai para 1024 e sai JPEG; o desenho tem de viver no claro-escuro. O vermelho é do jogo, no vão. |

**O que NÃO está no prompt de propósito:** "cemitério de armas" (traz lápide, osso e
montinho de terra), "pedra solta no pé do pilar" (é a semente do pedestal), lâmina
espetada acima da viga (rouba altura do arco na medição) e proibição de texto/bandeira
(nomear bandeira é o jeito mais certo de receber uma).

---

## Como entrou no jogo (feito em 20/09)

O dono entregou o lote inteiro em `Downloads\assets_ok\mapa e itens pvp\` — o portal,
os dois muros e as duas folhas de quatro barreiras. O caminho foi:

```bash
"C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --factory-startup --python tools/normaliza_pvp.py
```

1. `tools/normaliza_pvp.py` — os três de peça única (portal, muro alto, muro médio):
   textura a 1024, JPEG, 19 MB → 0,44 MB cada.
2. `tools/separa_pecas.py --conta 4,4` — as duas folhas viraram oito peças.
3. `tools/embute_pvp.py` — grava `assets/embedded/cenario-pvp.js`: os onze modelos e o
   catálogo `JOGO.CENARIO['pvp']` (alto 4, pilar 1, baixo 5, sotaque 4).
4. `python tools/extrai_assets.py` — o bundle servido e o manifesto.
5. `js/render3d/hub3d.js`: `OBRAS.campo = { chave: 'praca_portal_pvp', alvoAlt: 6.0, teto: 9.5 }`.
6. `js/core/data/campo_pvp.js`: `tema: 'pvp'` e as dezesseis barreiras baixas espalhadas.

**O nome do embutido é `cenario-pvp.js`, e isso importa.** No jogo SERVIDO o `index.html`
lê a tabela (o `JOGO.CENARIO`) só dos embutidos `cenario-*.js`; os `models-*.js` ele pula
inteiros, porque os binários já descem do bundle. Com o arquivo chamado `models-pvp.js` o
catálogo `pvp` não existia sobre http, e o Campo voltava vestido de jardim — de `file://`
parecia certo e servido parecia quebrado.

**O lote desce em dois tempos** (`tools/extrai_assets.py`, `grupo_de`): o portal fica no
grupo `base`, porque está de pé na praça (0,43 MB); os muros e as barreiras ficam em
`campo:pvp` (4,4 MB) e só descem para quem vai ao Campo — a pré-busca do Acampamento os
traz em segundo plano (`js/assets_bundle.js`, `ordemDaPreBusca`).

**Proporção alvo em metros de jogo:** ~8 m de largura × ~6 m de altura (com o leque),
vão livre de ~2,6 m de largura × ~3,5 m de altura. Referências: herói 2,05 m, casa do
tabuleiro 2,0 m, muro 3,10 m, Arena 9,5 m. O que chegou: 1,00 × 0,59 × 0,82 de proporção,
que com o teto de 9,5 m de largura dá 9,5 m de largura × 5,6 m de altura.

---

## O que olhar quando o modelo chegar

1. **O vão está vazio?** Olhe de frente: tem de dar para ver o que está atrás. Se vier
   grade, porta ou véu, é rodada perdida — não dá para tirar na normalização.
2. **A base é plana?** Nada de laje, montinho ou pedra solta no pé. O arco tem de nascer
   direto no chão.
3. **As espadas estão separadas?** Se fundiram num pente, a silhueta de cima morre.
4. **Lâmina grossa?** Papel fino não sobrevive à textura 1024.
5. **É uma peça só?** Se vier fila de objetos, rode de novo.
6. **Sem texto, símbolo gravado ou bandeira.**

---

## O que o código faz por conta (20/09, resolvido)

- **O disco vermelho e o brilho do chão.** Quem acendia o vão era o arco provisório, e a
  vestimenta varria tudo que não fosse rótulo. Agora o brilho do chão é marcado
  (`userData.brilhoChao`) e sobrevive, e um disco novo nasce dentro do vão do portal do
  dono, na altura do peito — o mesmo vermelho que pulsa nos portais.
- **O giro dobrado.** O nó do portão já vinha girado (o arco provisório usa `lookAt`); a
  obra traz o giro dela dentro. O nó volta a zero antes de vestir.
- **O corredor murado da entrada** saiu: sem `portao`, nada de muro, câmara, braseiro ou
  bandeira nasce ali. Ficam o portal e a calçada. As provas (`tests/paredes.html`,
  `tests/corredores.html`, `tests/campo_pvp.html`) cobram o contrário do que cobravam.
- **A entrada não é parede**: `solido` fica zerado no portão — atravessa-se ele.
