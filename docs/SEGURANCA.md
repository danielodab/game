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
- Uma conta tem **um** bilhete aberto: abrir outro vence o anterior.
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
  (idem; a conta de cada herói sai da party guardada), `duelo/fechar` (ranqueado, empate,
  desistência/W.O. — o PV em que o replay parou — e acima do teto). NÃO grava: sala recusada
  (422), grupo `nao-conferida`, duelo fotografado, duelo cujo replay diverge.
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

### Limites conhecidos

- Sala em grupo que precisou de **foto de resgate** (divergência entre os motores) não pode
  ser refeita pelo registro de quem recebeu a foto: vale o registro limpo do outro membro; se
  nenhum dos dois tiver registro limpo, a sala fica **não conferida** e não paga.
- Duelo que acaba por W.O., desistência ou contestação não ranqueia.
- A configuração de PA/PP do Mestre (`soterra-gm-v1`) mora no navegador: batalha da conta do
  Mestre com PA/PP mudado pode divergir no servidor.
