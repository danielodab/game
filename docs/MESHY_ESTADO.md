# Personagens do Meshy — onde parou e o que falta

Estado de `sumo`, `xama` e `mago`, gerados pelo usuário no Meshy e deixados em
`C:\Users\danie\Downloads\assets_ok`.

**Resumo:** os três **estão no jogo** e aparecem corretos. A **animação deles
está desligada** até o arquivo ser reexportado — os clipes viram o personagem de
ponta-cabeça, e sete consertos falharam (todos listados abaixo).

Um personagem bonito e parado é melhor que um animado de cabeça para baixo. A
trava é uma linha (`semAnimacao`, ligada por `/^meshy_/`) e some sozinha quando
o arquivo vier certo.

---

## O que está pronto

`tools/embute_meshy.py` converte e embute. Resultado medido:

| classe | antes | depois | triângulos | ações |
|---|---|---|---|---|
| sumo | 20,6 MB | **1,04 MB** | 15.208 | 6 |
| invocador (xamã) | 18,5 MB | **1,33 MB** | 15.378 | 6 |
| bruxo (mago) | 17,9 MB | **1,06 MB** | 15.665 | 6 |

**370 MB → 4,58 MB**, com as seis animações de cada um.

De onde veio a queda: cada classe chegou como **seis** `.glb` de ~20 MB, um por
animação. Mas os seis são **redundantes** — cada arquivo já traz todas as ações.
E os 20 MB eram quase só uma **textura 4096×4096**, reamostrada para 1024.

Três cuidados que o script toma, cada um por ter custado uma rodada:

1. **Os seis arquivos são redundantes mas não idênticos** — cada um traz um
   subconjunto. Peguei o `attack.glb` do mago e perdi justo `idle` e `death`. O
   arquivo certo dele é o `idle.glb`.
2. **Há uma `Icosphere` solta** em todos, sobra do gerador. Sai no script.
3. **As ações são renomeadas** para `Idle/Walk/Run/Attack/HitReact/Death`, que é
   o vocabulário que `autoActions()` já reconhece. O Meshy nomeia diferente em
   cada personagem — o xamã tem `Charged_Spell_Cast`, o mago tem
   `Shot_and_Fall_Forward`. Renomear evita um caso especial no renderizador.

---

## O que trava, exatamente

**O rig vem em centímetros.** O osso `Hips` tem 1226 de comprimento e um
armature encolhe tudo por 0,01. Malha e esqueleto passam a discordar por 100×.

Isso importa porque **tudo que mede no jogo mede a MALHA** — altura,
enquadramento, raio no tabuleiro, retrato — e a malha em pose de repouso dá
**0,02**. A normalização calcula escala de 135× e aplica sobre um esqueleto que
já estava certo: o personagem vira uma mancha fora do quadro.

### O que eu já provei

Renderizando **sem tocar no rig e sem animar**, os três ficam **perfeitos**:
Bárbaro vermelho musculoso com maço e tatuagem, Bruxo de barba branca com cajado
e pingente, Xamã rato com bordão. **O modelo está ótimo.** O problema é só de
medição.

### Quatro consertos que falharam, com foto cada um

| tentativa | resultado |
|---|---|
| `transform_apply(scale)` no armature | personagem de cabeça para baixo |
| o mesmo com todos os objetos juntos | idem — a malha é filha e recebia a transformação duas vezes |
| escalar os ossos em modo de **edição** | pose de repouso certa, **animada quebrada** (as curvas continuam em cm) |
| o anterior **mais** escalar as curvas | continua invertido |
| virar por medida **antes** de animar | não dispara: a pose de bind está certa |
| virar por medida **depois** de animar | não corrige — não é rotação simples |
| girar a **malha** 180° mantendo o esqueleto | nada: malha *skinned* ignora a própria transformação |

A lição do terceiro: mexer no *bind* sem mexer nas ações deixa o modelo parado
bonito e o **animado** errado — e o teste que olha a pose de repouso passa.

---

## O achado que fecha o diagnóstico

**Sem tocar no rig e sem animar, os três renderizam perfeitos.** Com a animação
tocando, viram de ponta-cabeça — sempre, em toda combinação que testei.

Isso descarta a malha, a escala, a orientação do arquivo e o meu conversor: o
modelo está bom. **A inversão vem do clipe.**

Tentei corrigir por medida — conferir se a cabeça está abaixo do pé depois do
mixer posar o modelo, e girar π em X se estiver. Não pegou, o que sugere que a
animação não apenas inverte: ela reposiciona de um jeito que uma rotação única
não desfaz.

### O que eu faria a seguir, na ordem

1. **Reexportar do Meshy com outras opções.** É o caminho mais curto e não custa
   código. Se houver escolha de "Y-up", de esqueleto padrão (Mixamo) ou de
   "aplicar transformações na exportação", tente. O arquivo atual mistura rig em
   centímetros com armature compensando — é sintoma de exportação sem normalizar.
2. **Abrir um `.glb` original no Blender e dar Play na animação.** Se lá também
   inverter, o problema nasce no gerador e nenhum conserto do meu lado resolve
   direito. Se lá ficar em pé, o problema é como o three.js lê essa animação, e
   aí vale converter as ações para o formato que o resto do jogo usa (banco
   único de clipes, como `models-anims.js`).

## O que falta, e é estreito

**Fazer o jogo medir o ESQUELETO, não a malha em repouso.** Em `models3d_v2.js`
já existe `alturaPelosOssos()` para a altura; falta o mesmo nos outros lugares
que chamam `Box3.setFromObject` sobre uma unidade — enquadramento de retrato,
raio no tabuleiro e a folha de contato.

`Box3.setFromObject` não aplica *skinning*: mede a pose de bind. Para um rig
cujo tamanho vive nos ossos, ela responde a pergunta errada.

**Não** insista em consertar o arquivo no Blender: quatro caminhos foram
testados e todos pioraram.

---

## O que já entrou no motor e vale para qualquer modelo futuro

- **`show` virou opcional** em `classLook` e `fusionLook`. Corpo com arma
  esculpida não tem malha para ligar ou desligar, e antes isso estourava.
- **`CLASS_MARK` ganhou a coluna `model`**: a marca da fusão diz de qual arquivo
  a peça sai. Sem ela, uma classe com corpo de outro acervo perderia chapéu,
  capa e arma na fusão — em silêncio.
- **`findBone` traduz KayKit ↔ Mixamo** (`head`/`Head`, `chest`/`Spine02`,
  `handslotl`/`LeftHand`…). Um lugar só; o próximo esqueleto custa uma linha.
- **`prepScene` põe o personagem de pé por MEDIDA** — cabeça abaixo do quadril
  significa invertido —, não por lista de nomes.
- **`naturalHeight` cai para os ossos** quando a malha vem degenerada.

E um teste meu que mentia: `armas_e_fusoes` cobrava "peça pendurada em osso",
que é o jeito do KayKit. Corpo com arma esculpida reprovava **por estar certo**.

---

## Para retomar

1. Reapontar as três em `CLASS_LOOK` para `meshy_sumo`, `meshy_bruxo`,
   `meshy_invocador` (e tirar `show`, `build`, `headSwap` delas — são do KayKit).
2. Trocar as medições de `Box3.setFromObject` por medida de esqueleto.
3. Conferir **com foto e com animação tocando**, não só pelo número do teste.
