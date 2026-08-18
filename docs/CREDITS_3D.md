# CRÉDITOS — camada 3D do SOTERRA 2.0

Todos os modelos usados na apresentação 3D são **CC0 (Creative Commons Zero,
domínio público)**. Nenhum exige atribuição e todos podem ser redistribuídos —
por isso os originais ficam versionados em `assets/models/` e as versões
otimizadas ficam embutidas em base64 em `assets/embedded/models-*.js`.

Creditamos mesmo assim: é o mínimo que se deve a quem publica arte boa de graça.

---

## 1. Personagens jogáveis e esqueletos

| Pacote | Autor | Licença | Origem |
|---|---|---|---|
| **KayKit — Character Pack: Adventurers 1.0** | Kay Lousberg (kaylousberg.com) | CC0 1.0 | https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0 |
| **KayKit — Character Pack: Skeletons 1.0** | Kay Lousberg (kaylousberg.com) | CC0 1.0 | https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Skeletons-1.0 |

Modelos aproveitados: `Barbarian`, `Knight`, `Mage`, `Rogue`, `Rogue_Hooded`,
`Skeleton_Warrior`, `Skeleton_Rogue`, `Skeleton_Mage`, `Skeleton_Minion`.

Os nove compartilham **exatamente o mesmo esqueleto de 41 ossos** (Universal
Animation Library do KayKit). Por isso o jogo embute **um único banco de
animações** (`assets/embedded/models-anims.js`, 30 clipes extraídos de
`Skeleton_Warrior.glb`) e reaproveita esse banco em todos os personagens —
economia de ~30 MB em relação a embutir os 76–95 clipes de cada arquivo.

## 2. Cenário

| Pacote | Autor | Licença | Origem |
|---|---|---|---|
| **KayKit — Dungeon Remastered 1.0** | Kay Lousberg | CC0 1.0 | https://github.com/KayKit-Game-Assets/KayKit-Dungeon-Remastered-1.0 |

49 peças (pisos, paredes modulares, pilares, tochas, estandartes, barris,
caixas, baús, mesas, entulho) já embutidas em `assets/embedded/env-kit.js`
desde a versão 1 do jogo. A camada 3D da v2 reaproveita o montador de salas de
`js/render3d/models3d.js` (auto-tiling de paredes por máscara de vizinhança,
buracos com profundidade, props de borda, fusão de geometria por material).

Escolha deliberada: **o cenário é do mesmo autor e do mesmo estilo dos
personagens**, então tudo casa sem retoque.

## 3. Criaturas

| Pacote | Autor | Licença | Origem |
|---|---|---|---|
| **Easy Enemies** (Frog, Spider, Wasp, Snake, Rat) | Quaternius | CC0 1.0 | https://quaternius.com/packs/easyenemy.html |
| **Animals / Farm Animal** (Wolf, Fox, Stag, Bull) | Quaternius | CC0 1.0 | https://quaternius.com/packs/farmanimal.html |
| **Animated Dinosaurs** (Velociraptor, Trex, Triceratops) | Quaternius | CC0 1.0 | https://quaternius.com/packs/animateddinosaurs.html |

Baixados do espelho GLTF `github.com/trebeljahr/quaternius-showcase` (mesmo
conteúdo, formato `.glb` pronto). Cada criatura traz o **próprio** conjunto de
animações (3 a 13 clipes: parado, andar, correr, atacar, morrer, pular).

## 4. Bibliotecas

| Biblioteca | Licença | Uso |
|---|---|---|
| three.js r147 (`vendor/three.min.js`) | MIT | motor 3D |
| GLTFLoader, EffectComposer, RenderPass, ShaderPass, UnrealBloomPass, CopyShader, LuminosityHighPassShader | MIT (three.js) | carga de modelos e pós-processamento (bloom) |

## 5. O que é feito em código (sem asset externo)

- **Efeitos** (`js/render3d/fx3d_v2.js`): partículas, projéteis, clarões, anéis
  de choque, decalques de chão e números de dano são gerados em tempo real —
  nenhum sprite baixado. As texturas de partícula saem de `<canvas>`.
- **Clima**: chuva, poeira de estiagem, rajadas de vendaval e tremor são
  sistemas de pontos gerados no código.
- **Retratos da HUD**: renderizados a partir dos próprios modelos 3D numa cena
  offscreen com luz de três pontos (`Models3D2.portrait`).
- **Céu**: cúpula com gradiente por `ShaderMaterial`.

## 6. Orçamento de bytes embutidos

