# Idiomas — português, inglês e espanhol

O dono (05/10): *"quero que o jogo tenha os principais idiomas para poder mudar: inglês, espanhol ou
português."* Combinado em **três etapas**:

| etapa | o quê | estado |
|---|---|---|
| 1 | a base (`JOGO.I18n`), o seletor nas Configurações e os **dados** (tudo o que vem de `js/core/data`) | **feita** |
| 2 | as telas e os menus do jogo (`js/ui/*`, as mensagens de `js/core/*`) | **feita** (05/10) |
| 3 | o site (`site/*`) e as mensagens do servidor (`servidor/*.py`) | a fazer |

Este arquivo é o manual de quem vai fazer a 3 (e de quem for acrescentar texto ao jogo) sem ter visto a 1 e a 2.

## A regra que não se quebra

**Tradução é só texto de exibição.** O português é o texto de verdade: está no código, nos dados, no
save, no servidor e no juiz. O idioma é uma camada por cima, no navegador.

- O juiz (`servidor/juiz/motor.js`) lê os `js/core/data/*.js` crus e **nunca** carrega `js/core/i18n.js`
  nem `js/i18n/*`. Não mexa nisso.
- Nada de idioma entra no save, no hash da batalha (`Engine.hash` não tem nome nenhum) nem vai ao
  servidor. `Engine.VERSAO_REGRAS` não muda por causa de tradução.
- Não se traduz o arquivo de dados: traduz-se **por cima** dele (`js/i18n/dados_*.js`).
- `node tests/idiomas.js` prova tudo isso (47 checagens, poucos segundos). Rode depois de qualquer mexida.

## As peças

| arquivo | o que é |
|---|---|
| `js/core/i18n.js` | `JOGO.I18n`: decide o idioma, `t()`, `n()`, `registra()`, `aplicaDados()`. Sem DOM. |
| `js/i18n/dados_en.js`, `dados_es.js` | os dados: tabela → registro → campo. Uma linha por registro, edita-se à mão. |
| `js/i18n/textos_en.js`, `textos_es.js` | a interface: `"texto em português": "tradução"`. **É aqui que a etapa 2 escreve.** |
| `index.html` | carrega o `i18n.js` antes da lista, põe o `<html lang>` e, fora do português, desce o `textos_<idioma>.js` **logo depois do `i18n.js`** (o aplicativo desenha telas antes da lista) e encaixa o `dados_<idioma>.js` depois do último `js/core/data/*.js`. Em português não desce dicionário nenhum. A tela de carga e o aviso de abertura que parou têm um dicionário próprio, pequeno, DENTRO do `index.html` (`BT`): rodam antes do `i18n.js`. |
| `js/ui/hud.js` → `sheetConfig` | o seletor (primeira seção da ficha) e o **exemplo vivo** de texto embrulhado. |
| `tools/i18n_falta.js` | o que falta traduzir. |
| `tests/idiomas.js` | a prova. |

Arquivo novo de dicionário (se um dia quiser separar por tela): crie `js/i18n/<nome>_en.js` e
`_es.js`, registre com `JOGO.I18n.registra('en', { textos: {…} })` e acrescente o nome na linha do
`arquivos.splice(…)` do `index.html`. O `servidor/coolify/versao.py` dá hash a todo `.js` sozinho, e o
aplicativo de Android copia a pasta `js/` inteira — não há outra lista para atualizar.

## Como o idioma é escolhido

Por **navegador** (`localStorage['soterra-idioma']`), como o som e os gráficos. Ordem:

1. `?lang=en` (ou `es`, `pt`) na URL — para prova. Vale só naquela abertura, **não grava**.
2. o que está gravado (a escolha da pessoa, ou a decisão da primeira abertura).
3. primeira abertura: **português se já há rastro de jogo neste navegador** (save, conta local, registro
   de contas, sessão do site ou registro da nuvem); senão o idioma do aparelho — `pt*` → pt, `es*` → es,
   o resto → en. A decisão é gravada na hora.

O item 3 existe para que **quem já joga não veja nada mudar**: antes todo mundo jogava em português,
inclusive com o navegador em inglês. Efeito colateral aceito: quem cria conta pelo site (que ainda é
só português) e abre o jogo cai em português e troca nas Configurações. **A etapa 3 resolve**: o site
deve ler e gravar a MESMA chave `soterra-idioma` (mesma origem), com a mesma regra — aí o idioma
escolhido no site já vale no jogo.

