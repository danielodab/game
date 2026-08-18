# Ficha de Especificação — Sprites dos Personagens

Guia para gerar a arte dos personagens do SOTERRA 2.0 de forma consistente.
Siga as **regras de ouro** em todas as imagens; sem elas, os personagens não encaixam no tabuleiro.

---

## 1. Regras de ouro (valem para TODAS as imagens)

| Regra | Por quê |
|---|---|
| **Fundo transparente** (PNG). Se não der, use **fundo chapado de uma cor só** — rosa `#FF00FF` ou verde `#00FF00` | O personagem precisa ficar sobre o nosso tabuleiro. Fundo de pedra/cenário me obriga a recortar e o resultado fica sujo nas bordas |
| **Corpo inteiro, sempre** — do topo da cabeça à sola dos pés | Cortar pé ou cabeça inviabiliza a pose |
| **Pés na base da imagem**, personagem centralizado | É pelos pés que eu ancoro o boneco na célula do tabuleiro |
| **Sem sombra no chão** desenhada | O jogo desenha a sombra sozinho, e ela precisa girar com a câmera |
| **Sem chão, sem cenário, sem moldura** | Só o personagem |
| **Mesma escala entre poses do mesmo personagem** | Se o tamanho varia, o boneco "pula" ao trocar de pose |
| **Luz vindo de cima**, neutra | Para casar com a iluminação do tabuleiro |
| Mínimo **512 px de altura** por pose | Dá margem para o zoom |

### Escala entre personagens (importante)

Todos os personagens precisam conviver no mesmo tabuleiro. Use o **Sumô como referência de "grande"**:

```
Sumô (tanque)      ██████████  100%  ← referência, o mais largo e pesado
Invocador           █████████    92%
Bruxo               █████████    90%
Arqueiro            ████████     88%
Espadachim          ████████     88%
Curandeira          ██████       72%  ← a menorzinha
```

Se estiver gerando uma imagem por vez, peça sempre "corpo inteiro em pé, ocupando toda a altura da
imagem" e eu ajusto a escala final no jogo — o que **não** posso corrigir é enquadramento cortado.

---

## 2. As poses necessárias

### Direções — só 5 precisam ser geradas

As outras 3 eu obtenho **espelhando** por código (de graça):

| # | Direção | Gerar? |
|---|---|---|
| 1 | Frente | ✅ gerar |
| 2 | Frente-Esquerda (3/4 frontal) | ✅ gerar |
| 3 | Perfil Esquerdo | ✅ gerar |
| 4 | Costas-Esquerda (3/4 traseiro) | ✅ gerar |
| 5 | Costas | ✅ gerar |
| 6 | Costas-Direita | 🔁 espelho da 4 |
| 7 | Perfil Direito | 🔁 espelho da 3 |
| 8 | Frente-Direita | 🔁 espelho da 2 |

### Conjunto MÍNIMO por personagem (≈ 16 imagens) — já fica ótimo

| Ação | Direções | Imagens |
|---|---|---|
| **Parado** (idle) | as 5 | 5 |
| **Ataque — preparação** | frente, frente-esq, perfil-esq, costas | 4 |
| **Ataque — impacto** | frente, frente-esq, perfil-esq, costas | 4 |
| **Levar dano** | frente | 1 |
| **Morte** | frente (deitado) | 1 |
| **Vitória** | frente | 1 |

### Conjunto COMPLETO (≈ 30 imagens) — se quiser caprichar

Acrescente ao mínimo:

| Ação | Direções | Imagens |
|---|---|---|
| **Andar — passo A** (perna esquerda à frente) | frente, frente-esq, perfil-esq, costas | 4 |
| **Andar — passo B** (perna direita à frente) | frente, frente-esq, perfil-esq, costas | 4 |
| **Conjurar** (gesto de magia) | frente, frente-esq, perfil-esq, costas | 4 |
| **Levar dano** | costas | 1 |
| **Segundo golpe** (outro tipo de ataque) | prep + impacto × 4 direções | 8 |

> **Sobre o "andar"**: se não gerar, eu animo o deslocamento com quique e inclinação a partir da pose
> parada — funciona, mas as pernas não se alternam. Com os 2 quadros, fica caminhada de verdade.

---

## 3. Prompts prontos

Gere **sempre citando a imagem de referência** do personagem (a primeira que você aprovou), para o
estilo não derivar. Os prompts abaixo estão em inglês porque a maioria dos geradores responde melhor
assim — mas funcionam traduzidos.

### 3.1 Bloco de estilo (cole em TODOS os prompts)

```
2D game character sprite, bold comic ink outlines, flat cel-shaded colors,
clean vector-like cartoon style, full body from head to feet, centered,
feet at the bottom edge, transparent background, no ground, no shadow,
no scenery, no frame, no text, soft top-down lighting, consistent with
the reference image style and proportions
```

### 3.2 Direções — troque só a frase da câmera

