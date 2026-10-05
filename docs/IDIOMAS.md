# Idiomas — português, inglês e espanhol

O dono (05/10): *"quero que o jogo tenha os principais idiomas para poder mudar: inglês, espanhol ou
português."* Combinado em **três etapas**:

| etapa | o quê | estado |
|---|---|---|
| 1 | a base (`JOGO.I18n`), o seletor nas Configurações e os **dados** (tudo o que vem de `js/core/data`) | **feita** |
| 2 | as telas e os menus do jogo (`js/ui/*`, as mensagens de `js/core/*`) | a fazer |
| 3 | o site (`site/*`) e as mensagens do servidor (`servidor/*.py`) | a fazer |

Este arquivo é o manual de quem vai fazer a 2 e a 3 sem ter visto a 1.

## A regra que não se quebra

**Tradução é só texto de exibição.** O português é o texto de verdade: está no código, nos dados, no
save, no servidor e no juiz. O idioma é uma camada por cima, no navegador.

- O juiz (`servidor/juiz/motor.js`) lê os `js/core/data/*.js` crus e **nunca** carrega `js/core/i18n.js`
  nem `js/i18n/*`. Não mexa nisso.
- Nada de idioma entra no save, no hash da batalha (`Engine.hash` não tem nome nenhum) nem vai ao
  servidor. `Engine.VERSAO_REGRAS` não muda por causa de tradução.
- Não se traduz o arquivo de dados: traduz-se **por cima** dele (`js/i18n/dados_*.js`).
- `node tests/idiomas.js` prova tudo isso (30 e poucas checagens, 2 s). Rode depois de qualquer mexida.

## As peças

| arquivo | o que é |
|---|---|
| `js/core/i18n.js` | `JOGO.I18n`: decide o idioma, `t()`, `n()`, `registra()`, `aplicaDados()`. Sem DOM. |
| `js/i18n/dados_en.js`, `dados_es.js` | os dados: tabela → registro → campo. Uma linha por registro, edita-se à mão. |
| `js/i18n/textos_en.js`, `textos_es.js` | a interface: `"texto em português": "tradução"`. **É aqui que a etapa 2 escreve.** |
| `index.html` | carrega o `i18n.js` antes da lista, põe o `<html lang>` e, fora do português, encaixa os dois dicionários do idioma logo depois do último `js/core/data/*.js`. Em português não desce dicionário nenhum. |
| `js/ui/hud.js` → `sheetConfig` | o seletor (primeira seção da ficha) e o **exemplo vivo** de texto embrulhado. |
| `tools/i18n_falta.js` | o que falta traduzir. |
| `tests/idiomas.js` | a prova. |

Arquivo novo de dicionário (se a etapa 2 quiser separar por tela): crie `js/i18n/<nome>_en.js` e
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

## Etapa 2 — como embrulhar um texto

A chave é **o próprio texto em português**. Não invente chave.

```js
// antes
el('h3', 'bk-tit', 'Gráficos')
toast('Faltam ' + n + ' vinténs.', 'bad')
// depois
el('h3', 'bk-tit', tr('Gráficos'))
toast(tr('Faltam {n} vinténs.', { n: n }), 'bad')
```

- No `hud.js` use `tr(…)` (já existe, com rede se o módulo faltar). Nos outros arquivos de `js/ui` crie o
  mesmo atalho de três linhas; em `js/core/*` use `JOGO.I18n ? JOGO.I18n.t(…) : texto` — o juiz carrega
  alguns desses arquivos SEM o i18n, e eles têm de seguir funcionando.
- **Frase montada aos pedaços vira UMA frase com variáveis.** `'Faltam ' + n + ' vinténs'` não se traduz
  pedaço a pedaço: a ordem das palavras muda de idioma para idioma.
- Plural: `JOGO.I18n.n(qtd, '{n} sala', '{n} salas')` — as duas formas são chaves do dicionário.
- O texto tem de estar **literal** dentro do `tr('…')`: é assim que o `tools/i18n_falta.js` o acha.
  `tr(variavel)` funciona, mas a ferramenta não vê — use só para o que já está no dicionário (família
  de monstro, grau de forja, título).
- HTML dentro do texto (`<b>`, `<kbd>`) fica na chave e na tradução, igual.
- Depois de embrulhar, acrescente a linha nos DOIS `js/i18n/textos_*.js` e rode a ferramenta.

### Três textos que o DATA guarda em português de propósito

Têm cara de texto, mas alguém os usa como chave — por isso **não** são trocados no DATA, e a etapa 2
os passa por `tr()` na hora de desenhar (as traduções já estão nos `textos_*.js`):

| o quê | quem usa como chave |
|---|---|
| `monster.family` ("Flora Voraz"…) | `js/render3d/models3d_v2.js`, `M.FAMILY_LOOK[md.family]` — o visual do monstro |
| `DATA.upgrade.tiers[].name` ("Comum", "Raro", "Supremo", "Magnífico") | `hud.js`, `tierClass()` faz a classe de CSS com ele — traduza em `tierOf()` **só na exibição**, nunca no `tierClass` |
| os títulos de `js/core/titulos.js` ("o Podador da Viúva", "Voz do Eco"…) | o texto do título é o que o save e o relé guardam e comparam |

### Onde o motor escreve texto

`js/core/engine.js`, `poco.js`, `santuario.js`, `fusion.js` escrevem o registro da batalha com
`log('… ' + u.name + ' …')`. Esses arquivos rodam no juiz. O jeito seguro: `log(T('{nome} morre.', {
nome: u.name }))` com `var T = (JOGO.I18n && JOGO.I18n.t) || function (s, v) { /* interpola */ }` — o
log não entra no hash, mas **confira** com `node tests/idiomas.js` e `node tests/juiz_sala.js`.
O nome do feitiço de fusão é montado em `js/core/fusion.js` como `formName + ' ' + affix`; os
dicionários já foram escritos para essa ordem (ver o glossário) — não inverta no código.

### O tamanho do serviço (medido em 05/10 com `node tools/i18n_falta.js --candidatos`)

Cerca de **2.900 literais** com cara de texto em português: `js/ui/hud.js` ≈ 2.030, `js/core/grupo.js`
≈ 110, `engine.js` ≈ 75, `js/ui/moderacao.js` ≈ 70, `coop.js` ≈ 55, `js/app_modelos.js` ≈ 55,
`guilda.js` e `js/ui/brasao.js` ≈ 50 cada, `compra_play.js` ≈ 40, `mercado.js` ≈ 30, e mais uns 300
espalhados em 25 arquivos pequenos. É estimativa (pega falso positivo e perde frase aos pedaços).
Sugestão de ordem: batalha e inventário do `hud.js` primeiro (é o que mais aparece), depois praça e
fichas, depois as mensagens de `js/core`. O `css/style.css` tem texto em `content:` — confira.

## Etapa 3 — site e servidor

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
- Texto que viaja entre jogadores vai **no idioma de quem o gerou**: o nome do item numa oferta de troca
  ou do mercado (`troca.js`, `mercado.js`), o "X escolheu o calabouço Y" do grupo, a foto de resgate da
  batalha em dupla. É cosmético; se incomodar, a etapa 2 troca o nome pelo id e traduz na ponta.
- `index2d.html`, `v2.html`, `v2_3d.html` (as linhas antigas) não carregam o i18n: seguem em português.
