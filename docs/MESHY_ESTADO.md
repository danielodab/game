# Personagens do Meshy — resolvido

`sumo`, `xama` e `mago`, gerados pelo usuário no Meshy, **estão no jogo,
animados e corretos**.

## O que foi feito

Cada classe chegou como **seis** `.glb` de ~20 MB, um por animação: 126 MB por
personagem, 370 MB nos três. O jogo inteiro tinha 29,6 MB.

Medindo, virou conta simples:

- a malha é boa: **~15 mil triângulos, 24 ossos** — densidade de jogo;
- os 20 MB eram quase só uma **textura 4096×4096**, reamostrada para 1024;
- e os seis arquivos são **redundantes** — cada um já traz todas as ações.

| classe | antes | depois | triângulos | ações |
|---|---|---|---|---|
| sumo | 20,6 MB | **1,04 MB** | 15.208 | 6 |
| invocador (xamã) | 18,5 MB | **1,33 MB** | 15.378 | 6 |
| bruxo (mago) | 17,9 MB | **1,06 MB** | 15.665 | 6 |

**370 MB → 4,58 MB.** `tools/embute_meshy.py` faz a conversão.

Três cuidados que o script toma, cada um por ter custado uma rodada:

1. **Os seis arquivos são redundantes mas não idênticos** — cada um traz um
   subconjunto. Peguei o `attack.glb` do mago e perdi justo `idle` e `death`. O
   arquivo completo dele é o `idle.glb`.
2. **Há uma `Icosphere` solta** em todos, sobra do gerador.
3. **As ações são renomeadas** para o vocabulário que `autoActions()` já
   reconhece. O Meshy nomeia diferente em cada personagem — o xamã tem
   `Charged_Spell_Cast`, o mago tem `Shot_and_Fall_Forward`.

## A caçada ao fantasma, e a lição

Os três apareciam **de ponta-cabeça** assim que animavam. Passei **oito**
tentativas de conserto no modelo, cada uma verificada com foto:

| tentativa | resultado |
|---|---|
| `transform_apply(scale)` no armature | de cabeça para baixo |
| o mesmo com todos os objetos juntos | idem — a malha é filha e recebia duas vezes |
| escalar os ossos em modo de edição | repouso certo, **animado quebrado** |
| o anterior **mais** escalar as curvas | continua invertido |
| virar por medida **antes** de animar | não dispara: o bind está certo |
| virar por medida **depois** de animar | não corrige |
| girar a **malha** 180° | nada: malha *skinned* obedece ao esqueleto |
| casar a pose de repouso com a dos clipes | continua invertido |

**Nenhuma era necessária.** O defeito estava na minha página de teste: o
`pousa()` dela pegava um clipe de `M.clips()` — que é o **banco do KayKit** — e
tocava num esqueleto Mixamo de 24 ossos. Animação de outro esqueleto, resultado
de cabeça para baixo. **O jogo esteve certo o tempo todo**, porque `M.unit` usa
`src.own ? src.clips : bankClips`.

O que teria encurtado isso: medir no Blender **antes** de mexer. Duas linhas de
script mostraram cabeça a 1,40 e pés a 0,15 no arquivo original **e** no meu
exportado — ou seja, os dois estavam bons, e o problema era de quem os exibia.

**A lição:** quando o modelo parece quebrado, desconfie primeiro de quem o está
mostrando. Eu tinha a evidência na segunda tentativa — "sem animar fica
perfeito" — e mesmo assim fui consertar o modelo mais seis vezes.

## O que entrou no motor, e vale para qualquer modelo futuro

- **`show` virou opcional** em `classLook` e `fusionLook`. Corpo com arma
  esculpida não tem malha para ligar ou desligar, e antes isso estourava.
- **`CLASS_MARK` ganhou a coluna `model`**: a marca da fusão diz de qual arquivo
  a peça sai. Sem ela, classe com corpo de outro acervo perderia chapéu, capa e
  arma na fusão — em silêncio.
- **`findBone` traduz KayKit ↔ Mixamo** (`head`/`Head`, `chest`/`Spine02`,
  `handslotl`/`LeftHand`…). Um lugar só; o próximo esqueleto custa uma linha.
- **`visibleBodyBox` e `naturalHeight` medem o esqueleto** quando a malha em
  bind vem degenerada. `Box3.setFromObject` não aplica *skinning*: para um rig
  cujo tamanho vive nos ossos, ela devolve 0,02 para um corpo de dois metros.

E dois testes meus que mentiam: `armas_e_fusoes` cobrava "peça pendurada em
osso" (jeito do KayKit — corpo com arma esculpida reprovava por estar certo) e
enquadrava por um `Box3` próprio em vez da medida do jogo.
