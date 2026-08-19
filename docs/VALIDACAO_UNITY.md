# VALIDAÇÃO — o que existe na Unity, e o que não existe

Medido em 19/08/2026, na ponta da branch `unity`, contando **definição real de
classe e método** — não busca por substring, que dava falso positivo (procurar
`IA` casava com "BATALHA" em 40 arquivos).

**Resposta curta: não terminou.** A batalha de uma sala funciona. O jogo não.

---

## 1. O que está pronto e testado

227 testes passando, zero inconclusivo.

| sistema | onde | estado |
| --- | --- | --- |
| Grade tática | `Soterra.Grade` | mapa em texto, busca em largura, linha de visão (`#` corta, `=` não), alcance com `min/max/line/los`, 6 formas de área |
| Dados | `Soterra.Dados` | 25 das 28 chaves carregadas de `Resources/dados/` |
| Turno, PA/PP | `Soterra.Motor` | enchem no turno DA UNIDADE, não na virada da rodada |
| Andar | `Soterra.Motor` | desconta PP por passo, com teste de fixação/esquiva |
| Conjurar e dano | `Soterra.Motor` | **16 dos 24** tipos de efeito |
| Rivalidade elemental | `Soterra.Motor` | fogo↔água, terra↔ar |
| Clima | `Soterra.Motor` | tique de ±5 PV por turno, favorece/prejudica por elemento, pode matar — **confere com o JS** |
| Fúria da sala | `Soterra.Motor` | poder por rodada, corte de cura, derrota na rodada 40 |
| Montar a sala | `Soterra.Batalha` | 18 salas dos 6 calabouços varridas, todas montam |
| Tabuleiro e elenco | `Soterra.Cena` | sala real, heróis e monstros com os modelos CC0 |
| Interface de toque | `Soterra.Interface` | PV/PA/PP, barra de feitiços, iniciativa, alvo mínimo de 44 pontos |

## 2. O que NÃO existe — nenhuma linha

Verificado procurando a definição; todas voltaram vazias.

| falta | tamanho no JS | o que isso significa jogando |
| --- | --- | --- |
| **IA de monstro** | `ai.js`, 681 linhas | **o monstro não joga.** Passa o turno parado |
| **Fusão** | `fusion.js`, 452 linhas + 105 formas | o sistema mais próprio do jogo não existe |
| **Progressão** | `progress.js`, 1.665 linhas | não se ganha XP, não se sobe de nível |
| **Itens e equipamento** | 90 itens, 18 conjuntos | não se equipa nada |
| **Forja e estrelas** | pedras até +10, estrela de classe até ★5 | — |
| **Inventário** | 4 abas | não existe tela |
| **Eventos de terreno** | 9 marcas `ev-*` | pisar numa marca não faz nada |
| **Pets** | 6 bichos | — |
| **Calabouço sala a sala** | 18 salas, 6 chefes | joga-se UMA sala e acaba |
| **Efeito visual de feitiço** | 21 famílias | o feitiço acerta sem nada aparecer |
| **8 dos 24 tipos de efeito** | `teleport`, `swap`, `moveTo`, `summon`, `trap`, `weatherShift`, `chain`, `reflect` | o feitiço é lançado e o efeito é ignorado — **com evento no log**, não em silêncio |
| **Ciclo automático de clima** | `weatherShiftEveryRounds` | o clima da sala nunca muda sozinho |
| **4 dos 5 traços** | `enrage`, `explodeOnDeath`, `split`, `regenAura` | a Carrapicho-Mãe não se parte |

## 3. Por que a sala parece diferente

Ela **é** diferente, e é honesto dizer em vez de defender.

- **Parede é cubo.** O jogo em JS monta a sala com o env-kit KayKit — peça de
  parede, quina, coluna, escombro. Na Unity o obstáculo alto é um cubo escuro e
  o baixo é um cubo claro. Os 49 modelos de cenário **já estão** em
  `Assets/Modelos/cenario/`, mas ninguém os montou ainda.
- **Sem divisória animada, sem props, sem tema por calabouço.** A paleta é a do
  tema `garden` fixa no código, marcada como provisória.
- **O tamanho está certo.** 21×17, célula de 1 m, medido em teste.

## 4. Duas coisas que a foto escondeu

- **Os dois heróis se sobrepõem.** Nascem em `P` adjacentes; com 2,30 m e 1,75 m
  numa casa de 1 m, as silhuetas quase coincidem. Lê-se um vulto onde há dois.
- **Os 26 bichos do Quaternius perderam a animação própria** na conversão para
  FBX. Voltam com o pacote `com.unity.cloud.gltfast`, que ainda não entrou.

## 5. A conta honesta

Das ~45 mil linhas de JS, o que atravessou até agora é a **regra de uma
batalha**. Falta o laço do jogo (calabouço, progressão, itens), falta a metade
do que dá identidade (fusão, IA, eventos de terreno) e falta tudo que é visual
além do tabuleiro.

Não é atraso: é o tamanho real do trabalho, e cada peça acima é uma rodada.
