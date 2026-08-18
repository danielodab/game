# SOTERRA 2.0 — Projeto de Reconstrução

Documento mestre. Define a visão, os sistemas e a ordem de implementação da versão 2.
O detalhamento técnico (esquemas e APIs exatas) está em `CONTRACT_V2.md`.

---

## 0. Decisões de fundação

| Decisão | Escolha | Porquê |
|---|---|---|
| Motor gráfico | **PixiJS 7.4.2** (WebGL 2D, `vendor/pixi.min.js`, 456 KB) | Renderizador 2D mais rápido da web, usado em jogos mobile de produção. Faz batching automático (milhares de sprites a 60 fps em celular), tem suporte nativo a toque e escala de resolução. Não é um framework opinativo: mantemos nosso motor de regras intacto. |
| Estilo visual | **Dofus 1.29** — isométrico 2D, traço limpo, cores chapadas, animação de desenho ocidental | Pedido do usuário. Leve, legível em tela pequena e barato de produzir em volume (o jogo terá centenas de combinações visuais). |
| Câmera | Isométrica fixa com zoom e arrasto de deslocamento (pan) | Dofus 1.29 não gira a câmera. Simplifica tudo e é o que funciona em celular. |
| Mobile desde o início | Entrada por toque, layout responsivo, alvos ≥ 44 px, nada dependente de *hover* | Requisito de escalabilidade futura. |
| Linha 3D anterior | Preservada no Git (tag `v1-3d`) | Nada se perde; pode voltar como opção. |

**Renomeações:** `PM` passa a ser **PP (Pontos de Passos)**; `PA` = **Pontos de Ataque**.

---

## 1. Elementos e Clima

### 1.1 Os quatro elementos e suas rivalidades

```
        FOGO  ⚔  ÁGUA
        TERRA ⚔  AR
```

Uma única regra para o jogador aprender: **cada elemento tem um rival**. Fogo e Água se anulam;
Terra e Ar se anulam. Existe ainda o **Neutro**, que não tem rival (nem sofre nem se beneficia).

### 1.2 Climas

Cada sala tem um clima. O clima **favorece um elemento e prejudica o rival dele**:

| Clima | Favorece | Prejudica |
|---|---|---|
| **Calmo** | — | — |
| **Chuva** | Água | Fogo |
| **Estiagem** (calor) | Fogo | Água |
| **Vendaval** | Ar | Terra |
| **Tremor** (poeira/areia) | Terra | Ar |

**Efeito:** no início do turno de cada unidade, se o clima favorece o elemento dela, **+5 PV**;
se prejudica, **−5 PV**; se não influencia, nada. Vale para heróis, monstros e pets.

Em calabouços avançados o clima **muda durante a batalha** (a cada N rodadas), e alguns feitiços
de nível alto conseguem **virar o clima** — uma jogada tática poderosa.

### 1.3 Esquiva e Fixação (prender)

Sair de uma célula vizinha a um inimigo exige um teste de **Esquiva** contra a **Fixação** dele.
Falhou: perde PP restantes (e em falha crítica, 1 PA).

O elemento modifica a chance: escapar de um inimigo do **elemento rival é mais fácil (+30%)**;
do **mesmo elemento**, normal; de um elemento **não relacionado, +10%**.
Ex.: um herói de Água esquiva com folga de um monstro de Fogo; outro monstro de Fogo o prenderia
com dificuldade média.

---

## 2. Personagens

Seis classes, cada uma com identidade tática única (pedido do usuário):

> **Atualizado na migração 3D**: a aparência das classes mudou para casar com os modelos CC0
> (decisão registrada em `PLANO_NOITE.md`). Os **ids internos e os papéis táticos são os mesmos** —
> `sumo`, `arqueiro`, `bruxo`, `espadachim`, `curandeira`, `invocador`.

| Classe | id | Arquétipo | Identidade |
|---|---|---|---|
| **Bárbaro** (machado de duas mãos) | `sumo` | Tanque | Escudos altos, provocação, dano pesado corpo a corpo, empurra e prende |
| **Batedor** (besta, capuz) | `arqueiro` | Atirador | Dano à distância que **acumula marcas** no alvo (quanto mais atinge, mais dói) |
| **Bruxo** (chapéu e cajado) | `bruxo` | Mago | Áreas de média/longa distância, maldições e controle de terreno |
| **Ladino** (adagas gêmeas) | `espadachim` | Assassino | Velocidade, invisibilidade, venenos, ataques pelas costas |
| **Paladina** (espada e escudo) | `curandeira` | Suporte | Cura, escudos e bênçãos — e ataca quando precisa |
| **Xamã** (grimório) | `invocador` | Invocador | Invoca criaturas, arma **armadilhas** e potencializa aliados |

