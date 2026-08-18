# PESQUISA — modelos 3D com proporção ADULTA (não chibi)

**Status: PESQUISA. Nenhum arquivo do jogo foi alterado. `js/` não foi tocado.**
Data: 2026-08-18.

Este documento responde ao pedido: *"quero uns personagens mais humanoides que
esses… esses parecem de jogo de criança"*. O critério central é **proporção
medida em cabeças de altura**, não gosto pessoal.

> Documento separado, de propósito. `docs/PROPOSTA_MODELOS.md` é de outro
> trabalho (remix do acervo KayKit atual) e não foi modificado aqui. Onde os dois
> se cruzam, este aqui aponta a diferença em vez de repetir.

---

## 0. Como as medidas foram feitas (para poder conferir)

Ninguém aqui estimou proporção "no olho". Foi escrito um medidor que abre o
`.glb`/`.gltf`, resolve a hierarquia de nós até a matriz de mundo, lê o
`min`/`max` do accessor de `POSITION` de cada malha e calcula:

- **altura do corpo** = extensão em Y das malhas de corpo (chapéu, capa, arma e
  escudo são excluídos por nome — senão o chapéu do mago falsifica a altura);
- **cabeças de altura** = altura do corpo ÷ altura da cabeça, onde a altura da
  cabeça é `topo do crânio − Y do osso de pescoço` (`neck`/`neck_01`). Quando a
  cabeça é uma malha separada — caso do KayKit — a bbox dela dá uma segunda
  medida independente, e as duas batem.

O script está em
`…/scratchpad/medecabeca.py` (fora do repositório; é ferramenta de análise, não
do jogo). Rodar: `python medecabeca.py caminho/modelo.glb`.

**Régua de referência:** anatomia adulta real ≈ **7,5 cabeças**. Herói de
quadrinho/"heroico" ≈ **8**. Estilizado adulto de jogo ≈ **6 a 7**. Chibi ≈ 3 a 4.

---

## 1. A linha de base — quanto é chibi o que está no jogo hoje

Medido nos `.glb` originais em `assets/models/`:

| modelo (KayKit) | altura | triângulos | ossos | clipes | **cabeças (por malha)** | **cabeças (por osso)** |
|---|---|---|---|---|---|---|
| `Barbarian.glb` | 2,186 | 6 543 | 42 | 76 | **2,08** | 2,31 |
| `Knight.glb` | 2,315 | 6 952 | 42 | 76 | **2,11** | 2,16 |
| `Mage.glb` | 2,203 | 5 683 | 42 | 76 | **1,94** | 2,29 |
| `Rogue.glb` | 2,187 | 6 377 | 42 | 76 | **2,14** | 2,31 |
| `Rogue_Hooded.glb` | — | 6 035 | 42 | 76 | (capuz atrapalha) | — |
| `Skeleton_Warrior.glb` | 2,166 | 5 934 | 42 | 95 | **2,51** | 2,34 |
| `Skeleton_Rogue.glb` | 2,166 | 5 278 | 42 | 95 | 2,55 | 2,34 |
| `Skeleton_Minion.glb` | 2,166 | 5 288 | 42 | 95 | 2,54 | 2,34 |
| `Skeleton_Mage.glb` | 2,166 | 4 588 | 42 | 95 | — | 2,34 |

**O número que importa: ~2,1 cabeças.** Isso não é só "chibi", é o extremo do
chibi — mais baixo que a maioria dos bonecos chibi, que costumam ficar em 3 a 4.
A cabeça vale **quase metade** do corpo, exatamente como o usuário descreveu.

Isso também **confirma por medida** por que escalar osso não resolveu: para sair
de 2,1 para 7 cabeças a cabeça teria de encolher para **30 % da altura atual**.
Uma esfera com 30 % da altura sobre ombros modelados para receber uma esfera 3×
maior não vira anatomia adulta — vira uma bolinha sobre um barril. A malha é que
está chibi, e escala não remodela silhueta.

---

## 2. Candidato 1 — **Quaternius: sistema "Universal"** ⭐ recomendado

Não é um pacote, são três que compartilham o mesmo esqueleto. **Já estão
baixados** em `assets/candidatos/quaternius_universal/` (foram trazidos por
outro trabalho e descartados lá por "sem variação de silhueta" — mas é
exatamente o acervo que atende ao critério de proporção deste pedido).

| peça | pasta local | conteúdo |
|---|---|---|
| **Universal Base Characters** (UBC) | `ubc/` | corpos base masc./fem. + 8 cabelos/barbas/sobrancelhas |
| **Universal Animation Library** (UAL) | `ual/` | **43 clipes**, versão normal e com root motion |
| **Modular Character Outfits — Fantasy** (MCO) | `mco/` | roupas modulares em peças (braços, corpo, pernas, pés, ombreiras) |

### Licença — copiada do arquivo do pacote

`assets/candidatos/quaternius_universal/ubc/License_Standard.txt`, `ual/License.txt`
e `mco/License_Standard.txt` trazem os três o mesmo texto:

```
License:
CC0 1.0 Universal (CC0 1.0)
Public Domain Dedication
https://creativecommons.org/publicdomain/zero/1.0/
```

**CC0 1.0 — domínio público.** Sem atribuição obrigatória, redistribuição
liberada → **pode entrar no Git** e ser embutido em base64 sem qualquer ressalva.
(Os arquivos dizem que existe uma versão SOURCE paga com mais modelos; a versão
gratuita que está em disco é CC0 do mesmo jeito.)

