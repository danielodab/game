# PROPOSTA DE MODELOS — elenco das 6 classes e os 6 chefes

**Status: PESQUISA E PROPOSTA. Nenhum arquivo do jogo foi alterado.**
Data: 2026-08-18. Tudo aqui é CC0 verificado lendo a página da licença, não de memória.

Arquivos produzidos por este trabalho (todos FORA do que o jogo carrega):

| o quê | onde |
|---|---|
| candidatos baixados (25 `.gltf`, 22 MB) | `assets/candidatos/quaternius_ultimate_monsters/` |
| folhas de aprovação (5 PNG) | `assets/candidatos/_folhas/` |
| página que gera as folhas | `tests/candidatos.html` |

As folhas: `classes.png`, `classes_sil.png`, `chefes.png`, `chefes_sil.png`, `fusao.png`.
Para regerar: subir o servidor estático (porta 8137) e abrir
`http://localhost:8137/tests/candidatos.html?folha=classes|chefes|fusao` (`&sil=1` = silhueta).

---

## 1. O diagnóstico, com números

| medida | valor |
|---|---|
| classes jogáveis | 6 |
| modelos distintos usados por elas | **5** (`barbarian`, `knight`, `mage`, `rogue`, `rogue_hooded`) |
| classes que dividem o MESMO modelo | `bruxo` e `invocador` — os dois são `mage` |
| esqueleto | o mesmo, **41 ossos**, nos cinco |
| altura natural dos cinco corpos | 3,311 · 3,436 · 3,364 · 3,309 · 3,373 — variação de **3,8 %** |
| chefe da Estufa hoje | `q_stag` — um **cervo** do Quaternius tingido de verde, 4,88 m |
| chefes com modelo de humanoide genérico | 3 dos 6 (dois esqueletos KayKit e um T-Rex repetido em dois chefes) |

Tradução: o elenco não tem seis corpos, tem **um corpo com seis fantasias**. A prova está em
`assets/candidatos/_folhas/classes_sil.png`, coluna "HOJE": seis manchas pretas quase idênticas.
Só o chapéu do bruxo se distingue — e ele é adereço, não corpo.

---

## 2. As três amarras técnicas (isto é o que decide, não a beleza)

Antes de propor qualquer coisa eu abri os `.glb`, contei ossos, comparei matrizes e listei clipes.
Toda afirmação abaixo é medida, não suposta.

### Amarra 1 — o banco ÚNICO de animações

`assets/embedded/models-anims.js` (1,90 MB) guarda **30 clipes** extraídos de
`Skeleton_Warrior.glb`. Ele serve os 9 humanoides KayKit porque os 9 têm o mesmo rig.
O carregador (`models3d_v2.js`, `M.load`) já sabe lidar com duas situações:

- modelo **sem** animação própria → usa o banco KayKit (`KAYKIT_ACTIONS`);
- modelo **com** animação própria → usa os clipes dele, mapeados por `autoActions()` (regex
  `/Idle$/`, `/Walk$/`, `/Attack$/`, `/Death$/`…). É assim que as 12 criaturas Quaternius já funcionam.

Ou seja: **um pacote novo que traga as próprias animações não precisa de retargeting.** Precisa,
no máximo, de um ajuste no `autoActions` se os nomes dos clipes fugirem do padrão.

Descoberta relevante e desagradável: os clipes KayKit têm trilhas de **translation (3893),
rotation (3895) E scale (3019)**. Isso significa que mexer na escala de um osso no bind é
sobrescrito pelo mixer a cada quadro. Para esculpir proporções é preciso um **passe por quadro,
depois de `mixer.update()`** — não é um ajuste de dados, é código. Custo estimado: ~40 linhas.

### Amarra 2 — os nomes de osso

`fusionLook()` enxerta a arma da classe convidada no osso literal `handslot.l`. E `M.unit`
guarda `handslot.r`, `handslot.l`, `head`, `chest`.

Rig KayKit (41 ossos): `root, hips, spine, chest, upperarm/lowerarm/wrist/hand/**handslot**.l|.r,
head, upperleg/lowerleg/foot/toes.l|.r` + 18 ossos de IK.
Rig Quaternius Ultimate Monsters (43 ossos): `Root, Body, Hips, Abdomen, Torso, Neck, Head,
Shoulder/UpperArm/LowerArm.L|.R`, 14 ossos de dedo, `UpperLeg/LowerLeg/Foot`, `PoleTarget`.

**Não existe `handslot` no Quaternius.** Também não existe `chest` (o equivalente é `Torso`) nem
`spine`. O enxerto precisaria de um mapa de nomes **e** de um deslocamento manual por modelo,
porque não há soquete de arma — a mão é osso de dedo.

### Amarra 3 — as peças separáveis

Cada personagem KayKit é um **guarda-roupa**, não uma malha fechada. Nomes reais dos nós:

- `Barbarian.glb` (13 peças): `1H_Axe_Offhand · Barbarian_Round_Shield · 1H_Axe · 2H_Axe · Mug ·
  Barbarian_Hat · Barbarian_Cape · Barbarian_ArmLeft · ArmRight · Body · Head · LegLeft · LegRight`
- `Knight.glb` (15): `1H_Sword_Offhand · Badge_Shield · Rectangle_Shield · Round_Shield ·
  Spike_Shield · 1H_Sword · 2H_Sword · Knight_Helmet · Knight_Cape · Arm/Body/Head/Leg…`
- `Mage.glb` (12): `Spellbook · Spellbook_open · 1H_Wand · 2H_Staff · Mage_Hat · Mage_Cape · …`
- `Rogue.glb` / `Rogue_Hooded.glb` (12): `Knife_Offhand · 1H_Crossbow · 2H_Crossbow · Knife ·
  Throwable · Rogue_Cape · … · Rogue_Head` / `Rogue_Head_Hooded`
- `Skeleton_*.glb` (9–10): inclui `Skeleton_Mage_Hat`, `Skeleton_Rogue_Hood`, `Skeleton_Rogue_Cape`,
  crânios e mandíbulas separados.

Armas, escudos, chapéus e capas são malhas **estáticas** penduradas em ossos → clonáveis para
qualquer esqueleto. Corpo, cabeça, braços e pernas são **skinned**.

Quaternius Ultimate Monsters: **1 ou 2 malhas por modelo**, corpo fechado. `Orc` tem
`Orc_Weapon` separado; `MushroomKing` tem o chapéu separado; o resto é peça única.

### **A descoberta que muda tudo**

Comparei a ordem das juntas e as `inverseBindMatrices` dos 9 humanoides KayKit, um contra um:

```
Knight        ossos_iguais=True  bind_igual=True
Mage          ossos_iguais=True  bind_igual=True
Rogue         ossos_iguais=True  bind_igual=True
Rogue_Hooded  ossos_iguais=True  bind_igual=True
Skeleton_Warrior / Minion / Mage / Rogue   ossos_iguais=True  bind_igual=True
```

Os nove não só compartilham o esqueleto: compartilham a **pose de bind byte a byte**. Isso
significa que **qualquer peça skinned de um monta no esqueleto do outro** — a cabeça do mago no
corpo do bárbaro, os braços do bárbaro no tronco do mago, o crânio do esqueleto em quem for.
O acervo que já está embutido é, na prática, um **criador de personagens de 9 corpos × 9 cabeças ×
9 pares de braços/pernas × ~30 adereços**, e ninguém tinha usado isso.

Está provado na folha `classes.png`, coluna "A": a Sacerdotisa tem corpo de Knight com cabeça e
braços de Mage; o Xamã tem corpo e braços de Barbarian sob a túnica do Mage.

---

## 3. O que existe em CC0 hoje (catálogos conferidos em 18/08/2026)

| acervo | licença lida na página | serve para |
|---|---|---|
| **KayKit — Adventurers 1.0** | CC0 1.0 (`LICENSE.txt` do pacote) | já embutido |
| **KayKit — Skeletons 1.0** | CC0 1.0 (`LICENSE.txt` do pacote) | já embutido |
| **KayKit — Character Animations** | CC0 1.0 | banco atual |
| KayKit — Mystery Monthly Series 4/5/6 | **PAGO, US$ 19,99 cada**; "Complete KayKit" US$ 150 | ❌ fora |
| **Quaternius — Ultimate Monsters** (50 modelos) | **CC0 1.0**, declarado na página do pacote e no FAQ ("attribution is not necessary… free to modify and redistribute") | chefes e monstros |
| Quaternius — Easy Enemies / Animals / Dinosaurs | CC0 1.0 | já embutido |
| Quaternius — Ultimate Modular Men / Women, Universal Base Characters | CC0 1.0 | corpos humanos, **sem variação de silhueta** |
| Kenney (Mini/Blocky Characters) | CC0 1.0 | corpos sem esqueleto → exigiria rigging do zero. ❌ |

**Conclusão do levantamento:** o KayKit **não tem mais nenhum humanoide CC0** além dos 9 que já
estão no jogo. Os corpos novos dele são todos pagos. Portanto **qualquer silhueta nova vinda de
fora do KayKit obrigatoriamente sai da convenção de rig da casa** — e cai nas amarras 2 e 3.

Baixei e abri 25 modelos do Ultimate Monsters para medir. Ele tem **três arquétipos de rig**,
não um só:

| grupo | ossos | clipes | quais |
|---|---|---|---|
| **Big** (bípedes) | 43 | **14**: Idle, Walk, Run, Jump, Jump_Idle, Jump_Land, Duck, Punch, Weapon, Wave, No, Yes, HitReact, Death | Yeti, Orc, Ninja, Tribal, Demon, BlueDemon, MushroomKing, Cactoro, Monkroose, Birb, Alien… |
| **Blob** (sem pernas) | 4 | **9**: Idle, Walk, Jump, Bite_Front, Dance, No, Yes, HitRecieve, Death | Wizard, Mushnub, GreenSpikyBlob… |
| **Flying** | 13–43 | **8**: Flying_Idle, Fast_Flying, Headbutt, Punch, No, Yes, HitReact, Death — **sem Walk** | Dragon, Squidle, Ghost, Goleling, Armabee, Glub, Hywirl… |

Dentro do grupo Big, os 43 ossos são idênticos entre modelos: **um banco só serve o grupo todo**.

---

