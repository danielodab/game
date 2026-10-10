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
      arenas.js         os mapas que não são calabouço: a Praça, o Salão da Sede e a Câmara do Eco
      eco.js            o Eco Primordial (02/10): o chefe supremo da semana, os Ecos Menores, as fases
      progression.js    curva de nível e desbloqueio
      pets.js           bichos de estimação
    engine.js           REGRA PURA de batalha. Não conhece DOM nem Three.js.
    fusion.js           compõe os feitiços de fusão e resolve a fusão
    ai.js               inimigos
    poco.js             o Poço sem Fundo: andar semeado, perigos do chão e Colossos
                        (a regra deles; o motor só chama — ver docs/SISTEMAS.md §6)
    progress.js         save, inventário, forja, estrelas, coleção
    game.js             a máquina de estados entre telas
    registro_erros.js   02/10: o erro no navegador de quem joga chega ao Mestre (o 1º script)
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
    moderacao.js        a tela do banido, a denúncia e o correio da Equipe (02/10)
    painel_mestre.js    o painel ÚNICO do Mestre por cima de qualquer tela (M, F9):
                        a Caixa (para ele ou para qualquer jogador, pelo servidor),
                        moedas, contas, denúncias, banimentos, auditoria, eventos do
                        mundo, grimório e ferramentas (03/10: juntou a ficha da M)
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
recebe a parte que ajuda (`Engine.feiticoMisto`; `docs/EQUILIBRIO.md` §3). No feitiço de
alvo próprio e casa única, o efeito hostil é o **preço** e cai em quem lança (a queimadura do
Sangue Fervente e das Veias em Chamas). A prova direta das regras é `node tests/regras_equilibrio.js`.

**O muro de espinhos (03/10).** Todo muro do Minotauro (e das fusões dele) fere o inimigo que
**termina a vez numa casa vizinha** (de lado, não de quina) ou é **jogado contra a pedra**: o `fere`
do feitiço (30) vezes o poder de quem ergueu, uma vez por vez, nunca no próprio lado. A IA dos dois
lados enxerga — quem anda evita, quem ergue aperta — e a tela mostra (estacas ao pé da pedra, casas
vizinhas pintadas, a casa de passo vermelha). `docs/EQUILIBRIO.md` §3.6.

**PvP ranqueado (03/10).** A Arena (quadro de inscritos, vale coroa) aceita até **3 níveis** entre o
herói mais forte de cada lado — o servidor confere no desafio e no fechamento. O Campo de PvP (10) e
a guerra de guilda (10) seguem como estavam.

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

