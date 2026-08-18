# SOTERRA 2.0 — Ecos do Mundo Enterrado

Jogo tático de calabouço por turnos, em grade, inspirado em Dofus/Wakfu.
Roda no navegador, **abrindo `index.html` direto do disco** — sem servidor, sem
build, sem instalação.

> **Leia antes de mexer:** este arquivo é o mapa. As regras de quem-manda-em-quê
> estão em [`docs/CONTRACT_V2.md`](docs/CONTRACT_V2.md); o desenho de jogo está
> em [`docs/GDD.md`](docs/GDD.md). Se os dois discordarem do código, **o código
> está certo e o documento está velho** — corrija o documento.

---

## 1. Como rodar

**O jeito do jogador:** abra `index.html` com dois cliques. É só isso.

**O jeito de quem desenvolve** (necessário para os testes, porque `fetch` de
`.glb` falha em `file://`):

```bash
python -m http.server 8137 --directory .
```

E abra <http://localhost:8137/index.html>.

Outras portas de entrada:

| arquivo | o que é |
|---|---|
| `index.html` | o jogo, tabuleiro 3D (Three.js) |
| `index2d.html` | a versão isométrica 2D em PixiJS (linha antiga, preservada) |
| `v1_3d.html` | a primeira linha 3D, preservada para comparação |

---

## 2. A restrição que explica quase todas as decisões estranhas

O jogo tem de abrir por **`file://`**. Isso não é preferência, é requisito —
e derruba três coisas que seriam óbvias em qualquer projeto web:

1. **Nada de ES modules.** `import`/`export` exigem servidor. Todo arquivo é um
   `<script>` clássico e tudo pendura num único global, `JOGO.*`.
2. **Nada de `fetch`.** Carregar um `.glb` do disco falha. Por isso **todo
   modelo 3D vive embutido em base64** dentro de `assets/embedded/*.js`. É o
   motivo de o repositório ter ~28 MB de `assets/embedded`.
3. **Nada de bundler.** A ordem dos `<script>` no `index.html` **é** a árvore de
   dependências. Um arquivo que use `JOGO.Engine` tem de vir depois de
   `engine.js`, e não há ferramenta que avise se você errar.

---

## 3. Arquitetura

```
index.html              a ordem dos scripts É a árvore de dependências
js/
  core/
    data/               DADOS — sem lógica, sem DOM, sem Three.js
      elements.js       5 elementos: fogo, água, terra, ar, neutro
      classes.js        6 classes e os 4 caminhos elementais de cada
      spells.js         171 feitiços (162 de caminho + 9 cargas de armadilha)
      fusions.js        105 formas × 16 misturas → 2.625 feitiços compostos
      monsters.js       bestiário, chefes, invocações
      items.js          itens e conjuntos
      items_extra.js    ADITIVO: 3º conjunto por calabouço + avulsos
      dungeons.js       6 calabouços, salas, eventos de terreno, clima
      progression.js    curva de nível e desbloqueio
      pets.js           bichos de estimação
    engine.js           REGRA PURA de batalha. Não conhece DOM nem Three.js.
    fusion.js           compõe os feitiços de fusão e resolve a fusão
    ai.js               inimigos
    progress.js         save, inventário, forja, estrelas, coleção
    game.js             a máquina de estados entre telas
  render3d/
    models3d_v2.js      modelos, "looks" de classe, enxerto de peça, retratos
    renderer3d_v2.js    tabuleiro, câmera, clima, sobreposições, armadilhas
    fx3d_v2.js          partículas, placas e as 21 famílias de efeito
    portraits3d.js      embrulha Art.* para servir retrato 3D em vez de 2D
  render2d/
    art.js              ícones e desenho procedural (o retrato 2D de emergência)
  ui/
    hud.js              TODA a interface
    debug.js            painel de teste (libera classes, nível, modo de efeitos)
  main.js               o laço de quadro
assets/embedded/*.js    modelos em base64 (a consequência do file://)
tests/*.html            50 páginas de teste, cada uma abre sozinha no navegador
docs/                   contrato, GDD, auditorias, pesquisas de acervo
unity/SOTERRA-Tatico/   prova em C# da mesma grade tática (ver §9)
```