## 4. As duas opções para as classes

### Opção A — remixar o KayKit e esculpir proporções

Seis corpos montados a partir do que já está embutido, com um passe de proporções por quadro.

| classe | corpo | peças trocadas / visíveis | proporção | altura na folha |
|---|---|---|---|---|
| `sumo` tanque | Barbarian | `Barbarian_Hat`, `Barbarian_Cape`, `2H_Axe` | tronco ×1,5 · braços ×1,5 · pernas ×0,72 · cabeça ×0,82 · geral ×1,26 | **3,00 m** |
| `arqueiro` atirador | Rogue_Hooded | `2H_Crossbow`, `Rogue_Cape` | tronco ×0,74 · pernas ×1,34 | 2,09 m |
| `bruxo` mago | Mage | `Mage_Hat`, `Mage_Cape`, `2H_Staff` | corpo ×0,84 · **cabeça ×1,34** (o chapéu cresce junto) | 3,23 m |
| `espadachim` assassino | Rogue | `Knife`, `Knife_Offhand` | tudo ×0,8 | **1,59 m** |
| `curandeiro` suporte | **Knight + cabeça e braços do Mage** | `1H_Sword`, `Badge_Shield`, `Knight_Cape` | tronco ×0,86 · pernas ×1,20 | 2,20 m |
| `invocador` invocador | **Mage + corpo, braços e capa do Barbarian** | `Spellbook_open`, `1H_Wand` | tronco ×1,62 · pernas ×0,70 · geral ×0,86 | 2,53 m |

Veredito das três amarras: **passa nas três por construção.** Mesmo rig, mesmo banco de 30 clipes,
`handslot.l/r` intactos, guarda-roupa completo para a fusão.

- **Bytes novos: zero.** Tudo já está embutido.
- **Trabalho:** passe de proporções (~40 linhas, chamado depois do `mixer.update`); reescrever
  `CLASS_LOOK` com um campo de peças trocadas; recalibrar retrato (`portraitFraming` mede cabeças)
  e `height`/`radius` de cada classe; reteste das 15 fusões.
- **Risco honesto:** continuam sendo bonecos da mesma família. As proporções resolvem porte e
  massa, não anatomia. Na folha de silhueta, `arqueiro` × `curandeiro` ainda é o par mais fraco —
  os dois são humanoides de altura média, e o que os separa é besta × escudo, ou seja adereço.
  Correção possível: dar à curandeiro o `Skeleton_Rogue_Hood` ou uma capa longa e ao arqueiro um
  perfil ainda mais alto; ou aceitar e diferenciar por cor.

### Opção B — trocar as classes para o Quaternius Ultimate Monsters

| classe | candidato 1 | candidato 2 |
|---|---|---|
| `sumo` tanque | **Yeti** — largo, curvado, braços enormes | **Orc** — pesado, com arma separada |
| `arqueiro` atirador | **Cactoro** — magro, espinhos, chapéu de aba larga | **Birb** — pernalta, bico |
| `bruxo` mago | **Wizard** — bola com chapéu mole, sem pernas | **Mushnub Evoluído** — cogumelo espinhoso |
| `espadachim` assassino | **Ninja** — compacto, espadas nas costas | **Alien** — esguio, tentáculos |
| `curandeiro` suporte | **Monkroose** — postura de símio, ombros baixos | **Ghost** — flutuante, sem pernas |
| `invocador` invocador | **Tribal** — cocar de penas, máscara, cajado | **Mushroom King** — chapéu de cogumelo e coroa |

Veredito das três amarras:

1. **Animação — passa com ressalva.** Traz clipes próprios; o carregador já aceita. Mas o
   `autoActions` procura `/Attack$/` e o Quaternius chama de `Punch`/`Weapon`/`Bite_Front` →
   precisa de ajuste. Pior: o jogo fala um vocabulário de 30 clipes que inclui `Spellcast_Shoot`,
   `Spellcast_Summon`, `Spellcast_Raise`, `Block`, `Dodge_Backward`, `Cheer`, `Taunt`, `Throw` e os
   ataques de duas mãos. **Nenhum desses existe no set de 14.** Todos cairiam no fallback
   `attack`/`idle`. Para monstros isso já é o normal hoje; para seis classes que lançam feitiço a
   cada turno, é um rebaixamento visível — e o FX3D sincroniza com `hitDelay`/`castCurve`.
2. **Ossos — REPROVA sem trabalho extra.** Sem `handslot`. Mapa de nomes + ~24 números de
   deslocamento de mão afinados a olho, 6 corpos × (posição, rotação, escala).
3. **Peças separáveis — REPROVA.** Corpo fechado. A fusão fica condenada a "corpo do anfitrião +
   nada", que é exatamente o que o usuário pediu para acabar. Salvação parcial: as peças do KayKit
   são estáticas e podem ser penduradas num osso Quaternius — dá para pôr o cajado e até o chapéu
   do mago na cabeça do Yeti, mas com posicionamento manual por modelo e sem garantia de escala.

- **Bytes:** os 6 corpos escolhidos somam **3,32 MB em `.glb` → 4,55 MB em base64**. Os heróis
  passariam de 3,98 MB para ~8,5 MB (ou ~5,2 MB se os corpos KayKit forem removidos — mas eles
  ainda são necessários para os adereços da fusão).
- **Estilo:** o Ultimate Monsters é mais redondo, olhão e fofo que o KayKit. Combina com o
  Quaternius que já está lá (as criaturas), mas destoa do **cenário**, que é KayKit Dungeon
  Remastered. Seis classes nesse estilo mudam o tom do jogo inteiro, não só do elenco.

---

## 5. Chefes — por tema de sala

Aqui o veredito é outro, porque **chefe não funde e não precisa de guarda-roupa**. Ele só precisa
de silhueta, porte e clipes próprios — e o carregador já aceita clipes próprios. Custo de
animação: **zero**. Custo de osso: **zero** (nada é enxertado num chefe).

| calabouço · tema | chefe | hoje | candidato 1 | candidato 2 |
|---|---|---|---|---|
| Estufa · `garden` | A Jardineira-Viúva | `q_stag` — **um cervo**, 4,88 m | **MushroomKing** — rei-cogumelo coroado, chapéu de 3 m | Cactoro |
| Cisterna · `cistern` | Baronesa Salmoura | `skeleton_mage`, 5,13 m | **Squidle** — lula de língua pendente | Glub_Evolved |
| Fecho de Brasa · `forge` | Magno, o Acendedor | `q_trex`, 3,83 m | **Demon** — demônio vermelho de chifres e forcado | BlueDemon |
| Andaimes · `scaffold` | Cambota, o Mestre-de-Obras | `skeleton_warrior`, 5,39 m | **Armabee_Evolved** — vespa gigante, asas abertas | Dragon |
| Mina Trêmula · `mine` | Batepedra | `q_triceratops`, 2,69 m — **menor que o tanque** | **Goleling_Evolved** — golem coroado de boca rasgada | Yeti |
| Coração Partido · `heart` | O Coração Partido | `q_trex` de novo, 4,28 m | **Dragon_Evolved** — dragão de asas e chifres | Ghost_Skull |

Peso: os 6 recomendados somam **2,80 MB em `.glb` → 3,84 MB em base64**. Se substituírem
`q_stag`, `q_trex`, `q_triceratops` (que só existem por causa dos chefes), o saldo fica próximo de
neutro. Orçamento atual embutido: 16,27 MB de 25 MB acordados.

Observação medida: `Squidle` e `Dragon` são **largos**, não altos. Normalizados a 3,30 m de
altura eles invadem as células vizinhas; na folha aparecem menores porque foram limitados pela
largura. No tabuleiro isso vira ocupação lateral — bonito para um chefe, mas exige conferir o
enquadramento da câmera de batalha.

---

## 6. A fusão — o pedido "dar característica das DUAS classes"

Hoje `fusionLook()` faz: corpo do anfitrião + escala 1,26 + tom misturado + **só a arma** do
convidado no `handslot.l`. Chapéu, capa e tudo mais do convidado se perdem.

A folha `fusao.png` mostra os dois lado a lado, mesma escala:

- **FUSÃO HOJE** — bárbaro careca segurando o cajado. 3,47 m.
- **FUSÃO PROPOSTA** — bárbaro **de chapéu de mago, capa de mago e cajado**, sobre o corpo
  esculpido do tanque. 4,01 m.

A segunda foi montada só com o que já existe: as peças do `Mage.glb` clonadas para os ossos
correspondentes do `Barbarian.glb`. **Nenhum asset novo, nenhuma animação nova.** É a prova de
que o pedido é realizável hoje — desde que o pacote das classes tenha peças separáveis, ou seja,
desde que a Opção A seja a escolhida.

Regra sugerida para a fusão (uma linha de conceito por peça):
`corpo + pernas do anfitrião · cabeça/adereço de cabeça do convidado · capa do convidado ·
arma-assinatura do convidado no punho livre · proporção = média das duas receitas`.

**Sobre a tabela `BULK`** (`sumo 5 · curandeiro 4 · invocador/bruxo 3 · arqueiro 2 · espadachim 1`):
ela decide quem é o corpo anfitrião. Se a Opção A entrar, as massas reais mudam — o `invocador`
passa a ser o segundo corpo mais largo (tronco ×1,62) e a `curandeiro` fica esguia. A tabela
precisa ser reordenada para `sumo 5 · invocador 4 · curandeiro 3 · bruxo 2,5 · arqueiro 2 ·
espadachim 1`, senão a fusão vai escolher como anfitrião um corpo que já não é o mais encorpado.
São 15 duplas para reconferir.

---

## 7. As seis juntas, e os nomes

**Coerência de estilo.** O cenário é KayKit Dungeon Remastered. A Opção A mantém elenco e cenário
do mesmo autor, com a mesma paleta e o mesmo tratamento de contorno — casa sem retoque. A Opção B
põe seis personagens Quaternius num cenário KayKit; funciona (as criaturas já convivem lá), mas o
elenco principal passa a ser o corpo estranho, e não o coadjuvante.

**Não misturar convenções entre classes.** Se a Opção B for escolhida, tem de ser para as seis.
Três classes com `handslot` e três sem seria a pior combinação possível: duas regras de enxerto,
dois bancos de animação e 15 fusões atravessando as duas.

