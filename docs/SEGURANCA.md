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
Corpo: `{dungeonId, roomIndex, dificuldade, herois: [heroId, heroId?], versaoRegras}`.
- Confere: calabouço e sala existem (o juiz sabe: `/regras`), `dificuldade ∈
  {facil, normal, dificil}`, heróis são da conta e liberados, teto de bilhetes por
  hora (`SALAS_POR_HORA = 240`).
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
  inteira) ou recusa. `GET /api/guerra/estado` = `livre | aguardando | convite | inscrito | casada | pronta` (a consulta
  é o "ainda estou aqui": 20 s sem ela, a inscrição sai). Teto de 120 pedidos (inscrever + juntar) por conta por hora.
- `POST /api/guerra/fechar {gid, lances, hashFinal, fotografada}` (qualquer um dos quatro; idempotente por gid): o juiz
  (`POST /guerra/fecha`) refaz com a ata GUARDADA (`createDuelSala` com até 4 por lado — o `refazEm` do sala.js aceita 4
  no modo duelo desde 15/09 — e a vida pela chave `dono:heroId`) e devolve `fase`, `venc` e a vida do fim POR DONO. Vitória:
  `guildas.xp += 40` para a guilda vencedora (decisão do coordenador), dividido em `guilda_contrib` entre os dois que
  lutaram por ela (quem ainda é membro); a perdedora não perde; empate (`motivo: 'empate'`) e W.O./desistência (o replay
  sem fim, `'sem-fim'`) não rendem. A COROA NÃO MUDA (a Brasa é do PvP individual). Tetos anti-combinação: 3 guerras com
  XP por par de guildas e 10 por guilda (vencendo ou perdendo) em 24 h — acima vale sem XP (`'teto'`). A vida dos oito grava
  na conta de cada um em todo fim refeito. Tempo mínimo de 0,35 s por turno de gente desde a pronta (422 `rapido-demais`,
  guardado). Fotografado espera 120 s um registro limpo de outro dos quatro, senão `nao-conferida` (sem XP e sem vida).
  Replay que não bate (422): `recusada`, guardado, sem XP e sem vida.
  Resposta `{ok, gid, fase, venc, lado, venceu, xp, guilda, guildas, motivo?, vida}`.
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