### Proporção MEDIDA

| modelo | altura | triângulos | ossos | clipes | **cabeças** |
|---|---|---|---|---|---|
| `Superhero_Male_FullBody.gltf` | 1,820 | 14 318 | 66 | 0 | **6,28** |
| `Superhero_Female_FullBody.gltf` | 1,775 | 15 060 | 66 | 0 | **6,30** |
| `UAL1_Standard.glb` (manequim) | 1,829 | 13 744 | 66 | **43** | 5,35 |

**6,3 cabeças contra 2,1 do KayKit — 3× menos cabeça.** Cai na faixa "estilizado
adulto de jogo", que é o alvo do pedido. Não é fotorrealista (nem deveria ser,
num jogo tático visto de cima), mas é inequivocamente adulto.

### Esqueleto e animação

66 ossos, e os nomes são a **convenção do manequim da Unreal Engine**:

```
Head · neck_01 · spine_01/02/03 · clavicle_l|r · upperarm_l|r · lowerarm_l|r ·
hand_l|r · thigh_l|r · calf_l|r · foot_l|r · ball_l|r
+ 5 dedos × 4 falanges em cada mão
```

Consequências práticas, todas boas:

1. **UBC e UAL têm o mesmo rig de 66 ossos** → o banco de 43 clipes serve todos
   os corpos, exatamente como o banco KayKit serve os 9 de hoje. O padrão
   arquitetural do jogo (`M.load` com banco único de animação) **não muda**.
2. Ser rig de manequim UE significa que é **o rig mais bem servido do mundo em
   retargeting** — Mixamo, bibliotecas de mocap e tutoriais tratam dele como
   caso padrão. Ampliar o vocabulário de clipes depois é caminho conhecido.
3. Tem **dedos**. O jogo hoje pendura arma no osso `handslot.l/.r` do KayKit, que
   não existe aqui — a arma passaria a ser pendurada em `hand_l`/`hand_r` com um
   deslocamento fixo. É trabalho de calibração, não impedimento (detalhado na
   seção de custos).

### Os 43 clipes (nomes reais lidos do arquivo)

```
A_TPose · Crouch_Fwd_Loop · Crouch_Idle_Loop · Dance_Loop · Death01 ·
Driving_Loop · Fixing_Kneeling · Hit_Chest · Hit_Head · Idle_Loop ·
Idle_Talking_Loop · Idle_Torch_Loop · Interact · Jog_Fwd_Loop · Jump_Land ·
Jump_Loop · Jump_Start · PickUp_Table · Pistol_Aim_Down · Pistol_Aim_Neutral ·
Pistol_Aim_Up · Pistol_Idle_Loop · Pistol_Reload · Pistol_Shoot · Punch_Cross ·
Punch_Jab · Push_Loop · Roll · Sitting_Enter · Sitting_Exit · Sitting_Idle_Loop ·
Sitting_Talking_Loop · Spell_Simple_Enter · Spell_Simple_Exit ·
Spell_Simple_Idle_Loop · Spell_Simple_Shoot · Sprint_Loop · Swim_Fwd_Loop ·
Swim_Idle_Loop · Sword_Attack
```

**Leitura honesta deste conjunto.** Tem o essencial de um jogo tático:
`Idle_Loop`, `Jog_Fwd_Loop`, `Sprint_Loop`, `Sword_Attack`, `Punch_Cross`,
`Punch_Jab`, `Roll` (esquiva!), `Hit_Chest`, `Hit_Head`, `Death01`, e um ciclo de
magia decente (`Spell_Simple_Enter/Idle/Shoot/Exit`).

Mas é **um acervo de jogo moderno/urbano**, não de fantasia: seis dos 43 são de
pistola, e há `Driving_Loop`, `Sitting_*`, `PickUp_Table`, `Fixing_Kneeling`.
Contra os 30 clipes que o jogo fala hoje, **perde-se** vocabulário de fantasia
específico — `Spellcast_Summon`, `Spellcast_Raise`, `Block`, `Taunt`, `Cheer`,
`Throw`, ataques de 2 mãos. Existe substituto plausível para vários
(`Spell_Simple_Shoot` cobre lançar feitiço; `Roll` cobre esquiva melhor do que o
`Dodge_Backward` atual), mas **não é troca 1:1**. Isto é uma perda real e está
listada no balanço da seção final.

### Peso

Medido nos arquivos em disco (não estimado):

| arquivo | cru | em base64 (×1,37) |
|---|---|---|
| `UAL1_Standard.glb` (43 clipes + manequim) | **7,62 MB** | ~10,4 MB |
| `Superhero_Male_FullBody` (.gltf + .bin) | 0,75 MB | ~1,0 MB |
| `Superhero_Female_FullBody` (.gltf + .bin) | 1,02 MB | ~1,4 MB |

O banco de animação pode ser podado (o gerador `prune()` já existe e já foi usado
para cortar 76 clipes para 30) — tirar os 6 de pistola, os 4 de `Sitting`,
`Driving`, `Swim` e `PickUp_Table` derruba bastante o custo. **Mas o problema de
bytes maior não é a geometria, é a textura** — está quantificado na seção 2b, e é
sério.

### O que se ganha e o que se perde com este candidato