### 2.1 Progressão de feitiços

- O personagem começa com **3 ataques neutros** (identidade da classe, sem elemento).
- Ao chegar ao **nível 5, escolhe um elemento** — Fogo, Água, Terra ou Ar. A escolha define
  toda a árvore seguinte e é **permanente para aquele personagem**.
- Novos feitiços desbloqueiam nos níveis **5, 10, 12, 15, 20 e 30** (o de nível 30 é o mais forte).
- **6 classes × 4 elementos × 6 níveis = 144 feitiços elementais**, mais 18 neutros: **162 feitiços**,
  todos com efeitos distintos e fiéis ao elemento.

O que muda por elemento (exemplo com o Sumô):

| Elemento | Como o Sumô joga |
|---|---|
| **Fogo** | Contra-ataque: devolve dano recebido, aquece o próprio corpo, explode ao ser cercado |
| **Água** | Absorve e se cura com o dano que causa; empurra com ondas; fica escorregadio (esquiva) |
| **Terra** | Escudo colossal, imóvel, provoca e **enraíza** os inimigos ao redor |
| **Ar** | Investidas e arremessos: agarra, gira e joga o inimigo longe |

Cada uma das 6 classes tem 4 leituras assim.

### 2.2 Desbloqueio de personagens

- O jogador começa com **2 classes liberadas**.
- Chefes derrubam **cartas de personagem**. Quanto mais forte a classe, mais rara a carta.
- O grupo continua sendo de **1 a 3 personagens** — e a Sorte de Saque (menos heróis = itens
  melhores) continua valendo.

---

## 3. Fusão (o coração da versão 2)

Dois aliados **adjacentes** podem se fundir: um deles gasta a ação **Fusão** e **encerra o turno
colado** no outro. Se qualquer um se afastar antes do fim do turno, a fusão não acontece.

**Ao fundir:**
- Vida = soma da vida restante dos dois
- **+2 PA, +1 PP, +50 de escudo**
- Nível = **média** dos dois (10 + 20 → nível 15)
- Aparência = **mistura das duas classes** (o desenho funde as silhuetas)
- Herda as características das duas classes: Tanque + Invocador vira um *tanque que invoca*;
  Mago + Atirador vira *magia de longo alcance*

**Ataques da fusão:** são **novos**, exclusivos, e combinam os dois elementos.
- Dois de Fogo → ataques de Fogo puro, mais fortes
- Água + Ar → ex.: **Furacão Salgado** — o furacão em área ganha água e causa dano duplo
- Se algum dos dois ainda não escolheu elemento (< nível 5), a fusão gera ataques **neutros**
  com traços das duas classes
- Só ficam disponíveis os ataques cujo nível de desbloqueio seja ≤ nível da fusão

**Como isso é viável em escala:** ao invés de escrever mil feitiços à mão, o jogo **compõe** cada
ataque de fusão a partir de duas peças:

```
     FORMA (dupla de classes)        ×      MISTURA (dupla de elementos)
  "furacão que suga em área"                 "salgado: água + ar"
  (Atirador + Invocador)                     (dano dividido + efeito extra)
                     ↓
            "Furacão Salgado" — dano de Ar e Água,
            puxa os inimigos e deixa poça que envenena
```

São **15 duplas de classe × 5 formas** = 75 formas autorais, e **15 misturas de elemento**,
gerando **mais de mil ataques de fusão distintos** — todos coerentes, todos com nome, efeito e visual.

---

## 4. Pets

Um espaço exclusivo de **pet** por personagem. O pet:
- Dá **bônus fixos** ao dono (vida, PA, PP, poder, resistências)
- **Age sozinho depois que o jogador encerra o turno** — ataca ou fortalece aliados
- Tem **alcance próprio** e **nunca se afasta do dono** (anda junto)

Cinco pets iniciais (temas: dragãozinho de fogo, planta carnívora que prende, águia que empurra,
criatura de água que cura, e um bicho neutro que fortalece). Detalhes em `CONTRACT_V2.md`.