> **Servindo com o `http.server` do Python, suba a fila de conexões** (`request_queue_size`,
> que vem 5). A página que abre o `index.html` inteiro pede centenas de arquivos de uma vez; com
> a fila de 5 o Windows recusa conexões na rajada e um script qualquer não chega — a prova falha
> com "Cannot read properties of undefined" num módulo diferente a cada vez, ou o `gm_agenda.html`
> "estoura as voltas" esperando o menu. Parece regressão de código e não é (medido em 03/10).

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
| `gema.js` (Node) | 29 / 0 (08/10: a Gema Enterrada — juntar fragmentos, o engaste sorteado pelos pesos, o `extra` que viaja com a cópia, os stats, o juiz, a loja e o saque) |
| `prova_toque_batalha.html` | 14 / 0 (08/10, Chrome headless em tempo real pelo DevTools: o "i" fora da barra, a explicação por toque longo ou mouse parado, o lance pelo card da fila, UM laço na antessala) |
| `premio_diario_api.py` | 4 próprias / 0 (08/10: o prêmio diário de resgate — calendário do mês, ordem só pelos resgates, barra no 10º; herda as da autoridade) |
| `torneio_api.py` | 14 / 0 (10/10: o Torneio da Arena no servidor, com o juiz de verdade — os da semana, as vagas até 16, o sorteio com passes, a chamada, o W.O., a revanche, o duelo sem coroa nem vida, o prêmio pago uma vez, o título, a moldura, o carimbo do relé e o torneio de guilda; o contrato é docs/TORNEIO.md) |
| `juiz_titulos_regua.js` (Node) | 8 / 0 (10/10: a régua dos títulos do Torneio da Arena lida como o juiz a lê; `juiz_economia.js` a chama) |
| `notificacoes.js` (Node) | 20 / 0 (08/10: os avisos locais do aplicativo com plugin de mentira, e a casca: package.json, empacota, manifesto) |
| `rele_titulos_prova.py` | 3 / 0 (08/10: o título de pódio que acompanha a posição e a moldura carimbada pelo relé) |
| `estrelas_manuais.js` (Node) | 18 / 0 (08/10: as duas iniciais livres, a carta como moeda, a estrela comprada à mão por 5/10/20/30/45, a migração do save de antes, as ops do juiz, as comuns na loja) |
| `prova_iniciais_estrelas.html` | 14 / 0 (08/10, DevTools em tempo real: a conta nova escolhe dois heróis de qualquer classe em "Quem desce"; as cartas na mão no cartão; o botão ★ Subir na ficha gasta as cartas e a ★ aparece no retrato) |
| `test_progress_v2.html` | **118 passaram / 56 falharam** (medido 03/10 na base `39a6ae9` e depois — iguais). O "174 / 0" que estava aqui veio de um conserto de 21/09 que nunca entrou em ramo nenhum (`git log --all -- tests/test_progress_v2.html`) |
| `validate_fusion.html` | 6.607 checagens, **51 falhas** (3.675 composições) — saque e pedras, nenhuma de fusão; as mesmas antes e depois de 03/10 |
| **`moderacao_api.py`** (Python, API + juiz) | 16 de 16 (03/10: a Caixa inteira para QUALQUER jogador com aviso e carta, as réguas, nada para a lápide nem para a banida, a op do jogador online que sobe por cima da entrega, e — a revisão — cartas e bicho que esperam a luta acabar, com uma sala de verdade fechada paga depois de uma entrega no meio, e a entrega que não muda nada recusada sem aviso) — banimento com prazo (403 com motivo e fim em toda rota e no login depois da senha, o prazo que vence sozinho, desbanir, o banido de antes, o `admin desbanir`), silêncio, denúncia (freios, falas como relato do cliente), a fila com a ação ligada e a carta, a auditoria, o "pôr no inventário" pelo juiz, as ferramentas do Mestre (02/10) e o histórico que diz `expirou` quando o prazo venceu antes de punir de novo ou desfazer (03/10) |
| **`moderacao_rele_prova.py`** (Python, relé de verdade) | 19 de 19 — o token banido ouve `banido` e cai com 4003 (no ident e com a praça aberta), o silenciado não fala, o banimento vencido confere, e a fala sem conta sai com o nome de troca (03/10, a revisão) |
| `gm_agenda.html` (o jogo inteiro) | 33 de 33 (03/10) — os eventos do mundo como a aba Eventos do painel único: só leitura sem a marca, o POST com a marca, a pergunta numa janela por cima do painel, a faixa da praça, o portal e a recompensa |
| `prova_icones_menus.html` | 76 de 76 (03/10) — os menus de ícone; a Caixa do Mestre com as sete abas redondas DENTRO do painel único, o "+10" da pedra pela porta da Caixa no jogo local, e a tecla M com a HUD e o painel juntos (abre, fecha, e o "m" num select do painel não o fecha) |
| **`entregas_cliente.js`** (Node) | 11 de 11 (03/10) — o jogo do jogador online com a entrega do Mestre: a op feita com o hash de antes não se perde, a fila feita durante a viagem fica (e a feita durante a viagem SEGUINTE também — a revisão), `sincroniza` não adota leitura que cruzou com op nova, `adotaDeFora` |
| **`painel_mestre.html`** (navegador) | 76 de 76 (03/10: o painel ÚNICO — as nove abas, a tecla M, o "Para:" que escolhe o jogador (e a própria conta escolhida é o "você"), a Caixa e as moedas para ele sem adotar o estado de outra conta, o aviso dentro do painel, "O Mestre te enviou …" no jogo do jogador; e a revisão: o Tab preso nas janelas e na capa do banido, o foco, a régua de 44 px no toque, a pílula das cartas e o ⚖ no celular) — o painel do Mestre (quem vê, F9, abas, filtros de item, o que vai ao servidor, a adoção do estado), a denúncia pela linha do chat, o correio e a tela do banido — contando o DOM e as camadas que recebem clique |
| `validate_world.html` | **7.914 checagens, 0 falhas** depois da junção de 03/10 (servido; com a seção 9 do Eco e os traços dos Colossos). 19/09: cobra "alcance > 0 ⇒ los:true"; a varredura de fonte exige `http://` |
| **`visao_mapas.js`** (Node) | 218 passaram / 0 falharam (02/10: + a Câmara do Eco) — 21 salas + 10 andares do Poço: 0 vazamentos por muro, 0 assimétricos, 0 frestas de canto, área sem casa atrás de muro, cobertura −25% (depois da dificuldade, medida de onde a visão do golpe é exigida: conjurador, centro da área, vítima anterior do raio), raio e explosão de morte presos pelo muro |
| **`afixos.js`** (Node) | 39 de 39 (07/10) — os afixos do Calabouço do Dia (`js/core/afixos.js`): o catálogo e o afixo do dia de Brasília, cada regra (vida, passo, esquiva, dano do lado inimigo; o clima virado e preso; o chão traiçoeiro fora da entrada, pela semente), o juiz que refaz igual com o mesmo afixo e cai sem ele ou com outro, +25% de XP e vinténs na mesma luta, e o Calabouço do Dia que não muda quando o Poço entra em `DATA.dungeons` |
| **`afixos_api.py`** (Python, juiz + API) | 6 de 6 (07/10; herda as 22 de `autoridade_api.py`) — o caminho escuro (um afixo sorteado da segunda sala em diante, a primeira nunca, torto 400, o portal do dia manda, a sala em grupo igual), `POST /dia` e os `afixos` do `/regras`, o afixo do dia no bilhete do portal do dia (e em nenhum outro), a proposta fora do catálogo que cai 400, a sala em grupo com a mesma regra, e o fechamento que refaz com o afixo do bilhete (sem ele, `divergiu`) |
| **`elites.js`** (Node) | 21 de 21 (07/10) — os elites de sala (`js/core/elites.js`): onde cabem (e onde não gastam tirada do rng), 38% das salas elegíveis com elite em 425 sementes, nunca chefe/colosso/filhote, a mesma semente dá o mesmo elite, cada traço medido num golpe, o juiz refaz igual, ×1,5 de XP e pedra garantida |
| **`feitos.js`** (Node) | 12 de 12 (07/10) — os feitos da coleção (`docs/SISTEMAS.md` §9-A.3): o bestiário por portal, os chefes e as fusões a zero na conta nova, a sala vencida que anota cada corpo e a dupla fundida, +10% de saque no portal completo (e em nenhum outro), +5% de XP por chefes e por fusões, o sanitize que guarda e poda, o hash que muda |
| **`cronicas.js`** (Node) | 16 de 16 (07/10) — as crônicas do mundo enterrado (`docs/SISTEMAS.md` §9-A.4): 14 no dado (o prólogo, uma por portal, uma por chefe, as fusões), a conta nova só com o prólogo, o chefe derrubado que abre a dele (nova até ser lida), o bestiário completo e as 21 fusões |
| **`trilha_api.py`** (Python, juiz + API) | 4 de 4 (07/10; herda as 22 de `autoridade_api.py`) — a trilha da temporada (`docs/SISTEMAS.md` §9-A.2): a temporada da Brasa, os 20 degraus e os prêmios (nunca selo, título, estrela ou peça), a sala vencida que dá 10 e a perdida nada, o resgate que entrega na hora pela fila da loja e só uma vez, e a missão reivindicada que dá 5 |
| **`guilda_meta_api.py`** (Python, juiz + API) | 2 de 2 (07/10; herda as 22 de `autoridade_api.py`) — a meta da semana da guilda (`docs/SISTEMAS.md` §9-A.1): zerada ao fundar, a sala vencida soma e a perdida não, ao encher paga 150 de XP e os dois bônus até a próxima segunda de Brasília, uma vez só; sem guilda nada soma |
| **`programa_api.py`** (Python, juiz + API) | 4 de 4 (07/10; herda as 22 de `autoridade_api.py`) — a semana do SOTERRA (`docs/SISTEMAS.md` §9-A): os sete dias em `programa`, um evento por dia de Brasília em `semanais` com o tipo e o fator do dia, a sexta apontando para o Calabouço do Dia daquela sexta, o de hoje no ar e nos `fatores`, o id estável e que ninguém cancela |
| **`juiz_balcao.js`** (Node) | 18 de 18 (07/10) — o balcão de vinténs (`docs/SISTEMAS.md` §9-B): a Reescrita a 8.000 com trava de 30 dias no relógio do servidor, as pedras do dia a 1.500 com o elemento do chefe do Calabouço do Dia e um lote por dia, o banco que não conta, o hash igual ao da tela, a trava que sobrevive ao load e o relógio do cliente que não entra |
| **`poco_perigos.js`** (Node) | 42 passaram / 0 falharam (02/10) — o chão do Poço e os Colossos: semente decide tudo, perigo nunca na entrada nem em casa de monstro, buraco nunca separa o mapa (nem o rachado debaixo de muro invocado deixa de virar buraco), todo disparo avisado com uma vez inteira para sair, a IA não para em casa avisada (0 em 1.303 decisões), um colosso e um chefe por andar múltiplo de 5, os quatro traços, o juiz refaz andares com perigo e colosso e chega ao mesmo hash |
| `poco_chao_tela.html` | passou (02/10; 03/10: o Colosso veste o corpo PRÓPRIO) — 7 perigos desenhados, avisos acendem e apagam, nada vaza; o colosso mede 1,44× um comum de escala 1,0 |
| **`corpos_lancamento.html`** | 22 de 22 (03/10; 07/10: as alturas do briefing ×2,20/1,80 — o monstro comum subiu de 1,80 para 2,20 m, a invocação para 2,00) — os 15 corpos do lote do lançamento (4 Colossos, 3 Ecos Menores, 8 do Santuário), cada um sozinho pelo `Models3D2.unit`: chave própria, pele com esqueleto, clipe por papel que mexe os ossos, golpe e reação destrocados, altura do briefing, pés no chão, frente em +Z, andar no lugar, morte que derruba, tinta do elemento, retrato da HUD; só o nado da Arraia é ajustado; os dois que não chegaram seguem no provisório. Fecha com quatro folhas de fotos na mesma régua |
| **`corpos_tabuleiro.html`** | 8 de 8 (03/10, refeita em 07/10 com as alturas novas; ~6 min em tempo real) — os mesmos 15 numa SALA REAL (motor + renderizador): um nó por unidade, pele visível, porte do briefing, pés no piso do herói, retrato da linha do tempo com figura. Uma foto por personagem |
| **`eco_motor.js`** (Node) | 74 de 74 (02/10; 03/10: o sorteio rodada a rodada) — o corpo 2×2 (as quatro casas, a área que acerta uma vez, passagem, fixação, nada de empurrão), a visão simétrica em toda casa da Câmara, invisível/armadilha/raio sem brecha, as quatro fases, o golpe avisado, o placar (só o que o grupo tirou), o bônus de derrubar, a 13ª rodada, o hash, a IA jogando a tentativa inteira; e a virada que para esperando o sal (nada anda, sal de outra rodada não entra, a sorte da rodada sai SÓ do sal, um sal por rodada da 2 à 12) e o caminho (SHA-256 conferido com o do Node, JSON canônico que sobrevive à viagem) |
| **`juiz_supremo.js`** (Node) | 27 de 27 (02/10; 03/10: o ensaio) — o juiz refaz a tentativa e chega ao mesmo dano do cliente; um "dano" mandado é ignorado; a largada pontua até onde foi (também parada na virada); lance trocado, hash mentido e outra semente = `divergiu`; outra versão = `regras-mudaram`; e o ENSAIO recusado: outro caminho com o sal de um (`caminho-trocado`), sal inventado (`sal-forjado`), sal nunca dado (`sal-nao-pedido`), rodada pulada (`sal-faltando`), sal fora da virada (`sal-fora-da-hora`), sem a chave |
| **`supremo_api.py`** (Python, juiz + API) | 14 do Eco + as 15 do palco da autoridade (02/10; 03/10: o banimento vencido não tira do ranking, o juiz refaz com o estado da abertura, e a tentativa jogada AO VIVO pedindo o sal de cada rodada) — 3 por dia, versão das regras, o Mestre fora, o placar do replay, recusada/vencida/regras-mudaram, a semana que fecha uma vez só com os prêmios entregues pelo juiz (vinténs, selos, o título), o evento semanal em `/api/eventos`; o ensaio tentado contra o servidor de verdade (409 `caminho-preso`, 422 `caminho-trocado`/`sal-forjado`/`sal-faltando`, 409 `rodada-fora`, 410 vencida), o mesmo caminho dando o mesmo sal nos dois contêineres, e a conta do sal em Python igual à do juiz. O herói das provas do Eco é nível 26 (no 22 a IA zerava o dano em ~4% das tentativas e a prova falhava por sorte) |
| **`eco_sal_cliente.js`** (Node) | 18 de 18 (03/10) — o game.js de verdade contra o juiz de verdade: a virada para e pede o sal com o caminho dos lances anotados, nada anda na espera, o sal entra como lance e a tentativa inteira fecha no juiz com o dano da tela; sem rede espera e pede de novo o mesmo caminho; o pedido pendurado (nem resposta nem erro) passa do prazo e sai outro, e o sal atrasado não entra duas vezes; a recusa de vez acaba a tentativa na virada; largar na espera; o treino com o sal local |
| **`eco_hud.html`** | a ficha do Eco, a linha da sala na batalha, a tela do fim (treino e conferido pelo servidor), o aviso do prêmio, e o título "Voz do Eco" ganho aparece no menu da ficha do Personagem e pendura, e o cais da praça com as 7 portas cabe a 320, 360 e 390 px, e o prêmio pela semana em datas; 03/10: a barra "A rodada N vem do servidor…", o "sem resposta" que espera e pede de novo, e a tentativa que parou na virada (49 de 49) |
| **`regras_versao_api.py`** (Python, juiz + API) | 8 de 8 — a versão das regras do bilhete, da sala em grupo, do duelo e da guerra: 409 na abertura (versão errada OU sem o campo, em sala/grupo/duelo/confirmar da guerra), 410/`vencida` no fechamento, linha ausente = versão 1. `Engine.VERSAO_REGRAS` é **10** desde 08/10 à noite (atacar a casa vazia, §9-A.16; a 9 veio antes nesta semana, a 8 em 07/10 foram os afixos de sala; a 7 foi o Santuário, a 6 uma subida só para o equilíbrio, o chão do Poço e o Eco Primordial) |
| `validate_classes.html` | 7.088 checagens, **7 falhas** — o teste crava `starCosts = [5,15,30,55,90]` e o dado é `[5,15,35,65,110]` (a escada de 30/08); as mesmas antes e depois de 03/10 |
| **`privacidade_api.py`** (Python, API) | 12 de 12 (03/10, com a prova da junção: o Eco e a moderação no "Baixar meus dados", a lápide que não se desbane nem aparece entre os banidos) — o cadastro exige o aceite da versão de agora e o grava; excluir pede o nome exato e a senha e espera luta e pagamento abertos; depois, NENHUMA linha do esquema aponta para a conta (lido do `sqlite_master`), fica só o dinheiro sem a conta, a guilda passa ao mais antigo; baixar meus dados; a faxina dos prazos no boot; cada número das páginas `site/termos.html` e `privacidade.html` bate com a constante |
| **`registros_api.py`** (Python, API) | 11 de 11 (02/10; 03/10: o erro do cliente não despeja o da API, e quem não tem conta abre poucas linhas novas) — o registro de erros: repetidos numa linha, nada de e-mail/IP/token no banco, cortes, freio por endereço, 30 dias, o painel do Mestre e a exceção da própria API |
| **`privacidade_navegador.py`** (Chrome, pela vez da máquina) | 11 de 11 (03/10) — `site_privacidade.html` 38/38 (termos, privacidade, o aceite no cadastro, o bloco da conta, o painel de erros, com fetch falso), `site_fase_c.html` 129/129 e `privacidade_jogo.html` 14/14: o jogo INTEIRO contra a API de verdade — o erro lançado chega ao banco, a ficha Contas baixa os dados e exclui a conta |
| **`registro_erros.js`** (Node) | 40 de 40 (02/10) — o cliente (`js/core/registro_erros.js`): junta, limita, limpa a pilha, nada em `file://`, e é o primeiro script do `index.html` |
| `validate_data.html` | 2.631 checagens, 0 falhas |
| `efeitos_um_a_um.html` | 7 de 7 — 186 desenhos disparados um a um |
| `armadilha_chao.html` | passou — 5 armadilhas, uma cor por elemento |
| `carga.html` | passou (03/10) — 40,02 MB na primeira visita servida, 92 `.glb` (eram 40,88 MB antes do relevo/brilho a 512); depois da junção, 40,14 MB |
| `toque.html` | 12 de 12 — mirar com o dedo, agir com o mouse |
| **`fichas_fotos.html`** (sem `?ficha=`) | **174 de 174** depois da junção de 03/10 (`python tools/fotos_fichas.py prova`) — a régua das fichas (02/10): em cada uma das 24 fichas (a do Eco entrou na junção), medalhão + título + fechar, papel de diálogo com nome, todo controle ≥ 44 px numa coluna de 390, nada vazando, foco dentro e de volta a quem abriu, o Tab dando a volta dentro dela, e quem digita fora dela (o chat) sem perder o campo; abas de texto, Configurações (a chave da tela cheia seguindo a tela), o cais desenhado com as sete portas (a do Eco com o `fc-eco`) e o `.is-off` que esconde continuando escondido. Com `?ficha=<nome>` é a página das FOTOS — `tools/fotos_fichas.py` fotografa todas (1600×900 e 390×844) numa janela de Chrome só e monta a folha antes\|depois |
| `celular.html` | 13 de 13 — o `index.html` num quadro de 390×844 |
| `perf.html` | passou — 193 chamadas de desenho no perfil de celular |
| **`texturas_prova.py`** (Python) | 16 de 16 (03/10) — relevo/brilho a 512 fora das exceções, cor intacta (também quando divide o bufferView com o relevo), `.glb` remontado byte a byte igual fora das imagens, bundle em dia |
| `texturas_abrem.html` | passou (03/10) — 333/333 `.glb` do bundle abrem no three e desenham, 0 erros de GL |
| **`equilibrio.js`** (Node) | a prova do equilíbrio ([`docs/EQUILIBRIO.md`](docs/EQUILIBRIO.md)); medida completa de 03/10: **399 de 436** — perfis 198/198, fusão 119/126 (sobram degraus nos níveis de conferência 16 e 25), duelos em dupla 62 de 84 células em 40–60% (o Minotauro é a maior parte do que sobra); depois da revisão (preço no próprio corpo) os duelos completos dão 60 de 84 células e 21 de 28 médias; **depois do muro de espinhos (03/10): 70 de 84 células e 24 de 28 médias** (o Minotauro 44/55/55/47%), e a prova rápida **423 de 436** (era 413). Ver §7.1 |
| `equilibrio_fusao.html` | a mesma conta da fusão no navegador (8 misturas) |
| `equilibrio_pve.js` (Node) | mostra, não cobra: o calabouço por classe no nível recomendado (docs/EQUILIBRIO.md §6.6) |
| `regras_equilibrio.js` (Node) | 64 de 64 (03/10) — cada regra que o equilíbrio consertou, num lance só: feitiço misto, armadilha ao pé do muro, preço no próprio corpo, muro e salto da IA; e o **muro de espinhos** do Minotauro: os dados e o texto de cada feitiço, quem encosta (de lado, não de quina, nunca o próprio lado, uma vez por vez), o empurrão contra a pedra, o invisível que sangra sem aparecer, o pet, o Eco 2×2 e o placar dele, a IA que desvia e a que aperta (com mutação: tirar o peso ou o aperto reprova), e o duelo com os dois jeitos de ferir refeito pelo juiz (`servidor/juiz/duelo.js`) até o mesmo hash, com o hash forjado caindo |
| `muro_visual.html` | 20 de 20 (03/10; a página estava parada desde 03/09 — a descida começa na antessala — e voltou pela porta `direto`) — a pedra aparece, sobe, assenta e afunda, e os espinhos: o colar de 12 pontas preso à grade, a zona nas casas vizinhas, os pixels que eles somam e a casa de passo vermelha só do outro lado, e a ficha do feitiço na batalha com o espinho de agora (o poder de quem ergue) |