### A regra de ouro

**`js/core/` não conhece o navegador.** Nem DOM, nem Three.js, nem `window`. É
o que permite testar a regra de batalha sem abrir tela — e é o que vai
atravessar para a Unity, se a migração acontecer.

---

## 4. As regras de jogo, em uma página

**Turno.** Cada unidade tem **PA** (ação) e **PP** (passo), que enchem no começo
do turno dela. Andar gasta PP por casa; conjurar gasta PA.

**Distância é Manhattan**, sem diagonal — andar na diagonal custaria dois passos
de qualquer jeito, então medir em linha reta mentiria sobre o custo.

**Alcance x área.** `range` diz até onde o feitiço chega; `aoe` diz o que ele
pega ao chegar. Formas de área: `single`, `circle`, `cross`, `cone`, `line`,
`ring`.

**Feitiço de área mira o CHÃO.** Quando `aoe.shape !== 'single'` e `size > 0`, a
célula-alvo é um **lugar**: basta estar no alcance, e a área pega quem estiver
dentro — ou ninguém. Só feitiço de alvo único exige criatura na célula. Isso
permite largar a explosão *entre* dois inimigos ou chutar onde o outro vai
estar.

**Elementos.** Cada classe escolhe **um** dos quatro caminhos elementais no
nível 5, e a escolha é **permanente**. Os outros três galhos ficam visíveis mas
apagados na árvore de feitiços.

**Fusão.** Dois heróis se fundem numa unidade só. A fundida **mantém o uid e a
casa na ordem de iniciativa** do herói A; B sai do tabuleiro
(`alive:false, offBoard:true`), sem evento de morte e sem contar derrota. Os
feitiços da fusão são gerados de `forma × mistura` — a forma decide a mecânica
**e o desenho**, a mistura decide o sabor elemental.

**Clima** (chuva, vento, tremor) favorece ou prejudica, e é por sala.

---

## 5. Testes

50 páginas em `tests/`. Cada uma **abre sozinha no navegador** e se pinta de
verde ou vermelho — não há runner, não há `npm test`.

### O padrão que funciona neste projeto

O painel de navegador embutido **não compõe quadros** (o `requestAnimationFrame`
não dispara), então captura de tela e teste 3D **têm de rodar em Chrome
headless**:

```bash
"/c/Program Files/Google/Chrome/Application/chrome.exe" \
  --headless=new --disable-gpu --enable-unsafe-swiftshader \
  --virtual-time-budget=150000 \
  --dump-dom "http://localhost:8137/tests/test_engine_v2.html"
```

E lê-se a `<div id="summary">` do DOM despejado. Para foto, troque `--dump-dom`
por `--window-size=L,A --screenshot=caminho.png`.

> **Cuidado ao julgar imagem headless:** o WebGL ali é por **software**
> (SwiftShader) e sai pálido. Nunca conclua "está fraco" a partir de uma captura
> headless — compare sempre lado a lado na mesma folha.

### Proteção do save

**Toda** página de teste carrega `tests/save_sandbox.js` como **primeiro
script**. Ele isola o `localStorage` para o teste não corromper o save real do
jogador. Página nova sem essa linha é bug.

### Estado das baterias (medido agora)

| bateria | resultado |
|---|---|
| `test_engine_v2.html` | 209 passaram / 0 falharam |
| `test_progress_v2.html` | 174 passaram / 0 falharam |
| `validate_fusion.html` | 5.767 checagens, 0 falhas (2.625 composições) |
| `validate_world.html` | 6.719 checagens, 0 falhas |
| `validate_classes.html` | 6.204 checagens, 0 falhas |
| `validate_data.html` | 2.631 checagens, 0 falhas |
| `efeitos_um_a_um.html` | 7 de 7 — 186 desenhos disparados um a um |
| `armadilha_chao.html` | passou — 5 armadilhas, uma cor por elemento |
| **`equilibrio_fusao.html`** | **FALHA — 18 de 30 duplas na faixa.** Ver §7 |

