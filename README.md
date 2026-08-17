# SOTERRA — Ecos do Mundo Enterrado

Jogo tático por turnos em grade, no estilo Dofus/Wakfu, focado em calabouços. Roda no navegador,
em HTML5 + JavaScript puro, com gráficos 3D em WebGL (Three.js) e câmera que orbita o campo em 360°.

> Há mil anos o céu virou pedra e esmagou tudo que estava sob céu aberto. O mundo só sobreviveu
> dentro dos **Fechos** — calabouços-cofre mantidos vivos por um Coração cada. Os calabouços não são
> parte do mundo: eles **são** o mundo. Três Corações estão falhando.

## Como jogar

Abra `index.html` no navegador (duplo clique já funciona) ou sirva a pasta por HTTP.

- **Arraste o mouse** para girar a câmera ao redor do campo; **roda** para zoom.
- **Clique** numa célula para mover, ou selecione um feitiço na barra e clique no alvo.
- Escolha de **1 a 3 heróis**: quanto menos heróis, maior a chance de itens raros.
- Cada calabouço tem **3 salas** (2 normais + chefe). Entre salas os heróis se recuperam parcialmente.

## Conteúdo

- **5 raças originais**: Sineiros (bronze com cabeça-sino), Pávios (cera com chama viva),
  Miceles (povo-fungo), Vitrélios (vitrais vivos), Fôlegos (torso-sanfona).
- **5 heróis** com papéis táticos distintos: tanque/provocação, assassina com teleporte e
  invisibilidade, invocadora de esporos, suporte de cura e escudos, e controle de posicionamento.
- **23 monstros** com particularidades mecânicas (explodir ao morrer, dividir-se, enfurecer,
  aura de regeneração, imunidade a empurrão) e **3 chefes** com mecânicas próprias.
- **3 calabouços**: A Estufa Soterrada, A Cisterna dos Afogados e O Fecho de Brasa.
- **Progressão**: XP e níveis até 20, 21 equipamentos com raridades, drops por calabouço e
  salvamento automático no navegador.

## Estrutura

```
index.html            entrada do jogo
js/core/              regras: dados, motor de combate, IA, progressão, fluxo de telas
js/render3d/          camada visual 3D (modelos, efeitos, renderizador WebGL)
js/render/            camada visual 2D anterior (mantida; ainda fornece retratos/ícones da HUD)
js/ui/                interface (HUD, seleção de heróis, equipamento)
assets/embedded/      modelos 3D embutidos em base64 (permite abrir via file://)
vendor/               Three.js e utilitários (MIT)
docs/                 contrato técnico, game design, relatórios de QA e de revisão
tests/                suítes de teste que rodam no navegador
```

A camada de regras não conhece a camada visual: ambas conversam pelo contrato descrito em
`docs/CONTRACT.md`, o que permitiu trocar toda a apresentação (2D → 3D) sem tocar no jogo em si.

## Testes

Abra no navegador (via servidor HTTP local):

- `tests/test_engine.html` — motor de combate, IA e fluxo
- `tests/test_progress.html` — XP, níveis, equipamentos e sorteio de drops
- `tests/validate_data.html` — validação de todos os dados do jogo
- `tests/sprite_gallery.html` e `tests/preview3d.html` — galerias e cena de desenvolvimento

## Créditos

- Modelos de cenário: [KayKit Dungeon Remastered](https://kaylousberg.itch.io/) por Kay Lousberg (CC0).
- Motor 3D: [Three.js](https://threejs.org/) (MIT).
- Demais gráficos, personagens, efeitos, código e conteúdo: criados para este projeto.