**Nomes.** Os nomes de hoje foram trocados numa madrugada e estão marcados como reversíveis em
`docs/PLANO_NOITE.md`. Com a Opção A:

| classe | nome hoje | o modelo ainda sustenta? | sugestão |
|---|---|---|---|
| `sumo` | Bárbaro | sim — machado, capa, gorro de pele | manter |
| `arqueiro` | Batedor | sim — capuz fundo e besta, como o texto já diz | manter |
| `bruxo` | Bruxo | sim — chapéu pontudo | manter |
| `espadachim` | Ladino | sim — duas adagas | manter |
| `curandeiro` | **Paladina** | **não** — com cabeça e braços de mago sob a armadura, ela deixa de ler como paladina de placa | **Sacerdotisa** ou **Guardiã** |
| `invocador` | Xamã | sim — e melhora: com corpo e capa de pele fica xamã, não mago | manter |

Com a Opção B, os seis nomes caem: Yeti, Cactoro, Wizard, Ninja, Monkroose e Tribal não são
Bárbaro, Batedor, Bruxo, Ladino, Paladina e Xamã. Seria um renome completo do elenco.

---

## 8. Recomendação

**Recomendo o caminho misto, e ele resolve as quatro prioridades do usuário:**

1. **Classes → Opção A (remix KayKit + passe de proporções).** Passa nas três amarras, custa zero
   byte, mantém as 30 animações e as 15 fusões, e entrega característica física por classe: o
   tanque vira uma parede de 3,00 m contra um ladino de 1,59 m — quase o dobro. E acaba com o
   `bruxo`/`invocador` gêmeos: um é chapéu pontudo e corpo fino, o outro é corpo e capa de pele,
   baixo e largo, com o grimório aberto.
2. **Chefes e monstros → Quaternius Ultimate Monsters.** Custo de animação zero, custo de osso
   zero, +3,84 MB (com folga no orçamento), e o cervo verde da Estufa vira um rei-cogumelo.

**Alternativa, se o usuário olhar as folhas e disser que a Opção A ainda é o mesmo boneco:**
Opção B para as seis classes, assumida com o preço na mesa — +4,55 MB, mapa de ossos,
deslocamento de mão afinado modelo a modelo, perda do vocabulário de conjuração, fusão sem chapéu
nem capa (só arma), renome do elenco e mudança de tom do jogo. É defensável; só não é barata, e
não quero que pareça barata.

**Terceiro caminho, se houver orçamento de tempo em vez de dinheiro:** Opção A agora (é rápida e
não quebra nada) e, em paralelo, avaliar o Quaternius **Ultimate Modular Men/Women + Universal
Animation Library** — aquele acervo é modular (peças separáveis de verdade) e tem biblioteca de
animação própria e grande. Ele resolveria as amarras 1 e 3 num pacote só; falta confirmar se os
corpos aceitam a mesma variação de proporção. Não o avaliei a fundo aqui porque os corpos são
todos humanos e não entregam, sozinhos, a silhueta não-humana que o Ultimate Monsters entrega.

---

## 9. Como ler as folhas

- `classes.png` — 6 linhas (uma por classe) × 4 colunas: **HOJE**, **A · KayKit remixado**,
  **B · Quaternius**, **B · alternativa**. Mesma câmera, mesmo chão, régua de 1/2/3 m, altura real
  impressa embaixo.
- `classes_sil.png` — as mesmas 24 células em preto chapado sobre fundo claro. É o teste: se dá
  para dizer quem é quem só pela mancha, passa.
- `chefes.png` / `chefes_sil.png` — 6 linhas (uma por sala) × 4 colunas: **referência** (o tanque,
  para dar noção de porte), **CHEFE HOJE**, **candidato 1**, **candidato 2**.
- `fusao.png` — pai A, pai B, **FUSÃO HOJE**, **FUSÃO PROPOSTA**.

Nada disso está ligado ao jogo. `tests/candidatos.html` carrega `tests/save_sandbox.js` como
primeiro script e lê os candidatos de `assets/candidatos/`, pasta que nenhum arquivo do jogo
referencia.

## 10. Créditos e licenças dos candidatos baixados

| pacote | autor | licença | origem |
|---|---|---|---|
| Ultimate Monsters (25 dos 50 modelos) | Quaternius | **CC0 1.0** — declarada em `quaternius.com/packs/ultimatemonsters.html` e no FAQ; `License.txt` incluído no pacote | pasta pública do Google Drive ligada na página oficial |

Atribuição não é obrigatória. Creditamos assim mesmo, como já se faz em `docs/CREDITS_3D.md`.

---
---

# PARTE II — A DIREÇÃO "DOFUS": ESPÉCIES DIFERENTES, NÃO PROPORÇÕES DIFERENTES

**Status: EM PESQUISA (documento sendo escrito enquanto a investigação corre).**
Data: 2026-08-18, sessão da tarde. Nenhum arquivo do jogo foi alterado.

## II.0 O que mudou no pedido

Palavras do usuário: *"pense no Dofus.. os personagens são humanoides mas são classes
totalmente diferentes. cada um com uma característica. POR EXEMPLO: Sram é esqueleto,
Ecaflip é um gato humanoide, Cra um elfo."*

Isto **invalida a recomendação da Parte I**. A Opção A (remix do KayKit + passe de proporções)
entrega seis corpos com massas diferentes, mas todos continuam sendo **o mesmo humano de
cabeça grande**. O pedido agora é **espécie**: morto-vivo, felino, élfico, golem, demônio,
inseto, anfíbio, orc — todos bípedes, mesma família de estilo, mas criaturas distintas.

**A Opção A vira plano B.** O que segue é a busca por um elenco de espécies.

## II.1 Onde procurei, e o que a busca devolveu

Varri Poly Pizza, Sketchfab (filtro CC0/CC-BY + downloadable), OpenGameArt, itch.io,
Quaternius, Kenney, KayKit/Kay Lousberg, Mixamo e Blender Studio, com os termos pedidos
("low poly fantasy character pack", "stylized rpg races", "skeleton warrior low poly",
"cat humanoid", "orc goblin low poly", "elf archer low poly").

| fonte | o que tem | veredito |
|---|---|---|
| **Quaternius — Ultimate Monsters** (50 modelos) | **14 espécies bípedes no MESMO rig de 43 ossos**, 14 clipes cada | **é o único pacote coeso multiespécie CC0 que achei** |
| KayKit — Adventurers / Skeletons | 5 humanos + 4 esqueletos, rig da casa | já embutido; só 2 espécies (humano, morto-vivo) |
| KayKit — Mystery Monthly 4/5/6 | 14–15 personagens cada, prováveis não-humanos | **US$ 19,99 cada** → fora (o usuário não quer comprar) |
| Quaternius — Universal Base Characters + Modular Outfits + UAL | modular de verdade, animação enorme | **todos humanos**; resolve fusão, não resolve espécie |
| Quaternius — Cute Animated Monsters (21) | é a geração ANTERIOR dos mesmos bichos | redundante com Ultimate Monsters |
| Kenney — Blocky/Mini Characters | CC0, mas **sem esqueleto** | exigiria rigging do zero, reprovado |
| OpenGameArt — "LowPoly RPG Characters" (6) | CC0, riggados | são **classes humanas** (wizard/warrior/rogue/monk/ranger), não espécies; rigs avulsos |
| itch.io — LOWPO: Goblin Assets | CC0, 3 goblins riggados | **uma espécie só**, rigs avulsos, não fecha um elenco |
| Mixamo | tem não-humanos e retargeting automático | licença Adobe **não permite redistribuir o asset**; aqui os modelos vão embutidos em base64 no repositório, então está fora |
| Sketchfab CC0 avulsos | dá para achar gato, elfo, esqueleto | **cada um com rig próprio**, o que daria 6 bancos de animação e 15 fusões atravessando 6 convenções |

**Conclusão da busca:** não existe, em CC0/CC-BY, um "Dofus kit" com gato, elfo e esqueleto
prontos no mesmo rig. O que existe e chega perto é **um** pacote — e ele é bom.

### A licença, colada da fonte

`assets/candidatos/quaternius_ultimate_monsters/License.txt`, íntegra da parte que importa:

```
License:
CC0 1.0 Universal (CC0 1.0)
Public Domain Dedication
https://creativecommons.org/publicdomain/zero/1.0/
```

(o cabeçalho do arquivo diz "Ultimate Platformer Pack" — é um copiar-e-colar errado do
próprio autor; o pacote baixado é o Ultimate Monsters e a licença declarada é a mesma.)

`quaternius.com/faq.html`, verbatim:

> "Yes, these assets can be used for free without the need for attribution in commercial,
> educational, and personal projects."
> "All models are under the CC0 License."
> "No, attribution is not necessary. However, credit is always appreciated."
> "Yes, you are free to modify the models in any way you like, including combining them
> with other asset packs."

`poly.pizza`, na página do pacote e de cada modelo: **"Public Domain (CC0)"**, "free to use
in any project, even commercially".

CC0 é renúncia de direitos: permite uso comercial, modificação **e redistribuição**, que é o
que este repositório precisa (os modelos vão embutidos em base64 e versionados). Creditamos
mesmo assim em `docs/CREDITS_3D.md`.

---

## II.2 A descoberta: o pacote é coeso, e ninguém tinha medido

Baixei os 25 `.gltf` que já estavam aqui **mais 14 `.glb`** que faltavam (via poly.pizza,
mesma licença), abri os 39 e contei osso por osso. O Ultimate Monsters não é um saco de
modelos avulsos: são **quatro rigs**, e um deles é um elenco pronto.

| grupo | ossos | clipes | espécies |
|---|---|---|---|
| **BÍPEDE** | **43** | **14** | Yeti, Orc, Demon, BlueDemon, Cactoro, MushroomKing, Monkroose, Birb, Alien, Ninja, Tribal, **Frog**, **Dino** (+ Bunny, 49) |
| flutuante | 38 | 8 (sem Walk) | Ghost, Ghost_Skull, Hywirl, Squidle (43) |
| asa | 13 | 8 (sem Walk) | Dragon, Goleling, Armabee, Glub, Alpaking |
| blob | 4 | 9 | Wizard, Mushnub, Cat, slimes |