**Ganha:** proporção adulta medida (6,3 cabeças), rig padrão da indústria,
banco de animação único (mesmo padrão de hoje), CC0 sem ressalva, malha modular
(o MCO permite montar classes diferentes trocando peças de roupa — é o mesmo
truque de guarda-roupa que o KayKit permite, só que em corpo adulto), e já está
em disco (custo de download zero).

**Perde:** o `handslot` (recalibrar arma na mão), coerência de estilo com o
cenário KayKit da masmorra (ver seção final — este é o custo mais sério), e
vocabulário de animação de fantasia.

---

## 2b. O problema de bytes do Quaternius Universal — medido

A geometria é barata; **a textura é que estoura o orçamento.** Números reais dos
arquivos em disco:

| item | bytes |
|---|---|
| `UAL1_Standard.glb` (43 clipes + manequim) | **7,62 MB** |
| `Superhero_Male_FullBody` (.gltf + .bin) | 0,75 MB |
| `Superhero_Female_FullBody` (.gltf + .bin) | 1,02 MB |
| `Male_Ranger` (.gltf + .bin) | 1,79 MB |
| `Female_Ranger` (.gltf + .bin) | 2,01 MB |
| `Male_Peasant` / `Female_Peasant` (.gltf + .bin) | 0,71 / 0,69 MB |
| `T_Ranger_Normal.png` | **12,71 MB** (uma textura!) |
| `T_Peasant_Normal.png` | **14,11 MB** |
| `T_Ranger_ORM.png` / `T_Peasant_ORM.png` | 10,79 / 9,90 MB |
| pasta `ubc/` inteira | **123 MB** |
| pasta `mco/Textures/` inteira | **127 MB** |
| zip original `modular-character-outfits-fantasy` | **294 MB** |

**Isso não cabe como está — em nenhuma hipótese.** O jogo inteiro embutido hoje
soma ~15,7 MB.

O que salva: são texturas PBR 4K (BaseColor + Normal + ORM) feitas para engine
moderna. Este jogo é tático visto de cima, com bloom, e o material do KayKit já é
um atlas minúsculo. **Normal e ORM são descartáveis aqui** e o BaseColor pode cair
para 256×256. Com isso cada personagem fica em ~0,7–2,0 MB de geometria + ~50–150 KB
de textura.

**Estimativa realista para 6 classes + banco de animação podado:**

| item | estimativa embutida (base64) |
|---|---|
| 6 corpos com roupa (geometria) | ~7 a 9 MB |
| banco de animação podado (43 → ~20 clipes úteis) | ~4 a 5 MB |
| texturas 256 px BaseColor | ~0,5 MB |
| **total** | **~12 a 15 MB** |

Contra os **3,98 MB** (heróis) + **1,90 MB** (animações) = 5,88 MB de hoje.
**O elenco de classes ficaria 2 a 2,5× mais pesado**, e o total embutido subiria
de ~15,7 MB para ~22–25 MB — no limite ou acima do teto de 25 MB acordado.
Caberia se os KayKit humanoides saíssem junto, mas eles são usados também como
monstros (esqueletos). **Este é um custo real e não deve ser minimizado.**

Observação: a malha também é mais cara. 14–27 mil triângulos por personagem contra
**5–7 mil** do KayKit — 2× a 4× mais. Num tabuleiro com muitas unidades na tela
isso pesa em GPU, ainda que os modelos sejam simples pelos padrões atuais.

---

## 2c. O reforço que resolve a fraqueza de animação — **Universal Animation Library 2**

Achado durante a pesquisa e **não presente em disco**: o Quaternius publicou uma
segunda biblioteca no mesmo sistema.

- Fonte: https://quaternius.com/packs/universalanimationlibrary2.html
- **130+ animações**, descritas na página como cobrindo *combos de combate corpo a
  corpo e armado, parkour, agricultura, pesca, locomoção de zumbi*, e **combos de
  3–4 golpes com acertos e recuperações separados**.
- Licença declarada na página: **CC0**.
- Formatos: FBX, GLB e Blend.
- Rig: a página diz *"a universal humanoid rig, which is compatible with Unreal
  Engine, Godot and Unity, ready for retargeting"*. **Não confirma explicitamente**
  ser byte a byte o mesmo esqueleto do Universal Base Characters — isso precisa ser
  verificado abrindo o arquivo (é a mesma família "Universal", então é muito
  provável, mas não está provado e não vou afirmar que está).
- Peso: **não declarado na página**. Precisa ser medido após download.

Se o rig for o mesmo — e é o ponto que **precisa ser checado antes de decidir** —
o vocabulário de animação deixa de ser uma perda e vira um **ganho** sobre os 30
clipes de hoje: combos de golpe com recuperação separada é mais do que o KayKit
oferece.

## 2d. Outros pacotes Quaternius no mesmo sistema (levantados, não baixados)

Da página inicial https://quaternius.com — todos anunciados como gratuitos:

| pacote | conteúdo declarado | licença na página |
|---|---|---|
| **Universal Base Characters** | corpos base | CC0 (arquivo do pacote confere) |
| **Universal Animation Library** | 43 clipes | CC0 (arquivo do pacote confere) |
| **Universal Animation Library 2** | 130+ clipes, combate | CC0 (página) |
| **Modular Character Outfits — Fantasy** | roupas modulares | CC0 (arquivo do pacote confere) |
| **Ultimate Modular Men Pack** | *"11 Different characters with 24 animations"*, cada um dividido em 4 peças trocáveis | CC0 (página) |
| **Ultimate Modular Women Pack** | idem | CC0 (página) |
| **Animated Knight Pack** | cavaleiro animado | gratuito (licença não lida) |
| **RPG Character Pack** | 6 personagens de fantasia rigged/animados | gratuito (licença não lida) |
| **Animated Monster Pack** | monstros | gratuito (licença não lida) |