Trocar nas Configurações grava e **recarrega** a página (no meio de uma batalha, só avisa e oferece o
botão). A conta não sai: sessão e save moram em outras chaves.

## Etapa 2 — o que foi feito, e como embrulhar um texto novo

**Feita em 05/10.** 2.400 textos embrulhados (frase solta e frase que era montada aos pedaços), todos
com inglês e espanhol: `js/ui/hud.js` (≈ 1.750 chaves), o registro da batalha (`engine.js`, `poco.js`,
`santuario.js`, `fusion.js`), `grupo.js`, `coop.js`, `guilda.js`, `mercado.js`, `troca.js`, `agenda.js`,
`autoridade.js`, `game.js`, `loja.js`, `sessao.js`, `nuvem.js`, `db.js`, `missoes.js`, `amigos.js`,
`nomes.js`, `progress.js`, `brasa.js`, `titulos.js`, `js/ui/moderacao.js`, `brasao.js`, `tutor.js`,
`tela_cheia.js`, `js/app_modelos.js`, `compra_play.js`, `main.js`, `mobile.js`, o `content:` do CSS e
a tela de carga do `index.html`.

A chave é **o próprio texto em português**. Não invente chave.

```js
// antes
el('h3', 'bk-tit', 'Gráficos')
toast('Faltam ' + n + ' vinténs.', 'bad')
// depois
el('h3', 'bk-tit', tr('Gráficos'))
toast(tr('Faltam {n} vinténs.', { n: n }), 'bad')
```

- No `hud.js` o atalho é `tr(…)`. **Em todos os outros arquivos é `Tx(…)`**, uma função de dez linhas no
  topo de cada um (`tr` é nome de variável em vários deles — armadilha, trilha). Os dois têm rede: sem o
  `JOGO.I18n` (o juiz, as provas em Node, página de prova que não carrega o `i18n.js`) devolvem o
  português **com as {variáveis} preenchidas**. Arquivo novo que precise de texto: copie o `Tx` de um
  vizinho (`tests/idiomas.js` cobra que quem chama `Tx(` o defina).
- **Frase montada aos pedaços vira UMA frase com variáveis.** `'Faltam ' + n + ' vinténs'` não se traduz
  pedaço a pedaço: a ordem das palavras muda de idioma para idioma.
- **Pedaço que muda conforme a conta vira frase inteira por ramo**, não pedacinho traduzido:
  `n === 1 ? tr('Falta <b>{n}</b> carta.', …) : tr('Faltam <b>{n}</b> cartas.', …)`. O `JOGO.I18n.n(qtd,
  '{n} sala', '{n} salas')` serve ao plural simples.
- O texto tem de estar **literal** dentro do `tr('…')`/`Tx('…')`: é assim que o `tools/i18n_falta.js` o
  acha. `tr(variavel)` funciona, mas a ferramenta não vê — use só para o que já está no dicionário
  (grau de forja, título, a medalha "ouro/prata/bronze", o nome do chefe no catálogo de títulos).
- HTML dentro do texto (`<b>`, `<kbd>`) fica na chave e na tradução, igual — `tests/idiomas.js` confere
  as tags e os espaços das pontas; a ferramenta confere as `{variáveis}`.
- Em português **nada pode mudar**: `tr(modelo, vars)` tem de dar, byte a byte, o texto que a
  concatenação dava (as provas de `tests/` procuram texto em português). Valor nulo numa variável sai
  "null", como saía.
- Depois de embrulhar, acrescente a linha nos DOIS `js/i18n/textos_*.js` e rode a ferramenta.

### O que NÃO se embrulha (o embrulho automático respeitou; quem mexer à mão, cuidado)

- Texto que é **chave**: comparação (`===`, `case`, `indexOf`), nome de propriedade, classe de CSS, id,
  chave de `localStorage`, evento, o que vai para `throw`/`console`.
- `js/core/contas.js` e `js/core/rede.js` ficaram de fora inteiros: os rótulos "Principal", "Visitante",
  "Conta 2", "Mestre do Fundo" são **gravados** no registro de contas e comparados; "Aventureiro" e
  "Guilda" viajam pelo relé como nome de reserva.