**As 13 espécies bípedes têm os MESMOS nomes de osso, na MESMA ordem — e quase a MESMA
pose de bind.** Medi a divergência máxima das `inverseBindMatrices`, uma contra a outra,
em modelos de ~3,5 unidades de altura:

```
referência: Yeti
Orc          0,0740      MushroomKing 0,0740      Monkroose 0,0130
Ninja        0,0858      Cactoro      0,0046      Birb      0,0182
Demon        0,0858      Tribal       0,0101      Alien     0,0055
BlueDemon    0,0879
```

Máximo **0,088 em 3,5** = **2,5 %**. Na prática: mesma pose de bind. Isso é o equivalente,
entre espécies, da descoberta da Parte I entre os KayKit — e é ela que destrava a fusão.

---

## II.3 As QUATRO amarras, medidas

### Amarra 1 — animação: PASSA

Um banco só serve as 13 espécies bípedes (o `AnimationMixer` casa por nome de osso, e os
nomes são idênticos). Custo: **um** banco novo de 14 clipes, extraído uma vez.

**Ressalva honesta:** são 14 clipes contra os 30 de hoje. Não existem `Spellcast_Shoot`,
`Spellcast_Summon`, `Spellcast_Raise`, `Block`, `Dodge_Backward`, `Cheer`, `Taunt`, `Throw`.
O que existe: Idle, Walk, Run, Jump, Jump_Idle, Jump_Land, Duck, Punch, Weapon, Wave, No,
Yes, HitReact, Death. Seis classes que conjuram todo turno cairiam em `Punch`/`Weapon`.
`autoActions()` precisa de um mapa novo (`Punch`→attack, `Weapon`→attack2, `HitReact`→hit).

### Amarra 2 — ossos de mão: PASSA COM AJUSTE

Não existe `handslot`. Existem, em todas as 13: `Shoulder.L/R`, `UpperArm.L/R`,
`LowerArm.L/R`, e os dedos `Index1-3.L/R`, `Middle1-3.L/R`, `Pinky1-3.L/R`, `Thumb1-2.L/R`.
Como os nomes são iguais nas 13, é **UM** mapa de nomes para o elenco inteiro, não seis.
`fusionLook()` trocaria `'handslot.l'` por `'LowerArm.L'`.

### Amarra 3 — peças separáveis: REPROVA NO PAPEL, PASSA NA PRÁTICA

Cada espécie é **uma malha fechada**. Só 4 das 14 têm peça própria: `Demon→Trident`,
`Orc→Orc_Weapon`, `MushroomKing→Mushroom`, `Bunny→Carrot` — e mesmo essas são **skinned**,
não estáticas: estão presas ao esqueleto, não penduradas num osso.

**A saída, e ela é código, não asset:** como a pose de bind é a mesma nas 13, dá para
**recortar a malha fechada por peso de osso**, em tempo de carga. Escrevi e rodei:
para cada vértice acho o osso dominante, classifico em cabeça/corpo, e reconstruo o índice
do triângulo. ~35 linhas. Isso transforma "malha fechada" em "guarda-roupa por região".
E as 4 peças skinned viajam entre espécies com um `bind()` no esqueleto do anfitrião —
também testado, também funciona, **porque a bind pose é a mesma**. (Está no render: na folha
`esp_fusao.png` o Iéti aparece segurando o tridente do Demônio.)

### Amarra 4 — a FUSÃO: PASSA, com uma receita específica

Testei os quatro caminhos, renderizados lado a lado em
`assets/candidatos/_folhas/esp_fusao.png`:

| caminho | resultado medido |
|---|---|
| **(b) só adereço** | **REPROVA.** 4 espécies de 14 têm peça. Nas outras 10 a fusão fica invisível: aparece o anfitrião e mais nada. |
| **(a') corpo + CABEÇA do convidado** | Funciona e é bonito — **mas o anfitrião PERDE a marca dele.** O Rei-Cogumelo sem o chapéu deixa de ser Rei-Cogumelo; o Tribal sem a máscara vira só um corpo pintado. Reprova o teste "quais duas classes formaram isto". |
| **(c') quimera sagital** (metade de cada, corte vertical) | Mostra as duas, mas **parte o corpo ao meio**. Radical demais para virar regra. |
| **(d') DUAS CABEÇAS** — anfitrião inteiro + cabeça do convidado ao lado da própria | **VENCEDOR.** Nenhuma marca se perde, vale para **as 15 duplas**, e lê como fusão à primeira vista. |

**A receita proposta:**
`corpo + cabeça + marca do ANFITRIÃO, intactos · CABEÇA do CONVIDADO no ombro ·
peça de assinatura do convidado no punho livre · cor da classe convidada como tinta`

### O teste cego

Renderizei as 15 fusões **sem rótulo** (`esp_quinze_sem.png`), olhei antes de ver o gabarito
e tentei nomear os dois pais. **Acertei 15 de 15.** Depois conferi contra `esp_quinze.png`.

**Ressalva sobre o meu próprio teste:** eu já conhecia as seis espécies, o que torna o teste
mais fácil para mim do que para quem vê pela primeira vez. Por isso a folha sem rótulo está
entregue: o teste que vale é o do usuário, não o meu.

Honestidade sobre as fracas: na primeira rodada, as 5 fusões que tinham o **Anfíbio como
convidado** (#3, #7, #10, #13, #14) ficaram ambíguas — o crânio do sapo é pequeno e pálido e
lia como um caroço. Não aceitei e voltei: normalizei o tamanho da cabeça convidada por um
fator por espécie (`Frog 1,30`) e subi a tinta de classe de 0,22 para 0,42. Na segunda
rodada as cinco passaram. **Isso é uma regra que fica:** a cabeça convidada precisa de um
fator de escala por espécie, senão espécies de crânio pequeno somem na fusão.

### E no TAMANHO DO TABULEIRO (`esp_tabuleiro.png`)

Medi o alvo em vez de chutar: `CELL = 2,0` e a trava de legibilidade é `26 px` por célula no
desktop (`renderer3d_v2.js`, `minCellPx`), com `tilt 0,98` — **um herói de ~4 m ocupa da
ordem de 40–55 px de tela.** A folha renderiza nesse tamanho.

O que eu vejo lá, sem enfeitar: **o CORPO se identifica pela cor e pela silhueta grossa; a
cabeça convidada vira uma mancha colorida.** A forma da cabeça (bico, chifre, chapéu) só
começa a ler no retrato e no close. Ou seja: **no tabuleiro quem carrega a identificação é a
PALETA da classe, e a forma confirma no retrato.** Isso vale para qualquer pacote, inclusive
para o plano B com chapéu KayKit — chapéu de 20 px também é mancha. É uma limitação do
tamanho na tela, não deste acervo, e é melhor dizer isso agora do que prometer o contrário.

---

## II.4 O elenco: seis espécies, uma por papel

Folhas: `esp_elenco.png` (colorida) e **`esp_elenco_sil.png` (silhueta)**.

| papel | classe | espécie | por quê | marca doável na fusão | alternativa |
|---|---|---|---|---|---|
| tanque | `sumo` Bárbaro | **Iéti** | mole de pelo, ombros o dobro da cabeça, braços que arrastam no chão: massa sem precisar de escala | cabeçorra peluda de chifres curtos | Orc (traz porrete próprio) |
| atirador | `arqueiro` Batedor | **Ave (Birb)** | pernalta, ereta, bico e crista: a única silhueta vertical e fina do elenco | bico comprido + crista | Cactoro (chapéu de aba larga) |
| mago | `bruxo` Bruxo | **Demônio** | chifres, asas curtas e **tridente em malha própria** — a única classe que doa arma de verdade | chifres + TRIDENTE | BlueDemon |
| assassino | `espadachim` Ladino | **Anfíbio (Frog)** | agachado, coxas de salto, o corpo mais baixo e compacto do elenco | crânio largo de olhos no topo | Ninja (mas é humano, o menos "espécie") |
| suporte | `curandeiro` Paladina | **Rei-Cogumelo** | o chapéu **é** o corpo; nenhuma outra silhueta se confunde com ela | chapéu de cogumelo + COGUMELO em malha própria | Monkroose (símio) |
| invocador | `invocador` Xamã | **Tribal mascarado** | máscara e cocar de penas: lê como quem chama coisa de fora | máscara + cocar | Alien (crânio grande, esguio) |

**Teste de silhueta (`esp_elenco_sil.png`): passa com folga.** Na coluna HOJE as seis manchas
são o mesmo boneco. Na coluna ESPÉCIE: macaco curvado, pernalta de bico, chifres e asas,
agachado de patas largas, cogumelo, cocar de penas. Dá para nomear as seis de olhos meio
fechados. Isso é exatamente o que a Parte I **não** conseguiu entregar.

**As seis marcas são únicas entre si** (chifre ≠ bico ≠ chapéu ≠ cocar ≠ crânio de sapo ≠
cabeça peluda) e **todas são silhueta**, não textura — que era a terceira condição.

### O que este elenco NÃO tem, e é justo dizer

O pedido citava Sram (esqueleto), Ecaflip (gato) e Cra (elfo). **O pacote não tem gato
bípede, não tem elfo, e o morto-vivo que ele tem (`Ghost_Skull`) está no rig flutuante de
38 ossos, com 8 clipes e SEM `Walk`** — não serve como classe jogável, serve como chefe.
O que o pacote entrega no lugar: iéti, orc, demônio, planta, fungo, ave, anfíbio, réptil,
símio, alienígena, lagomorfo. É outro baralho de espécies, com a mesma lógica.

---

## II.5 Chefes — agora com número, e uma má notícia sobre o presente

Folha: `esp_chefes.png`. A linha **vermelha** marca 4,70 m, a altura da dupla fundida
renderizada na folha (a fusão de hoje chega a 4,38 m). **Cuidado com esse número:** pela
receita `média das duas alturas × 1,26`, a dupla mais alta da proposta (tanque + invocador)
daria **4,88 m**. Então o piso seguro para um chefe é **4,9 m**, não 4,7. Nenhum veredito da
tabela abaixo muda com isso — os dois reprovados continuam reprovados e os aprovados
continuam acima de 5,2 m. Cada célula imprime altura, largura e um sinal de
aprovado/reprovado.

**Má notícia primeiro: metade dos chefes de HOJE já está abaixo da linha.**

| sala | chefe hoje | altura | passa? |
|---|---|---|---|
| Fecho de Brasa | `q_trex` | **3,83 m** | NÃO — menor que a fusão |
| Mina Trêmula | `q_triceratops` | **2,69 m** | NÃO — menor que o próprio tanque |
| Coração Partido | `q_trex` | **4,28 m** | NÃO |
| Estufa | `q_stag` (um cervo) | 4,88 m | sim (mas é um cervo) |
| Cisterna | `skeleton_mage` | 5,13 m | sim |
| Andaimes | `skeleton_warrior` | 5,39 m | sim |

**Segunda descoberta, contraintuitiva:** os "Evolved" do Ultimate Monsters são **largos, não
altos**. Medindo a caixa de bind:

| candidato | altura | largura | veredito |
|---|---|---|---|
| **Ghost_Skull** | **6,20 m** | 4,83 m | melhor número do lote |
| **Mushnub_Evolved** | **5,60 m** | 4,47 m | ótimo |
| **Goleling_Evolved** | 5,70 m | 9,73 m | alto, mas ocupa 3 células de lado |
| **Dino** | 5,50 m | 7,93 m | passa |
| **Alpaking_Evolved** | 5,40 m | 7,28 m | passa |
| **Glub_Evolved** | 5,30 m | 6,15 m | passa |
| GreenSpikyBlob | 5,20 m | 5,22 m | passa (mas rig de 4 ossos, sem Walk) |
| Dragon_Evolved | 6,00 m | **11,50 m** | espetacular e larguíssimo |
| Armabee_Evolved | 5,30 m | 10,67 m | largo |
| Hywirl | 5,20 m | 10,50 m | largo |
| **Squidle** | **4,68 m** | **12,89 m** | REPROVADO: não chega nem aos 4,7 e ocupa 6 células |
| **Dragon** | 4,53 m | 12,89 m | REPROVADO |

Todos os aprovados acima ficam em 5,2 m ou mais, ou seja, **passam também do piso real de
4,9 m**.

(As larguras são da pose de bind, com braços/asas abertos — é a mesma caixa que o jogo usa
em `visibleBodyBox`, então é a medida certa para comparar, mas superestima a pegada real na
pose de Idle.)

**Proposta de chefes:**

| calabouço · tema | chefe | candidato | altura/largura | por quê |
|---|---|---|---|---|
| Estufa · `garden` | A Jardineira-Viúva | **Mushnub_Evolved** | 5,60 / 4,47 | cogumelo gigante espinhoso; acaba com o cervo verde |
| Cisterna · `cistern` | Baronesa Salmoura | **Glub_Evolved** | 5,30 / 6,15 | peixe-anfíbio de bocarra |
| Fecho de Brasa · `forge` | Magno, o Acendedor | **BlueDemon** ampliado a 6,2 m | bípede, estreito | usa o rig bípede, então o banco já está pago. Alternativa espetacular: Dragon_Evolved, 6,00 m mas 11,5 m de largura |
| Andaimes · `scaffold` | Cambota, o Mestre-de-Obras | **Alpaking_Evolved** | 5,40 / 7,28 | criatura voadora, combina com o vento |
| Mina Trêmula · `mine` | Batepedra | **Goleling_Evolved** | 5,70 / 9,73 | golem coroado; hoje é um triceratops de 2,69 m |
| Coração Partido · `heart` | O Coração Partido | **Ghost_Skull** | **6,20 / 4,83** | caveira espectral; melhor razão altura/largura do acervo |

---

## II.6 O preço, em bytes — e ele é BEM menor do que a Parte I estimou

A Parte I disse "+4,55 MB para as classes". Estava errado, porque contava a animação
**seis vezes**. Medi acessor por acessor:

| | malha+rig | animação | com UM banco | em base64 |
|---|---|---|---|---|
| 6 classes | 1,33 MB | 0,67 MB (duplicada 6×) | **1,49 MB** | **1,98 MB** |
| 6 chefes | 1,01 MB | 0,31 MB | 1,14 MB | 1,52 MB |

(os `.gltf` baixados pesam ~1,2 MB cada em disco só por causa do base64 embutido + JSON;
o conteúdo binário de cada corpo é ~212 KB de malha e ~119 KB de animação.)

Orçamento embutido hoje: 16,27 MB de 25 MB. **Cabe com folga**, e se os 5 corpos KayKit de
herói saírem (3,98 MB — mas os esqueletos precisam ficar, os monstros os usam), o saldo é
negativo, ou seja, o jogo **encolhe**.

---

## II.7 O que se perde — a conta honesta

1. **O vocabulário de conjuração.** 14 clipes contra 30. `Spellcast_Shoot/Summon/Raise`,
   `Block`, `Dodge_Backward`, `Taunt`, `Throw` deixam de existir. Para seis classes que
   conjuram todo turno é rebaixamento visível, e o FX3D sincroniza com `hitDelay`/`castCurve`.
   Mitigação: `Punch` e `Weapon` são dois ataques distintos, `Duck` serve de esquiva e
   `Wave` serve de conjuração de suporte. Dá para cobrir ~6 dos 30 papéis. Não os 30.
2. **O tom.** O Ultimate Monsters é mais redondo, olhudo e fofo que o KayKit. O **cenário**
   é KayKit Dungeon Remastered. Seis classes nesse traço mudam o tom do jogo inteiro, não só
   do elenco. As criaturas Quaternius já convivem lá, mas como coadjuvantes.
3. **Os nomes.** Bárbaro, Batedor, Bruxo, Ladino, Paladina e Xamã não descrevem iéti, ave,
   demônio, sapo, cogumelo e mascarado. É renome do elenco inteiro.
4. **O trabalho de código**, que não é nenhum monstro mas não é zero:
   corte por peso de osso (~35 linhas), `bind()` de peça entre esqueletos (~25),
   `fusionLook` com cabeça convidada e fator por espécie (~40), mapa de `autoActions`
   novo (~15), banco de animação novo, recalibrar `height`/`radius`/`portraitFraming`,
   reteste das 15 fusões.
5. **A `BULK`.** Ela decide o anfitrião. Com as espécies as massas mudam:
   `sumo 5 · curandeiro 4 · invocador 3,5 · bruxo 3 · arqueiro 2 · espadachim 1` (é a que
   usei nas folhas). Sem reordenar, a fusão escolhe anfitrião errado.

---

## II.8 O dilema, posto na mesa

|  | **Parte II · espécies (Ultimate Monsters)** | **Parte I · Opção A (remix KayKit), agora PLANO B** |
|---|---|---|
| silhueta distinta por classe | seis bichos diferentes | seis proporções do mesmo humano |
| fusão identificável | 15/15 no teste cego, receita "duas cabeças" | 15/15, e mais natural: chapéu+capa+arma trocados |
| fusão no tamanho do tabuleiro | lê pela COR; a forma só no retrato | igual — chapéu de 20 px também é mancha |
| animação | 14 clipes (perde conjuração) | 30 clipes, os de hoje |
| ossos de mão | 1 mapa novo | `handslot` intacto |
| coerência com o cenário | muda o tom | mesmo autor, mesma paleta |
| bytes | +1,98 MB | 0 |
| nomes das classes | renome completo | 5 de 6 se mantêm |

**Recomendação:** ir de **espécies (Parte II)** para as classes, porque é literalmente o que
foi pedido e porque a fusão passou no teste — que era o risco real. O preço a pagar com os
olhos abertos é o vocabulário de animação e o tom. Se o usuário olhar as folhas e disser que
os bichos são fofos demais para o SOTERRA, o plano B continua de pé e custa zero.

**Para os chefes a recomendação é a mesma dos dois lados:** Ultimate Monsters, porque chefe
não funde, não precisa de guarda-roupa, e três dos seis chefes de hoje estão menores que uma
dupla fundida.

---

## II.9 Índice das folhas (`assets/candidatos/_folhas/`)

| arquivo | o que mostra |
|---|---|
| `esp_especies.png` / `_sil.png` | catálogo: 20 espécies do pacote, mesma escala, com o rig de cada |
| `esp_elenco.png` / `_sil.png` | 6 papéis × [HOJE · ESPÉCIE · alternativa]. **A folha de silhueta é o teste** |
| `esp_fusao.png` | 3 duplas × [pai A · pai B · só adereço · corpo+cabeça · DUAS CABEÇAS · quimera sagital] |
| `esp_quinze_sem.png` | **as 15 fusões SEM rótulo**, para o usuário fazer o teste cego |
| `esp_quinze.png` | as mesmas 15 COM rótulo — o gabarito |
| `esp_tabuleiro.png` / `_rot.png` | as 6 classes e as 15 fusões **no tamanho em que aparecem no jogo** |
| `esp_chefes.png` / `_sil.png` | 6 salas × [tanque · FUSÃO · chefe hoje · candidato 1 · candidato 2], com a linha de 4,70 m e altura/largura medidas |

Regerar: subir `python -m http.server 8137 --directory C:\Users\danie\Documents\Jogo` e abrir
`http://localhost:8137/tests/especies.html?folha=elenco|especies|fusao|quinze|tabuleiro|chefes`
(`&sil=1` = silhueta, `&rot=0` = sem rótulo, `&receita=duas|cabeca|sagital`).

Nada disso está ligado ao jogo. `tests/especies.html` carrega `tests/save_sandbox.js` como
primeiro script e lê de `assets/candidatos/`, pasta no `.gitignore` que nenhum arquivo do
jogo referencia. **Nenhum arquivo em `js/` foi tocado.**

## II.10 Créditos

| pacote | autor | licença | origem |
|---|---|---|---|
| Ultimate Monsters (39 dos 50 modelos baixados) | Quaternius | **CC0 1.0** — `License.txt` do pacote, página oficial e FAQ | Google Drive oficial (25 `.gltf`) + poly.pizza (14 `.glb`) |

Atribuição não é obrigatória sob CC0. Creditamos assim mesmo, como já se faz em
`docs/CREDITS_3D.md`.

---
---

# PARTE III — EFEITOS E CHEFES GRANDES

**Status: PESQUISA CONCLUÍDA nas duas frentes. Nada aplicado ao jogo.**
Data: 2026-08-18, sessão da noite. **Nenhum arquivo em `js/` foi tocado.**
Frente 1 (efeitos) na seção III.1; Frente 2 (chefes maiores) na III.2.
O elenco de personagens jogáveis está FECHADO (KayKit customizado) e não foi pesquisado.

## III.0 A régua que reprova

Palavras do usuário: *"os monstros, efeitos e personagens devem seguir o gráfico que temos
no jogo, para não ficar diferente."* Poder de veto.

Traduzido para critério verificável, o nosso gráfico é:

| eixo | o que o jogo é hoje |
|---|---|
| cor | **chapada**, vinda de um atlas-paleta; sem textura pintada, sem PBR |
| forma | silhueta grossa, contorno limpo, zero detalhe fino |
| proporção | chibi, cabeça grande |
| cenário | KayKit Dungeon Remastered |
| monstros | Quaternius (casa razoavelmente) |

Para EFEITO o critério é outro, e é o que o usuário deu: **NITIDEZ e SATURAÇÃO**.
Fumaça fotorrealista num jogo de cor chapada fica pior que partícula desenhada simples.

---

## III.1 FRENTE 1 — EFEITOS

### O que existe hoje, medido no código

`js/render3d/fx3d_v2.js` (807 linhas) gera **tudo por código**, sem um único arquivo de
imagem. São cinco técnicas:

| técnica | onde | textura |
|---|---|---|
| partículas | `THREE.Points`, pool de 2600, blend aditivo | **uma só**: `dotTexture()` |
| projéteis | esfera/cilindro emissivo (`projMesh`) | nenhuma |
| anéis de choque | `RingGeometry(0.86, 1.0, 40)` | nenhuma |
| decalques de chão | `PlaneGeometry` | **a mesma** `dotTexture()` |
| luz dinâmica | pool fixo de 6 `PointLight` | — |

E `dotTexture()` é, na íntegra, **um degradê radial branco de 64×64 pixels desenhado num
canvas** (linhas 62–75 do arquivo). Ou seja: **o jogo inteiro — 24 tipos de efeito × 5
elementos — é pintado com um borrão macio só.** Não há um único traço desenhado em lugar
nenhum da camada de efeitos.

Esse é o achado que orienta a frente toda. Não faltam efeitos — falta **desenho**.

### O acervo, com a licença colada da fonte

| pacote | conteúdo | licença |
|---|---|---|
| **Kenney — Particle Pack 1.1** | 80 PNG 512×512 (transparente + fundo preto + versões giradas) | CC0 |
| **Kenney — Smoke Particles** | 70 PNG, 5 famílias (fumaça preta, explosão, flash, puff branco, "fart") | CC0 |
| Kenney — Splat Pack | 30 PNG de respingo | CC0 |
| OpenGameArt — Magic Effect Particle System (HenriqueGibi) | 8 PNG, **16,8 MB** | CC-BY 4.0 |

`assets/candidatos/kenney_fx/particle-pack/License.txt`, verbatim:

```
	Particle Pack (1.1)

	by Kenney Vleugels (Kenney.nl)

	Additional credit for creating filter templates:
	Indigo Ray, Craig Nisbet, Zoltan Erdokovy, Heliagon, ThreeDee, Killst4r and Tim2501

			------------------------------

	License (Creative Commons Zero, CC0)
	http://creativecommons.org/publicdomain/zero/1.0/

	You may use these assets in personal and commercial projects.
	Credit (Kenney or www.kenney.nl) would be nice but is not mandatory.
```

`assets/candidatos/kenney_fx/smoke-particles/License.txt`, verbatim:

```
	Smoke particle pack by Kenney Vleugels (www.kenney.nl)

			------------------------------

			        License (CC0)
	       http://creativecommons.org/publicdomain/zero/1.0/

	You may use these graphics in personal and commercial projects.
	Credit (Kenney or www.kenney.nl) would be nice but is not mandatory.
```

CC0 é renúncia de direitos: uso comercial **e redistribuição** liberados, que é exatamente o
que este repositório precisa (vai tudo em base64, versionado, e o jogo abre por `file://`).
Créditos entram em `docs/CREDITS_3D.md` mesmo assim.

**Peso bruto baixado:** particle-pack 15 MB (o zip traz quatro cópias de cada sprite);
só a pasta `PNG (Transparent)`, que é a que importa, são **5,24 MB em 80 arquivos de
512×512**. Nada disso entra como está — ver "O preço" abaixo.

### O veredito de estilo, com as capturas na mão

**REPROVADO — Kenney Smoke Particles (os 70).** Folha `fx_kenney_smoke.png`. São puffs de
aerógrafo: borda difusa, sem silhueta, e com **cor assada dentro** (explosão laranja, puff
verde, flash amarelo), o que briga com a tinta elemental que o FX aplica por código. É
exatamente a "fumaça fotorrealista" que o critério manda recusar.

**REPROVADO — a família macia do Particle Pack:** `circle_05`, `light_01..03`, `flare_01`,
`star_01..05`, `smoke_01..10`, `fire_01/02`, `flame_01..04`, `spark_01..04/07`.
Motivo com número: **`circle_05` é literalmente o degradê radial que o `dotTexture()` já
desenha.** Metade do pacote não acrescenta nada, porque o jogo já tem essa metade de graça,
em doze linhas de canvas.

**APROVADO — a família de borda dura**, cerca de 30 dos 80: `magic_01/02/03`, `star_06..09`,
`slash_01..04`, `spark_05/06` (raios), `scratch_01` (três riscos), `flame_05/06`,
`muzzle_01..05`, `circle_01..04` (anéis), `twirl_01..03`, `trace_01..07`, `dirt_01..03`,
`scorch_01..03`, `symbol_02`. São **desenhos**, com contorno — a mesma língua de cor chapada
do KayKit.

### A descoberta que muda a recomendação

Renderizei cada candidato **dentro da Cisterna, sala 1**, ao lado dos heróis e dos monstros:
mesma câmera, mesmo quadro (t = 0,15 s), mesmo impacto de fogo, mudando **só a textura**.
Folha `fx_sala_tamanho.png`.

**No tamanho de partícula de HOJE (~14 px de tela), toda forma nítida vira cisco.**
A estrela de quatro pontas some; o anel do `magic_03` lê como um losango de 3 px; o
`slash_03` lê como um traço. Pior: o borrão macio de hoje é o que **mais brilha**, porque
cobre 19 % do quadrado contra 7,5 % da estrela — mais pixels acesos, mais luz.

Isso derruba a hipótese óbvia ("é só trocar o `dotTexture` por um sprite bonito"). Trocar a
textura sem mexer no tamanho **piora** o efeito.

**Com a partícula inflada 2,6× a conclusão inverte** (folha `fx_sala_particula.png`, que é a
folha que decide):

| sprite | veredito dentro da sala |
|---|---|
| HOJE (ponto radial) | brilha, mas é **borrão**: mancha laranja/branca sem forma |
| **`star_07`** | **melhor do lote.** Faíscas de quatro pontas, nítidas e saturadas; leem como magia desenhada |
| **`flame_05`** | línguas de chama apontando para cima — a melhor para `fogo` |
| `scratch_01` | riscos diagonais; ótimo para corpo-a-corpo |
| `magic_03` | vira padrão repetido de anéis; bonito parado, **repetitivo** em 26 cópias |
| `spark_06` | raio fino; serve para `chain`/`ar`, some no resto |
| `smoke_04` | pior que o de hoje. Confirma a reprovação da família macia |

### O achado maior: o desenho paga como PLACA, não como partícula

Folha `fx_sala_bilhete.png`. Plantei o mesmo PNG como **uma placa única de 3,6 m** (~250 px
de tela) no lugar do impacto, aditiva, tingida pela cor do elemento. Nessa escala o desenho
do Kenney não só lê: ele **pertence**. O anel rosa que aparece em todas as células é o anel
de choque que o jogo já desenha hoje — está lá de propósito, para comparar a língua.

| sprite como placa | serve para |
|---|---|
| `slash_03` / `slash_01` | corpo-a-corpo, golpe cortante |
| `magic_03` | conjurar, `summon`, `teleport`, `swap` |
| `muzzle_04` | sopro de fogo, `cast` de projétil |
| `twirl_01` | `push`, `pull`, `moveTo` |
| `star_09` | `detonateMarks`, clarão |
| `circle_02` | `nova`, `shield`, `root` — troca a `RingGeometry` de cor chapada por um anel desenhado |

Hoje os 24 tipos de efeito se distinguem por **cor e quantidade de partícula**, não por
forma. A placa desenhada dá a cada tipo uma **assinatura de silhueta** — que é o que falta.

### O preço, em bytes

Não entram 80 PNG de 512×512. A conta que fecha:

| plano | conteúdo | peso |
|---|---|---|
| mínimo | 1 atlas 512×512 com 16 sprites a 128 px | **~120–180 KB** → base64 ~160–240 KB |
| recomendado | 1 atlas 1024×1024 com 16 sprites a 256 px (placas) + 8 a 64 px (partículas) | **~400 KB** → base64 ~540 KB |

Orçamento embutido hoje: 16,27 MB de 25 MB. Cabe folgado. E como os sprites são **brancos
sobre transparente** (o FX já tinge por código, `col3(color)`), **um atlas serve os cinco
elementos** — não há custo por elemento.

### Recomendação da Frente 1

1. **Adotar o Kenney Particle Pack (CC0), só a família de borda dura** — cerca de 16 dos 80,
   reamostrados para 128/256 px e empacotados num atlas. Baixado em
   `assets/candidatos/kenney_fx/`, seleção em `.../sel/` (39 arquivos, 2,1 MB).
2. **A mudança de maior retorno não é a partícula: é a PLACA.** Um bilhete desenhado por tipo
   de efeito dá silhueta própria a cada um dos 24 — e é onde o traço do Kenney pertence.
3. **Se a partícula for trocada, o tamanho sobe junto** (~2,5×), senão o efeito piora. Está
   medido na folha `fx_sala_tamanho.png`.
4. **Reprovados:** Smoke Particles (70), a metade macia do Particle Pack, e o pacote da
   OpenGameArt (16,8 MB para 8 arquivos, pintado, CC-BY).

**Nota de engenharia, para quem for implementar:** reamostre o sprite para 128 px **antes**
de embutir. Deixar 512 px e confiar no mipmap faz a GPU escolher um nível borrado quando a
partícula tem 14 px de tela — o desenho nítido morre no caminho, e você paga 16× em bytes
pelo privilégio.


---

## III.2 FRENTE 2 — CHEFES MAIORES

**Status: CONCLUÍDA.** Folha: `assets/candidatos/_folhas/chefes_sala.png`.
Página: `tests/chefes_sala.html`.
Pedido do usuário: *"cada chefe precisa ser MAIOR que qualquer personagem,
incluindo a maior fusão."* Número que ele deu de cabeça: 4,38 m.

### A primeira coisa medida foi a régua, e ela estava torta

Antes de escolher modelo, é preciso saber contra o que se compara. Duas
armadilhas apareceram nos primeiros dez minutos, e as duas já tinham contaminado
números publicados neste documento.

**Armadilha 1 — a altura de um chefe NÃO vem do modelo.**
`js/render3d/models3d_v2.js`, linhas 948-951:

```js
var targetH = look.classId ? 2.05 : (look.pet ? 1.20 : (look.fusion ? 2.55 : 1.80));
if (opts.boss || look.boss) targetH = 2.95;
var natural = src.natural || 1.8;
var scale = (targetH / natural) * (look.scale || 1) * (opts.scale || 1);
```

Todo corpo é **normalizado** para uma altura-alvo do papel e só então
multiplicado por `look.scale`. Logo:

> **altura de chefe no jogo = 2,95 × `look.scale`, seja qual for o modelo.**

Trocar um T-Rex por um dragão não muda um milímetro de altura. O modelo decide
**silhueta e largura**; a altura é um número na tabela `MONSTER_LOOK`. Isso muda
a natureza do pedido: "chefes maiores" é, em primeiro lugar, uma linha de dados
— e só depois uma questão de acervo.

**Armadilha 2 — `THREE.Box3.setFromObject` não aplica skinning.**
Ele lê `geometry.boundingBox`, que está na **pose de bind** — o T-pose, de
braços abertos. Medir largura assim descreve um crucifixo, não uma criatura
parada. Conferido contra os `min`/`max` dos acessores dos próprios `.gltf`:

| modelo | caixa de bind (X × Y × Z) | leitura |
|---|---|---|
| `BlueDemon` | 4,63 × 2,84 × 2,16 | "mais largo que alto" — é o T-pose |
| `Yeti` | 4,65 × 2,83 × 1,47 | idem |
| `Ghost_Skull` | 5,50 × 3,10 × 1,53 | idem |

É daí que veio a frase da seção II.5, *"os Evolved são largos, não altos"*.
**Ela está errada** — mede a pose de bind, não a de Idle.

A medição correta recalcula cada vértice pelos ossos, com `boneTransform`,
depois que o mixer aplicou o clipe. E aqui mora uma terceira armadilha, esta de
biblioteca: **no three r147 `boneTransform(i, alvo)` lê a posição-base do
PRÓPRIO `alvo`**, não da geometria (só a partir do r151, renomeado para
`applyBoneTransform`, ele lê o atributo sozinho). Passar um vetor vazio devolve
**lixo finito** — números plausíveis, sem NaN, e completamente errados. O
vértice tem de ser carregado antes da chamada.

**Armadilha 4 — `mixer.update()` sem ação tocando não põe o corpo em pose de
parado.** Sem `play('idle')` os ossos ficam na pose de REPOUSO do arquivo, que
não é nem a de bind nem a de Idle. O `q_triceratops` mede 3,84 m numa e 1,81 m
na outra.

A página que faz tudo isso é `tests/chefes_sala.html?modo=medida`.

### O teto a bater, medido (e ele não é 4,38 m)

O número 4,38 m veio de `docs/AUDITORIA_FUSAO.md` §4, e naquele momento estava
certo — era `userData.height` da fusão mais alta de então. Duas coisas
aconteceram desde:

1. O commit `dc7b470` ("Fusao troca de modelo") uniformizou as fusões: hoje as
   **15 medem 3,21 m de corpo**, não mais quatro valores distintos.
2. `userData.height` sai de `visibleBodyBox()`, que soma **só malha skinned** —
   ou seja, ignora chapéu, machado, capa, cajado e escudo, que são malhas
   simples penduradas nos ossos. É o *corpo*, não a *figura*.

O olho compara a figura. Medindo a figura inteira, na pose de parado:

| corpo | corpo (skinned) | **figura inteira** | largura | modelo |
|---|---|---|---|---|
| `sumo` Bárbaro | 2,38 | **2,91** | 2,09 | barbarian + machado |
| `bruxo` | 2,09 | 2,82 | 2,55 | mage + cajado |
| `arqueiro` | 2,05 | 2,41 | 1,65 | rogue_hooded |
| `invocador` | 2,05 | 2,02 | 1,45 | mage |
| `curandeiro` | 2,05 | 2,02 | 1,89 | knight |
| `espadachim` | 1,99 | 1,96 | 1,44 | rogue |

E as 15 fusões — **todas com 3,21 m de corpo**, e figura entre 3,16 e 5,78 m:

| dupla | figura | largura | dupla | figura | largura |
|---|---|---|---|---|---|
| **sumo + bruxo** | **5,78** | **5,73** | bruxo + curandeiro | 4,12 | 3,97 |
| sumo + curandeiro | 4,87 | 3,49 | sumo + espadachim | 3,94 | 2,83 |
| sumo + arqueiro | 4,71 | 3,85 | sumo + invocador | 3,94 | 2,83 |
| arqueiro + bruxo | 4,33 | 3,92 | arqueiro + espadachim | 3,78 | 2,83 |
| bruxo + espadachim | 4,33 | 3,92 | arqueiro + curandeiro | 3,17 | 2,97 |
| bruxo + invocador | 4,33 | 3,92 | espadachim + curandeiro | 3,17 | 2,97 |
| espadachim + invocador | 4,33 | 3,92 | curandeiro + invocador | 3,17 | 2,97 |
| | | | arqueiro + invocador | 3,16 | 2,71 |

> **TETO DE PERSONAGEM = 5,78 m** — a fusão Bárbaro + Bruxo.
> Não 4,38 m. O piso para um chefe é **maior do que o usuário supunha**.

**Achado colateral, e ele é um defeito:** essa mesma dupla tem **5,73 m de
largura**, quase três células. O enxerto que a fusão faz põe o `2H_Staff` do
Bruxo no osso `handslotl` do Bárbaro, e o cajado sai **atravessado**, não
empunhado. É ele que produz tanto o 5,78 m de altura quanto os 5,73 m de
largura. Duas leituras possíveis, e as duas pedem decisão do usuário:

- se o cajado atravessado for **defeito** (é o que os números sugerem), corrigir
  o enxerto derruba o teto para **4,87 m** (sumo + curandeiro) e os chefes ficam
  bem mais baratos de dimensionar;
- se ficar como está, **todo chefe precisa passar de 5,78 m**.

Esta seção dimensiona os chefes pelo caso pessimista — 5,78 m — porque é o que
está no jogo hoje.

### Os chefes de hoje, medidos: **os seis reprovam**

| sala | chefe | modelo × escala | figura | largura | células | veredito |
|---|---|---|---|---|---|---|
| Andaimes | `boss-windwright` | skeleton_warrior ×1,55 | 4,50 | 2,79 | 1,4 | abaixo do teto |
| Estufa | `boss-gardener` | q_stag ×1,25 | 4,87 | 4,27 | 2,1 | abaixo do teto |
| Cisterna | `boss-baroness` | skeleton_mage ×1,45 | 4,21 | 2,58 | 1,3 | abaixo do teto |
| Coração | `boss-riftheart` | q_trex ×1,45 | 4,20 | **8,83** | **4,4** | abaixo, e ocupa 4 células |
| Fecho | `boss-heartforge` | q_trex ×1,30 | 3,77 | **7,92** | **4,0** | abaixo, e ocupa 4 células |
| Mina | `boss-deepknock` | q_triceratops ×1,30 | **1,81** | 4,30 | 2,2 | **mais baixo que o Bárbaro** |

O `boss-deepknock` é o caso extremo: `userData.height` diz 3,84 m — é o número
que a auditoria anterior publicou —, mas a figura de pé mede **1,81 m**. Um
triceratops é comprido e baixo; normalizar pela *altura* de um corpo assim não
faz o bicho crescer, faz ele esticar. Ele é hoje **mais baixo que o Bárbaro sem
fusão** (2,91 m) e cabe debaixo dele.

### Os candidatos, medidos na pose de parado

Pedindo 5,30 m de altura a cada um (`look.scale` 1,80), o que acontece com a
pegada. `natural` é a altura de bind, que é o divisor que o jogo usa; `altura` é
a figura real, e ela **não bate com o pedido** justamente porque o jogo divide
pela bind e a pose muda tudo.

| candidato | natural | altura real | largura X | largura Z | células | `k` = altura/pedido |
|---|---|---|---|---|---|---|
| `Ghost_Skull` | 3,10 | 5,35 | 4,75 | 3,58 | **2,4** | 1,01 |
| `Mushnub_Evolved` | 4,41 | 5,33 | 4,10 | 4,23 | **2,1** | 1,01 |
| `Glub_Evolved` | 3,71 | 5,33 | 4,95 | 1,81 | **2,5** | 1,01 |
| `Dino` | 3,23 | 5,10 | 5,08 | 3,17 | 2,5 | 0,96 |
| `Hywirl` | 2,74 | 5,47 | 5,37 | 4,29 | 2,7 | 1,03 |
| `GreenSpikyBlob` | 4,14 | 5,36 | 4,48 | 5,32 | 2,7 | 1,01 |
| `BlueDemon` | 2,84 | 5,06 | 5,63 | 3,66 | 2,8 | 0,96 |
| `Alpaking_Evolved` | 3,19 | 5,31 | 5,68 | 4,94 | 2,8 | 1,00 |
| `Dragon_Evolved` | 2,86 | 5,40 | 6,95 | 4,17 | 3,5 | 1,02 |
| `Goleling_Evolved` | 2,57 | 6,43 | 7,62 | 3,75 | 3,8 | 1,21 |
| `Armabee_Evolved` | 2,14 | 5,56 | 8,58 | 3,84 | 4,3 | 1,05 |
| `Squidle` | 1,99 | 6,89 | 9,85 | 6,10 | 4,9 | 1,30 |
| `Dragon` | 1,54 | 8,25 | 12,54 | 7,19 | **6,3** | 1,56 |

Fórmula para quem for implementar: **`look.scale` = altura desejada ÷ (2,95 × k)**,
com o `k` da última coluna.

**A seção II.5 estava errada em dois pontos, e agora dá para dizer por quê.**
Ela reprovou `Squidle` e `Dragon` por serem *baixos* (4,68 e 4,53 m) e aprovou os
outros por serem *altos*. Medindo a pose de verdade: `Squidle` e `Dragon` são os
**mais altos** do lote (k de 1,30 e 1,56 — eles empinam no `Flying_Idle`), e
continuam reprovados, mas por **largura**: 4,9 e 6,3 células. E `Ghost_Skull`,
que a II.5 dizia ter 4,83 m de largura, é na verdade **o mais estreito de
todos**, com 2,4 células.

### O defeito que a folha revelou: o chapéu da fusão

`assets/candidatos/_folhas/chefes_sala.png`, primeira e quarta tiras. A figura
rotulada *FUSÃO mais alta* não parece um herói fundido: é **um chapéu de mago
gigante flutuando sobre um bárbaro**. Medindo peça por peça
(`tests/chefes_sala.html?modo=medida&parte=graft`):

| peça enxertada | no corpo do Bárbaro | nos outros corpos |
|---|---|---|
| `Mage_Hat` | **5,73 m de largura**, topo a 5,01 m | 3,28–3,45 m |
| `Knight_Helmet` | **3,12 m de largura**, topo a 4,09 m | — |
| `2H_Crossbow` | 3,39 m, topo a 3,93 m | 1,81–1,91 m |

O chapéu é **mais largo do que o corpo que o carrega é alto** (5,73 contra
3,94 m), e um elmo de 3,12 m de largura não é um elmo.

**A causa está localizada.** `models3d_v2.js` linha 859: o enxerto faz
`bone.add(g2)` copiando a pose local que a peça tinha no dono original, mas a
peça passa a herdar a **escala acumulada da cadeia de ossos do anfitrião**. No
Bárbaro essa cadeia foi inflada de propósito pelo `build`
(`chest 1,42 · ombro 1,34 · braço 1,38`), e ninguém desfaz isso na peça. Daí o
fator ~1,75× que aparece em **todas** as peças que caem no corpo do Bárbaro, e
só nele.

Isso não foi corrigido — o pedido era pesquisa, não implementação. Mas ele
muda o número que os chefes têm de bater, então está medido dos dois jeitos.

### A folha: `assets/candidatos/_folhas/chefes_sala.png`

Seis tiras, uma por sala, **renderizadas dentro da sala de verdade**: chão,
paredes, props, luz, névoa e clima do jogo. Em cada tira, na mesma célula-a-
célula e com a mesma câmera:

`HERÓI mais alto (Bárbaro) · FUSÃO mais alta · CHEFE DE HOJE · CANDIDATO 1 · CANDIDATO 2`

A linha vermelha tracejada é o **teto de personagem (5,78 m)**, traçada em
espaço de mundo e projetada — é altura de verdade, não enfeite. Cada figura leva
sob os pés a altura medida e o veredito.

Duas ressalvas de leitura honestas:

1. A câmera foi virada para **azimute 0** (de frente), não para os 45° do jogo.
   Nos 45° a fileira foge para o fundo e a perspectiva encolhe as figuras do
   fim — o quadro deixaria de ser régua. Sala, luz e cenário continuam os do
   jogo.
2. **Não compare o tamanho aparente entre tiras diferentes.** A distância de
   câmera é limitada pelo tamanho de cada sala, então as tiras não estão na
   mesma escala de tela. Dentro de cada tira, sim — e é lá que a linha vermelha
   e os números valem.

Para regerar: subir o servidor na porta 8137 e abrir
`http://localhost:8137/tests/chefes_sala.html?modo=sala&chefe=0..5&limpo=1`
(sem `chefe=` ele monta as seis de uma vez; `&modo=medida` dá a tabela de
números; `&alvo=6.6` muda a altura pedida aos candidatos).

### O veredito de estilo, com as capturas na mão

**APROVADOS.** As seis criaturas do Ultimate Monsters **pertencem** à sala. Isso
não era óbvio no fundo neutro da folha `esp_chefes.png` e é o achado visual da
frente: cor chapada de atlas, silhueta grossa, zero detalhe fino, proporção
cabeçuda — a mesma língua do KayKit Dungeon Remastered. Na tira do Fecho de
Brasa o `Dragon_Evolved` laranja e o `BlueDemon` azul-petróleo lêem como se
tivessem sido feitos para aquele chão hexagonal.

**REPROVADOS por FORMA, não por licença nem por estilo — e são os de hoje:**

- `boss-deepknock` (`q_triceratops`): 1,81 m de figura. Na tira da Mina ele é
  **uma manchinha verde menor que o Bárbaro**. Um chefe que some ao lado de um
  herói não é um chefe.
- `boss-heartforge` e `boss-riftheart` (`q_trex`, o mesmo modelo duas vezes):
  3,77 e 4,20 m de altura para **7,92 e 8,83 m de comprimento** — quatro células
  deitadas. Na tira do Fecho o T-Rex lê como um bicho *atravessado no chão*, não
  como um adversário de frente.
- `boss-gardener` (`q_stag`): um cervo pálido, quase invisível contra a estufa
  verde. O problema aqui é de leitura, não de porte.

**Nota de largura, que é o custo escondido.** `Squidle` (6,89 m, 4,9 células) e
`Dragon` (8,25 m, 6,3 células) são os mais altos do acervo e continuam
reprovados — por pegada. E existe um agravante no código: `models3d_v2.js`
limita o raio lógico a `Math.min(1.2, …)`, meia célula. Um chefe de 4 células
visuais com raio lógico de meia célula **mente para o jogador** sobre onde ele
está. Isso já acontece hoje com os dois T-Rex.

### A recomendação da Frente 2, em dois passos

**Passo 1 — o que custa ZERO byte e é obrigatório de qualquer jeito: subir a
escala.** Como `altura = 2,95 × look.scale`, os chefes de hoje já poderiam
crescer trocando um número. É o passo barato, e ele resolve metade do pedido.

**Passo 2 — trocar os quatro modelos cuja FORMA não lê como chefe.** Escala não
conserta um triceratops deitado nem um cervo pálido.

Os seis escolhidos (seção II.5), com o número que falta: quanto tem de valer
`look.scale` e quanto o chefe passa a ocupar. Duas colunas, porque o teto
depende de o enxerto ser corrigido ou não:

| sala | chefe | modelo | **se o enxerto for corrigido**: alvo 5,20 m | **se ficar como está**: alvo 6,60 m |
|---|---|---|---|---|
| Estufa | A Jardineira-Viúva | `Mushnub_Evolved` | `scale` **1,75** · 2,1 células | `scale` **2,22** · 2,6 células |
| Cisterna | Baronesa Salmoura | `Glub_Evolved` | `scale` **1,75** · 2,4 células | `scale` **2,22** · 3,1 células |
| Fecho de Brasa | Magno, o Acendedor | `BlueDemon` | `scale` **1,85** · 2,9 células | `scale` **2,34** · 3,7 células |
| Andaimes | Cambota | `Alpaking_Evolved` | `scale` **1,76** · 2,8 células | `scale` **2,23** · 3,5 células |
| Mina Trêmula | Batepedra | `Goleling_Evolved` | `scale` **1,45** · 3,1 células | `scale` **1,84** · 3,9 células |
| Coração Partido | O Coração Partido | `Ghost_Skull` | `scale` **1,75** · 2,3 células | `scale` **2,22** · 2,9 células |

(Hoje a maior escala de chefe é 1,55. A fórmula é `look.scale = altura ÷ (2,95 × k)`,
com o `k` da tabela de candidatos.)

**Recomendação:** **corrigir o enxerto primeiro e mirar 5,20 m.** Motivo com
número: no cenário de 6,60 m, quatro dos seis chefes passam de **3,5 células de
largura**, e o raio lógico continua travado em meia célula. Pagar 6,60 m de
altura para acomodar um chapéu que está grande por defeito é caro do lado
errado.

**Alternativas espetaculares, se o usuário topar a pegada:** `Dragon_Evolved`
no Fecho de Brasa (3,5 células) e `Squidle` na Cisterna (4,9 células). As duas
são as figuras mais impressionantes da folha; as duas custam largura.

### O preço, em bytes

| | conteúdo binário | em base64 |
|---|---|---|
| 6 chefes novos (só o buffer de malha+anim) | **1,33 MB** | **1,77 MB** |
| atlas de textura, compartilhado pelos seis | 9 KB | 12 KB |

Orçamento embutido hoje: 16,27 MB de 25 MB. Se `q_stag`, `q_trex` e
`q_triceratops` saírem junto (existem no acervo por causa dos chefes), o saldo
fica próximo de neutro.

### Licença

| pacote | autor | licença | onde está colada |
|---|---|---|---|
| Ultimate Monsters | Quaternius | **CC0 1.0** | `assets/candidatos/quaternius_ultimate_monsters/License.txt`, e a íntegra já transcrita na seção II.1 deste documento |

CC0 permite uso comercial, modificação **e redistribuição** — que é o que este
repositório exige, já que tudo vai embutido em base64 e versionado. Atribuição
não é obrigatória; entra em `docs/CREDITS_3D.md` mesmo assim.

### O que NÃO foi feito

Nada em `js/` foi tocado. Nenhum modelo entrou em `assets/embedded/`. Os
candidatos continuam em `assets/candidatos/`, pasta no `.gitignore` que nenhum
arquivo do jogo referencia. `tests/chefes_sala.html` carrega
`tests/save_sandbox.js` como primeiro script.

**Decisões que dependem do usuário, e ele precisa das duas:**

1. O chapéu da fusão é defeito (corrigir, teto cai para ~4,9 m) ou é assim
   mesmo (teto 5,78 m, chefes de 6,60 m)?
2. Largura: aceita chefes de 3 a 4 células, ou o teto de pegada é 2,5?
