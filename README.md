# SOTERRA 2.0 — Ecos do Mundo Enterrado

Jogo tático de calabouço por turnos, em grade, com fusão de heróis.
Roda no navegador, **abrindo `index.html` direto do disco** — sem servidor, sem
build, sem instalação.

> **Leia antes de mexer:** este arquivo é o mapa **técnico**. Os SISTEMAS do jogo
> — as 7 classes, fusão, feitiços, visão, calabouços, chefes, itens, forja, inventário —
> estão em [`docs/SISTEMAS.md`](docs/SISTEMAS.md). As regras de quem-manda-em-quê
> estão em [`docs/CONTRACT_V2.md`](docs/CONTRACT_V2.md); a intenção de design em
> [`docs/GDD.md`](docs/GDD.md); o equilíbrio de classes e fusões — a régua, as faixas e
> cada ajuste — em [`docs/EQUILIBRIO.md`](docs/EQUILIBRIO.md). Se os dois discordarem do código, **o código
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
| `www/` + `capacitor.config.json` | o mesmo jogo como aplicativo — ver [`docs/CELULAR.md`](docs/CELULAR.md) |
| `index2d.html` | a versão isométrica 2D em PixiJS (linha antiga, preservada) |
| `v1_3d.html` | a primeira linha 3D, preservada para comparação |

---

## 2. A restrição que explica quase todas as decisões estranhas

O jogo tem de abrir por **`file://`**. Isso não é preferência, é requisito —
e derruba três coisas que seriam óbvias em qualquer projeto web:

1. **Nada de ES modules.** `import`/`export` exigem servidor. Todo arquivo é um
   `<script>` clássico e tudo pendura num único global, `JOGO.*`.
2. **Nada de `fetch` — *por `file://`*.** Carregar um `.glb` do disco falha.
   Por isso todo modelo 3D vive **também** embutido em base64 dentro de
   `assets/embedded/*.js` (os ~28 MB de `assets/embedded`).
   **Desde a preparação para celular isso virou um caminho de dois lados**, e
   quem decide é o endereço:

   | endereço | o que carrega |
   |---|---|
   | `file://` (duplo clique) | o base64 embutido, como sempre foi |
   | `http://`, `https://localhost` (dentro do APK) | os `.glb` de verdade de `assets/models/bundle/`, por XHR |

   Quem escolhe é `js/assets_bundle.js`; quem gera os `.glb` é
   `tools/extrai_assets.py`. MEDIDO: 30,84 MB de JavaScript para o motor
   compilar viraram 2,94 MB. Detalhes em [`docs/CELULAR.md`](docs/CELULAR.md).
3. **Nada de bundler.** A ordem dos `<script>` no `index.html` **é** a árvore de
   dependências. Um arquivo que use `JOGO.Engine` tem de vir depois de
   `engine.js`, e não há ferramenta que avise se você errar.

---

## 3. Arquitetura