**A bateria depois da junção de 03/10** (Node, API e as páginas que as frentes tocaram, no Chrome
headless pela vez da máquina), comparada com a base `39a6ae9`. O que falha é o que já falhava lá:
`autoridade_cliente.js` (sem vitória para provar), `autoridade_ponta.js` 3 de 11,
`juiz_poco.js` 1 de 4, `luta_aberta_cliente.js` 2 de 27 (as 4 do Eco, de 03/10, passam), `guilda_api.py` 1 (o nome "Mestre"
reservado), `rele_nomes_prova.py --sem-navegador` 1 de 113, `validate_classes` 7, `validate_fusion`
51, `test_progress_v2` 56, `arvore_feiticos` 4, `grupo_hud` 2, `pocoes_hud` 1 e `ui_screens` 4.
Três vêm das frentes e ficam abertas, conhecidas: `equilibrio.js` (prova rápida) dava **413 de 436**,
igual à ponta da frente — com o muro de espinhos (03/10) dá **423 de 436** (sobram os degraus de
fusão no 16 e no 25 e cinco médias de duelo na borda, ver `docs/EQUILIBRIO.md` §4.4); `site_prova.py` acusa a falta dos retratos dos quatro Colossos (só com a
arte); e `ui_screens.html` acusa o cais de sete portas vazando o quadro de 390 px — a página
simula o celular num quadro dentro de uma janela larga, onde as regras `@media` do celular não
valem; numa tela de verdade de 320, 360 ou 390 px o cais cabe (`eco_hud.html` e `fichas_fotos.html`
medem isso numa janela de celular).