---

## 5. Mapas vivos

### 5.1 Cenário no lugar de muros

As divisórias deixam de ser blocos genéricos: cada calabouço tem **obstáculos temáticos** —
grades e canteiros, colunas quebradas, canais d'água, veios de lava, barracas, cristais, raízes.
Dois tipos:
- **Obstáculo alto**: bloqueia passagem *e* visão
- **Obstáculo baixo** (cobertura): bloqueia passagem, mas **não** a visão — cria jogo de posicionamento

### 5.2 Eventos de terreno (a "surpresa")

A cada rodada podem surgir marcadores no chão, pegos ao pisar:

| Marcador | Efeito |
|---|---|
| ⚡ Bônus | +dano, +PA ou +PP por 1 turno |
| ❓ Surpresa | Pode ser bom ou ruim: dano alto, cura, PA/PP extra, ou perda de vida |
| 🌀 Portal | Teleporta para outro ponto do mapa |
| 🩸 Sanguessuga | Drena vida de quem pisa |
| 💧 Fonte | Recupera vida |

Aparecem em células livres, duram algumas rodadas e mudam a leitura do mapa a cada turno.

---

## 6. Itens, inventário e economia

**Quatro espaços de equipamento + um de pet:**

| Espaço | Tipo de bônus |
|---|---|
| 1 | **PA** — ponto de ataque extra (raro/épico) |
| 2 | **PP** — passos extras |
| 3 | **Vida** — vitalidade e resistências |
| 4 | **Ataque especial** — o item **concede um feitiço novo** (vários itens diferentes = várias táticas) |
| Pet | O companheiro equipado |

Itens caem nos calabouços; quanto mais fundo, melhores. Continua valendo: **menos heróis no grupo,
maior a chance de item raro**.

---

## 7. Calabouços

De 3 passa para **6 calabouços**, em dificuldade crescente, cada um com clima característico,
cenário próprio, monstros próprios e itens exclusivos:

1. **A Estufa Soterrada** — Terra/vegetal · clima Chuva · introdutório
2. **A Cisterna dos Afogados** — Água · clima Chuva/Calmo
3. **O Fecho de Brasa** — Fogo · clima Estiagem
4. **Os Andaimes do Vento** — Ar · clima Vendaval · plataformas e vazios
5. **A Mina Trêmula** — Terra · clima Tremor · desabamentos
6. **O Coração Partido** — todos os elementos · **clima que muda a cada 3 rodadas** · desafio final

Cada calabouço mantém 3 salas (2 + chefe), e os chefes derrubam as cartas de personagem.

---

## 8. Ritmo de jogo

- **Turno de 30 segundos**, com **tempo acumulado**: o que sobrar de um turno entra no próximo
  (jogar rápido vira vantagem para os momentos difíceis).
- **Proteção contra clique acidental**: com um feitiço selecionado, clicar fora da zona válida
  **fecha a seleção** e devolve o controle de movimento, em vez de gastar a jogada.

---

## 9. Ordem de implementação

Tudo é executado nesta sequência, com equipes trabalhando em paralelo dentro de cada fase:

| Fase | O quê | Quem |
|---|---|---|
| **0** | Fundação: PixiJS, contrato técnico v2, esqueleto de dados | Orquestrador ✅ |
| **1** | **Conteúdo**: classes e 162 feitiços · mundo (elementos, climas, monstros, 6 calabouços, terreno) · fusões, pets e itens | 3 agentes Criativos |
| **2** | **Motor**: clima, esquiva/fixação, fusão, pets, armadilhas, eventos de terreno, cronômetro · progressão, caminho elemental, cartas, inventário | 2 agentes de Lógica |
| **3** | **Apresentação**: renderizador PixiJS isométrico, entrada por toque, câmera · arte estilo Dofus 1.29 (classes, fusões, monstros, pets, cenários), interface mobile | 2 agentes Designers |
| **4** | Integração, QA de regressão e veredito | Orquestrador → Revisor → Chefe |

As fases 1, 2 e 3 começam **juntas**: o contrato técnico define os formatos com precisão suficiente
para que motor e arte sejam construídos antes de o conteúdo final existir — foi assim que a v1
foi feita e é o que permite executar tudo de uma vez.
