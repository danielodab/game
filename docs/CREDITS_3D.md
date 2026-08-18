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

## 7. Como reproduzir os arquivos embutidos

Os originais `.glb` ficam em `assets/models/`. O gerador é
`scratchpad/glbtool.py` + `scratchpad/gen_models.py`:

1. `prune(src, dst, keep_anims=[…], drop_meshes=…)` remove animações não usadas,
   coleta lixo (accessors, bufferViews, materiais, texturas) e reempacota o
   buffer binário;
2. `to_b64_js(files, out)` gera o `JOGO.MODELS['chave'] = 'base64…'`.

O jogo abre por `file://`, onde `fetch` de `.glb` falha — por isso tudo é
embutido e carregado com `GLTFLoader.parse(ArrayBuffer)`.