**Aviso de método:** as linhas marcadas "página" tiveram a licença lida na página
do pacote, não no `LICENSE.txt` de dentro do zip. As três primeiras eu li no
arquivo em disco, que é a prova mais forte. Antes de qualquer pacote entrar no
Git, o `LICENSE.txt` de dentro do zip deve ser lido — foi assim que se confirmou
o CC0 dos que já estão aqui.

---

## 2e. A limitação honesta do candidato 1: quanta coisa é realmente grátis

Aqui está o furo, e ele é grande o bastante para mudar a decisão.

O `License_Standard.txt` do UBC e do MCO diz, textualmente:

```
This is the standard FREE version of the Universal Base Characters Kit, which only contains
a portion of the models. You can buy the SOURCE version which has all the models...
```

O que a página anuncia contra **o que existe de fato na versão gratuita em disco**:

| pacote | página anuncia | **está em disco (grátis)** |
|---|---|---|
| Universal Base Characters | *"6 Base models"* em 3 proporções (**Superhero, Regular, Teen**, masc./fem.) + *"20 Hairstyles"* | **2 corpos** (`Superhero_Male`, `Superhero_Female`) + 8 cabelos/barbas |
| Modular Character Outfits — Fantasy | *"12 Outfits, 62 Parts"* | **2 famílias de roupa** (`Peasant`, `Ranger`), masc./fem. |

Ou seja: **2 corpos × 2 roupas**. Para vestir **6 classes com silhuetas distintas**,
isso é magro. O `Ranger` traz `Head_Hood` e `Acc_Pauldrons` (capuz e ombreiras), o
`Peasant` é roupa simples — dá para fazer um batedor e um plebeu convincentes,
não dá para fazer tanque, mago, assassino, suporte e invocador que se distingam
na silhueta.

