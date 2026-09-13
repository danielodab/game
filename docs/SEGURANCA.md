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
- O `carry` (HP que atravessa) é o que o servidor anotou ao fechar a sala anterior
  **da mesma descida** (sala = anterior + 1, mesmo calabouço, fechada há menos de
  2 h); senão nenhum.
- Resposta: `{ok, bilhete, semente, carry}`.

### 4.2 `POST /api/sala/fechar`
Corpo: `{bilhete, lances: [...], hashFinal}`.
- Confere dono, `estado='aberta'`, idade ≤ 6 h.
- Pede ao juiz `POST /sala/fecha` (§5.2) com o estado da conta.
- Tempo mínimo: `agora - aberta_em ≥ max(4 s, 0,35 s × turnos do jogador)` — senão
  422 `rapido-demais` (a sala não paga e fica `recusada`).
- Vitória: grava o estado novo (versao+1), registra `iids.novos` (origem do juiz),
  marca `iids.fora`, soma o XP do dízimo na guilda do servidor, anota o carry, marca
  a sala `paga`. Derrota: `perdida`, estado sem mudança de recompensa.
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

### 4.6 A troca
`POST /api/troca` move itens (por iid), bichos e vinténs entre os DOIS estados do
servidor numa transação: o juiz tira do estado de quem dá e põe no de quem recebe
(ops `troca-tira`/`troca-poe`). Cada lado recebe `{versao, hash, progress, db}`.

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
  iids: {novos: [{iid, itemId, origem}], fora: [iid]}, carry, hash}`.

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
- [ ] API: salas, op, PUT cosmético, loja e troca no servidor (em andamento)
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
