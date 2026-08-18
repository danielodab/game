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
| `curandeira` suporte | **Knight + cabeça e braços do Mage** | `1H_Sword`, `Badge_Shield`, `Knight_Cape` | tronco ×0,86 · pernas ×1,20 | 2,20 m |
| `invocador` invocador | **Mage + corpo, braços e capa do Barbarian** | `Spellbook_open`, `1H_Wand` | tronco ×1,62 · pernas ×0,70 · geral ×0,86 | 2,53 m |

Veredito das três amarras: **passa nas três por construção.** Mesmo rig, mesmo banco de 30 clipes,
`handslot.l/r` intactos, guarda-roupa completo para a fusão.

- **Bytes novos: zero.** Tudo já está embutido.
- **Trabalho:** passe de proporções (~40 linhas, chamado depois do `mixer.update`); reescrever
  `CLASS_LOOK` com um campo de peças trocadas; recalibrar retrato (`portraitFraming` mede cabeças)
  e `height`/`radius` de cada classe; reteste das 15 fusões.
- **Risco honesto:** continuam sendo bonecos da mesma família. As proporções resolvem porte e
  massa, não anatomia. Na folha de silhueta, `arqueiro` × `curandeira` ainda é o par mais fraco —
  os dois são humanoides de altura média, e o que os separa é besta × escudo, ou seja adereço.
  Correção possível: dar à curandeira o `Skeleton_Rogue_Hood` ou uma capa longa e ao arqueiro um
  perfil ainda mais alto; ou aceitar e diferenciar por cor.

### Opção B — trocar as classes para o Quaternius Ultimate Monsters

| classe | candidato 1 | candidato 2 |
|---|---|---|
| `sumo` tanque | **Yeti** — largo, curvado, braços enormes | **Orc** — pesado, com arma separada |
| `arqueiro` atirador | **Cactoro** — magro, espinhos, chapéu de aba larga | **Birb** — pernalta, bico |
| `bruxo` mago | **Wizard** — bola com chapéu mole, sem pernas | **Mushnub Evoluído** — cogumelo espinhoso |
| `espadachim` assassino | **Ninja** — compacto, espadas nas costas | **Alien** — esguio, tentáculos |
| `curandeira` suporte | **Monkroose** — postura de símio, ombros baixos | **Ghost** — flutuante, sem pernas |
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

**Sobre a tabela `BULK`** (`sumo 5 · curandeira 4 · invocador/bruxo 3 · arqueiro 2 · espadachim 1`):
ela decide quem é o corpo anfitrião. Se a Opção A entrar, as massas reais mudam — o `invocador`
passa a ser o segundo corpo mais largo (tronco ×1,62) e a `curandeira` fica esguia. A tabela
precisa ser reordenada para `sumo 5 · invocador 4 · curandeira 3 · bruxo 2,5 · arqueiro 2 ·
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
| `curandeira` | **Paladina** | **não** — com cabeça e braços de mago sob a armadura, ela deixa de ler como paladina de placa | **Sacerdotisa** ou **Guardiã** |
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