- `js/core/registro_erros.js` (o relato que vai para a equipe) e os `throw new Error('…')` de
  `js/core/loja.js` e do `engine.js`: são para quem lê o registro, não para o jogador.
- O painel do Mestre, o `debug.js`, o `gm.js`, o 3D (`js/render*`).

### Texto que é chave e só se traduz NA TELA

| o quê | onde se traduz |
|---|---|
| o grau da forja ("Comum", "Raro", "Supremo", "Magnífico") | `hud.js`: `tierOf()` devolve o português (o `tierClass()` faz a classe de CSS com ele); `tierNome()` é o da tela |
| o título ("o Podador da Viúva", "Voz do Eco", "Top 2 Bárbaro") | `hud.js`: `titExibe()`, também exposto como `JOGO.UI.titExibe` para a plaquinha do `hub3d.js`. O título de classe é montado com o nome da classe **em português** mesmo com o DATA traduzido: `JOGO.I18n.pt('classes', id, 'name', atual)` devolve o original de qualquer campo que o `aplicaDados` trocou |
| `monster.family` | não aparece em tela nenhuma hoje; as traduções estão no dicionário para quando aparecer |

### Texto que viaja entre jogadores

Vai **no idioma de quem o gerou** — não se mexeu no protocolo: os avisos do grupo e do duelo que o outro
lado monta ("X escolheu o calabouço Y"), o nome do item numa oferta de troca ou do mercado, a foto de
resgate da batalha em dupla e, nela, o **registro da batalha** (quem recebe a foto do parceiro vê as
linhas que ele gerou no idioma dele). O nome de reserva "Você" do `grupo.js` também. É cosmético; o
conserto certo é mandar id + campos e traduzir na ponta.

### O que sobrou em português (medido com `--candidatos`: 179, quase tudo falso positivo)

A conta de `node tools/i18n_falta.js --candidatos` não zera, e não é para zerar: sobram os
`'[object Array]'`, folhas de estilo e `cssText` em string, nomes de tecla (`'Enter'`, `'Escape'`,
`'Tab'`) e os arquivos da lista acima. Português de verdade que ainda aparece ao jogador:

- **as mensagens que o servidor manda** (`{"erro": "…"}`) — etapa 3;
- o **nome da etapa** no aviso de abertura que parou ("o download dos modelos") — é marca interna;
- palavra solta em minúscula que a régua do embrulho não reconhece como texto (o que apareceu nas fotos
  da praça, das fichas e da batalha foi embrulhado à mão; tela que as fotos não abriram pode ter alguma)
  e atributo `title="…"` escrito dentro de marcação em string (`title="quem manda na guerra"`);
- o que a conta de candidatos chama de sobra e é de propósito: 45 `'[object Array]'`, 44 folhas de estilo
  em string, 11 nomes de tecla, 27 `throw`/`console`, 35 nos arquivos que ficaram de fora;