Esta é a **mesma objeção** que `docs/PROPOSTA_MODELOS.md` levantou ("corpos
humanos, sem variação de silhueta") — e ela continua verdadeira. A diferença é
que aquele documento usou isso para descartar o acervo; aqui ele é retido porque
**resolve o critério que o usuário levantou** (proporção), e a falta de silhueta é
tratada como problema a resolver, não como veredito.

**Caminhos para resolver, em ordem de custo:**

1. **Somar `Ultimate Modular Men` + `Ultimate Modular Women`** (CC0, página do
   Quaternius): *"11 Different characters with 24 animations"* e *"10 Different
   characters with 24 animations"*, **cada um dividido em 4 peças trocáveis**.
   21 corpos com guarda-roupa. **Proporção não medida** — precisa baixar e medir
   antes de contar com isso. É a peça que falta e o próximo passo óbvio.
2. **Somar o `RPG Character Pack`** (CC0): *"6 different rigged, animated and
   textured fantasy characters"* — literalmente 6, o número de classes. Formatos
   FBX, OBJ, Blend, glTF. Proporção não medida.
3. Diferenciar por **porte, cor e arma** em cima dos 2 corpos, como o jogo já faz.
   Barato, mas é exatamente o "um corpo, seis fantasias" de que se quer sair.
4. Comprar a versão SOURCE. **Fora do escopo** — o usuário não compra nada.

---

## 3. Candidatos que a LICENÇA reprova — bons modelos que não podem entrar no Git

Esta seção existe porque são as opções mais óbvias e mais bonitas, e todas caem
na mesma pedra: a restrição de redistribuição. O usuário foi explícito — *"arte
com restrição de redistribuição não entra no Git"*. Como este jogo **embute os
modelos em base64 dentro de arquivos `.js` versionados**, qualquer modelo que
entre está sendo redistribuído em código-fonte. Não há meio-termo.

### 3.1 Mixamo (Adobe) — o mais tentador, e reprovado

- **Proporção:** adulta/heroica, tipicamente 7,5–8 cabeças. Seria o alvo perfeito.
- **Acervo:** ~100 personagens + ~2 500 animações, com auto-rigger e retargeting.
- **Formato:** FBX (conversível para glTF).
- **Licença (Adobe):** uso comercial e não comercial ilimitado, **sem royalties**.
  MAS a restrição, nas palavras da FAQ da Adobe: não se pode *"create blueprints,
  templates, or asset packages for video game engines which redistribute character
  or animation raw files as the product"*, nem *"packages for 3D stock or asset
  store websites where character or animation raw files will be sold or
  distributed"*. A regra prática: **os arquivos brutos não podem ser
  redistribuídos** — têm de ir embutidos num produto acabado.
- **Veredito:** REPROVADO para o Git. Um `.glb` em base64 dentro de um `.js`
  versionado num repositório é distribuição do arquivo bruto.
  Fonte: https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html
- **Ressalva cinzenta e importante:** existe a leitura de que animação Mixamo
  *retargetada e assada* num modelo próprio deixa de ser "arquivo bruto". Não é
  posição segura, e não é minha para tomar — se essa via interessar, é caso de ler
  a FAQ com atenção antes, não depois.

### 3.2 Unity Asset Store (pacotes gratuitos)

- **Licença (EULA padrão):** proíbe redistribuir o asset como item autônomo; ele
  só pode ir embarcado num produto que faça mais do que entregar o asset.
  Levantamentos da comunidade são específicos: **isso vale para projetos publicados
  no GitHub**.
- **Veredito:** REPROVADO para o Git. Vale para *todos* os pacotes gratuitos sob a
  EULA padrão, incluindo os de personagem e os de VFX (`Particle Pack`,
  `Magic Effects FREE`, `Starter Assets`).
  Fonte: https://unity.com/legal/as-terms

### 3.3 Fab / Epic Games (ex-Unreal Marketplace) — Paragon, Infinity Blade

- **Proporção:** adulta/heroica, qualidade AAA. Visualmente o melhor da lista.
- **Licença:** historicamente rotulados *"Licensed for use only with and under the
  same terms as the Unreal Engine"* — ou seja, **só dentro da Unreal**. Há
  discussão nos fóruns da Epic sobre a rotulagem "UE-only" ter sido removida na
  migração para o Fab, e sobre assets gratuitos terem virado "Standard License".
  **A situação não está clara**, e não encontrei texto de licença atual e
  inequívoco que autorize uso fora da Unreal.
- **Peso:** um único personagem Paragon passa fácil de 50–200 MB (texturas 4K,
  dezenas de milhares de triângulos). **Estoura o orçamento de bytes sozinho.**
- **Veredito:** REPROVADO por dois motivos independentes — licença ambígua e peso.
  Fonte: https://forums.unrealengine.com/t/fab-ue-only-content-licensing/2082870

### 3.4 TurboSquid / CGTrader / Free3D — os "grátis" que não são livres

- **Licença:** "free" nesses sites quase sempre significa *royalty-free para uso em
  um produto*, **não** domínio público. A licença padrão do TurboSquid proíbe
  redistribuir o modelo como arquivo. Cada modelo tem licença própria, e há muito
  material de procedência duvidosa (rips de jogos comerciais).
- **Veredito:** REPROVADO como acervo. Um modelo individual explicitamente marcado
  CC0 poderia servir, mas exige verificação caso a caso e o risco de procedência é
  alto. Não recomendo como base do elenco.

### 3.5 Synty (POLYGON) — amostras gratuitas

- **Proporção:** estilizada adulta, silhuetas ótimas. Seria bom.
- **Licença:** proíbe redistribuição dos assets de origem.
- **Veredito:** REPROVADO para o Git.

### 3.6 Meshy e geradores de IA que anunciam CC0

- Anunciam saída CC0 e formato `.glb`.
- **Veredito:** REPROVADO para este pedido — os modelos gerados **não vêm com
  esqueleto nem animação**, e a restrição é clara: *"sem animação o modelo não
  serve"*. Rigar 6 classes do zero não é caminho.

---

## 4. Candidatos que a PROPORÇÃO reprova — livres, mas continuam chibi

### 4.1 Kenney.nl — CC0 impecável, proporção errada

`Blocky Characters` (18 personagens, 27 animações), `Mini Characters` (25),
`Animated Characters 1/2/3`. Tudo **CC0**, formatos FBX/OBJ/glTF, sem exigência de
atribuição, redistribuição liberada. Licença perfeita.

**Mas:** os pacotes de personagem do Kenney foram feitos **pelo mesmo artista do
KayKit**. A página do próprio Kay Lousberg diz: *"Together with Kenney I've
produced a modular 3D character model asset pack"* (4 modelos, 75 skins, 40
acessórios, 17 animações). É a **mesma mão e a mesma estética** que produziu o que
já está no jogo.

**Veredito:** REPROVADO para este pedido. Trocar KayKit por Kenney é trocar chibi
por chibi — não resolve nada do que o usuário reclamou.
Fontes: https://kenney.nl/assets/blocky-characters ·
https://www.kaylousberg.com/work/kenney-character-assets

### 4.2 KayKit (o que está no jogo hoje)

Medido na seção 1: **~2,1 cabeças**. É a origem da reclamação. O acervo CC0
humanoide do KayKit está esgotado — os pacotes novos são pagos (US$ 19,99 cada;
"Complete KayKit" US$ 150).

### 4.3 Quaternius Ultimate Monsters

**Não proposto.** O usuário já recusou por serem fofos demais. Registrado só para
constar que foi considerado e descartado por decisão dele, não por falha técnica.

---

## 5. MONSTROS e CHEFES — o levantamento, e uma má notícia

Este é o ponto mais fraco do acervo livre, e é melhor dizer logo:
**não existe, em CC0, um bestiário de monstros humanoides adultos e ameaçadores
com esqueleto e animação, comparável ao que o Quaternius Universal oferece para
as classes.** Procurei em Sketchfab (filtro CC0), OpenGameArt, itch.io (tag CC0),
poly.pizza, na lista curada `madjin/awesome-cc0` e nos catálogos do Kenney e do
Quaternius. O que existe é ou fofo, ou avulso, ou sem rig.

### 5.1 O que foi levantado