---

## 6. Acervo e licenças

**Nada foi comprado. Tudo é CC0**, e por isso pode ficar no Git.

| pacote | uso | licença |
|---|---|---|
| KayKit Adventurers / Skeletons / Dungeon Remastered | heróis, esqueletos, cenário | CC0 1.0 |
| Quaternius Ultimate Monsters | bestiário, 6 chefes, 7 invocações | CC0 1.0 |
| Kenney Particle Pack | atlas de partícula e placas de efeito | CC0 1.0 |

Créditos completos em [`docs/CREDITS_3D.md`](docs/CREDITS_3D.md).

**A regra do `.gitignore` é por LICENÇA, não por nome de arquivo.** Isso já deu
problema: a regra `assets/embedded/fx-*.js` era por prefixo e deixava de fora o
`fx-atlas.js`, que é CC0 e que o `index.html` carrega — quem clonasse baixava um
jogo apontando para um arquivo inexistente.

Fora do Git de propósito:

- `assets/candidatos/` — modelos baixados só para avaliação (~20 MB, CC0, mas
  ainda não aprovados). A análise está versionada em `docs/PROPOSTA_MODELOS.md`
  e `docs/PESQUISA_MODELOS_NAO_CHIBI.md`.
- `tests/qa_shots/` — 138 MB de capturas, regeneráveis pelos testes.

---

## 7. O que está em aberto — leia antes de prometer qualquer coisa

### 7.1 O equilíbrio da fusão está quebrado, e o teste antigo mentia

`equilibrio_fusao.html` mostra **18 de 30** duplas dentro de ±20%. Isso **não é
regressão nova**: a bancada de medição tinha quatro defeitos que sustentavam o
"30/30" anterior —

1. a fusão era medida com **4 PA** contra 12 dos dois heróis separados;
2. com área mirando o chão, o teste pegava o **canto do alcance** como alvo, e o
   bruxo de nível 12 marcava **zero** com os três feitiços de área;
3. o instantâneo não restaurava estado nem semente — a mesma dupla dava 264 ou
   335 **só dependendo da ordem** de medição;
4. media "melhor feitiço repetido", mas 92 das 105 formas só podem ser lançadas
   uma vez por turno, então a fusão largava 6 dos 10 PA sem usar.

Com a bancada corrigida, **6 duplas estão fora por construção**: um coeficiente
constante multiplica nível 12 e nível 30 juntos, e só cabe em ±20% nos dois se a
razão entre eles for ≤ 1,5. Nessas seis vai de **1,52 a 2,90**, e a inclinação
**troca de sinal** entre elas — nenhum valor global resolve.

As saídas honestas: dar ao `PAIR_TUNE` uma **dimensão de nível** (medindo num
terceiro nível, para não virar ajuste exato a dois pontos), ou tratar como
**conteúdo** — as formas de fusão têm bem menos área grande no topo que os
feitiços de classe (`circle:3` aparece 2 vezes em 105 formas contra 13 nos
feitiços).

### 7.2 O elenco é chibi, e isso tem chão

O KayKit mede **2,1 cabeças de altura** — não é só chibi, é o extremo (o chibi
típico fica em 3–4). Tentativa de alcançar proporção heroica por escala de osso
**falhou por medida**: encolher a cabeça deixa uma bola menor sobre um corpo
largo, porque a malha foi modelada chibi e escala não remodela silhueta.

Existe um acervo adulto CC0 em disco (Quaternius Universal, 6,3 cabeças), mas
trocar só o elenco deixa herói adulto pisando em cenário de brinquedo, e **não
existe cenário CC0 adulto equivalente**. Decisão do dono: **fica KayKit**.

### 7.3 Efeitos

As 21 famílias existem e o teste prova que desenham coisas diferentes. O dono
ainda acha que "parece tudo igual" na tela. As placas (billboards) foram
implementadas e acabaram de ser ligadas; **falta o julgamento no tamanho real do
tabuleiro** — julgar em close já enganou uma vez.

