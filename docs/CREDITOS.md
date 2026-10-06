# CRÉDITOS — música do SOTERRA

Os modelos 3D têm o registro deles em `docs/CREDITS_3D.md`. Este arquivo é o da
**música de fundo** (`assets/musica/`, tocada por `js/audio.js`).

Todas as faixas são **CC0 (Creative Commons Zero, domínio público)**: podem ser
usadas, alteradas e redistribuídas, inclusive em jogo comercial, sem pedir
licença e sem crédito obrigatório. O registro abaixo existe para provar de onde
cada arquivo veio — e porque é o mínimo que se deve a quem publica música boa de
graça.

A licença foi conferida **na página de cada faixa, em 06/10/2026**, antes de
baixar (o campo "License(s)" da página dizia CC0 nas quatro). Só entra aqui
faixa cuja página diga CC0.

| Papel no jogo | Faixa | Autor | Página | Licença | Baixado em | Arquivo de origem |
|---|---|---|---|---|---|---|
| Praça, sede e toda tela fora da luta | Medieval: The Bard's Tale (a versão em laço) | RandomMind | https://opengameart.org/content/medieval-the-bards-tale | CC0 | 06/10/2026 | `Loop_The_Bards_Tale.wav` |
| Luta comum (1) | Heartfelt Battle (Loopable, fantasy, strings/piano/horn) — só o laço | request | https://opengameart.org/content/heartfelt-battle-loopable-fantasy-stringspianohorn | CC0 | 06/10/2026 | `heartfelt-battle_loop.ogg` |
| Luta comum (2), alterna com a 1 | Heavy Battle 2 | MintoDog | https://opengameart.org/content/heavy-battle-2 | CC0 | 06/10/2026 | `heavy_battle_2_bpm185.ogg` |
| Luta de chefe | Heavy Boss Battle 1 | MintoDog | https://opengameart.org/content/heavy-boss-battle-1 | CC0 | 06/10/2026 | `heavy_boss_battle_1_bpm200_0.ogg` |

## O que foi feito com cada arquivo

Nenhuma nota foi mexida. Cada faixa foi só **recodificada e nivelada** por
`tools/musica_converte.py`:

- Ogg Vorbis a ~96 kbps (o que o jogo toca) e MP3 a 112 kbps (a reserva do
  navegador que não toca Ogg), 44,1 kHz estéreo;
- todas na **mesma altura média** (RMS 0,10, cerca de −20 dB): os originais
  iam de −23 dB (Heartfelt Battle) a −13 dB (Heavy Boss Battle 1), e sem isso
  "bem de leve" valeria para uma faixa e não para a outra.

| Arquivo em `assets/musica/` | Duração | .ogg | .mp3 |
|---|---|---|---|
| `praca-bards-tale` | 57,7 s | 0,60 MB | 0,77 MB |
| `luta-heartfelt-battle` | 153,6 s | 1,42 MB | 2,05 MB |
| `luta-heavy-battle-2` | 83,0 s | 0,89 MB | 1,11 MB |
| `chefe-heavy-boss-battle-1` | 108,0 s | 1,19 MB | 1,44 MB |

## Trocar ou acrescentar uma faixa

1. Só de página que diga **CC0**. A reserva pensada para a praça
   ("Peaceful village loop", de elerya) é **CC-BY 3.0** e por isso NÃO entrou.
2. Rode `tools/musica_converte.py` (o cabeçalho dele diz como) e ponha os dois
   arquivos em `assets/musica/` com um **nome novo**: o servidor manda o
   navegador guardar a música por 30 dias (o `@musica` dos dois Caddyfile), e
   arquivo trocado com o mesmo nome continuaria tocando o antigo.
3. Aponte a faixa na tabela `FAIXAS` do `js/audio.js` e acrescente a linha aqui.