**A bateria depois da segunda junção de 03/10** (os ajustes `minotauro` → `eco` → `mestre2`, ver
§7.0.1), comparada com a base `f3f2e35`: todas as provas de Node, todas as de API e relé, e no Chrome
headless pela vez da máquina as páginas que os ajustes e a noite tocam. **Nenhuma falha nova.** A
junção quebrou uma prova e foi consertada no mesmo ramo: o espinho no corpo 2×2 do Eco
(`regras_equilibrio.js`) passava a vez com `endTurn` em laço, e depois do sorteio rodada a rodada a
virada da Câmara para esperando o sal — a prova agora dá o sal da rodada, como o jogo. Passaram:
Node — `eco_motor` 74, `eco_sal_cliente` 18, `entregas_cliente` 11, `regras_equilibrio` 64,
`juiz_supremo` 27, `guerra_bancada` 96, `invisivel_armadilha` 106, `visao_mapas` 218,
`poco_perigos` 42, `juiz_economia` 46, `juiz_guerra` 26, `juiz_pocoes` 46, `juiz_grupo` 12,
`juiz_recompensa` 19, `juiz_sala` 9, `mercado_cliente` 26, `um_aparelho_cliente` 33,
`inatividade_mestre` 11, `registro_erros` 40; API e relé — as 21 `*_api.py` (fora a `guilda_api.py`
de sempre: `moderacao_api` 16, `supremo_api` 29, `arena_api` 8, `grupo_duelo_api` 17,
`servidor_api` 43, `conta_api` 33, `guerra_api` 24…), `coolify_prova` 64, `rele_prova` 96,
`rele_amigos` 26, `rele_aparelho` 15, `rele_presenca` 24, `guerra_rele` 14, `moderacao_rele` 19,
`texturas_prova` 16, `rede_dois_prova --sem-navegador` 62, `carga_prova` 19; navegador —
`eco_hud` 49, `painel_mestre` 76, `prova_icones_menus` 76, `gm_agenda` 33, `gm` 13, `muro_visual`
20, `muro` 12, `muro_area` 5, `pvp_hud` 35, `grupo` 226, `duelo` 10, `campo_pvp` 52, `desafios` 11,
`guerra_hud` 33, `validate_world` 7.914/0, `validate_data` 2.631/0, `test_engine_v2` 218,
`texturas_abrem` 333/333, `carga.html` 40,18 MB, `vida_praca` 46, `privacidade_navegador.py` 11,
`fichas_fotos` 174 e mais 16 páginas de HUD e conta. Falham as mesmas da base: as de cima, `equilibrio.js`
rápida **423 de 436** (= a ponta do `ajuste/minotauro`), `equilibrio_fusao.html` 118 de 126 (as 8
da base) e `site_prova.py` só com os retratos dos Colossos. `celular.html` e `toque.html` ficam em
"rodando…" em tempo real **também na base** (são páginas velhas: listam embutidos à mão e descem sem
`{ direto: true }`, §8) — os 13 e 12 da tabela são de antes. `juiz_jogador.js` e
`juiz_grupo_jogador.js` não são provas: são o jogador de mentira que as provas da API chamam (lê o
pedido da entrada padrão).

