# SOTERRA 2.0 — Ecos do Mundo Enterrado

Jogo tático por turnos em grade, no estilo Dofus, focado em calabouços. Roda no navegador,
em HTML5 + JavaScript puro, com tabuleiro 3D (Three.js) e modelos de personagem animados.

> Há mil anos o céu virou pedra e esmagou tudo que estava sob céu aberto. O mundo só sobreviveu
> dentro dos **Fechos** — calabouços-cofre mantidos vivos por um Coração cada. Os calabouços não são
> parte do mundo: eles **são** o mundo. Seis Corações estão falhando.

## Como jogar

Abra `index.html` no navegador (duplo clique funciona) ou sirva a pasta por HTTP.

- **Arraste** para girar a câmera ao redor do campo; **roda** para zoom. O mapa fica parado — quem se move é você.
- **Clique** numa célula para andar, ou escolha um feitiço na barra e clique no alvo.
- Escolha **1 ou 2 heróis**: quanto menos heróis, maior a chance de itens raros.
- Cada calabouço tem **3 salas** (2 normais + chefe) e um **nível recomendado**. Descer mais fundo
  paga muito mais XP; repetir conteúdo fácil rende cada vez menos.

## Os sistemas

**Elementos e clima.** Fogo ⚔ Água e Terra ⚔ Ar. Cada sala tem um clima que favorece um elemento
(+5 PV por turno) e prejudica o rival (−5). Nos calabouços finais o clima muda sozinho, e alguns
feitiços de nível 30 conseguem virá-lo.

**Seis classes**, cada uma com um papel próprio: Bárbaro (tanque), Batedor (dano à distância com
marcas acumuladas), Bruxo (áreas), Ladino (velocidade, invisibilidade e veneno), Paladina (cura e
escudos) e Xamã (invocações e armadilhas). Começam duas liberadas.

**Caminho elemental.** No nível 5 o herói escolhe Fogo, Água, Terra ou Ar — e a escolha é definitiva.
Novos feitiços abrem nos níveis 5, 10, 12, 15, 20 e 30. São **171 feitiços**, e cada classe joga de
quatro jeitos diferentes conforme o caminho. Cada nível depois da escolha dá +5 PV e +3 de dano
naquele elemento.

**Fusão.** Dois heróis colados podem virar **um só**: a vida soma, ganha +2 PA, +1 PP e 50 de escudo,
e o personagem fundido mistura as duas classes na aparência e nos ataques. Os golpes de fusão são
compostos a partir de 15 duplas de classe × 15 misturas de elemento — mais de **1.800 ataques**
distintos, e um golpe de Ar+Água mostra vento e água ao mesmo tempo.

**Coleção.** Chefes derrubam cartas. Juntando cartas você desbloqueia classes (Xamã 10, Bruxo 10,
Ladino 20, Batedor 25) e sobe a **trilha de 5 estrelas** de cada uma, com bônus permanentes.

**Equipamento e forja.** Inventário único com quatro espaços — **Punho** (o que golpeia), **Passo**
(o que anda), **Casca** (o que protege) e **Lume** (a relíquia acesa, que concede um feitiço) — mais
um espaço de **pet**. Há 12 conjuntos elementais com bônus por peças, e a forja evolui qualquer item
até **+10** com pedras derrubadas pelos monstros (Comum → Raro → Supremo → Magnífico).

**Ritmo.** Turno de 30 segundos, e o tempo que sobra acumula. Clicar fora da zona de um feitiço só
cancela a mira — nunca queima a jogada.

## Estrutura

```
index.html            o jogo (tabuleiro 3D)
index2d.html          a mesma versão em 2D isométrico (PixiJS)
js/core/data/         dados: classes, feitiços, monstros, calabouços, fusões, pets, itens
js/core/              regras: motor de combate, IA, fusão, progressão, fluxo de telas
js/render3d/          apresentação 3D: modelos, efeitos, câmera
js/render2d/          apresentação 2D e os ícones/retratos da interface
js/ui/                interface: HUD, coleção, inventário, forja
assets/               modelos e cenário embutidos (permite abrir por file://)
docs/                 contrato técnico, plano, QA e revisões
tests/                suítes que rodam no navegador
tools/                scripts de recorte e empacotamento de arte
```

A camada de regras não conhece a camada visual: as duas conversam pelo contrato em
`docs/CONTRACT_V2.md`. Foi isso que permitiu trocar a apresentação inteira (2D → 3D) sem tocar no
jogo em si.

## Testes

Sirva a pasta por HTTP e abra:

| Página | O que cobre |
|---|---|
| `tests/test_engine_v2.html` | motor: clima, esquiva, efeitos, fusão, pets, IA e batalhas completas |
| `tests/test_progress_v2.html` | níveis, cartas, estrelas, conjuntos, forja e save |
| `tests/validate_classes.html` | classes, feitiços e curva de progressão |
| `tests/validate_world.html` | bestiário, calabouços, cenário e economia |
| `tests/validate_fusion.html` | fusões, pets e itens |
| `tests/art_gallery.html` · `tests/ui_screens.html` | arte e telas (inclusive em tela de celular) |

## Créditos

- Modelos 3D: **KayKit** (Adventurers, Skeletons, Dungeon Remastered) e **Quaternius** — todos CC0.
  Detalhes em `docs/CREDITS_3D.md`.
- Motores: [Three.js](https://threejs.org/) e [PixiJS](https://pixijs.com/) (MIT).
- Regras, conteúdo, efeitos e código: criados para este projeto.