| candidato | fonte | licença | rig/anim | proporção | veredito |
|---|---|---|---|---|---|
| **Quaternius — Ultimate Monsters** (50) | quaternius.com/packs/ultimatemonsters.html | CC0 | sim, 8–14 clipes | fofo/redondo | recusado pelo usuário |
| **Quaternius — Animated Monster Pack** (4) | quaternius.com/packs/animatedmonster.html | CC0 (página) | *"each with their own animations"* | não medida | **só FBX/OBJ/Blend — sem glTF**; exige conversão. 4 modelos é pouco |
| **Quaternius — Cute Animated Monsters** (21) | quaternius.com/packs/cutemonsters.html | CC0 | sim | fofo por definição | mesma recusa do usuário |
| **Quaternius — Easy Enemies / Animals / Dinosaurs** | já embutidos | CC0 | sim | bichos, não humanoides | já no jogo |
| **KayKit Skeletons** (4) | já embutidos | CC0 | sim, 95 clipes | ~2,3 cabeças | chibi |
| **Sketchfab — tag CC0**, modelos avulsos de monstro | sketchfab.com/tags/cc0 | CC0 caso a caso | **inconsistente** | variada | avulsos; rigs diferentes entre si, sem banco de animação comum |
| **OpenGameArt — "Knight (Rigged - Mid Poly)"** | opengameart.org/content/knight-rigged-mid-poly | CC0 | rigify, **sem animações prontas** | adulta | `.blend` 14,1 MB, 8 000 vértices (corpo) + 12 000 (armadura). Precisa de animação e de exportação |
| **Mixamo — Mutant, Warrok, Maw, Ganfaul, zumbis** | mixamo.com | Adobe | sim, ótimas | adulta/monstruosa | REPROVADO no Git (seção 3.1) |
| **Fab — Paragon** | fab.com | UE / ambígua | sim | adulta AAA | REPROVADO (seção 3.3) |

### 5.2 A saída honesta para os monstros

Não há um pacote que resolva. Existem três caminhos, e todos têm custo:

1. **Vestir o corpo Quaternius Universal de monstro.** Os 66 ossos aceitam qualquer
   malha skinned do mesmo rig, e o banco de animação já está pago. Monstros
   humanoides (as famílias Corte Afogada, Prole da Fornalha, Guarda do Coração,
   Coro dos Andaimes, Turno da Noite) viram **variações de corpo adulto com cor,
   porte e adereço** — igual ao que o jogo faz hoje com os esqueletos KayKit, mas
   num corpo que não é chibi. Custo de bytes: **quase zero** (reaproveita corpo e
   banco). Custo de arte: nenhum. **Perda: não são monstros de verdade, são
   humanos tingidos.**
2. **Manter os bichos Quaternius que já estão embutidos** (aranha, vespa, cobra,
   sapo, rato, lobo, raposa, cervo, touro, raptor, T-Rex, tricerátops). Eles são
   animais, não humanoides — **a crítica de "parece jogo de criança" não se aplica
   a eles do mesmo jeito**. São o que há de melhor disponível e já estão pagos em
   bytes. Recomendo **não mexer neles**.
3. **Aceitar mistura de estilos** e garimpar monstros avulsos em CC0 no Sketchfab,
   um a um. Alto custo de curadoria, resultado visualmente incoerente, e cada um
   traz um rig diferente (sem banco comum de animação). **Não recomendo.**

---

## 6. EFEITOS DE ATAQUE

Boa notícia: aqui o jogo já está bem servido e **não precisa comprar briga nova**.

### 6.1 O que já existe no projeto

- `js/render3d/fx3d_v2.js` gera partículas, projéteis, clarões, anéis de choque,
  decalques de chão e números de dano **em tempo real, por código** — sem asset
  externo. Texturas de partícula saídas de `<canvas>`.
- `assets/embedded/fx-atlas.js` — **286 KB** já embutidos.
- `assets/candidatos/kenney_fx/` já tem baixado, **e não foi usado**:
  `particle-pack` (15 MB) e `smoke-particles` (6 MB), com uma seleção já feita em
  `kenney_fx/sel/` (2,1 MB): `circle_01..05`, `dirt_01/02`, `fire_01`,
  `flame_05/06`, `light_01`, `magic_01..05`, `muzzle_03/04/05`, `scorch_01`.

### 6.2 Recomendação de efeitos

| fonte | licença | o que serve | veredito |
|---|---|---|---|
| **Kenney — Particle Pack / Smoke Particles** | **CC0** (`License.txt` dentro do pacote) | 100+ texturas PNG de partícula: fogo, fumaça, magia, faísca, clarão de disparo, chamusco | ✅ **Usar.** É CC0, é PNG (leve), entra em billboard/atlas sem tocar em geometria, e **já está em disco com uma seleção pronta de 20 arquivos, 2,1 MB** |
| **Unity — Magic Effects FREE / Particle Pack** | EULA padrão da Unity | efeitos de magia prontos | ❌ redistribuição proibida |
| **itch.io — tag CC0 + Magic** | CC0 caso a caso | spritesheets de efeito | ⚠️ maioria é **2D pixel art**, não casa com 3D. Verificar caso a caso |
| **MyCreativeFX, Magic Spells FX Pack** | não CC0 | — | ❌ |

**Ponto importante:** efeito de ataque é a categoria onde **o estilo chibi não é o
problema** — partícula não tem cabeça. E o pacote CC0 do Kenney serve tanto para o
elenco atual quanto para qualquer elenco novo. **Isto pode ser feito hoje,
independentemente da decisão sobre os personagens.**

---

## 7. COMPARAÇÃO HONESTA — o que se ganha e o que se PERDE

Trocar o elenco de classes do KayKit pelo Quaternius Universal. Ponto a ponto,
sem propaganda.