**Depois do lote dos personagens (03/10 à noite, `arte/monstros`)**, no Chrome headless pela vez da
máquina, em tempo real: `corpos_lancamento` 22, `corpos_tabuleiro` 8, `poco_chao_tela` passou,
`eco_hud` 49, `validate_world` 7.914/0, `texturas_abrem` **348/348** (eram 333: os 15 kits novos
abrem e desenham), `carga.html` 40,19 MB até o menu (os três pacotes novos têm grupo próprio e NÃO
entram na base); Node — `poco_perigos` 42, `eco_motor` 74, `visao_mapas` 218; Python —
`texturas_prova` 16, `extrai_assets --conferir` em dia (348 itens), `retratos_site --so-confere`
131 de 131. O `site_prova.py` fecha **174 de 174** e **deixou de acusar os retratos dos Colossos** (uma
rodada antes deu 1 falha no filtro de itens da wiki, a oscilação de sempre do tempo virtual; 72 fotos em 72
cartões). Com TODOS os 183 modelos embutidos carregados, o ajuste de locomoção por medida
(`M.locoAjustada()`) pega um clipe só, o nado da Arraia: nenhum andar que já estava no ar mudou.

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
couberam no saldo. Desde 03/10 também são do dono os quatro Colossos do Poço
(`models-meshy-colossos.js`), três Ecos Menores (`models-meshy-eco.js`) e os
oito do Santuário dos Elementos (`models-meshy-santuario.js`). Créditos completos em [`docs/CREDITS_3D.md`](docs/CREDITS_3D.md).

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

