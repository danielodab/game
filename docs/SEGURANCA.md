# SEGURANÇA — o servidor manda na economia e confere a batalha

> Pedido do dono (12/09): "cada item dropado tem um id? preciso que evite hackers
> de duplicação de itens ou aumento de rate e dano." Este documento é a LEI da
> implantação: quem é dono de cada campo, as rotas, os formatos e a ordem.

## 1. O problema

Até 12/09 o jogo inteiro era calculado no navegador: a batalha, o dano, o sorteio
do saque, o XP e os vinténs. O servidor guardava o save que o cliente mandava e só
garantia que um número de série (iid) não estivesse em dois lugares. Quem abrisse o
console podia inventar peças, mudar rate, dano e XP, e escrever qualquer carteira
(que a loja lia do save).

## 2. A ideia

Um **JUIZ** em Node (`servidor/juiz/`) carrega **os mesmos arquivos JS do jogo** num
contexto isolado e roda a regra no servidor. Não há segunda cópia das regras:

- a sala é refeita da semente do servidor e dos lances do jogador (`sala.js`);
- a recompensa sai do **próprio `computeRewards` do game.js**, rodando no juiz com a
  sala refeita e o sorteio semeado pelo servidor (`recompensa.js`);
- toda operação que muda a economia (equipar, forjar, fundir, roleta, elementos,
  cofre, missões, mercado, loja…) roda a **mesma função** do Progress/DB no estado
  que o servidor guarda (`economia.js`).

A API (Python) guarda o estado e conversa com o juiz por HTTP no 127.0.0.1
(`juiz_ponte.py`). Sem juiz, o que precisa de conferência responde 503 e o cliente
tenta de novo — nada é pago sem conferir.

## 3. Quem é dono de cada campo

Com a **autoridade ligada** (conta do site com sessão; ver §8), o servidor é o dono do
estado econômico. O cliente aplica na hora para a tela não esperar, mas o que vale é
o do servidor.

| Onde | Campo | Dono |
|---|---|---|
| progress | tudo (heróis: xp, nível, elementos, itens, itemVar, pet, trajes; inventory; unlockedClasses; cards; stones; pets; petCards; petXp; selos; petSelosDado; seloElemento; insignias; pergaminhos; bonusXp; bonusXpAte) | **servidor** |
| db | carteira, banco, mercado, missoes, conquistas, chefes, poco, loja, jogador.brasa | **servidor** |
| db | jogador.titulo | servidor (só grava título que a régua dá) |
| db | jogador.nome, avatar, dupla, coroaOculta, mutados, placar, pvp, trocas | cliente (cosmético) |

`progress.nascimentos` deixa de valer: com a autoridade ligada o servidor cunha os
iids e registra na tabela `itens` na mesma transação.

**O hash da economia** (`js/core/economia.js`, carregado no jogo E no juiz):
`Economia.hash(progress, db)` = FNV-1a 32 bits sobre o JSON canônico (chaves
ordenadas) dos campos de dono **servidor** acima, sem os caches derivados
(`hero.spells`, `progress.nascimentos`, `db.loja.recusadas`). O cliente compara o
dele com o do servidor a cada resposta; diferente = adota o do servidor.

## 4. As rotas da API

Todas com sessão (Bearer). Erros no formato de sempre `{ok:false, erro, ...}`.

### 4.1 `POST /api/sala/abrir`
Corpo: `{dungeonId, roomIndex, dificuldade, herois: [heroId, heroId?], versaoRegras?}`.
- Confere: calabouço e sala existem (o juiz sabe: `/regras`), `dificuldade ∈
  {facil, normal, dificil}`, heróis são da conta e liberados, teto de bilhetes por
  hora (`SALAS_POR_HORA = 240`).