| Direção | Frase a usar |
|---|---|
| Frente | `facing the viewer, front view` |
| Frente-Esquerda | `three-quarter front view, turned slightly to its left` |
| Perfil Esquerdo | `side profile view, facing left` |
| Costas-Esquerda | `three-quarter back view, turned slightly to its left` |
| Costas | `back view, seen from behind` |

### 3.3 Ações — troque só a frase da pose

| Ação | Frase a usar |
|---|---|
| Parado | `standing idle, relaxed but ready stance` |
| Ataque (preparação) | `winding up an attack, weight shifted back, anticipation pose` |
| Ataque (impacto) | `at the moment of impact, arm/weapon fully extended forward, body committed` |
| Andar (passo A) | `mid-walk cycle, left leg forward, right arm forward, body slightly bobbing` |
| Andar (passo B) | `mid-walk cycle, right leg forward, left arm forward, body slightly bobbing` |
| Conjurar | `casting a spell, both arms raised, energy gathering, magical gesture` |
| Levar dano | `recoiling from a hit, head back, off balance` |
| Morte | `defeated, lying face down on the ground, seen from above` |
| Vitória | `victory pose, one fist raised, proud and triumphant` |

### 3.4 Montagem do prompt

```
[DESCRIÇÃO DO PERSONAGEM] , [FRASE DA AÇÃO] , [FRASE DA CÂMERA] , [BLOCO DE ESTILO]
```

**Exemplo pronto** (Sumô atacando de costas, no momento do impacto):

```
A heavy sumo wrestler fighter, massive build, topknot hair, red and gold mawashi belt,
white hand wraps, barefoot, at the moment of impact, arm fully extended forward,
body committed, back view seen from behind, 2D game character sprite, bold comic ink
outlines, flat cel-shaded colors, clean vector-like cartoon style, full body from head
to feet, centered, feet at the bottom edge, transparent background, no ground, no shadow,
no scenery, no frame, no text, soft top-down lighting, consistent with the reference
image style and proportions
```

---

## 4. Descrição das 6 classes (use no lugar de `[DESCRIÇÃO DO PERSONAGEM]`)

| Classe | Descrição para o prompt | Identidade |
|---|---|---|
| **Sumô** (tanque) | `A heavy sumo wrestler fighter, massive build, topknot hair, red and gold mawashi belt, white hand wraps, barefoot` | Escudo e provocação; segura a linha de frente |
| **Arqueiro** (atirador) | `A slender elf archer, long pointed ears, hooded green cloak, leather bracers, wooden longbow, quiver on the back, tall boots` | Dano à distância que acumula marcas |
| **Bruxo** (mago) | `A hooded warlock, wide brimmed pointed hat, long dark purple robe with tattered hem, gnarled wooden staff topped with a glowing crystal, glowing eyes under the hat` | Áreas de média e longa distância |
| **Espadachim** (assassino) | `A lean masked swordsman, dark blue scarf covering the face, light leather armor, flowing cape, slim curved blade in each hand, agile stance` | Velocidade, invisibilidade e veneno |
| **Curandeira** (suporte) | `A short young healer girl, big expressive eyes, cream and gold robe with a hood, flower ornaments in her hair, small wooden staff with a glowing bud on top` | Cura, escudos e bênçãos |
| **Invocador** (invocador) | `A tribal summoner, bone and feather ornaments, green ritual robe, painted face markings, carrying a totem staff and small hanging charms` | Invoca criaturas e arma armadilhas |

---

## 5. Como me entregar

1. Crie a pasta **`assets/packs/`** dentro de `C:\Users\danie\Documents\Jogo\`
2. Salve as imagens lá, uma pasta por personagem: `assets/packs/sumo/`, `assets/packs/arqueiro/`, …
3. Nomeie assim (facilita muito e evita erro):

```
parado_frente.png          ataque_prep_frente.png       andar_a_frente.png
parado_frente-esq.png      ataque_prep_frente-esq.png   andar_b_frente.png
parado_perfil-esq.png      ataque_prep_perfil-esq.png   conjurar_frente.png
parado_costas-esq.png      ataque_prep_costas.png       dano_frente.png
parado_costas.png          ataque_impacto_frente.png    morte_frente.png
                           ataque_impacto_frente-esq.png vitoria_frente.png
                           ataque_impacto_perfil-esq.png
                           ataque_impacto_costas.png
```

4. **Folhas com várias poses juntas também servem** (como as que você já fez) — eu recorto. Só peço que
   cada pose fique bem separada das outras e sem o fundo de cenário.
5. Me avise o que salvou e eu integro.

---

## 6. Ordem sugerida

1. **Sumô completo** — a gente valida o encaixe no jogo de ponta a ponta com ele
2. **Curandeira** — é a outra classe liberada desde o início; com as duas, o jogo já é jogável
3. As demais classes: Arqueiro → Invocador → Espadachim → Bruxo
4. **Monstros** — mesma ficha, mas o conjunto mínimo basta (parado nas 5 direções + ataque prep/impacto
   em 2 direções + morte). São 66 no total, então priorize os dos primeiros calabouços e os 6 chefes
5. **Pets** — 6, e são pequenos: parado nas 5 direções + ataque frente já resolve