### 7.0 A noite de 03/10: oito frentes juntadas de uma vez

Oito frentes trabalharam em cópias isoladas a partir de `39a6ae9` e entraram nesta ordem, cada
uma num merge próprio: **texturas** (relevo e brilho a 512, a aba cai de 1,58 para 0,88 GB) →
**equilíbrio** (a régua `tests/equilibrio.js` e os acertos de regra e de número) → **Poço** (chão
perigoso, Colossos, chefe único) → **Eco Primordial** (o chefe supremo 2×2 da semana, conferido
pelo juiz) → **conta** (Termos, Privacidade, excluir a conta, baixar os dados, registro de erros) →
**Mestre** (o painel F9, banimento com prazo, silêncio, denúncias, auditoria) → **menus** (o
sistema visual das fichas e a ficha de Configurações) → **arte** (`docs/PROMPTS_LANCAMENTO.md`).

- `Engine.VERSAO_REGRAS` é **6**, uma subida só para as três frentes que mudam o fim de uma sala
  (equilíbrio, Poço, Eco); o comentário do histórico em `engine.js` conta as três.
- O que a junção teve de decidir (cada ponto no commit do merge):
  - o Poço e o Eco criavam cada um uma `M.CORPO_PROVISORIO` no `models3d_v2.js`, em formatos
    diferentes, e a segunda apagava a primeira — virou **uma tabela só**, de objetos;
  - a **lápide** da conta excluída (`banido = 1`) não se desbane nem se pune (API e `admin
    desbanir`) e não aparece entre os banidos do Mestre;
  - "Baixar meus dados" traz também o Eco (tentativas e prêmios) e a moderação da conta (punições,
    denúncias feitas, cartas); a Política e os Termos contam a denúncia (as falas anexadas são a
    única exceção ao "o chat não é gravado") e o silêncio — o **prazo de guarda das denúncias**
    ficou `[PREENCHER]` para o dono e o advogado;
  - a porta do Eco no cais ganhou o ícone desenhado `fc-eco` e a ficha dele o medalhão; a prova
    das fichas passou a cobrar a ficha do Eco.