- frases que ainda saem em dois pedaços (uma variável que carrega outro pedaço traduzido: "{a} — vida
  cheia"): estão traduzidas, mas a ordem das palavras ficou a do português.

### Onde o motor escreve texto

`js/core/engine.js`, `poco.js`, `santuario.js`, `fusion.js` escrevem o registro da batalha com
`log(Tx('{name} pisa em uma armadilha!', { name: u.name }))`. Esses arquivos rodam no juiz, sem o
`JOGO.I18n`: o `Tx` de cada um devolve o português. O log não entra no hash — `node tests/idiomas.js`
prova que o juiz e o cliente em português escrevem o mesmo registro, linha a linha, e que o cliente em
inglês chega ao mesmo hash. As tabelas de texto do motor (`WEATHERS`, os desafios de sala, o "perde o
bônus" do efeito que acaba) são traduzidas **na carga do arquivo**: no navegador o dicionário já
desceu; no juiz não há dicionário.
O nome do feitiço de fusão é montado em `js/core/fusion.js` como `formName + ' ' + affix`; os
dicionários já foram escritos para essa ordem (ver o glossário) — não inverta no código.

## Etapa 3 — site e servidor

O que a etapa 2 deixou combinado para ela:

- **A chave do idioma é uma só**: `localStorage['soterra-idioma']` (`pt`, `en` ou `es`), na mesma origem
  do jogo. O site deve LER e GRAVAR essa chave com a regra de `js/core/i18n.js` (`decide()`): `?lang=`
  vale só naquela abertura; depois o gravado; na primeira vez, português se há rastro de jogo, senão o
  idioma do aparelho. O `index.html` do jogo também a lê sozinho, antes do `i18n.js`, para a tela de
  carga (`lgBoot()`).
- **Erro do servidor com código.** O cliente mostra `r.erro` cru em dezenas de lugares (`toast(r.erro ||
  tr('não deu'))`): o texto de reserva já está traduzido, o do servidor não. O caminho: o servidor manda
  `codigo` (e os números em campos) junto do `erro`, e o cliente troca `r.erro` por uma função única —
  `erroDe(r, reserva)` — que procura `tr('erro.' + codigo)`... ou, mais simples, um mapa código → frase
  já embrulhada. **Não** traduza pela frase do servidor: várias têm número dentro.
- Os erros que o CLIENTE gera para a conta local (`guilda.js`, `db.js`, `missoes.js`, `nuvem.js`: "sem
  guilda", "só o líder promove") já estão traduzidos; os mesmos textos vindos do servidor de verdade não.
- A loja do site, os e-mails e o correio da Equipe entregam texto ao jogo (nome de pacote, recado): em
  português até a etapa 3.


- `site/*.html` + `site/*.js`: 23 arquivos, ~140 KB de HTML. O texto está no HTML, não em JS: o caminho
  barato é `data-i18n` nos elementos + um `site/i18n.js` pequeno com a mesma regra de escolha e a mesma
  chave `soterra-idioma`. `termos.html` e `privacidade.html` são texto jurídico — tradução revisada por
  gente, não por máquina. `mestre.html` e os `mestre*.js` **não se traduzem**.
- `servidor/*.py` (~22 mil linhas): as mensagens de erro vão em português no JSON (`{"erro": "…"}`) e o
  cliente as mostra cruas. Dois caminhos: (a) o cliente traduz pela frase com `tr()` (funciona para
  mensagem fixa; a que tem número dentro precisa virar código + campos); (b) o servidor passa a mandar
  `codigo` junto do `erro`, e o cliente traduz pelo código. O (b) é o certo para o que tem variável.
  E-mails e avisos do correio da Equipe ficam por último.

## Achar o que falta

```
node tools/i18n_falta.js               # resumo; sai 1 se falta algo
node tools/i18n_falta.js --lista       # tudo, um por linha
node tools/i18n_falta.js --candidatos  # o que ainda está em português puro no código (estimativa)
```

Ela cobra: dado sem tradução; **número da tradução diferente do português** (alguém mudou "Cura 30 PV"
para 35 no arquivo de dados e esqueceu o dicionário — depois de todo ajuste de equilíbrio, rode);
tradução de registro que não existe mais; texto embrulhado sem tradução; `{variável}` diferente.

Conteúdo novo (monstro, item, feitiço): escreva em português no arquivo de dados como sempre, rode a
ferramenta e acrescente as linhas nos dois `dados_*.js`. Tabela nova com texto: ponha o nome em
`I18n.TABELAS` (e o campo em `I18n.CAMPOS`, se for novo) — a lista é fechada de propósito.

## Glossário (fixo — não troque sem trocar em tudo)

| português | en | es |
|---|---|---|
| PV · PA · PP | HP · AP · MP | PV · PA · PP |
| poder · esquiva · escudo · alcance | power · dodge · shield · range | poder · esquiva · escudo · alcance |
| fixação (trava) | lock | traba |
| casa (do tabuleiro) | tile | casilla |
| turno · rodada · sala | turn · round · room | turno · ronda · sala |
| calabouço, masmorra · chefe | dungeon · boss | mazmorra · jefe |
| feitiço · armadilha · muro | spell · trap · wall | hechizo · trampa · muro |
| invocação · fusão | summon · fusion | invocación · fusión |
| veneno · queimadura · sangramento | poison · burn · bleed | veneno · quemadura · sangrado |
| cura · empurra · puxa | heal · pushes · pulls | curación · empuja · atrae |
| clima | weather | clima |
| Neutro, Fogo, Água, Terra, Ar | Neutral, Fire, Water, Earth, Air | Neutro, Fuego, Agua, Tierra, Aire |
| Calmo, Chuva, Estiagem, Vendaval, Tremor | Calm, Rain, Drought, Gale, Tremor | Calma, Lluvia, Sequía, Vendaval, Temblor |
| Bárbaro, Caçador, Bruxo, Ladino | Barbarian, Hunter, Warlock, Rogue | Bárbaro, Cazador, Brujo, Pícaro |
| Curandeiro, Xamã, Minotauro | Healer, Shaman, Minotaur | Curandero, Chamán, Minotauro |
| mascote · guilda | pet · guild | mascota · gremio |
| praça, a Praça | plaza, the Plaza | plaza, la Plaza |
| forja · pedra de forja | forge · forge stone | forja · piedra de forja |
| vintém, vinténs | copper, coppers | vintén, vintenes |
| barra de ouro | gold bar | barra de oro |
| Brasa (pontos do ranking da arena) | Ember | Brasa |
| selo (dos chefes) | seal | sello |
| Traje de X (conjunto) | X Garb | Traje de X |
| Comum, Incomum, Raro, Épico, Lendário | Common, Uncommon, Rare, Epic, Legendary | Común, Poco común, Raro, Épico, Legendario |
| Comum, Raro, Supremo, Magnífico (forja) | Common, Rare, Supreme, Magnificent | Común, Raro, Supremo, Magnífico |
| Fácil, Normal, Difícil | Easy, Normal, Hard | Fácil, Normal, Difícil |
| o Poço sem Fundo · Colosso | the Bottomless Pit · Colossus | el Pozo sin Fondo · Coloso |
| o Eco Primordial · Eco Menor | the Primordial Echo · Lesser Echo | el Eco Primordial · Eco Menor |
| o Santuário dos Elementos | the Sanctuary of the Elements | el Santuario de los Elementos |
| a Árvore-Mundo · a Sede · a Arena | the World Tree · the Guild Hall · the Arena | el Árbol-Mundo · la Sede · la Arena |
| A Estufa Soterrada | The Buried Greenhouse | El Invernadero Soterrado |
| A Cisterna dos Afogados | The Cistern of the Drowned | La Cisterna de los Ahogados |
| O Fecho de Brasa · os Fechos | The Ember Lock · the Locks | El Cierre de Brasa · los Cierres |
| Os Andaimes do Vento | The Wind Scaffolds | Los Andamios del Viento |
| A Mina Trêmula | The Trembling Mine | La Mina Trémula |
| os Fôlegos · Lume (do mundo) | the Breathers · Lume | los Alientos · Lume |
| ficha (painel da interface) | panel | ficha |
| Configurações | Settings | Configuración |

**Fica em português, de propósito** (nome próprio do mundo): **a Lousa** (the Lousa / la Lousa),
**Soterra**, **Mestre do Fundo** (é a identidade reservada da Equipe — o relé protege o nome), os
chefes pelo nome — **Magno, Cambota, Batepedra, Salmoura** — e os mascotes: **Brasinha, Bocarra,
Rasga-Ar, Borbulha, Pedrinha-Guia, Caco Vivo, Selinho**. O epíteto do chefe se traduz ("Magno, the
Kindler"; "Batepedra, el que Golpea Abajo"). Monstro comum tem nome traduzido, como num bestiário.

**Nome de feitiço de fusão.** O jogo monta `formName + ' ' + affix` ("Disparo Abissal"). Em inglês o
`affix` é sempre um complemento com "of" ("Shot of the Abyss"); em espanhol é adjetivo invariável ou
"de …", para servir a substantivo masculino e feminino. Mantenha ao acrescentar.

**Tom:** fantasia, frase curta, humor seco. Inglês americano, "you". Espanhol neutro da América
Latina, "tú", sem "vosotros" e sem regionalismo. Números, sinais e ícones idênticos ao português. A
tradução não passa muito do tamanho do português — botão e ficha de celular não esticam.

## O que fica de fora

- O **chat**, os nomes de jogador e de guilda, os recados: são de quem escreveu.
- O **painel do Mestre** (`js/ui/painel_mestre.js`, `js/ui/debug.js`, `js/core/gm.js`), o Terminal e o
  `site/mestre*`: ferramenta da equipe, em português.
- O nome do jogo, **SOTERRA**.
- Texto que viaja entre jogadores vai **no idioma de quem o gerou** (ver a etapa 2, acima).
- `index2d.html`, `v2.html`, `v2_3d.html` (as linhas antigas) não carregam o i18n: seguem em português.
