# Plano: SOTERRA na Unity

Escrito em 18/08/2026, depois de provar que dá para desenvolver na Unity por
linha de comando nesta máquina. O que está aqui é **plano**, não promessa de
prazo — e a fase 3 depende de uma decisão sua que ainda não foi tomada.

## O que já é fato, medido nesta máquina

| | |
| --- | --- |
| Editor | 6000.5.8f1, com módulos **WebGL** e **Windows Standalone** |
| Licença | Unity Personal, atribuída; entitlement `com.unity.editor.headless` — é ela que libera `-batchmode` |
| Projeto | `unity/SOTERRA-Tatico`, URP 17.6.0, abre sem diálogo de atualização |
| Testes | 6 testes EditMode, 6 passando em 0,054 s |
| Foto | PNG 1280×800 renderizado sem ninguém apertar Play |

Tudo isso roda por `unity/lote.ps1`. **Nada precisou de mouse.**

## O tamanho real da travessia

`js/` tem 44.647 linhas. Elas não valem todas o mesmo:

| parte | linhas | atravessa? |
| --- | --- | --- |
| dados (`js/core/data/*.js`) | 7.872 | **sim** — viram JSON |
| regra (`engine`, `game`, `ai`, `fusion`, `progress`, `data.js`) | 6.832 | **reescrita mecânica** em C# |
| render 2D (`art`, `renderer`, `fx`, `spriteart`) | 8.897 | não |
| render 3D (Three.js) | 11.388 | não |
| interface (`hud`, `debug`) | 2.936 | não |

Ou seja: ~15 mil linhas atravessam de alguma forma, ~23 mil não. **Migrar é
reescrever.** O que a Unity devolve em troca é iluminação, sombra, câmera,
animação, entrada de toque e build — coisas que hoje custam código próprio.

## Fase 1 — os dados atravessam

O maior valor pelo menor risco. Os arquivos de dados **não são só literais**:
`fusions.js`, `items.js`, `monsters.js` e `pets.js` têm funções que geram
conteúdo. Então não dá para converter o texto — tem que exportar o **resultado**
depois que o JS roda.

- Não há Node nesta máquina. O caminho é o mesmo já usado para screenshot:
  Chrome headless carrega os `<script>`, `JSON.stringify(DATA)` e o dump sai
  pelo `--dump-dom`.
- Saída em `Assets/StreamingAssets/dados/*.json`, lida por classes C#.
- **Teste de fronteira:** conferir as contagens (171 feitiços, ~105 formas de
  fusão, 90 itens, 6 calabouços) contra o JS. Se divergir, quebrou na travessia.

## Fase 2 — a regra atravessa

`engine.js` é puro e legível; virar C# é trabalho mecânico, não invenção. Regra:
**classes simples, sem `MonoBehaviour`** — assim roda em teste EditMode, sem
cena, em milissegundos.

- Critério de aceite: **mesma semente, mesmo resultado** nas duas casas. Sem
  isso, "portei o motor" é opinião.
- Oportunidade: o README (§7.1) registra que o equilíbrio da fusão está quebrado
  e que o teste antigo media a coisa errada. A travessia é a hora de consertar o
  teste, não de carregar o defeito junto.

## Fase 3 — o que não atravessa: render e interface

**Aqui está a decisão pendente.** Duas saídas honestas:

1. **2D isométrico com sprites** — é o que o `CONTRACT_V2.md` manda (Dofus 1.29,
   fixo). Fiel ao documento, mas exige folha de sprite por personagem e por
   direção, e hoje o acervo é modelo 3D, não sprite.
2. **Modelos 3D sob câmera ortográfica fixa em 3/4** — reaproveita os packs CC0
   que já estão no projeto, mantém o enquadramento fixo (nada de câmera livre) e
   é onde a Unity trabalha a favor. Fica mais perto de Dofus 2/Wakfu que de 1.29.

Em qualquer dos dois, a interface vai de **UI Toolkit** (UXML/USS): é texto,
versiona, revisa em diff — e dá para escrever sem clicar no Editor.

## Fase 4 — build

WebGL e Windows, ambos já instalados. O que se perde: hoje o jogo abre com dois
cliques num `index.html`. Na Unity vira build, com tempo de compilação.

## Limites que não mudam

- **Não clico no Editor.** Tudo por código e `-executeMethod`; cena gerada por
  script; verificação por foto renderizada em lote.
- **Não faço login em conta nenhuma** — Asset Store e conta Unity são suas.
- `foto` e `build` **não podem** usar `-nographics`: sem dispositivo de vídeo o
  PNG sai preto.
- O caminho deste worktree é longo e a importação da URP já falhou num arquivo
  por exceder o limite de caminho do Windows (`RenderPipelineConverter…uxml`).
  Não quebrou nada, mas o projeto de verdade é melhor viver perto da raiz.