- **Fica para o dono decidir:** a conta banida não alcança "Excluir conta" nem "Baixar meus
  dados" (o 403 do banimento vem antes — direito do titular contra evasão de banimento); o escudo
  do Minotauro em 1024; a mira dos efeitos do Eco no canto do corpo; e o
  número de BASE dos feitiços de fusão, que com o `PAIR_TUNE` por nível **desce** do nível 1 para o
  30 em várias duplas (Arqueiro+Bruxo: 15–21 no 1, 14–19 no 30; o poder do herói entra depois, na
  batalha) — a wiki e a barra mostram esse número, e quem lê pode achar que a fusão enfraquece.

- **O ensaio da semente do Eco — o dono respondeu "dificulte" (03/10, branch `ajuste/eco`).** A semente
  da abertura decide só a colocação e a rodada 1; a sorte de cada rodada seguinte vem de um sal que o
  servidor dá contra o caminho dos lances até a virada e trava (`POST /api/supremo/sal`, um caminho por
  rodada); o juiz recalcula cada caminho e confere cada sal. Ensaiar fora do jogo dá só a rodada de agora.
  Sem rede a tentativa espera e pede de novo; o prazo de 2 h ficou (agora é conforto, não janela de ensaio).
  `Engine.VERSAO_REGRAS` continua **6** (o 6 ainda não tinha ido ao ar). Detalhes em
  [`docs/SEGURANCA.md`](docs/SEGURANCA.md) §4.8 e §9.

### 7.0.1 Os ajustes de antes de subir (03/10, a segunda junção)

Três respostas do dono viraram três frentes a partir de `f3f2e35`, juntadas nesta ordem, cada uma
num merge próprio: **minotauro** (o muro que fere quem encosta e a paridade da Arena de 5 para 3
níveis — §4 e §7.1) → **eco** (a sorte de cada rodada vem do servidor, travada no caminho jogado — o
ensaio fora do jogo acaba, item acima) → **mestre2** (um painel só do Mestre na M e no F9, e a Caixa
que entrega no inventário de QUALQUER jogador pelo servidor, com aviso, carta da Equipe e auditoria;
cartas e bicho esperam a luta do jogador acabar). `Engine.VERSAO_REGRAS` continua **6** (o 6 ainda
não foi ao ar): o histórico em `engine.js` conta, no mesmo 6, o sal das rodadas do Eco e o muro de
espinhos — esse comentário foi o único conflito, e ficou com as duas coisas.

- **Para o dono testar depois de subir:** com duas contas, a Caixa para o outro jogador (e cartas
  com ele numa sala: tem de aparecer "mande quando a luta acabar"); uma tentativa do Eco com a rede
  caindo no meio (a barra espera e continua); o Minotauro com gente jogando — nos níveis 12 e 20 ele
  ficou um ponto acima da média dos outros.
- **Consequência aceita:** quem fecha a aba no meio de uma sala fica até 2 h sem receber cartas nem
  bicho do Mestre (o resto entra). Cada recusa do pedido do sal grava um `supremo-ensaio` na conta,
  sem teto por tentativa (o save recusado já fazia igual).

### 7.0.2 A arte do lançamento: os personagens (03/10 à noite)

O dono entregou 15 personagens e eles entraram pelo caminho de sempre (`docs/RECEBER_LOTE.md`,
manifesto à mão em `tools/monstros/{colossos,eco,santuario}.json`):

- **os 4 Colossos do Poço** (`models-meshy-colossos.js`, grupo `poco:colossos`) e **3 Ecos Menores**
  — Brasa, Coral e Rocha (`models-meshy-eco.js`, grupo `evento:eco`) saíram do corpo provisório.
  **Não chegaram** o Eco Primordial e o Eco Menor de Vento: seguem em `M.CORPO_PROVISORIO`
  (Coração Partido a 2,44× e Arauto do Vento), sem erro;
- **os 8 do Santuário dos Elementos** (`models-meshy-santuario.js`, grupo
  `calabouco:elementsanctum`, chaves `el-fogo-1` … `el-ar-2`): o MODELO está pronto para a chave;
  as fichas (`DATA.monsters`) e o mapa são de outra frente (`arte/santuario`);
- a arte veio **cinza de propósito**: quem diz o elemento é a tinta do jogo;
- nenhuma regra de batalha mudou: `Engine.VERSAO_REGRAS` continua **6**.

Três coisas novas no `models3d_v2.js`, todas dado declarado ou medida, nunca id escondido: o clipe
de locomoção fica no lugar e em cima do chão (`prendeNoLugar`, `assentaLocomocao` — o nado da
Arraia trazia o avanço dentro do clipe e vinha um metro abaixo do piso); `loco: 'walk'` no look
põe um clipe na frente da corrida (a Arraia plana); `retrato: 'inteiro'` no look pede a figura toda
no retrato da HUD (o busto por medida corta mal corpo sem rosto: o Caramujo, a Garça e o Colosso da
Ventania). As fotos para o dono olhar estão em `.wt/_fotos/arte/monstros/`.

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

**O que ficou aberto** (§6 do documento): degraus de fusão no 16 e no 25. As duas decisões que
esperavam o dono entraram em 03/10: o **Minotauro** ganhou o **muro de espinhos** (§3.6 — na
medida completa ele foi de 35/45/44/33% para 44/55/55/47% nos níveis 5/12/20/30, e as células
de duelo na faixa de 60 para 70 de 84) e a **paridade da Arena** caiu de 5 para 3 níveis (§6.3).

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