```
index.html              a ordem dos scripts É a árvore de dependências
capacitor.config.json   o APK: aponta para www/ (gerada) — ver docs/CELULAR.md
js/
  assets_bundle.js      escolhe entre .glb por XHR (servido) e base64 (file://)
  mobile.js             o que este aparelho é: toque? celular? economizar GPU?
  core/
    data/               DADOS — sem lógica, sem DOM, sem Three.js
      elements.js       5 elementos: fogo, água, terra, ar, neutro
      classes.js        7 classes e os 4 caminhos elementais de cada
      spells.js         198 feitiços de classe (medido 19/09)
      fusions.js        147 formas × 25 misturas → 3.675 feitiços compostos (21 duplas)
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
assets/embedded/*.js    modelos em base64 (o caminho file://)
assets/models/bundle/   os MESMOS modelos em .glb de verdade + manifest.json
                        (gerados por tools/extrai_assets.py; o caminho servido)
tests/*.html            55 páginas de teste, cada uma abre sozinha no navegador
docs/                   contrato, GDD, celular, auditorias, pesquisas de acervo
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
estar — e a IA também faz isso.

**Visão (19/09).** Só `#` bloqueia; `=`, buraco e armadilha não. `Engine.los` é
**simétrica e estrita** (traça nos dois sentidos; quem vê é visto), a fresta
entre dois `#` encostados pelo canto está fechada, a **área não atravessa muro**
(toda casa precisa de visão do centro do impacto; a linha para no primeiro
muro), o raio em cadeia não salta por cima de muro nem a explosão de morte fere
através dele, e quem está encostado numa mureta `=` e é atingido por cima dela
tem **cobertura −25%** no dano (sobre o dano já escalado pela dificuldade,
medida da mesma casa de onde a visão do golpe é exigida: o conjurador para o
alvo, o centro do impacto para as outras casas da área, a vítima anterior para
cada salto do raio). Todo feitiço com alcance > 0
exige `los`. A régua completa está em `docs/SISTEMAS.md` ("A visão") e a prova em
`tests/visao_mapas.js`.

**Elementos.** Cada classe escolhe **um** dos quatro caminhos elementais no
nível 5, e a escolha é **permanente**. Os outros três galhos ficam visíveis mas
apagados na árvore de feitiços.

**Fusão.** Dois heróis se fundem numa unidade só. A fundida **mantém o uid e a
casa na ordem de iniciativa** do herói A; B sai do tabuleiro
(`alive:false, offBoard:true`), sem evento de morte e sem contar derrota. Os
feitiços da fusão são gerados de `forma × mistura` — a forma decide a mecânica
**e o desenho**, a mistura decide o sabor elemental.

**Feitiço misto (03/10).** O que fere pega quem estiver na área, menos quem lança (o fogo
amigo existe); o que ajuda pega quem estiver na área. O feitiço que fere E ajuda — meia
tabela das formas de fusão — fere só o outro lado e ajuda só o próprio, e quem lança sempre
recebe a parte que ajuda (`Engine.feiticoMisto`; `docs/EQUILIBRIO.md` §3).

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
| `test_engine_v2.html` | 218 passaram / 0 falharam (19/09: +9 da visão e da cobertura; medido em Node com dublê de DOM) |
| `test_progress_v2.html` | **118 passaram / 56 falharam** (medido 03/10 na base `39a6ae9` e depois — iguais). O "174 / 0" que estava aqui veio de um conserto de 21/09 que nunca entrou em ramo nenhum (`git log --all -- tests/test_progress_v2.html`) |
| `validate_fusion.html` | 6.607 checagens, **51 falhas** (3.675 composições) — saque e pedras, nenhuma de fusão; as mesmas antes e depois de 03/10 |
| `validate_world.html` | 7.185 checagens (19/09: cobra "alcance > 0 ⇒ los:true"); em Node 7.184 OK — a varredura de fonte exige `http://` |
| **`visao_mapas.js`** (Node) | 210 passaram / 0 falharam — 20 salas + 10 andares do Poço: 0 vazamentos por muro, 0 assimétricos, 0 frestas de canto, área sem casa atrás de muro, cobertura −25% (depois da dificuldade, medida de onde a visão do golpe é exigida: conjurador, centro da área, vítima anterior do raio), raio e explosão de morte presos pelo muro |
| **`regras_versao_api.py`** (Python, juiz + API) | 8 de 8 — a versão das regras do bilhete, da sala em grupo, do duelo e da guerra: 409 na abertura (versão errada OU sem o campo, em sala/grupo/duelo/confirmar da guerra), 410/`vencida` no fechamento, linha ausente = versão 1 |
| `validate_classes.html` | 7.088 checagens, **7 falhas** — o teste crava `starCosts = [5,15,30,55,90]` e o dado é `[5,15,35,65,110]` (a escada de 30/08); as mesmas antes e depois de 03/10 |
| `validate_data.html` | 2.631 checagens, 0 falhas |
| `efeitos_um_a_um.html` | 7 de 7 — 186 desenhos disparados um a um |
| `armadilha_chao.html` | passou — 5 armadilhas, uma cor por elemento |
| `carga.html` | passou — 23,87 MB servido contra 30,84 MB embutido |
| `toque.html` | 12 de 12 — mirar com o dedo, agir com o mouse |
| `celular.html` | 13 de 13 — o `index.html` num quadro de 390×844 |
| `perf.html` | passou — 193 chamadas de desenho no perfil de celular |
| **`equilibrio.js`** (Node) | a prova do equilíbrio ([`docs/EQUILIBRIO.md`](docs/EQUILIBRIO.md)); medida completa de 03/10: **399 de 436** — perfis 198/198, fusão 119/126 (sobram degraus nos níveis de conferência 16 e 25), duelos em dupla 62 de 84 células em 40–60% (o Minotauro é a maior parte do que sobra). Ver §7.1 |
| `equilibrio_fusao.html` | a mesma conta da fusão no navegador (8 misturas) |