### 7.4 Fila

- **Fogo persistente na arma**, com a cor do elemento (depende do resultado das placas).
- Duas invocações de pedra usam `Cactoro` e `GreenSpikyBlob` porque **o pacote
  não tem criatura de pedra nenhuma** — são as mais minerais que ele oferece.

---

## 8. Armadilhas conhecidas deste código

Coisas que já morderam mais de uma vez. Leia antes de mexer em 3D.

**Escala de osso é herdada pelos filhos.** Chapéu, elmo, capa e arma são malhas
simples penduradas num osso, e osso passa escala adiante. O `build` do Bárbaro
infla `chest` para 1,42, e sem desfazer isso o chapéu da fusão saía com **5,73 m
de largura** — mais largo do que o corpo é alto. A correção tem de desfazer a
**cadeia inteira** até a raiz, não só o osso de cima. Mordeu **cinco vezes**.

**A HUD desenha uma vez e não se redesenha.** A arte 3D decodifica em segundo
plano; quem abriu a tela antes disso recebia o desenho 2D de emergência e ficava
com ele para sempre. Existe `UI.repaint()` para isso, e o `portraits3d` o chama
ao terminar de instalar.

**Toda camada nova sob `.ui-root` decide `pointer-events` explicitamente.**
Esquecer isso já travou a tela de fusão (não dava para clicar em confirmar nem
cancelar) — três ocorrências.

**O `renderer.info` zera a cada `renderer.render()`.** Com o pós-processamento
ligado são vários passes por quadro, e ler no fim media só o último: `R.stats()`
devolvia "1 chamada, 1 triângulo". O zerar agora é manual, na entrada do quadro.

**Teste bom cobra a REGRA, não o número.** Já aconteceu três vezes: o teste
cravava `1,10×` em vez de ler `starCfg()`, e uma mudança legítima de curva
"quebrava" um teste que estava certo.

**Julgar por foto não vale.** Testes de aparência precisam contar o que o
renderizador criou — peças visíveis, nós na cena, formas medidas. Conferir na
imagem já deixou passar quatro variantes secretamente idênticas.

---

## 9. Migração para Unity

Existe uma prova pequena em [`unity/SOTERRA-Tatico/`](unity/SOTERRA-Tatico/): a
grade tática mínima em C#, com **a mesma regra** (Manhattan, alcance por busca
em largura, a paleta de `DATA.classes`, o mesmo enquadramento 3/4). O
`LEIA-ME.md` de lá tem os cinco passos até o Play.

**Migrar é reescrever, não portar.** São ~45 mil linhas de JS, e o motor, o
renderizador e a interface **não atravessam**.

**O que atravessa:**

- **Os dados.** `js/core/data/*.js` são objetos literais — viram JSON numa
  tarde. É a maior parte do valor: 171 feitiços, 105 formas de fusão, o
  bestiário, os itens, os 6 calabouços.
- **A regra**, como especificação. `engine.js` é puro e legível; reescrever em
  C# é trabalho mecânico, não invenção.
- **Os modelos CC0**, que na Unity entram com menos briga do que no `file://`
  (sem base64, sem embutir).
- **As decisões medidas** — equilíbrio, curva de estrela, teto de chefe.

**O que se perde:** o jogo abre com dois cliques hoje. Na Unity vira build, com
plataforma, licença e tempo de compilação.

---

## 10. Convenções

- **Comentário explica o PORQUÊ**, não o quê — de preferência o defeito que a
  linha evita. Boa parte dos comentários deste código é memória de bug.
- **Português** em comentário, mensagem de commit e interface. Identificador em
  código segue o que já existe no arquivo.
- **Um commit por assunto**, mensagem explicando o problema antes da solução.
- **Não afrouxar teste para ele passar.** Se o teste está errado, conserte o
  teste e diga o que ele media de errado. Se o contrato está errado, diga isso —
  não mude o número escondido.