**Toda ficha nasce do `sheetShell` e veste o sistema das fichas.** O fim do
`css/style.css` ("O SISTEMA DAS FICHAS") é a régua de espaço, letra, cor, foco,
desligado, campo, aba de texto (`.abas-fila` + `.btn-tab`), título de seção
(`.bk-tit`), estado vazio (`.empty`) e cartão. O medalhão do cabeçalho vem de
`ICONE_FICHA`/`ICONE_ABA` no `hud.js` (desenhos `fc-*` do `icones_ui.js`):
ficha nova ganha uma linha ali. Aba de texto guarda o TEXTO de sempre — as provas
acham os botões por ele. Antes de mexer, rode a prova do `fichas_fotos.html`.

**Teste bom cobra a REGRA, não o número.** Já aconteceu três vezes: o teste
cravava `1,10×` em vez de ler `starCfg()`, e uma mudança legítima de curva
"quebrava" um teste que estava certo.

**Julgar por foto não vale.** Testes de aparência precisam contar o que o
renderizador criou — peças visíveis, nós na cena, formas medidas. Conferir na
imagem já deixou passar quatro variantes secretamente idênticas.

**A memória da aba é textura, e o relevo e o brilho vivem em 512.** Cada
imagem 1024 vira ~4 MB de ImageBitmap no navegador (o `.glb` não diz nada
sobre isso: 1 MB de JPEG). Desde 02/10 o relevo e o metal/rugosidade dos
modelos ficam em 512 e a cor em 1024 — menos nos heróis, fusões, pets,
chefes e coroas (`tools/reduz_texturas.py`; o caminho do lote está em
[`docs/RECEBER_LOTE.md`](docs/RECEBER_LOTE.md), seção *A textura*). Arte
nova que entrar sem o passo reprova em `tests/texturas_prova.py`.

**Trocar a imagem de uma textura por outra de OUTRO tamanho exige
`texture.dispose()` antes.** Sem isso o three grava a imagem nova dentro da
memória já alocada para a antiga (`texStorage`) e mistura as duas — deu
manchas pretas falsas no pilar da Cisterna na comparação de 02/10.

**A cor de um material não volta igual.** `material.color.getHexString()`
passa pelo espaço de cor do three e devolve outro número que o pedido (o
vermelho `#ff3b4a` das casas de espinho não voltava `ff3b4a`) — a prova que
procura casa pela cor lê a cor PEDIDA (`userData.cor`, `R.destaqueNaTela()`).
E o destaque das casas só se refaz quando a assinatura muda (vez, PP/PA,
posições, rodada): o muro não entra nela porque só nasce ou cai junto de uma
delas (`docs/EQUILIBRIO.md` §3.6).

**`Game.startRun` sem `{ direto: true }` abre a ANTESSALA** (desde 03/09) e
`Game.state` fica nulo até entrar na sala. Página de prova que desce assim e
espera a batalha fecha com zero checagens — o `muro_visual.html` ficou parado
um mês desse jeito até 03/10.

**Clipe de NADO ou de VOO do Meshy traz o deslocamento dentro** (03/10): a raiz avança dois corpos
por ciclo e volta num salto, e o corpo deitado fica abaixo do piso. O `models3d_v2.js` conserta por
medida ao abrir o kit, mas só o clipe que o `autoActions` escolheu como `walk`/`run`. Lote novo com
bicho que plana: confira `M.locoAjustada()` e a linha dele em `tests/corpos_lancamento.html`
(`PLANA`), e declare `loco` no look se o planar não for a corrida.

**Lote sem calabouço não passa pelo bestiário** (03/10): `tests/bestiario.html` filtra por
`dungeonId`. Colossos, Ecos e o que mais vier sem calabouço entram nas tabelas de
`tests/corpos_lancamento.html` e `tests/corpos_tabuleiro.html`, e a pasta nova tem de ganhar grupo
no `GRUPO_DA_PASTA` do `tools/extrai_assets.py` (senão cai na base, que todo jogador baixa).

**O jogo mostra só o COMEÇO do clipe de golpe** (medido na revisão de 03/10): o tabuleiro toca o
`attack` por 0,72 s no corpo a corpo e 0,94 s à distância, a 1,1× (`renderer3d_v2.js`, evento
`cast`), e solta para o parado. Clipe de 2,5 a 2,9 s tem o golpe nesse trecho (os 8 do Santuário e
os 3 Ecos Menores: algum osso anda de 48% a 135% da altura do corpo em 0,79 s). O clipe LONGO do
Meshy, de ~5,9 s, passa esse tempo se preparando: os **quatro Colossos** mexem 6% a 9% da altura
(o salto e a pancada vêm aos 2,2 s e ninguém vê), igual a pelo menos onze que já estavam no ar (`faceless-smith`,
`slag-bit`, `plank-shrike`, `kite-serpent`, `mote-swarm`, `nail-sprite`, `ore-chip`, `shaft-bat`,
`tide-herald`, `mirror-twin`, `boss-riftheart`). Não é defeito do lote e não foi mexido: encaixar o
golpe na janela muda a cara de pelo menos quinze monstros e pede o olho do dono (ou um clipe curto no Meshy).
Fotos quadro a quadro em `.wt/_fotos/arte/monstros/revisao-golpe-em-tiras-*.png`.

**`tests/sob_demanda.py` segue 24 de 34 vermelho desde antes deste lote** (rodado na revisão de
03/10: estoura em `avatar:corpo` e acusa 4,1 MB com Economia de Dados, a mesma assinatura de 22/09).
O conserto daquela noite (`Hub.cobreABatalha`, `economiaDeDados()` no hub3d, o passo `avatar:lider`)
nunca entrou no main. Por isso a descida servida até um Colosso não tem prova automática; o que a
cobre hoje é `tests/pacote_servido.py` (25 de 25: os 348 itens do bundle descem e abrem) e o plano
por chave do `js/assets_bundle.js` (`doMonstro` pede a chave que o `lookFor` devolve).

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
