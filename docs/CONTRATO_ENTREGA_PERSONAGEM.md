# CONTRATO DE ENTREGA — personagem vindo do Meshy

Escrito em 18/08/2026, quando ficou decidido que os personagens seriam **gerados
já rigados e animados** no Meshy, e não rigados aqui.

Isso encerra a tentativa de rig automático deste lado, e é uma boa notícia: era
a parte mais frágil de tudo. Quatro rodadas de ajuste e o braço continuava
aberto, porque encaixar esqueleto num corpo qualquer é adivinhação — a mão vira
a barra da capa, o ombro sobe acima da cabeça, e cada corpo erra de um jeito
diferente.

O preço de o modelo vir pronto é que ele precisa vir **no mesmo padrão sempre**.
Este documento é esse padrão. Se um personagem chegar fora dele, ele entra
torto na cena e ninguém vê o defeito até a batalha.

---

## 1. As seis animações, com estes nomes

O jogo chama a animação pelo nome. Nome diferente = animação que nunca toca.

| nome do clipe | quando toca | precisa dar laço? |
| --- | --- | --- |
| `idle` | parado, esperando o turno — **braços para baixo** | **sim** |
| `walk` | andando de casa em casa | **sim** |
| `run` | correndo (deslocamento longo) | **sim** |
| `attack` | conjurando ou golpeando | não |
| `hit` | sofrendo dano | não |
| `death` | morrendo | não, e **termina caído** |

Se o exportador não deixar renomear, entregue **um arquivo por animação**, com o
nome do arquivo igual ao da tabela: `sumo_idle.fbx`, `sumo_walk.fbx`…

**`idle` com os braços para baixo é o que mais importa.** O personagem passa a
maior parte do tempo parado, esperando o turno do outro. Se ele espera em T-pose,
o jogo inteiro parece quebrado, mesmo com todo o resto certo.

## 2. Formato, escala e orientação

| item | o que tem de ser | por que |
| --- | --- | --- |
| formato | **FBX** (preferido) ou GLB | FBX leva esqueleto e clipes com menos surpresa na Unity |
| unidade | **metro** | a célula do tabuleiro é 1 m; escala errada vira personagem do tamanho da sala |
| pivô | **entre os pés**, no chão | é o ponto que a Unity planta na casa; pivô no umbigo faz o personagem afundar |
| olhando para | **+Z** | é a convenção da Unity; qualquer outra vira o personagem de costas ao andar |
| de pé em | **+Y** | idem |
| textura | junto, ou ao lado com o mesmo nome | textura solta e sem nome vira material cinza |

**Altura de cada classe**, decidida quando você disse que o sumô é maior:

| classe | altura | | classe | altura |
| --- | --- | --- | --- | --- |
| Bárbaro (`sumo`) | 2,30 m | | Batedor (`arqueiro`) | 1,80 m |
| Paladina (`curandeira`) | 1,95 m | | Bruxo (`bruxo`) | 1,75 m |
| Xamã (`invocador`) | 1,85 m | | Ladino (`espadachim`) | 1,65 m |

Se o modelo vier em outra altura, eu escalo — mas a **proporção entre eles** é
que carrega a leitura de papel, e essa eu não invento.

## 3. Largura: o teto que já foi estourado uma vez

O personagem pisa em **uma** casa de 1 m. Transbordar meia casa para cada lado
é normal e o Dofus faz isso. Transbordar uma casa inteira não é.

| medido até agora | largura |
| --- | --- |
| Mago | 1,87 célula |
| Elfo | 1,88 |
| Ladino | 2,05 |
| Xamã | 2,09 |
| Bárbaro | 2,62 |
| **Paladino** | **3,32** ← asas abertas |

O paladino ocupa mais faixa que o Bárbaro, que tem 150 PV e meio metro a mais.
Com dois heróis e cinco monstros na sala, isso apaga o tabuleiro.

**Teto:** até ~2,2 células para herói e monstro comum, até 3,7 para chefe. Asa,
capa e manto **abertos** contam. Se a silhueta precisa de asa grande, ela tem de
estar **recolhida no `idle`** e abrir no `attack`.

## 4. Arma

Cada personagem com a sua, **presa à mão no próprio modelo**. O esqueleto tem
encaixe de punho (`handslot`), mas anexar arma solta só funciona bem se o osso
tiver nome conhecido — e cada gerador nomeia de um jeito.

Então: **arma junto do corpo, já na mão, animada junto.** Se ela precisar sair
depois (a fusão empresta a arma do convidado), eu separo por peça, que é
trabalho que já sei fazer.

## 5. Fusão — decidido: cada dupla tem modelo próprio

Decisão do usuário em 19/08/2026: **a fusão vira um modelo gerado por dupla**,
entregue como qualquer personagem. Ao fundir, o jogo troca o corpo inteiro pela
nova forma — nada de emprestar cabeça, capa e arma do convidado, que era como o
JS fazia e era a parte mais frágil de todo o visual.

O que isso fixa:

- **São 15 modelos**, um por dupla de classe — e não 105. Os 7 degraus da dupla
  mudam os feitiços, não o corpo. Se algum degrau merecer corpo próprio um dia,
  é decisão nova.
- **O id da dupla é o do dado**, ordem alfabética com `+`: `arqueiro+bruxo`,
  `espadachim+sumo`… (as 15 chaves de `fusionForms.json`). A pasta é
  `Assets/Resources/elenco/<id>/` como a de qualquer classe.
- **Mesmos seis clipes** (`idle`, `walk`, `run`, `attack`, `hit`, `death`) e o
  mesmo padrão do §2. Altura: a fusão é maior que os dois pais — o teto de
  personagem do projeto é ~4,76 m; fique entre o pai mais alto e esse teto.
- **Largura continua valendo** (§3): fusão é unidade de UMA casa. Teto ~2,2
  células; o que for grande demais nasce recolhido no `idle`.

O que ainda falta do MEU lado, e não é visual: o sistema de fusão no motor —
`fusion.js` (452 linhas), as 3 chaves de dado que ficaram de fora
(`fusionForms`, `fusionBlends`, `fusionIdentities`) e os 2.625 feitiços
compostos de forma × mistura. É rodada própria, já prevista. O campo
`ForaDoTabuleiro` que tira o convidado sem contar derrota já existe e está
testado.

## 6. O que eu monto deste lado

- Um **prefab por classe**, com `Animator` e os seis estados ligados
- Um **Animator Controller** compartilhado, que dispara por nome de gatilho
  (`Atacar`, `Levar`, `Morrer`) e por parâmetro de velocidade (parado → andando
  → correndo)
- O prefab carregado **por id de classe** (`sumo`, `arqueiro`…), para trocar o
  modelo sem tocar em código
- Escala e pivô conferidos por **teste**, não a olho

Trocar um personagem passa a ser: soltar o FBX na pasta da classe, rodar o teste,
ver a foto. Sem abrir o Editor.

## 7. Ordem que rende mais

Mande **um personagem completo** primeiro — as seis animações de uma classe só.
Eu monto o encaixe inteiro em cima dele, descubro os defeitos do padrão com um
modelo em vez de seis, e aí você produz o resto em série.

O Bárbaro é o melhor candidato: é o único sem capa, e capa é o que mais complica
qualquer coisa automática.
