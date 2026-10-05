# Idiomas — português, inglês e espanhol

O dono (05/10): *"quero que o jogo tenha os principais idiomas para poder mudar: inglês, espanhol ou
português."* Combinado em **três etapas**:

| etapa | o quê | estado |
|---|---|---|
| 1 | a base (`JOGO.I18n`), o seletor nas Configurações e os **dados** (tudo o que vem de `js/core/data`) | **feita** |
| 2 | as telas e os menus do jogo (`js/ui/*`, as mensagens de `js/core/*`) | **feita** (05/10) |
| 3 | o site (`site/*`) e as mensagens do servidor (`servidor/*.py`) | **feita** (05/10) |

As três entraram. Este arquivo é o manual de quem for acrescentar texto (ao jogo, ao site, ao servidor) ou um idioma.

## A regra que não se quebra

**Tradução é só texto de exibição.** O português é o texto de verdade: está no código, nos dados, no
save, no servidor e no juiz. O idioma é uma camada por cima, no navegador.

- O juiz (`servidor/juiz/motor.js`) lê os `js/core/data/*.js` crus e **nunca** carrega `js/core/i18n.js`
  nem `js/i18n/*`. Não mexa nisso.
- Nada de idioma entra no save, no hash da batalha (`Engine.hash` não tem nome nenhum) nem vai ao
  servidor. `Engine.VERSAO_REGRAS` não muda por causa de tradução.
- Não se traduz o arquivo de dados: traduz-se **por cima** dele (`js/i18n/dados_*.js`).
- `node tests/idiomas.js` prova tudo isso (58 checagens, poucos segundos). Rode depois de qualquer mexida.
- O **servidor fala português**. As recusas (`{"erro": "…"}`) saem em português e quem traduz é o cliente. A
  única coisa que o servidor escreve em outra língua é o **e-mail** (ver a etapa 3).

## As peças

| arquivo | o que é |
|---|---|
| `js/core/i18n.js` | `JOGO.I18n`: decide o idioma, `t()`, `n()`, `registra()`, `aplicaDados()`. Sem DOM. |
| `js/i18n/dados_en.js`, `dados_es.js` | os dados: tabela → registro → campo. Uma linha por registro, edita-se à mão. |
| `js/i18n/textos_en.js`, `textos_es.js` | a interface: `"texto em português": "tradução"`. **É aqui que a etapa 2 escreve.** |
| `index.html` | carrega o `i18n.js` antes da lista, põe o `<html lang>` e, fora do português, desce o `textos_<idioma>.js` **logo depois do `i18n.js`** (o aplicativo desenha telas antes da lista) e encaixa o `dados_<idioma>.js` depois do último `js/core/data/*.js`. Em português não desce dicionário nenhum. A tela de carga e o aviso de abertura que parou têm um dicionário próprio, pequeno, DENTRO do `index.html` (`BT`): rodam antes do `i18n.js`. |
| `js/ui/hud.js` → `sheetConfig` | o seletor (primeira seção da ficha) e o **exemplo vivo** de texto embrulhado. |
| `js/i18n/erros_en.js`, `erros_es.js` | o que o SERVIDOR diz: `"frase do servidor": "tradução"` (recusas, avisos, a loja). Etapa 3. |
| `site/i18n.js` | o site: o seletor do topo, a tradução do HTML por cima, a lista de scripts de cada página. |
| `site/i18n_en.js`, `i18n_es.js` | as frases do site (HTML e scripts). |
| `site/i18n_juridico_en.js`, `_es.js` | os Termos e a Privacidade (tradução de cortesia). |
| `tools/i18n_falta.js` | o que falta traduzir (jogo, site e servidor). |
| `tools/i18n_site.js` | colhe as frases do site dos arquivos, como o navegador as colhe. |
| `tools/erros_servidor.py` | colhe do código as frases que o servidor manda ao jogador. |
| `tests/idiomas.js` | a prova (Node). |
| `tests/idiomas_site.py` | a prova de navegador do site, do servidor e do caminho site → jogo. |

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
inclusive com o navegador em inglês. **O site usa a MESMA chave e a mesma regra** (carrega o próprio
`js/core/i18n.js`): quem chega pelo site com o aparelho em inglês vê o site em inglês e, ao abrir o jogo,
o jogo em inglês; quem troca no seletor do site troca o jogo junto, e vice-versa.

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

- as mensagens do servidor **montadas na hora** (94, quase todas código de `motivo` ou a recusa do juiz com valor
  concatenado) e o que o relé manda por WebSocket — o resto do que o servidor diz já sai traduzido (etapa 3);
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

## Etapa 3 — o site e o servidor (feita em 05/10)

### O site

Cada página de `site/*.html` (menos o `mestre.html`) carrega, no `<head>`, o `js/core/i18n.js` do jogo e o
`site/i18n.js`. **Em português o HTML servido não muda uma letra** e nenhum dicionário desce; só aparece o
seletor (Português / English / Español) no topo. Fora do português:

- os dicionários descem no `<head>` (`site/i18n_<idioma>.js`, `js/i18n/erros_<idioma>.js` e, nas duas páginas
  jurídicas, `site/i18n_juridico_<idioma>.js`) e a página é traduzida **antes** dos scripts dela rodarem — não
  pisca em português. O `<html lang>`, o `<title>` e a `meta description` acompanham;
- **não há `data-i18n`**: a página é andada uma vez e cada FRASE é procurada no dicionário pela própria frase em
  português. A frase é o miolo de um elemento que só tem texto e tags de linha (`<b>`, `<a>`, `<span>`, `<br>`…),
  com os espaços juntos e **as tags sem atributos**: `"Li e aceito os <a>Termos de Uso</a> e a <a>Política de
  Privacidade</a>."`. A tradução devolve as mesmas tags (pode mudar a ordem das palavras em volta) e os elementos
  de verdade — com o `href`, o `id`, o que um script vai preencher — são reaproveitados: o k-ésimo `<a>` da
  tradução é o k-ésimo `<a>` do original. Também se traduzem `title`, `placeholder`, `aria-label`, `alt`;
- o que o **JavaScript** do site escreve passa por `Tx('…')`, igual ao jogo: cada `site/*.js` tem o seu `Tx` com
  rede, e os scripts de dentro das páginas (index, eventos, ranking) usam `SITE.Tx`;
- as páginas que mostram dados do jogo (wiki, fusões, ranking, início) ganham os dicionários do jogo no lugar
  certo: a lista de scripts do fim do `<body>` passa por `SITE_LISTA([...])`, que encaixa o `textos_<idioma>.js`
  antes de tudo e o `dados_<idioma>.js` depois do último `js/core/data/*.js`;
- `translate="no"` num elemento tira ele (e o que há dentro) da tradução. "SOTERRA" nunca se traduz.

**Texto novo no site.** No HTML: escreva em português, como sempre; rode `node tools/i18n_falta.js --lista`, que
mostra a frase exatamente como a chave tem de ser, e acrescente a linha em `site/i18n_en.js` e `i18n_es.js`. Num
script: `Tx('Frase com {n} coisas.', { n: n })` e as mesmas duas linhas. Frase que ninguém traduziu aparece em
português.

**Mexeu numa frase em português** (trocou uma palavra): a chave mudou, a tradução velha fica órfã e a frase volta
a aparecer em português até ganhar a linha nova. A ferramenta acusa.

### Termos e Privacidade

Traduzidos em `site/i18n_juridico_<idioma>.js`. É **tradução de cortesia**: a página traduzida abre com o aviso de
que a versão em português é a única que vale, com o link `?lang=pt` para ela. O texto em português, a versão e o
aceite não mudaram. A tradução foi feita e conferida por máquina (tags, números, lacunas `[PREENCHER: …]`
intactas) — **a revisão jurídica é do dono**: os pontos duvidosos estão em `docs/REVISAO_JURIDICA.md`.

### O que o servidor diz

O servidor **não mudou as frases**: as provas e os clientes antigos dependem delas. Quem traduz é o cliente, no
funil dos pedidos — `JOGO.I18n.resposta(j, rota)`, chamado em `js/core/sessao.js` (o jogo) e em `site/site.js`
(o site) — uma vez, para toda tela que mostra `r.erro`:

- `r.erro` e `r.mensagem` são trocados por `JOGO.I18n.erro(frase)`; o original fica em `r.erroPt`;
- a chave é **a própria frase do servidor** (`js/i18n/erros_<idioma>.js`). Frase com valor dentro usa o MOLDE:
  cada valor é `{a}`, `{b}`… na ordem — `"o nome vai até {a} caracteres"`. O cliente casa a frase recebida com o
  molde e devolve o valor no lugar;
- **a loja**: nas rotas `/api/loja/*`, `/api/pagamento/*` e `/api/play/*`, os campos `nome` e `descricao` de
  qualquer objeto da resposta são trocados pela frase (catálogo, pedidos, extrato). Preço, sku e regra ficam como
  vieram. É por frase e não por SKU de propósito: se o dono muda a descrição de um produto no servidor, ela
  aparece em português até ser traduzida — nunca uma tradução velha dizendo outra coisa;
- **a agenda**: em `/api/eventos`, só o evento que o próprio servidor escreve (`origem: 'supremo'`, o Eco da
  semana) é traduzido; o que o Mestre escreve é dele;
- em português nada disso roda.