| Arquivo | Conteúdo | Tamanho |
|---|---|---|
| `assets/embedded/models-anims.js` | banco de 30 animações KayKit | ~1,8 MB |
| `assets/embedded/models-heroes.js` | 5 aventureiros + 4 esqueletos (sem animação) | ~3,9 MB |
| `assets/embedded/models-monsters.js` | 12 criaturas Quaternius (com animação) | ~7,1 MB |
| `assets/embedded/env-kit.js` | 49 peças de cenário (já existia) | ~2,9 MB |
| **Total** | | **~15,7 MB** (limite acordado: 25 MB) |

## 7. Mapa de aparências (o que virou o quê)

### Classes — CONCEITO NOVO (repassar ao Criativo Classes)

Os ids internos **não mudam** (`sumo`, `arqueiro`, …) e a identidade tática está
preservada; só a aparência foi trocada para caber no acervo CC0.

| id | papel | modelo | adereços visíveis | conceito novo |
|---|---|---|---|---|
| `sumo` | tanque | Barbarian | machado de 2 mãos + capa | bárbaro corpulento |
| `arqueiro` | atirador | Rogue_Hooded | besta de 2 mãos + capa | batedor encapuzado |
| `bruxo` | mago | Mage | cajado + chapéu + capa | mago de chapéu pontudo |
| `espadachim` | assassino | Rogue | duas adagas | ladino ágil |
| `curandeira` | suporte | Knight | espada + escudo de brasão + capa | paladina/clériga de armadura clara |
| `invocador` | invocador | Mage (sem chapéu) | grimório aberto + varinha + capa | xamã |

O tom de cada uma vem da `palette.primary` de `DATA.classes` — o elemento
escolhido entra como emissivo, não como cor de corpo.

### Monstros (66) e chefes (6)

Sem correspondência exata em acervo CC0 para um bestiário autoral. A regra usada:

- **humanoides** (Corte Afogada, Prole da Fornalha, Guarda do Coração, Coro dos
  Andaimes, Turno da Noite) → os 4 esqueletos KayKit (`Warrior`, `Rogue`,
  `Mage`, `Minion`), variando por **tint elemental** e **porte**;
- **bichos** (insetos, serpentes, anfíbios, feras, invocações) → criaturas
  Quaternius (`Spider`, `Wasp`, `Snake`, `Frog`, `Rat`, `Wolf`, `Fox`, `Stag`,
  `Bull`, `Velociraptor`, `Trex`, `Triceratops`);
- **6 chefes com modelo próprio e porte maior** (altura-alvo 2,95 contra 1,80
  do monstro comum): Jardineira-Viúva → Stag · Baronesa Salmoura →
  Skeleton_Mage · Magno o Acendedor → Trex · Cambota → Skeleton_Warrior ·
  Batepedra → Triceratops · Coração Partido → Trex neutro.

O mapa completo, por id, está em `M.MONSTER_LOOK` (js/render3d/models3d_v2.js).

**Aproximações assumidas** (registradas para revisão futura):

- a Flora Voraz (plantas carnívoras) usa serpente/aranha/sapo tingidos de verde
  — é o que existe em CC0 no mesmo estilo; um pacote de plantas animadas
  resolveria melhor;
- os esqueletos KayKit **não trazem arma embutida** no GLB de personagem (as
  armas vêm num pacote separado, em `.gltf`+`.bin`), então as listas `show` das
  famílias humanoides ainda não têm efeito: a variação vem de modelo, cor e
  porte. Embutir `Skeleton_Blade/Axe/Staff/Crossbow/Shield_*` é o próximo passo
  barato de qualidade;
- os pets reaproveitam criaturas pequenas do mesmo acervo.

### Fusões (15 duplas)

Sistema, não casos escritos à mão (`fusionLook` em `models3d_v2.js`):

1. **corpo** = classe de silhueta dominante (tabela `BULK`: sumo 5 · curandeira 4
   · invocador/bruxo 3 · arqueiro 2 · espadachim 1);
2. **arma-assinatura da outra classe** acoplada ao osso `handslot.l` (punho livre);
3. **cor** = paleta do hospedeiro puxada 34% para a do hóspede;
4. **aura** = emissivo misturando os dois elementos da fusão;
5. **porte** = 1,26× (altura-alvo 2,55 contra 2,05 do herói).

As 15 duplas foram verificadas: todas montam corpo + enxerto sem erro.

## 8. Como reproduzir os arquivos embutidos

Os originais `.glb` ficam em `assets/models/`. O gerador é
`scratchpad/glbtool.py` + `scratchpad/gen_models.py`:

1. `prune(src, dst, keep_anims=[…], drop_meshes=…)` remove animações não usadas,
   coleta lixo (accessors, bufferViews, materiais, texturas) e reempacota o
   buffer binário;
2. `to_b64_js(files, out)` gera o `JOGO.MODELS['chave'] = 'base64…'`.

O jogo abre por `file://`, onde `fetch` de `.glb` falha — por isso tudo é
embutido e carregado com `GLTFLoader.parse(ArrayBuffer)`.