As quatro últimas são a preparação para celular; o passo a passo do APK e todos
os números medidos estão em [`docs/CELULAR.md`](docs/CELULAR.md).

---

## 6. Acervo e licenças

**Nada foi comprado. Tudo é CC0**, e por isso pode ficar no Git.

| pacote | uso | licença |
|---|---|---|
| KayKit Adventurers / Skeletons / Dungeon Remastered | heróis, esqueletos, cenário | CC0 1.0 |
| Quaternius Ultimate Monsters | bestiário, 6 chefes, 7 invocações | CC0 1.0 |
| Kenney Particle Pack | atlas de partícula e placas de efeito | CC0 1.0 |

**Desde 21/09 o bestiário não é mais emprestado.** Os monstros dos SEIS
calabouços são arte própria do dono, gerada no Meshy e embutida em
`assets/embedded/models-meshy-<calabouço>.js` — a linha do Quaternius acima
vale hoje para as invocações, os pets e os dois monstros da Mina que não
couberam no saldo. Créditos completos em [`docs/CREDITS_3D.md`](docs/CREDITS_3D.md).

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

### 7.1 O equilíbrio: medido, acertado, e o que sobrou

Até 02/10 só a fusão tinha régua (`equilibrio_fusao.html`, "18 de 30 duplas na faixa"), e ela
media um turno só, com quatro defeitos que já tinham sustentado um "30/30" falso. Desde 03/10
a bancada `node tests/equilibrio.js` mede **classes, caminhos, fusões e duelos** com a mesma
régua, determinística, e o documento [`docs/EQUILIBRIO.md`](docs/EQUILIBRIO.md) diz as faixas,
o porquê de cada uma e cada ajuste feito. Em resumo:

- a medida achou **regras erradas**, não só números: o feitiço misto (efeito a favor E hostil)
  acertava o lado errado em dezoito formas de fusão, a armadilha do Minotauro caía em cima do
  próprio muro, e a IA dava valor zero ao muro e ao teleporte — consertados, `VERSAO_REGRAS` 6;
- nos duelos em dupla com a IA dos dois lados, o **alcance** decidia: o Caçador e o Bruxo
  venciam 66–80%. Alcance −2 neles (−1 no Xamã) e uma potência por classe e degrau;
- o `PAIR_TUNE` ganhou **nível** (`[k5, k12, k30]`), e a fusão ficou a ±20% em 119 de 126
  medidas (era 53 de 126 com a régua nova).

**O que ficou aberto** (§6 do documento): o **Minotauro** na régua da IA (35–44%; números
sozinhos não o trazem — decisão do dono), degraus de fusão no 16 e no 25, e a **paridade de 5
níveis** do PvP (o lado mais alto vence 65–80%).

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
  tarde. É a maior parte do valor: 198 feitiços, 147 formas de fusão, o
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