### 7.1 O que se GANHA

| ganho | medida |
|---|---|
| **Proporção adulta** — o pedido do usuário | **6,3 cabeças** contra **2,1**. Deixa a faixa chibi e entra na faixa "estilizado adulto de jogo" |
| **Licença sem ressalva** | CC0 1.0 lido no `LICENSE.txt` de dentro do pacote, não na página. Entra no Git sem atribuição obrigatória |
| **Rig padrão da indústria** | 66 ossos com nomes de manequim da Unreal (`spine_01/02/03`, `clavicle_l`, `thigh_l`…). É o rig mais bem servido do mundo em retargeting — ampliar o vocabulário depois é caminho conhecido, não pesquisa |
| **Arquitetura do jogo não muda** | UBC e UAL compartilham o rig → **banco único de animação**, exatamente o padrão que `M.load` já implementa para os 9 KayKit. Não é reescrita, é troca de dados |
| **Roupa modular** | O MCO separa braços/corpo/pernas/pés/ombreiras/capuz → o mesmo truque de guarda-roupa do KayKit, mas em corpo adulto |
| **Caminho de crescimento** | A `Universal Animation Library 2` (CC0, 130+ clipes com **combos de combate**) está disponível e resolveria o vocabulário de fantasia |
| **Custo de download zero** | Os três pacotes já estão em `assets/candidatos/quaternius_universal/` |

### 7.2 O que se PERDE

Estes são custos reais. Nenhum é fatal sozinho; somados, são o motivo de isto ser
uma **proposta para aprovação** e não uma recomendação automática.

| perda | tamanho do estrago |
|---|---|
| **Coerência com o cenário** | ⚠️ **A perda mais séria.** O calabouço é `KayKit Dungeon Remastered` — 49 peças no estilo chibi do mesmo autor dos personagens. Personagem adulto de 6,3 cabeças sobre mobiliário chibi **destoa**: as portas, as mesas, os barris e os baús foram modelados na escala de bonecos de cabeça grande. Ou se aceita o descasamento, ou o cenário também teria de ser trocado — e aí o custo multiplica. **Não existe cenário CC0 equivalente em estilo adulto no mesmo nível de completude.** |
| **Vocabulário de animação** | Os 43 clipes do UAL1 são de jogo moderno/urbano: 6 de pistola, mais `Driving_Loop`, `Sitting_*`, `PickUp_Table`, `Fixing_Kneeling`. Contra os 30 clipes que o jogo fala hoje, somem `Spellcast_Summon`, `Spellcast_Raise`, `Block`, `Taunt`, `Cheer`, `Throw` e os ataques de 2 mãos. Há substitutos plausíveis (`Spell_Simple_Shoot`, `Roll` para esquiva), **mas não é troca 1:1**. Mitigável com a UAL2 — que ainda precisa ser verificada |
| **Bytes** | Elenco de classes de **5,88 MB → ~12–15 MB**. Total embutido de ~15,7 MB → **~22–25 MB**, no limite ou acima do teto de 25 MB. E só depois de **descartar as texturas Normal/ORM e reduzir BaseColor para 256 px** — sem isso o acervo cru tem 123 MB só no UBC |
| **Triângulos** | 14–27 mil por personagem contra **5–7 mil** do KayKit: **2× a 4× mais**. Num tabuleiro com muitas unidades isso pesa em GPU |
| **O soquete de arma `handslot`** | Não existe no rig Quaternius. Arma passa a pendurar em `hand_l`/`hand_r` com deslocamento fixo calibrado à mão — 6 corpos × (posição, rotação, escala). O KayKit tinha o soquete pronto. **Isto afeta diretamente o sistema de fusão**, que enxerta a arma da classe convidada em `handslot.l` |
| **Variedade de silhueta** | A versão gratuita entrega **2 corpos e 2 roupas**. Sem somar os pacotes `Ultimate Modular Men/Women` ou `RPG Character Pack`, as 6 classes voltam a ser "um corpo com fantasias" — o problema que se queria resolver, só que num corpo mais alto |
| **Guarda-roupa perdido** | O KayKit tem ~30 adereços já embutidos (machados, espadas, escudos, chapéus, capas, grimórios, bestas, adagas) que **casam byte a byte** entre os 9 humanoides. Nada disso vem no Quaternius Universal — o MCO gratuito traz capuz e ombreiras, e ponto. **Armas teriam de vir de outro lugar** (as peças estáticas do KayKit podem ser penduradas no osso Quaternius, mas em escala chibi sobre corpo adulto, o que exige reescalar cada uma) |
| **Trabalho de conversão** | Os arquivos são `.gltf` + `.bin` + PNGs separados; o pipeline do jogo embute `.glb` único. Precisa de um passo de empacotamento antes do `to_b64_js` |

### 7.3 Tabela-resumo da decisão