`tools/erros_servidor.py` colhe as frases do código (`Recusa(status, 'frase')`, `{'erro': …}`, as `FRASE_*`, as
recusas do juiz em `servidor/juiz/*.js` e os textos da loja) e o `tools/i18n_falta.js` cobra a tradução de cada
uma. **Recusa nova no servidor:** escreva em português, rode a ferramenta e acrescente a linha nos dois
`erros_*.js`. O que ela não vê (a frase montada em tempo de execução) aparece em português.

**Os e-mails** (o código do "esqueci a senha", os avisos de senha e de e-mail trocados, a conta excluída) saem no
idioma do **pedido** que os causou: o site manda `idioma: 'en'|'es'` no corpo dessas rotas (`site/site.js`,
`SITE.api`), o servidor lê com `comum.idioma_de(corpo)` e usa `conta.EMAILS` / `privacidade.EXCLUIDA`. Sem o
campo, português. Nada é guardado na conta. O retorno de denúncia e as cartas da Equipe seguem em português.

### Acrescentar um idioma (ex.: francês)

1. `js/core/i18n.js`: `IDIOMAS`, `NOMES`, `TAG` e a regra de `doAparelho()`.
2. Crie `js/i18n/dados_fr.js`, `textos_fr.js`, `erros_fr.js`, `site/i18n_fr.js`, `site/i18n_juridico_fr.js`
   (copie os de um idioma e traduza os valores; as chaves são as mesmas).
3. `index.html` do jogo: o dicionário da tela de carga (`BT`). `site/i18n.js`: a lista do seletor.
4. `tools/i18n_falta.js`: a lista `IDIOMAS`. `servidor/comum.py`: `IDIOMAS_EMAIL`, e os
   e-mails em `conta.EMAILS` e `privacidade.EXCLUIDA`.
5. `node tools/i18n_falta.js` até zerar; `node tests/idiomas.js`; `tests/idiomas_site.py`.

### O que ficou em português no site e no servidor (medido)

- 94 frases do servidor **montadas na hora** (quase todas são código de `motivo`, não frase; as demais repassam a
  recusa do juiz com valor concatenado);
- o que o **relé** manda por WebSocket (3 frases) e os registros que o servidor guarda para a Equipe;
- o **correio da Equipe** (cartas, retorno de denúncia) e os eventos que o Mestre escreve: são de quem escreveu;
- o **painel do Mestre** (`site/mestre*`), de propósito;
- na wiki, a contração do nome do calabouço ("do chefe **da** Mina…") é gramática portuguesa feita por regex
  (`contrai()`): fora do português sai o nome traduzido sem a contração — a frase fica compreensível, não elegante;
- algumas descrições da wiki ainda juntam pedaços traduzidos na ordem do português (o sinal, o atributo e a
  duração de um efeito).

## Achar o que falta

```
node tools/i18n_falta.js               # resumo; sai 1 se falta algo
node tools/i18n_falta.js --lista       # tudo, um por linha
node tools/i18n_falta.js --candidatos  # o que ainda está em português puro no código (estimativa)
node tools/i18n_site.js                # quantas frases o site tem (HTML, scripts, jurídico)
python tools/erros_servidor.py --resumo  # quantas frases o servidor manda
```

A linha de cada idioma traz o jogo (dados e código) e, embaixo, o **site** e o **servidor**. Sem Python na
máquina, o item do servidor é pulado, com aviso.

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
| grupo (de jogadores) · dupla | **party** · duo | grupo · dúo |
| a posição no placar (3º) | **#3** (nunca "3º" nem "3th") | 3.º |
| conta · sessão · senha · e-mail | account · session · password · e-mail | cuenta · sesión · contraseña · correo |
| Entrar · Sair · Criar conta | Sign in · Sign out · Create account | Entrar · Salir · Crear cuenta |
| Loja · Eventos · Início · Jogar | Shop · Events · Home · Play | Tienda · Eventos · Inicio · Jugar |
| Termos de Uso · Política de Privacidade | Terms of Use · Privacy Policy | Términos de Uso · Política de Privacidad |
| pacote · pedido · presente | pack · order · gift | paquete · pedido · regalo |
| o juiz (o servidor que confere a luta) | the referee | el juez |
| mercadinho · saco · banco/cofre | market · bag · bank/vault | mercadillo · bolsa · banco/cofre |
| insígnia de Fundação · pergaminho | Founding Badge · scroll | insignia de Fundación · pergamino |
| Coroa (as dez da arena) · carta · estrela | Crown · card · star | Corona · carta · estrella |
| Ecos do Mundo Enterrado (o subtítulo) | Echoes of the Buried World | Ecos del Mundo Enterrado |
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
- O correio da Equipe, o retorno de denúncia e os eventos que o Mestre escreve.
- O nome do jogo, **SOTERRA**.
- Texto que viaja entre jogadores vai **no idioma de quem o gerou** (ver a etapa 2, acima).
- `index2d.html`, `v2.html`, `v2_3d.html` (as linhas antigas) não carregam o i18n: seguem em português.