- **A versão das regras** (19/09). Até 18/09 `versaoRegras` era só uma palavra neste documento: a
  única versão que existia era o hash dos arquivos que o juiz carrega (`GET /saude` e `/regras`,
  `versao`), que muda a cada deploy, que o navegador não sabe calcular e que ninguém guardava no
  bilhete — um deploy que mudasse uma regra no meio de uma sala fazia o replay cair como `divergiu`,
  isto é, como fraude. Agora o engine.js declara um NÚMERO, `Engine.VERSAO_REGRAS`, que sobe só
  quando uma regra muda o fim de uma sala refeita (a lista está no próprio engine.js; a 2 é a visão
  de 19/09). O juiz o anuncia em `GET /regras` e `GET /saude` (`regras`); a API:
  - `versaoRegras` (o `JOGO.Engine.VERSAO_REGRAS` da página) diferente do do juiz → 409
    `{motivo: 'regras-velhas', regras}`: a página está com um engine.js de antes do deploy e
    refaria a sala com outro resultado — recarregue (o `erro` já diz). **Sem o campo = versão
    1**: a única página que não manda é a de antes do número (18/09), e ela jogaria com o
    engine.js e o ai.js velhos para cair como `divergiu` (fraude) no fim — a revisão mediu 22%
    das salas dela divergindo só com a IA dos monstros. Só passa sem o campo quando o juiz
    também não anuncia número (juiz de antes). Torto, 400. Antes de recusar, a API pergunta ao
    juiz de novo (o `GET /regras` fica guardado 5 min e pode ser de antes do deploy se a API subiu
    primeiro; no máximo uma reconferência a cada 2 s) e só recusa se ele confirmar.
    `js/core/autoridade.js` manda o campo em toda abertura (A.prepara, A.abreGrupo, A.abreDuelo)
    e `grupo.js` na confirmação da guerra: a aba que ficou aberta através do deploy é pega na
    ABERTURA da luta seguinte, e não só no fechamento. O mesmo 409 vale em `/api/grupo/abrir`
    (quem lidera), `/api/duelo/abrir` (cada lado) e `/api/guerra/confirmar` (cada um dos quatro);
  - guarda o número do juiz em `salas_regras(bilhete, regras, versao)` (tabela nova, nunca
    ALTER) e o manda no `bilhete` do `POST /sala/fecha` (§4.2): o juiz confere contra o seu
    ANTES de refazer e recusa com `regras-mudaram`; a API então VENCE o bilhete (410, sala
    `vencida`, evento `sala-vencida` com o motivo) em vez de marcá-lo `recusada`. O jogador abre
    a sala de novo com as regras de agora, e a trilha diz por que a anterior não pagou.
    **Linha ausente = versão 1**: o bilhete aberto antes do deploy que trouxe a tabela não tem
    linha, e é justamente o que o deploy da visão põe em risco — a revisão mediu 12 de 54 salas
    de antes caindo como `divergiu` (fraude) quando o juiz novo as refazia sem conferir nada. A
    API manda `regras: 1` por ele (a versão implícita do engine.js) e o juiz o vence.
  - as salas em grupo, o duelo e a guerra (`servidor/grupo.py`, `guerra.py`) seguem o mesmo
    desenho desde 19/09: `salas_grupo_regras(gid, regras, versao)` gravada no `/grupo/abrir`,
    `duelos_regras(did, regras, versao)` gravada no primeiro `/duelo/abrir` do did, e a chave
    `regras` dentro da própria ata da guerra (`guerra_partidas.ata` — o número vem na resposta do
    `POST /guerra/ata` do juiz que montou a ata, sem segunda consulta). O fechamento manda o número
    na ata/pedido, o juiz confere antes de refazer, e sob outra versão: a sala em grupo VENCE para
    os dois (410 `regras-mudaram`, estado `vencida`, evento `grupo-vencida`); o duelo fica
    guardado como `fase: 'vencido'`, `motivo: 'regras-mudaram'` para os dois lados (200, sem vida
    gravada, sem coroa, evento `duelo-vencido`); a guerra fecha `vencida` na hora para os quatro
    (sem os 120 s de espera, sem XP, evento `guerra-fim` com o motivo). Linha ou chave ausente =
    1; só o duelo SEM abertura nenhuma (a página de antes do `/duelo/abrir`) não confere.
    Prova: `tests/regras_versao_api.py` (API + juiz, 8 provas) e `tests/visao_mapas.js`.
  - **no deploy, o juiz e a API sobem juntos (ou a API depois)**: a API guarda o `GET /regras` do
    juiz por 5 min (`REGRAS_CACHE`), e uma API que subiu antes do juiz novo abriria lutas com o
    número velho até lá — elas venceriam ao fechar (`regras-mudaram`), sem prêmio. A API esquece o
    guardado ao ver um `regras-mudaram` do juiz e reconfere antes de um 409 `regras-velhas`
    (`_regras_esquece`, `_confere_versao_cliente` em `servidor/salas.py`), então a janela é curta,
    mas não é zero: suba o juiz primeiro.
  - a HUD ainda mostra `regras-mudaram` com o texto genérico de luta vencida/recusada (o
    `motivo` viaja na resposta e na trilha; a frase própria "as regras mudaram: recarregue a
    página" é da frente da HUD).
- Uma conta tem **um** bilhete aberto: abrir outro vence o anterior. 15/09: antes, a luta que a conta
  deixou aberta no servidor é LARGADA (os heróis dela a 0; ver §5.2.1, "As falhas conhecidas") — o jogo
  honesto fecha a dele antes de abrir outra — e a resposta leva `largada: {herois}`.
- Sorteia `semente` (31 bits, `secrets`) e `bilhete` (token). Guarda
  `salas(bilhete, conta_id, dungeon, sala, dificuldade, semente, herois, carry,
  aberta_em, estado='aberta')`.
- O `carry` (HP com que cada herói entra) é a **vida de agora** do herói (§5.2.1, 14/09: a vida
  única), em QUALQUER sala — a 0 da descida, o Poço, outro calabouço. Só entram os heróis que
  não estão cheios; todos cheios, `carry = null`. Herói a 0 PV: 409 `vida-zero`.
- Resposta: `{ok, bilhete, semente, carry}`.

### 4.2 `POST /api/sala/fechar`
Corpo: `{bilhete, lances: [...], hashFinal}`.
- Confere dono, `estado='aberta'`, idade ≤ 6 h.
- Pede ao juiz `POST /sala/fecha` (§5.2) com o estado da conta.
- Tempo mínimo: `agora - aberta_em ≥ max(4 s, 0,35 s × turnos do jogador)` — senão
  422 `rapido-demais` (a sala não paga e fica `recusada`).
- Vitória: grava o estado novo (versao+1), registra `iids.novos` (origem do juiz),
  marca `iids.fora`, soma o XP do dízimo na guilda do servidor, anota o carry, marca
  a sala `paga`. Derrota (ou sala largada): `perdida`, estado sem mudança de recompensa.
  Nos dois casos a vida do fim de cada herói do bilhete é gravada em `vida_heroi` (§5.2.1).
- Resposta: `{ok, fase, recompensa, versao, hash, progress, db}` — o cliente adota
  `progress`/`db` (campos do servidor) e mostra `recompensa` na tela.

### 4.3 `POST /api/op`
Corpo: `{versaoBase, ops: [{nome, args}], hashDepois}`.
- `versaoBase ≠ versao atual` → 409 com `{versao, progress, db}` (o cliente adota).
- Teto: 40 ops por pedido, 600 por minuto por conta.
- Pede ao juiz `POST /op` (§5.3); grava; registra iids novos/fora.
- Resposta: `{ok, versao, hash, resultados}` e, se `hash ≠ hashDepois`,
  também `{progress, db}` para o cliente adotar.

### 4.4 `PUT /api/save` (muda de sentido)
- Autoridade ligada: `progress` do corpo é **ignorado**; do `db` só entram os campos
  de dono cliente (§3). Sem 409 por versão (o cosmético é "último vence").
- `nascimentos` ignorados.
- Conta sem estado no servidor (conta nova): o primeiro PUT é aceito inteiro e vira
  o estado inicial (a "anistia" do corte vale para quem já tinha save).
- Resposta: `{ok, versao, hash}`.

### 4.5 A loja, os presentes e os pagamentos
- `POST /api/loja/retirar` passa a **aplicar no servidor** as entregas pendentes (o
  juiz roda `Loja.entrega` no estado) e marca `entregue` na mesma transação.
  Resposta inclui `{versao, hash, progress, db}`.
- A carteira da loja é a do estado do servidor (já era `saves.db`; agora é confiável).
- 13/09, as **barras de ouro** (`servidor/loja.py`): a moeda da loja do site mora SÓ no
  servidor (`barras_saldo` + o extrato `barras_movimentos`, mudados juntos em
  `barras_move`, na mesma `_escrita`; `CHECK (saldo >= 0)`; idem único por conta). O
  save do jogo nunca as carrega, então um save forjado não cria barra. A compra em
  barras debita na transação que cria o pedido; cancelar ou estornar devolve uma vez
  (idem `pedido:ID:estorno`). Na troca de vinténs por barras, as barras só entram
  quando o pedido vira `entregue` — no `_loja_retirar_no_servidor`, depois de o juiz
  tirar os vinténs do estado (idem `pedido:ID:ganho`). No caminho antigo (sem juiz) o
  PUT que confirma a entrega credita: ali o save ainda é do cliente, o mesmo risco já
  aceito para os vinténs.

### 4.6 A troca
`POST /api/troca` move itens (por iid), bichos e vinténs entre os DOIS estados do
servidor numa transação: o juiz tira do estado de quem dá e põe no de quem recebe
(ops `troca-tira`/`troca-poe`). Cada lado recebe `{versao, hash, progress, db}`.

### 4.7 O mercadinho entre contas (13/09, `servidor/mercado.py`)
O anúncio é do SERVIDOR (`mercado_anuncios`) e a peça fica **em custódia**: sai do estado do
vendedor pela série (op interna `mercadoTira`) e a série segue `vivo` com ele no registro — o
`salvar` e o `_estado_grava` não a varrem, como o banco da guilda. Rotas (todas com conta; sem
juiz, 503): `GET /api/mercado/resumo|item?id=|meus|propostas|avisos`, `POST /api/mercado/
anunciar|comprar|propor|cancelar|responder|confirmar|retirar|visto`.
- **Comprar por X** e **confirmar a proposta aceita por Y** são a mesma venda: numa transação,
  o juiz debita o comprador (saco primeiro, depois o banco: `mercadoPaga`) e põe a peça no saco
  dele (`mercadoPoe`), credita o vendedor com valor − taxa (`mercadoRecebe`, mesmo offline), a
  série muda de dono (origem `mercador`), o anúncio fica `vendido` e as outras propostas vivas,
  `perdida`. Taxa = 5% do preço FINAL, para cima, mínimo 1.
- **Propor** não reserva vintém (confere saco + banco na hora); o vendedor aceita (o anúncio
  continua aberto) ou recusa; quem confirmar primeiro leva; anúncio que já saiu = `perdida`.
- As ops antigas do jogador (`anunciarMercado`, `comprarMercado`, `retirarMercado`) são
  recusadas pelo juiz; as ofertas que ainda moravam no `db.mercado.ofertas` viram anúncios na
  primeira chamada de mercado da conta (`mercadoLegadoTira`), com a série.
- **O lote de pedras de forja (22/09).** `POST /api/mercado/anunciar {tipo: 'pedra', stoneId,
  qtd, preco}` — o corpo SEM `tipo` segue o da peça (`{preco, iid}` ou `{preco, invIndex}`).
  A API confere a forma (stoneId no formato de id, `qtd` inteiro puro em 1/10/50/100, preço
  inteiro 1..9999: senão 400) e o teto de anúncios (o lote conta como a peça); o juiz, a regra:
  op INTERNA `mercadoTiraPedras {stoneId, qtd}` — a pedra tem de existir em `DATA.stones`
  (senão `argumento`, que a API devolve como 400) e o estoque tem de cobrir (`falta`, que a API
  devolve como 409 `pedras` com `tem`/`faltam`, sem gravar nada); tira pelo
  `Progress.gastaPedras`, tudo ou nada. O anúncio é a linha de `mercado_anuncios` com
  `item_id` = a pedra, level/stars 0 e `iid` NULL, mais uma linha em `mercado_lotes
  (anuncio_id PK → mercado_anuncios ON DELETE CASCADE, tipo CHECK 'pedra', qtd CHECK
  1/10/50/100)` — tabela nova, nunca ALTER —, gravadas na mesma transação que o estado.
  Comprar, propor/aceitar/confirmar e retirar são os de sempre; só a entrega muda: op INTERNA
  `mercadoPoePedras {stoneId, qtd}` (mesmas conferências; `addStones` — pedra não ocupa o
  saco, então não há `saco` cheio) no lugar do `mercadoPoe`, sem série a conferir e sem mexer
  no registro `itens`. As duas ops estão em `OPS_INTERNAS` (salas.py): pelo `/api/op`, 403.
  O lote que ainda morasse no `db.mercado.ofertas` (o mercadinho local) NÃO vira anúncio:
  `mercadoLegadoTira` põe as pedras de volta no estoque do vendedor. Leituras: o `resumo`
  separa `itens` (só peças) de `pedras` (`[{stoneId, lotes, pedras, menor, menorUnit, meus}]`);
  o `item?id=<pedra>` ordena pelo preço por pedra; todo objeto com cara de anúncio leva
  `tipo` ('peca' | 'pedra') e `qtd` (1 na peça). No rolling update, o contêiner velho vê o
  lote como uma peça que o juiz dele não aceita (`mercadoPoe`: peça inválida, 422): a compra e
  a retirada caem lá sem mexer em nada, e passam no contêiner novo.
  **Limite conhecido:** a MIGRAÇÃO do mercadinho local (`_mc_migra`) no contêiner velho não
  conhece lote: um lote local que chegue ao servidor no primeiro save de uma conta e tenha a
  primeira chamada do mercado atendida pelo contêiner velho, nos segundos de sobreposição,
  some sem devolver as pedras (a marca da migração impede a nova de refazer). Pede três
  coisas raras juntas — lote criado offline, primeiro login e a janela do deploy —; o contêiner
  novo devolve o lote ao estoque.

### 4.8 Os direitos do titular e o registro de erros (02/10, `servidor/privacidade.py`, `servidor/registros.py`)
Antes do lançamento: os Termos de Uso e a Política de Privacidade (`site/termos.html`,
`site/privacidade.html`, escritos lendo este servidor), o aceite, excluir a conta, baixar os
dados e o registro de erros. Módulos novos, com ganchos curtos no `api.py`; tabelas novas,
nunca ALTER. Um advogado revisa os textos antes de abrir ao público (`docs/REVISAO_JURIDICA.md`).
- **O aceite.** `POST /api/cadastro` exige `aceiteTermos` = `privacidade.VERSAO_TERMOS` (a data
  dos documentos): sem ele 400 `sem-aceite`, com outra versão 409 `termos-velhos` + `versaoTermos`.
  O aceite (`aceites(conta_id, documento, versao, aceito_em)`, os dois documentos) é gravado na
  MESMA transação que cria a conta. `GET /api/termos` (público) diz a versão de agora;
  `GET /api/conta/aceite` diz se a conta está em dia;
  `POST /api/conta/aceite {versao}` é o aceite de quem tem conta de antes (a página da conta
  mostra o pedido). A versão mora também em `site/site.js` (`SITE.VERSAO_TERMOS`) e no
  `data-versao` das duas páginas: `tests/privacidade_api.py` pega a deriva.
- **Excluir a conta.** `POST /api/conta/excluir {nome, senha}`: o nome EXATO da conta e a senha
  (o `_confere_senha` da troca de senha, com o freio por IP no balde `excluir`). Recusa 409 com
  `motivo`: `mestre` (a conta com a marca; tire no Terminal antes), `luta-aberta` (duelo aberto
  sem resultado da última 1 h, sala em grupo aberta, Arena ou guerra casada/pronta, das últimas 6 h) e `pagamento-aberto` (link do Mercado
  Pago das últimas 2 h sem resposta, ou pagamento pendente/em disputa). Numa transação: a guilda
  se resolve (o membro mais antigo herda; sozinho, ela se desfaz), os eventos da conta saem
  (menos os `pagamento-*`), as tabelas que guardam o id sem chave estrangeira são limpas
  (`SEM_CHAVE`), a linha de `contas` sai — o CASCADE e o SET NULL do esquema fazem o resto: o
  dinheiro (pagamentos, extrato das barras, alertas) fica sem a conta — e no MESMO id nasce a
  **lápide** (`excluída#<id>`, e-mail `.invalid`, senha impossível, `banido = 1`): sem ela o
  SQLite daria o maior id apagado à próxima conta criada. `contas_excluidas(conta_id,
  excluida_em, guilda)` anota a exclusão. A cópia que a conta emprestou pelo banco da guilda fica
  com quem pegou (a original some com a conta: não é duplicação). E-mail de confirmação ao
  endereço que era da conta. A prova lê o esquema: nenhuma coluna com chave para `contas` (nem
  `conta_id` sem chave) pode apontar para a conta depois.
- **Baixar meus dados.** `GET /api/conta/meus-dados`: o JSON de tudo o que o servidor guarda da
  conta (dados, aceites, save, sessões com IP, eventos, itens, salas, duelos, Arena, guerras,
  salas em grupo, guilda — com as peças no banco, o XP doado, o mural, pedidos e convites —, amigos,
  presença, barras, loja, pagamentos, mercadinho, erros; o adversário entra só como o lado A/B), listas longas com `total` e `incluidos`; 5 por hora.
- **A faxina dos prazos** (`_faxina_privacidade`, no boot e a cada sessão aberta, no máximo 1
  vez por hora): sessões sem uso há 30 dias (com o IP delas), o resumo das derrubadas, códigos e
  contagens de freio de mais de 1 dia, erros quietos há 30 dias. Antes, a sessão vencida só
  morria se o token voltasse.
- **O registro de erros.** `POST /api/registro/erros {erros: [{tipo, mensagem, pilha, onde,
  vezes}], versao, tela, navegador}`, com ou sem sessão (a conta sai do TOKEN; token morto não é
  401 aqui). Até 20 por lote, 12 pedidos por minuto por endereço ou conta (429), campos
  cortados; e-mail, IP, token e a consulta da URL viram marcadores antes de gravar. Uma linha por
  erro distinto (`erros_registro`, chave = sha256 da origem, da mensagem e do 1º quadro) com
  contador, primeira/última vez e as últimas versões/telas/navegadores; até 50 contas por erro
  (`erros_registro_contas`, CASCADE); 5.000 erros distintos (sai o mais quieto); 30 dias sem
  repetir e some. A exceção não tratada da própria API entra como origem `api` (o `except` do
  Atendente chama `registra_excecao_api`; a pilha é só arquivo:linha em função). O Mestre lê em
  `GET /api/mestre/erros` e apaga o resolvido em `POST /api/mestre/erros/apagar {chave}`
  (`site/mestre_erros.js`). O cliente é `js/core/registro_erros.js`, o PRIMEIRO script do
  `index.html`; em `file://` não faz nada.

## 5. O juiz (Node, só 127.0.0.1)

### 5.1 `GET /saude` → `{ok, versao}`; `GET /regras` → `{versao, calaboucos: {id: nSalas}}`

### 5.2 `POST /sala/fecha`
Entrada:
```
{ conta: {id, gm}, bilhete: {dungeonId, roomIndex, dificuldade, semente, herois, carry},
  lances, hashFinal, progress, db,
  contexto: { agoraMs, fatores: {geral, porCalabouco}, guilda: {bonusXp, bonusDrop, dizimo} } }
```
- Monta um mundo com dados + combate + `economia.js` + `progress.js` + `db.js` +
  `missoes.js` + `game.js` e os dublês de Agenda/Guilda/Diario/Coop.
- Grupo = `Progress.battleParty(herois)` **do estado do servidor**.
- Refaz a sala (`sala.js`); com `fase='won'`, põe o estado refeito no Game e chama
  `Game._computeRewards()` com `Math.random` do mundo semeado por
  `hash(semente, 'recompensa')`.
- Saída: `{ok, fase, turnosJogador, refeito, recompensa, progress, db, guildaXp,
  iids: {novos: [{iid, itemId, origem}], fora: [iid]}, carry, vidaMax, hash}`. `carry` (o PV do fim,
  caído = 0, a fusão divide) e `vidaMax` (o PV máximo) saem em qualquer fim refeito, não só na vitória.

### 5.2.1 As poções de vida e a vida entre as salas (13/09)
A poção NÃO é da batalha (o dono: "a poção não é para usar na batalha.. e sim para curar a vida
após uma batalha na sala de espera entre as salas"). O lance `{a:'po'}` derruba a sala no juiz
(422 `pocao-na-batalha`, solo, grupo ou duelo) e nenhum fechamento mexe em `progress.consumiveis`.

**A VIDA ÚNICA DO HERÓI (14/09).** O dono: "hoje nas salas de espera a vida vai recuperando aos
poucos até encher ou o jogador usa pote; isso vale para quando terminar calabouço (na praça), depois
de um pvp e assim por diante; e se o jogador estiver com a vida na metade e começar uma batalha sendo
pvp, poço, desafio ou outro calabouço, a vida vai começar onde estava". Até 13/09 a vida só
atravessava DENTRO de uma descida (`vida_espera`, por bilhete/gid; a praça zerava). Agora é UMA vida
por herói da conta, contínua entre qualquer luta.

- **Tabela** (nova, nunca ALTER): `vida_heroi(conta_id, heroi, hp_fim, hp_max, desde_ms, cura)`,
  chave `(conta_id, heroi)`. `vida_espera` segue criada (o contêiner velho do rolling update ainda
  escreve nela) e não é mais lida.
- **A regra**: PV agora = `min(hp_max, hp_fim + cura + floor((agora_ms − desde_ms) / 2000))`
  (`VIDA_MS_POR_PV`, o `DATA.vidaEntreSalas.msPorPv`). Herói sem linha, ou com o PV de agora no
  máximo da linha, está **cheio** e fica fora de todo carry: o motor dá o PV máximo de hoje (subir
  de nível ou trocar peça depois da luta entra sozinho). O relógio é o do servidor.
- **Quem grava** (hp_fim, hp_max, desde_ms = agora, cura = 0), uma linha por herói na conta DELE,
  sempre que o juiz refez a luta: `sala/fechar` (vitória, derrota e sala largada), `grupo/fechar`
  (idem; a conta de cada herói sai da party guardada; 15/09: `largou` grava só a parte de quem saiu),
  `duelo/fechar` (ranqueado, empate, acima do teto; 15/09: a desistência declarada e o W.O. provado
  põem o lado de quem saiu a 0 — ver "As falhas conhecidas") e, 15/09, a **largada** (a abertura de
  uma luta nova com outra ainda aberta: os heróis dela a 0). NÃO grava: sala recusada (422), grupo
  `nao-conferida`, duelo fotografado, duelo cujo replay diverge, W.O. esperando a prova.
- **Quem lê** (a vida de agora, só os feridos): `sala/abrir` (qualquer sala, o Poço inclusive),
  `grupo/abrir` (cada herói pela linha da própria conta, chave `dono:heroId`) e `duelo/abrir`.
  Qualquer herói a 0 PV → 409 `vida-zero` `{heroi, esperaS}`. O juiz (`aplicaCarry` /
  `aplicaCarryRede`) só prende no PV máximo da sala nova, com piso 1.
- `GET /api/vida` → `{ok, agoraMs, msPorPv: 2000, herois: {heroId: {hp, max, cheioEmMs, ate1Ms}}}`,
  só os feridos; `cheioEmMs`/`ate1Ms` = quanto falta (ms, a partir de `agoraMs`) para encher / para 1 PV.

**O duelo.** `POST /api/duelo/abrir {did, herois}` (cada lado, antes da arena): confere os heróis na
conta, recusa herói a 0 (409 `vida-zero`), guarda `duelo_vida(did, conta_id, herois, carry,
criado_em)` e responde `{ok, carry: {heroId: PV} | null}`. Idempotente por `(did, conta)`: a segunda
chamada devolve o guardado, não a vida de agora. Teto de 60 aberturas novas por conta por hora (429
`liberaEm`). O `duelo/fechar` manda ao juiz `A.vida`/`B.vida` = o carry guardado de cada lado (sem
linha = null = cheio); o juiz aplica em `Engine.createDuelSala(…, {seed, vidaA, vidaB})` antes do
primeiro turno e devolve por lado `vidaFim` (`Engine.vidaDoLado`) e `vidaMax`. Um registro jogado com
outra vida diverge (422). A resposta ganha `vida: {heroId: PV agora}` dos heróis de quem pede.
Risco aceito: a página de antes (sem `duelo/abrir`) entra cheia — o mesmo que era antes de 14/09.

**AS FALHAS CONHECIDAS (15/09): sair antes do fim não foge mais da consequência.** O dono: "arrume as
falhas conhecidas". As três eram da mesma família: (1) no duelo em rede quem desistia ou tomava W.O. não
perdia a vida da luta — o cliente só fechava o duelo sem W.O. nem contestação, e a sincronização trazia a
vida guardada no `duelo/abrir` por cima do fim; (2) fechar a aba no meio de uma derrota (sala solo, Poço,
sala em grupo) escapava da vida zerada — o servidor nunca recebia o fechar; (3) no duelo ranqueado a
desistência e o W.O. não mudavam a Brasa (o juiz, sem `venc`, não mudava nada).

- **A. A desistência é DECLARADA por quem desiste** (é contra ele: vale). `Coop.desistir` chama o
  `POST /api/duelo/fechar` com `{…, lances até ali, hashFinal, desistiu: true, lado}` antes do
  `Engine.encerra` (o `hashFinal` é o do estado de antes, num ponto de repouso — a vez de gente ou a
  colocação, onde o juiz também para; no meio de um turno da IA vai `null`), com `keepalive` e a fila de
  retentativa da Autoridade. O lado de quem desiste sai da CONTA que pede; `lado` diferente dela = 403
  `desistencia-alheia`. O juiz (`duelo.js`, `perdeu`) refaz os lances; o replay sem fim com `perdeu`
  vira a derrota desse lado: TODOS os heróis dele a 0, o outro com a vida do replay, e onde o modo
  ranqueia (a partida pronta, a paridade e os tetos de sempre) o Elo normal — `fim: 'desistencia'` no
  resultado. O desafio amistoso: a vida a 0, sem Brasa. Quem RECEBEU a desistência pela Rede fecha sem
  declarar nada e nunca zera ninguém: o replay sem fim grava a vida do replay dos dois e o duelo fica
  `aguardando` (`duelo_espera`, motivo `sem-fim`, tabela nova) até `DUELO_ESPERA_MS` = 120 s. A
  declaração do desistente dentro disso vale e só regrava o lado dele (a 0) e a Brasa; passado o prazo,
  fica a vida do replay, sem coroa (`sem-confirmacao`). A resposta `aguardando` traz `esperaMs`, e a
  `Autoridade.fechaDuelo` pergunta de novo sozinha. Desenho: o desistente honesto fecha na hora (mesmo
  saindo da tela); o receptor honesto não precisa confiar em ninguém; o prazo impede um duelo pendurado
  para sempre.
- **B. O W.O. precisa da prova de queda do RELÉ.** O relé (`rele.py`, com `--banco`) grava na tabela nova
  `rele_presenca(conta_id, evento 'caiu'|'voltou', em_ms)` (`servidor/presenca.py`) quando a ÚLTIMA
  conexão identificada de uma conta fecha e quando a conta ganha a primeira de novo; a escrita é numa
  thread, com `mode=rw` (nunca cria o banco), a tabela criada se faltar e a faxina das linhas de mais de
  24 h. **É o mesmo banco da API**: no Coolify os dois sobem com `--banco /dados/soterra.db`
  (`entrada.sh`); no VPS, `/var/lib/soterra/soterra.db` nos dois `.service`, os dois como `soterra`. O
  cliente que ficou, depois do W.O. de 60 s, fecha com `{…, wo: true, lances, hashFinal}`. O servidor
  procura um `caiu` da conta ausente depois do `duelo_vida.criado_em` daquele did sem `voltou` nos 60 s
  seguintes: **W.O. confirmado** = `perdeu` = a ausente (os heróis a 0 e, se o modo ranqueia, a derrota),
  `fim: 'wo'`. Queda anotada há menos de 60 s, ou nenhuma ainda (o relé vê a conexão morta com atraso;
  espera `WO_ESPERA_MS` = 60 s desde o primeiro pedido) = `aguardando`. Sem prova (a volta dentro dos
  60 s, ou nada anotado) = só a vida do replay dos dois, sem Brasa, motivo `wo-sem-prova`.
- **C. A sala abandonada.** O jogo guarda a luta com bilhete (sala solo, Poço) ou gid (sala em grupo) no
  localStorage da conta (`soterra-luta-aberta-v1` + o sufixo), com os lances a cada lance
  (`Autoridade.abreLuta/anotaLuta`). Ao abrir o jogo e ANTES de pedir qualquer luta (bilhete, grupo,
  duelo, Arena, guerra: `Autoridade.fechaPendente`), a luta pendente fecha no servidor com os lances
  guardados e `hashFinal: null` — a sala para no meio e o servidor grava a vida do ponto em que o replay
  parou; na sala em grupo, `POST /api/grupo/fechar {…, largou: true}` fecha só a parte desta conta (a sala
  segue aberta para o parceiro). O abandonar da tela fecha na hora. O bilhete não é mais pedido de
  antemão na antessala (só no "Entrar na batalha"): bilhete aberto = luta começada. O servidor cobre quem
  não fecha (outro aparelho, a memória limpa, o cliente mexido): tabela nova `luta_aberta(tipo, ref,
  conta_id, herois, aberta_ms, estado)`, gravada no `sala/abrir` e no `grupo/abrir` (uma linha por conta).
  Quando a conta abre uma luta nova (`sala/abrir`, `grupo/abrir`, `duelo/abrir`, `arena/inscrever|desafiar`,
  `guerra/inscrever|juntar|confirmar`) e uma luta DELA segue aberta no servidor, ela é **largada**: os
  heróis da conta naquela luta a 0 desde agora (o máximo vem do juiz refazendo a luta sem lance), a sala
  solo `perdida`, a em grupo segue aberta — e o fechamento do parceiro não regrava os heróis de quem
  largou (nem de quem fechou pelo registro). A resposta da abertura (e a recusa, como o 409 `vida-zero`
  que a própria largada provoca) leva `largada: {herois}`, e a HUD avisa "Você saiu da última luta sem
  terminar: os heróis dela voltam do zero". Luta aberta há mais de 2 h (`LARGADA_JANELA_MS`) só fica
  fechada: a vida já teria voltado.
- **Riscos que continuam aceitos:** o cliente MEXIDO que desiste e não declara (o outro lado espera 120 s e
  fica a vida do replay, sem coroa); o registro truncado de propósito (fechar a sala com os lances até um
  ponto bom — a vida daquele ponto, nunca acima da de entrada: o mesmo que fechar a aba naquele ponto e
  voltar); quem fica conectado e parado (sem queda anotada o W.O. não se prova); a queda anotada perdida
  por banco trancado (falha a favor de quem caiu); o primeiro fechamento com replay torto ou fotografado
  anula o duelo para os dois (já era assim); o relé do contêiner velho no rolling update não anota; a ata
  do grupo que falhou com a aba de quem lidera fechada no mesmo instante ainda pode largar o parceiro que
  abrir outra luta nas 2 h seguintes; o `sendBeacon` não serve (a API autentica pelo cabeçalho
  `Authorization`) e o `pagehide` não fecha a luta (ele também dispara na ida ao cache de voltar/avançar).

**As três formas de duelo (14/09).** O `modo` viaja no desafio/ataque da Rede, na ata, no Coop e no
corpo do `POST /api/duelo/fechar` (`desafio | arena | campo`; outro valor = 400). O juiz refaz TODOS
(a vida grava sempre); só a Brasa depende do modo, e o motivo fica guardado no resultado:
- `desafio` (tocar no jogador na praça): mapa FIXO `praca` (`js/core/data/arenas.js`, fora de
  `DATA.dungeons`). Nunca ranqueia (`motivo: 'amistoso'`) e não conta nos tetos. Sem `modo` (a página
  de antes do deploy) também é amistoso (`'modo'`). O mapa está preso aos lances: trocar `praca` por um
  calabouço no fechar diverge no replay (422).
- `arena` (o quadro de inscritos, `servidor/arena.py`): ranqueia só se existe a partida pronta desse
  `did` entre essas duas contas (`'sem-partida'`), com OS heróis que o quadro mostrou (`'dupla'`), e na
  paridade de 5 níveis entre o herói mais forte de cada lado, lida nos estados do servidor (`'paridade'`).
- `campo` (o Campo de PvP): paridade de 10 (`'paridade'`). Arena e campo no mapa `praca` = `'mapa'`.
Os tetos (3/par, 20/conta em 24 h) valem para arena e campo. A coluna `duelos.venc` (o que os tetos
contam) só é preenchida no ranqueado; o amistoso guarda o vencedor só no `resultado`.

**O quadro da Arena** (`arena_inscritos`, `arena_partidas`; tabelas novas, tempos em ms):
`POST /api/arena/inscrever {herois:[2]}` (os dois em ordem; 1 só se a conta só tem 1 que pode lutar —
400 `dois`; o Mestre não entra — 400 `mestre`; herói a 0 PV — 409 `vida-zero`), `GET /api/arena/quadro`
(`{inscritos:[{conta, nome, nivel, brasa, classes:[{classId, nivel}], desdeMs, eu}], paridade}`),
`POST /api/arena/desafiar {alvo, herois:[2]}` (409 `paridade`/`vida-zero-alvo`/`sem-inscricao`/
`inscrito`/`casada`), `POST /api/arena/confirmar`, `POST /api/arena/recusar`, `POST /api/arena/sair`,
`GET /api/arena/estado` (`livre | inscrito | casada | pronta`). Casada vale 30 s: os dois confirmados =
`pronta` com o `did` (inscrito = lado A); recusa, desistência de quem desafiou ou prazo = o inscrito
volta ao quadro com o lugar de antes. Quem não consulta o estado há 20 s sai do quadro. Teto de 120
pedidos (inscrever + desafiar) por conta por hora (429). Os clientes seguem o duelo pela Rede com o did
do servidor e as duplas PÚBLICAS (compromisso e revelação automáticos; a revelação que não bate com o
quadro é trapaça no cliente e `'dupla'` no servidor). Decisão: o inimigo marcado aparece e desafia.

**O Campo de PvP (cliente).** A presença (`oi`/`eco`/`pulso`) leva `zona: 'praca' | 'campo'`
(`Hub.naCampo`) e o `luta`; a aparência (`classe`) no Campo é a do 1º herói da dupla do Campo — o 2º
não viaja. O ataque é o dirigido `duelo/ataque` (paga o balde e a caixa de entrada do convite, como o
desafio); o atacado confere zona, ocupação, vida e paridade (pelo `resumo.forte` da presença, não pelo
envelope) e recusa com o motivo. Risco aceito: a zona e o `forte` são palavra do cliente — quem fecha
decide a Brasa é a paridade lida no servidor, e os tetos seguram o combinado entre duas contas.

**A guerra de guilda 2×2 na Sede (15/09, `servidor/guerra.py`, `servidor/juiz/guerra.js`).** O dono: "a guerra de
guild que é 2x2 de cada guild é na sede de guild, isso dá pontos de experiência para guild". Cada jogador leva a DUPLA
(oito heróis no mapa `sede`); a fila é na Sede e os QUATRO confirmam. Tabelas novas: `guerra_inscricoes`,
`guerra_partidas`, `guerra_jogadores`, `guerra_resultados`. Rotas (com conta; sem juiz, 503):
- `POST /api/guerra/inscrever {parceiro, herois:[2], dono}` — quem lidera o grupo de 2; o parceiro é da MESMA guilda
  (409 `sem-guilda`/`outra-guilda`); os dois heróis em ordem (400 `dois`/`mestre`), nenhum a 0 PV (409 `vida-zero`); fica
  `aguardando` até o parceiro juntar (60 s). `POST /api/guerra/juntar {herois:[2], dono}` (409 `sem-convite`): a
  inscrição vale, com o nível do herói mais forte dos QUATRO lido nos estados do servidor.
- O casamento: a inscrição completa mais antiga com a mais antiga de OUTRA guilda, diferença de nível ≤ 10 (decisão do
  coordenador). `casada` mostra a guilda e os NOMES dos adversários, nunca as duplas (a surpresa: elas só aparecem na ata).
- `POST /api/guerra/confirmar` (409 `vida-zero` do próprio herói; `sem-partida`): os quatro em 30 s = `pronta`, com a
  semente do servidor e a vida de cada jogador guardada (`guerra_jogadores.carry`). A ATA (`guerra_partidas.ata`) sai do
  juiz: `POST /guerra/ata` monta os oito payloads com `Progress.battleParty` no estado de cada conta, com o `dono` —
  o cliente não escolhe com que números luta; `carry` = `{dono:heroId: PV}` (a chave heroId colide entre os dois do
  mesmo lado). O prazo: quem não confirmou sai e o lado que confirmou inteiro volta à fila com o lugar;
  `POST /api/guerra/recusar` devolve o outro lado; `POST /api/guerra/sair` desfaz a inscrição (a dupla de jogadores
  inteira) ou recusa. `GET /api/guerra/estado` = `livre | aguardando | convite | inscrito | casada | pronta | em-luta |
  fechada` (a consulta é o "ainda estou aqui": 20 s sem ela, a inscrição sai; 19/09: ela só ESCREVE quando há o que
  arrumar ou a cada 5 s por inscrição — era uma transação de escrita a cada 2,5 s por jogador). Teto de 120 pedidos
  (inscrever + juntar) por conta por hora. 19/09: a partida viva da conta é a `pronta` SEM linha em `guerra_resultados`
  e sem a saída dela (não some em 3 min — provado a conta 'livre' inscrevendo de novo com a guerra em curso; o teto é
  `LARGADA_JANELA_MS`, 2 h); a pronta cuja ata nunca saiu cai depois de 3 min (`guerra-caiu` motivo `ata`); `em-luta` =
  esta conta já fechou a parte dela (o registro sem fim, o recusado ou o fotografado) e espera os outros (`esperaAte`) —
  o jogo não abre outra luta; `fechada` = a última guerra da conta, fechada há
  menos de 60 s (`gid, venc, lado, venceu, xp, guilda, motivo, fim`), para quem perdeu a resposta do fechar — não prende.
  `casada`/`pronta` levam `semXp: true` quando os tetos já estouraram (a HUD avisa ANTES de confirmar). Quem sai da
  guilda (ou é expulso) sai da fila (`guerra-saiu` motivo `guilda`), o par com um `dono` repetido entre as duplas não
  casa, e confirmar já fora da guilda = 409 `outra-guilda` (a partida cai, o outro lado volta à fila com o lugar).
- `POST /api/guerra/fechar {gid, lances, hashFinal, fotografada, desistiu?, lado?, wo?}` (qualquer um dos quatro;
  idempotente por gid): o juiz (`POST /guerra/fecha`) refaz com a ata GUARDADA (`createDuelSala` com até 4 por lado — o
  `refazEm` do sala.js aceita 4 no modo duelo desde 15/09 — e a vida pela chave `dono:heroId`) e devolve `fase`, `venc`
  e a vida do fim POR DONO. Vitória: `guildas.xp += 40` para a guilda vencedora (decisão do coordenador), dividido em
  `guilda_contrib` entre os dois que lutaram por ela (quem ainda é membro); a perdedora não perde; empate
  (`motivo: 'empate'`) não rende. A COROA NÃO MUDA (a Brasa é do PvP individual). Tetos anti-combinação: 3 guerras com
  XP por par de guildas e 10 por guilda (vencendo ou perdendo) em 24 h — acima vale sem XP (`'teto'`). A vida dos oito
  grava na conta de cada um em todo fim refeito. Tempo mínimo de 0,35 s por turno de gente desde a pronta (422
  `rapido-demais`). Resposta final `{ok, gid, fase, venc, lado, venceu, xp, guilda, guildas, motivo?, fim?, vida,
  fechada: true}`; em espera `{ok, gid, fase: 'aguardando', motivo, esperaAte (ms do servidor), esperaMs}` — o jogo
  pergunta de novo a cada 5 s até `fechada`.
- **A revisão de 19/09 (o dono: "dê uma revisada na guerra de guild do meu jogo e ajuste o que for necessário").**
  Estava provado: qualquer um dos quatro fechava com `lances: []` e o servidor guardava `sem-fim` como final, com a vida
  dos oito cheia e o registro do vencedor no guardado (o lado que perdia anulava a guerra do console); o primeiro
  registro recusado (422) fechava tudo como `recusada`; sair ou cair não custava nada; e o juiz aceitava marcas
  `morte`/`ia` forjadas contra o adversário (quatro marcas, sem lance, 4 s depois da pronta = +40 XP e o outro lado a 0).
  O contrato servidor↔jogo agora:
  1. **Só um registro COM FIM fecha a guerra na hora** (venc A/B/empate no replay, ou o fim forçado abaixo). O registro
     SEM fim (hashFinal null, fase `playing`) vai para `guerra_espera(gid, conta_id, lances, primeiro_ms, motivo,
     turnos, resultado)` (tabela nova), responde `aguardando` e grava a vida SÓ dos heróis de quem fechou. O recusado
     pelo juiz (422 `vez`, `divergiu`, `marca-sem-prova`…) e o rápido demais também entram na espera, sem gravar nada, e
     respondem 422 com `fase: 'aguardando'`. O fotografado idem (`fotografadas`, e o estado dele é `em-luta`). Um registro
     com fim de qualquer dos quatro dentro de `GUERRA_ESPERA` (120 s desde `primeiro_fecho`) vence — o limpo tardio
     também. Passado o prazo sem fim (pelo fechar — também o recusado e o rápido demais repetidos, 2ª rodada: o 422
     seguia 'aguardando' com esperaMs 0 para sempre, e o jogo repete o fechar a cada 5 s sem consultar o estado — ou
     pela consulta do estado, `_guerra_arruma`): `sem-fim` com a vida do replay mais LONGO para todos (menos quem saiu),
     sem XP; só recusados = `recusada`; só fotografados = `nao-conferida` (sem vida). O fechamento sem fim NÃO fecha a
     luta aberta de quem fechou (2ª rodada: fechava, e quem perdia fechava vazio do console, saía com a vida do começo
     e abria outra luta no meio da guerra): a luta aberta da guerra só fecha no resultado final ou pela saída declarada
     — quem fechou vazio e abre outra luta antes do fim é largado (heróis a 0, sem regravação). A vida de quem fechou
     sem fim decide com as saídas RELIDAS dentro da escrita (3ª rodada: o `saidas` lido antes da ida ao juiz deixava o
     `sair {gid}` — ou a largada de outra aba — que entrava nesse meio ser sobrescrito pela vida do replay, com
     `lances: []` a do começo, e a conta ficava 'livre' com a saída declarada e a vida cheia; provado 2 em 3 corridas).
     A regra do arquivo: nenhuma escrita de `vida_heroi` decide com uma leitura de antes da ida ao juiz.
  2. **A saída declarada**: `POST /api/guerra/sair {gid}` da partida pronta (ou `desistiu: true` no fechar — só da própria
     conta: `lado` de outro = 403 `desistencia-alheia`) = `guerra_saidas(gid, conta_id, em_ms, motivo)` (tabela nova), os
     dois heróis da conta a 0 NA HORA (o máximo vem do juiz refazendo a guerra sem lance), a luta aberta dela fechada,
     `guerra-saiu` para os outros três; a guerra segue para eles. Os DOIS de um lado fora = o outro lado vence (`fim:
     'saida'`, XP nos tetos) assim que qualquer um fechar. Quem saiu nunca é regravado pelo fim dos outros. Sair da
     pronta cuja ata ainda não saiu (o juiz lento) derruba a guerra que não começou, sem custo, e o outro lado volta à
     fila (`guerra-caiu` motivo `saiu`; 2ª rodada — respondia 'pronta' sem declarar nada) — e abrir outra luta
     (sala/grupo/duelo/Arena/guerra) com a pronta sem ata faz o mesmo (3ª rodada: `_guerra_larga` punha a linha da
     luta aberta como 'fechada' sem derrubar nada, a sala abria e, quando a ata saía, a conta lutava em duas frentes
     sem a régua da largada; se a ata sai nesse meio, 409 `mudou` e o pedido repetido larga a guerra).
  3. **O W.O. com prova**: `wo: true` = quem ficou declara que os DOIS adversários sumiram; o servidor confere
     `presenca.prova_de_queda` dos dois (menos quem já saiu) desde a CASADA (`criada_ms`; 3ª rodada — contava de
     `pronta_ms`, e quem confirmou pelo HTTP com o Relé já caído e nunca voltou ficava 'nada'; o 'voltou' dentro da
     janela já anula a queda velha) — 'caiu' sem 'voltou' em 60 s nos dois = W.O. confirmado: o lado ausente a 0
     (`perdeu` no juiz, `forcado`), `fim: 'wo'`, XP nos tetos (decisão do coordenador: sem consequência para quem some,
     o W.O. vira a saída barata de quem perde); queda há menos de 60 s, ou nenhuma ainda (até `WO_ESPERA_MS` do
     PRIMEIRO pedido de W.O. da partida, `guerra_wo(gid, pedido_ms)`, tabela nova — 2ª rodada: contava do
     `primeiro_fecho`, e o vazio de outro dois minutos antes pulava a espera do Relé) = o registro vai ao juiz e fica
     na ESPERA com motivo `wo` (`aguardando` com o prazo da prova; o estado de quem declarou é `em-luta`; 3ª rodada — o
     pedido não ficava em lugar nenhum: o estado era 'pronta', a consulta nunca lia a prova madura, quem ficou e
     declarou era largado a 0 ao abrir outra luta e a partida ficava pronta para sempre); a prova madura fecha o W.O.
     também pela CONSULTA de qualquer um dos quatro (`_guerra_wo_provado` → `_guerra_fecha_forcado`, com a vida do
     replay mais longo guardado na espera, sem ir ao juiz) e no fim da espera (`_guerra_encerra_espera`); sem prova (a
     volta em 60 s, ou nada anotado depois da espera) = `wo-sem-prova`: o replay entra na espera como um registro sem
     fim, e a espera vencida guarda `motivo: 'wo-sem-prova'` (não 'sem-fim'). O fim FORÇADO — os dois de um lado fora,
     o W.O. provado — é fato do servidor e vale também para quem foi restaurado por foto (3ª rodada: o ramo do
     fotografado vinha antes e o engolia em 'aguardando fotografada' → 'nao-conferida'): o juiz recebe o registro VAZIO
     com `perdeu` (o lado ausente a 0, o presente com a vida do começo); e o registro recusado pelo juiz (422) com um
     fim forçado decidido volta ao juiz com o vazio pelo mesmo motivo.
  4. **As marcas de rede** `{a:'x', ev:'ia'|'morte', u}` no registro: o juiz (`sala.js`, o gancho `confereMarca`;
     `guerra.js`, `confereMarcaDaGuerra`) só aceita a marca `morte` sobre o herói de uma conta X se X está no MESMO lado
     de quem fecha (o parceiro de guilda marca, por desenho), ou com a prova do servidor: a saída declarada de X em
     `guerra_saidas` (a API passa `{fechou, contas, saidas}`). Sem prova, 422 `marca-sem-prova` (na espera: o registro do
     parceiro dele vence). A marca `ia` passa de quem for (2ª rodada da revisão): o parceiro marca também por PRAZO
     (`coop.js`, `assumeGuerra` 'prazo' — sem queda nenhuma no Relé) e a voz `ia` entra nos QUATRO registros; exigir o
     'caiu' do Relé recusava o registro limpo dos dois adversários e o lado que perdia vetava a guerra de graça (provado
     pelo revisor: 'sem-fim' com a vida do começo, sem XP). E a prova não comprava segurança: marcar `ia` só faz a vez
     de X passar, o mesmo que o lance `{a:'e', de: X}` que o juiz já aceita de quem for (o risco aceito do replay).
  5. **A luta aberta da guerra**: `luta_aberta_guerra(conta_id, gid, desde_ms, estado)` (tabela nova; o CHECK da
     `luta_aberta` só aceita sala/grupo), uma linha por conta desde a pronta. Abrir sala/grupo/duelo/Arena/guerra com uma
     guerra pronta pendente (`_larga_pendentes` → `_guerra_larga`) = largada: a saída declarada com motivo `largada`, os
     heróis a 0, `luta-largada` tipo `guerra`, e `largada: {herois}` na resposta (ou no 409 `vida-zero` que ela provoca).
     O jogo guarda o gid em `soterra-luta-aberta-v1` e fecha a guerra pendente ao reabrir (`Autoridade.fechaPendente`).
  6. **Os motivos 4xx**: `sem-guilda`, `outra-guilda`, `dois`, `mestre`, `vida-zero`, `casada`, `inscrito`, `sem-convite`,
     `sem-estado-parceiro`, `sem-estado-lider`, `mesmo-dono`, `parceiro`, `sem-partida`, `gid`, `desistencia-alheia`,
     `desistiu-e-wo`, `marca-sem-prova`, `rapido-demais`, `mudou` — a HUD tem a tabela de textos.
  Também: uma ata por gid de cada vez por processo (`_atas_em_curso`); o fechamento concorrente dos quatro paga o XP
  uma vez (a checagem dentro de `BEGIN IMMEDIATE`); a ata só grava COM a versão das regras — o número vem na própria
  resposta do `/guerra/ata` (`regras`), e se nem ela nem o `/regras` o dão a ata fica para a consulta seguinte (3ª
  rodada: a ata gravada sem a chave era lida no fechar como a versão 1 e o juiz vencia a guerra inteira dos quatro).
  Provas: `tests/guerra_api.py` (24), `tests/juiz_guerra.js` (26), `tests/luta_largada_api.py` (a guerra largada). **Riscos que continuam aceitos**: um cliente mexido ainda pode escrever
  lances do adversário num registro com fim (o replay é o juiz dos lances; os tetos e o tempo mínimo seguram — e a
  marca `ia` livre é o mesmo atalho); o `sai` que viaja pelo relé sem o `POST /api/guerra/sair` chegar (só um cliente
  mexido: o jogo declara com keepalive, guarda `saiu` na luta aberta e repete ao reabrir, e o fechar dos outros repete a
  cada 5 s até a saída entrar) deixa a marca `morte` do adversário sem prova — só o lado do que saiu fecha, e sem
  ninguém dele a espera acaba `recusada` (um veto sem ganho para quem veta); quem fica conectado e parado não é W.O.
  (a vez passa pelo prazo do parceiro, e a guerra acaba pelo teto de rodadas); `dono` segue palavra do cliente (a
  colisão agora só custa o casamento).
- **O lockstep de 4 (cliente, `js/core/coop.js`).** Os lances vão pelo dirigido `batalha` aos três outros (um envelope
  por destino, com `para` e o limite de 6.000 bytes por fatia do `R.dirige` — o relé não mudou). Lance só do dono da vez;
  hash no fim de cada turno. Quem MANDA (a foto de resgate) é o primeiro presente da ordem A1, A2, B1, B2 (A = a dupla de
  jogadores que entrou na fila antes; 1 = quem inscreveu); cada cliente só aceita a foto que pediu, de quem ELE vê como
  autoridade. Quem cai: passada a carência de 15 s, quem marca `u.ia` (o turno passa) é o PARCEIRO DE GUILDA — marca
  vinda do adversário é ignorada; a volta desmarca (o parceiro, ou o próprio dono se o parceiro também está fora). Quem
  sai morre (`sai`). W.O. do lado inteiro só com os DOIS adversários fora há 60 s — e o W.O. não rende XP.
- **Risco aceito (o mesmo do duelo):** o primeiro registro limpo que o juiz refaz vale; um cliente mexido pode escrever
  lances que o adversário não fez. O tempo mínimo e os tetos seguram o farm, e o XP é da guilda (não vira moeda). A
  partida tem de estar `pronta` (os quatro confirmaram) e o gid é do servidor.

**A poção** se bebe FORA da batalha, em qualquer lugar (praça, antessala, depois do duelo): `POST
/api/vida/pocao {heroId, pocaoId}`. A API confere o herói na conta (400 `heroi`) e a vida ferida (409
`cheio`, com `hp`/`hpMax` quando há linha — antes de gastar); o juiz roda a op INTERNA `beberPocao
{id}` (tira uma do contador, tudo ou nada: sem ela, 422 `sem-pocao`) e a `cura` soma em
`vida_heroi.cura` na MESMA transação que grava o estado. Resposta `{ok, heroi, pocaoId, cura, hp,
hpMax, versao, hash, progress, db}`. As rotas de antes, `POST /api/sala/pocao {bilhete, …}` e `POST
/api/grupo/pocao {gid, …}`, fazem o mesmo (do bilhete/gid só se confere o formato): a página velha
aberta no deploy continua bebendo. A compra segue a op `comprarPocao {id, qtd}`
(`JOGO.Mercado.comprarPocao`: vinténs do saco, teto por tipo, tudo ou nada).

### 5.3 `POST /op`
Entrada: `{conta: {id, gm}, progress, db, ops: [{nome, args}], semente, contexto: {agoraMs}}`.
Cada `nome` é uma operação da tabela `OPS` de `economia.js`, que valida os
argumentos e chama a função do jogo. Sorteio (forja, roleta) usa o gerador semeado
pelo servidor. Saída: `{ok, progress, db, resultados, iids, hash}`; 422
`{erro, motivo, indice}` na primeira op recusada (as anteriores não valem: o pedido é
tudo ou nada).

A quebra (22/09): `quebrarPeca {invIndex, n?}` (n de 1 a 99, ausente = 1) chama
`Progress.quebraPeca` — n cópias idênticas do saco viram pedras do elemento pela régua de
`DATA.quebra`, sem sorteio. As séries quebradas saem em `iids.fora` (o cartório as aposenta
como qualquer consumo) e a cópia emprestada da guilda cai com `emprestada`. Cópia a menos, a
Panóplia do Mestre ou índice sem peça devolvem `false` com o estado igual (não é 422).

## 6. O cliente

- `js/core/economia.js`: o hash (§3).
- `js/core/autoridade.js` (`JOGO.Autoridade`): liga quando há sessão do site; guarda
  `versao`/`hash`; fila de ops com envio a cada 300 ms; `adota(progress, db)` troca o
  estado local sem recarregar a página (Progress.state + syncSpells + DB econômico +
  repinta a HUD).
- `game.js`: bilhete ao entrar na antessala (e na próxima sala), semente no
  `createBattle`, anotação dos lances do jogador no solo (`onTileClicked`,
  `endTurn`, `declareFusion`, colocação), `fechar` na vitória/derrota com a tela
  "conferindo…", recompensa vinda do servidor.
- As chamadas da HUD que mudam a economia passam por `Autoridade.op`. Forja com risco e
  roleta **esperam** o servidor (o sorteio é dele).

## 7. As fases de entrega

1. Juiz: motor, sala refeita, recompensa, economia, hash. ✔ parcial
2. API: salas, op, PUT cosmético, loja no servidor, troca no servidor.
3. Cliente: autoridade, bilhete/lances/fechar, ops, adoção de estado.
4. Grupo (semente do servidor na ata), Poço semeado, duelo ranqueado com Brasa no
   servidor e teto anti-farm.
5. Provas: juiz (Node), API com juiz de verdade (Python), cliente (Chrome), bateria.

## 8. Convivência e corte

- **Em casa (file://, sem sessão)** o jogo segue 100% local.
- **Anistia do corte**: o save que o servidor já tem vira o estado da conta.
- **Aba velha aberta no deploy**: o PUT dela não muda economia; ao recarregar, adota.
- **Offline no meio da sala**: o bilhete fechado fica guardado e é reenviado; a tela
  diz "conferindo…".
- **Tempo mínimo por sala** com folga: barra só o impossível.

## 9. Estado da implantação

- [x] Juiz carrega o jogo no Node (`servidor/juiz/motor.js`)
- [x] Sala refeita da semente e dos lances (`servidor/juiz/sala.js`, `tests/juiz_sala.js`)
- [x] Node no contêiner e o juiz no `entrada.sh`; API aceita `--juiz`
- [x] Juiz: recompensa (`recompensa.js`, `tests/juiz_recompensa.js`), economia (`economia.js`,
      `tests/juiz_economia.js`), hash (`js/core/economia.js`)
- [x] API: salas, op, PUT cosmético, loja, troca e banco da guilda no servidor (`servidor/salas.py`,
      `tests/autoridade_api.py`) — **a autoridade só liga com `--juiz`** (o `entrada.sh` passa)
- [x] API: grupo e duelo ranqueado com tetos anti-farm (`servidor/grupo.py`, `tests/grupo_duelo_api.py`)
- [x] Cliente: troca e banco da guilda adotam o estado do servidor; cópia emprestada não sai do saco
- [x] Prova de ponta a ponta: jogo + API + juiz de verdade (`tests/autoridade_ponta.js`, 11)
- [x] Cliente: autoridade, bilhete, lances, fechar, ops, forja e roleta pelo servidor
      (`js/core/autoridade.js`, `tests/autoridade_cliente.js`)
- [ ] Cliente: troca e cofre da guilda pelas rotas novas
- [x] Poço semeado (`poco.js` salaSemeada; `tests/juiz_poco.js`)
- [x] Juiz: sala em grupo (`/grupo/fecha`, registro com marcas de queda/volta/saída) e duelo
      ranqueado (`/duelo/fecha`, Brasa nos dois estados) — `tests/juiz_grupo.js`
- [x] Cliente: semente do grupo pelo servidor, fechar grupo e duelo (`coop.js`, `game.js`)
- [ ] API: rotas de grupo e duelo (`/api/grupo/abrir|fechar`, `/api/duelo/fechar`, tetos anti-farm)
- [x] Guerra de guilda 2×2 (15/09): a fila e o XP da guilda na API (`servidor/guerra.py`, `tests/guerra_api.py`), a ata
      e o replay de quatro donos no juiz (`servidor/juiz/guerra.js`, `tests/juiz_guerra.js`), o lockstep de quatro no
      cliente (`tests/guerra_motor.html`), a HUD (`tests/guerra_hud.html`) e o tráfego pelo relé de verdade
      (`tests/guerra_rele_prova.py`)
- [x] As falhas conhecidas (15/09): a desistência declarada e o W.O. com a prova do relé no duelo
      (`servidor/grupo.py`, `servidor/juiz/duelo.js`, `servidor/presenca.py`; `tests/grupo_duelo_api.py`,
      `tests/rele_presenca_prova.py`, K11 de `tests/coop_motor.html`) e a luta largada
      (`servidor/salas.py`, `js/core/autoridade.js`; `tests/luta_largada_api.py`, `tests/luta_aberta_cliente.js`)

### Limites conhecidos

- Sala em grupo que precisou de **foto de resgate** (divergência entre os motores) não pode
  ser refeita pelo registro de quem recebeu a foto: vale o registro limpo do outro membro; se
  nenhum dos dois tiver registro limpo, a sala fica **não conferida** e não paga.
- Duelo contestado não ranqueia nem fecha. 15/09: a desistência (declarada por quem desiste) e o W.O.
  (com a queda provada pelo relé) contam como derrota de quem saiu — a vida a 0 e, onde vale coroa, a
  Brasa; o W.O. sem prova vale só a vida do replay. Os riscos que sobram estão em §5.2.1, "As falhas
  conhecidas".
- A configuração de PA/PP do Mestre (`soterra-gm-v1`) mora no navegador: batalha da conta do
  Mestre com PA/PP mudado pode divergir no servidor.