| critério do pedido | KayKit (hoje) | Quaternius Universal | Mixamo | Fab/Paragon | Kenney |
|---|---|---|---|---|---|
| **proporção (cabeças)** | 2,1 ❌ | **6,3** ✅ | ~7,5–8 ✅ | ~7,5–8 ✅ | ~2–4 ❌ |
| gratuito | ✅ | ✅ | ✅ | ✅ | ✅ |
| **pode entrar no Git** | ✅ CC0 | ✅ **CC0** | ❌ | ❌ ambíguo | ✅ CC0 |
| esqueleto + animação | ✅ 30 clipes | ✅ 43 (+130 na UAL2) | ✅ ~2 500 | ✅ | ✅ |
| formato glTF | ✅ | ✅ | FBX | UE | ✅ |
| cabe no orçamento | ✅ 5,9 MB | ⚠️ ~12–15 MB | — | ❌ | ✅ |
| casa com o cenário | ✅ | ❌ | ❌ | ❌ | ✅ |
| silhuetas distintas (6 classes) | ❌ | ⚠️ 2 corpos grátis | ✅ | ✅ | ❌ |

---

## 8. RECOMENDAÇÃO — o que eu faria, e o que precisa de decisão do usuário

**Não apliquei nada.** `js/` não foi tocado. Abaixo está o que a pesquisa sustenta.

### 8.1 A resposta curta ao pedido

Existe **um** acervo gratuito que atende a todos os requisitos ao mesmo tempo —
proporção adulta, CC0 redistribuível, esqueleto com animação, glTF, e peso
administrável: o **sistema Universal do Quaternius** (Base Characters + Animation
Library + Modular Outfits). Todo o resto que tem proporção adulta ou **não pode ser
redistribuído** (Mixamo, Unity Asset Store, Synty, Fab/Paragon) ou **não tem
esqueleto** (geradores de IA) ou **não é adulto** (Kenney, KayKit).

O acervo livre e adulto é muito mais estreito do que parece de fora. Essa é a
descoberta central deste levantamento.

### 8.2 Ordem sugerida

1. **Fazer agora, sem depender de decisão nenhuma:** aproveitar o
   `assets/candidatos/kenney_fx/sel/` (CC0, 2,1 MB, 20 texturas já selecionadas e
   nunca usadas) nos efeitos de ataque. Ganho visual imediato, risco zero,
   independente do elenco.
2. **Antes de decidir o elenco — baixar e MEDIR três pacotes** (o medidor já está
   pronto; é uma tarde de trabalho):
   - `Universal Animation Library 2` — **verificar se o rig é o mesmo dos 66
     ossos**. Se for, a maior perda (vocabulário de animação) desaparece.
   - `Ultimate Modular Men` + `Ultimate Modular Women` — 21 corpos com 4 peças
     trocáveis cada. **Medir as cabeças.** É o que resolveria a variedade de
     silhueta.
   - `RPG Character Pack` — 6 personagens de fantasia. **Medir as cabeças.**
3. **Só então decidir**, com números na mão, entre:
   - **Trocar o elenco** para Quaternius Universal — resolve a queixa do usuário,
     mas **descasa do cenário KayKit** e custa 2–2,5× em bytes;
   - **Trocar elenco E cenário** — coerente, mas não há cenário CC0 adulto
     equivalente ao Dungeon Remastered, então isso é um projeto, não uma troca;
   - **Ficar no KayKit** e investir em silhueta/adereço (é o que
     `docs/PROPOSTA_MODELOS.md` propõe) — barato e coerente, mas **não responde à
     queixa**: continua com 2,1 cabeças.
4. **Monstros:** manter os bichos Quaternius que já estão embutidos (a queixa de
   "jogo de criança" não pega neles do mesmo jeito) e, se o elenco mudar, vestir os
   monstros humanoides com o corpo adulto Universal em vez dos esqueletos KayKit.
   **Não existe bestiário CC0 adulto pronto** — isto é limite do acervo livre, não
   falta de procura.

### 8.3 A pergunta que só o usuário responde

> O elenco adulto vale o descasamento com o cenário chibi?

É uma escolha estética, não técnica, e é a que decide tudo. Os personagens podem
virar adultos **hoje**, com material CC0 que já está em disco. O calabouço em volta
deles não pode — e não há substituto livre à altura.

---

## 9. Procedência de cada afirmação

| tipo | onde |
|---|---|
| **medido localmente** (abrindo o arquivo) | proporções KayKit e Quaternius Universal; contagem de triângulos, ossos, clipes; nomes de osso e de clipe; tamanhos em bytes; licenças em `LICENSE.txt` do KayKit, Quaternius (UBC/UAL/MCO) e Kenney Particle Pack |
| **lido na página da fonte** | licença e conteúdo de UAL2, Ultimate Modular Men/Women, RPG Character Pack, Animated Monster Pack, Cute Monsters; termos de Mixamo, Unity Asset Store, Fab |
| **não verificado — precisa de download** | proporção em cabeças de UAL2, Ultimate Modular Men/Women, RPG Character Pack; se o rig da UAL2 é o mesmo dos 66 ossos; peso desses pacotes |

Fontes principais:
https://quaternius.com ·
https://quaternius.com/packs/universalbasecharacters.html ·
https://quaternius.com/packs/universalanimationlibrary2.html ·
https://quaternius.com/packs/modularcharacteroutfitsfantasy.html ·
https://quaternius.com/packs/ultimatemodularcharacters.html ·
https://quaternius.com/packs/rpgcharacters.html ·
https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html ·
https://unity.com/legal/as-terms ·
https://forums.unrealengine.com/t/fab-ue-only-content-licensing/2082870 ·
https://kenney.nl/assets/blocky-characters ·
https://www.kaylousberg.com/work/kenney-character-assets ·
https://sketchfab.com/tags/cc0 ·
https://opengameart.org/content/knight-rigged-mid-poly ·
https://github.com/madjin/awesome-cc0
