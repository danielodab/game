# O Torneio da Arena (10/10)

O dono: "a arena é o maior item do mapa e tem que ir além de procurar desafios, deve ter torneio; todo sábado
terá torneio de PvP e todo domingo torneio de guilda (ou quando o adm marcar)". Este arquivo é o CONTRATO: o
servidor (`servidor/torneio.py`), o cliente (`js/core/torneio.js`, a HUD), o site e o painel do Mestre são
escritos contra ele. O que estiver aqui em maiúsculas é nome de campo ou de rota e não muda sem mudar aqui.

## 1. As regras

**Os torneios da semana** (horário de Brasília, relógio do servidor):

| quando | tipo | chaves |
|---|---|---|
| sábado 14:00 | `pvp` | DUAS, uma por faixa de nível: `20-25` e `25-30` |
| domingo 14:00 | `guilda` | UMA (representantes de nível 20 a 30) |

O servidor cria os da semana sozinho (assim que o anterior do mesmo tipo acaba, e nunca a menos de 6 dias).
O Mestre marca torneios extras (tipo, faixa, data e hora) e cancela qualquer um que ainda não começou.

**Quem entra.** O jogador inscreve uma DUPLA (dois heróis, como no quadro da Arena; um só se a conta só tem
um que pode lutar). O nível que vale é o do herói MAIS FORTE da dupla, no estado do servidor, e tem de estar
dentro da faixa (o nível 25 escolhe uma das duas; uma conta, uma chave por sábado). A conta do Mestre não
entra. Trocar a dupla é inscrever de novo, até o fechamento.

**As vagas abrem aos pares.** A chave nasce com 2 vagas; encheu, dobra: 2 → 4 → 8 → 16 (o teto). `vagas` é
sempre 2, 4, 8 ou 16; com 16 inscritos a inscrição fecha.

**O sorteio.** As inscrições fecham 10 minutos antes do início. Com menos de 2 inscritos o torneio é
`cancelado`. O tamanho da chave é a menor potência de 2 que cabe os inscritos (5 inscritos = chave de 8, com 3
passes livres); as posições e os passes saem por sorteio do servidor (`secrets`), e a chave fica pública na
hora. Passe livre (`bye`) só existe na primeira rodada e nunca dois passes se enfrentam.

**As rodadas.** A primeira começa no horário marcado; cada rodada seguinte começa 2 minutos depois de a
anterior inteira estar decidida ("vai até terminar"). A previsão pública de cada luta é
`inicio + rodada × 20 min`, corrigida quando a rodada de fato começa.

**A luta.** Na hora da rodada os dois são CHAMADOS e têm 3 minutos para dizer "estou aqui"
(`POST /api/torneio/presente`). Os dois presentes: a partida nasce PRONTA na Arena (uma linha em
`arena_partidas` com `estado = 'pronta'` e o `did` do torneio) e os clientes seguem o duelo de sempre, pelo
modo `arena` — o lado A é o de cima da chave. Só um presente: vence por W.O. Nenhum: o servidor sorteia quem
passa (a chave não para). A luta do torneio:
- NÃO mexe na coroa (a Brasa) nem conta nos tetos de duelo do dia, e a paridade de nível da Arena não vale
  (quem manda é a faixa do torneio);
- começa com a vida CHEIA dos dois lados e não grava a vida do fim (a vida única fica como estava);
- tem vencedor pelo juiz de sempre (o replay dos lances). Desistência declarada e W.O. provado pelo relé
  valem como no duelo. Duelo que fecha SEM vencedor (sincronizou por foto, regras mudaram, sem prova): o
  servidor abre UMA revanche (um `did` novo, mais 3 minutos de chamada); a revanche sem vencedor decide por
  sorteio. Luta que passa de 30 minutos decide por sorteio. **Um lado só não fecha "sem vencedor"** (10/10, a
  brecha fechada — §4.5): o fechamento sem vencedor vindo de UM lado (foto, replay que o juiz recusa, W.O. sem
  prova) fica `aguardando` o registro do OUTRO por 90 s; se o outro fecha com um registro limpo que o juiz
  refaz até um vencedor, vale esse (`como: 'luta'`). A revanche só abre quando os DOIS fecharam sem vencedor ou
  a janela venceu. O replay que o juiz recusa de um lado, com o registro limpo do outro, é DERROTA de quem o
  mandou (`como: 'wo'`). E quem fecha sem vencedor na luta E na revanche, com o outro limpo ou calado, perde
  por W.O. em vez de ir ao sorteio.

**O prêmio do campeão**, pelo tamanho da chave SORTEADA:

| chave | barras de ouro | vinténs | Gema Enterrada (`stone-gem`) | conta como conquista | moldura |
|---|---|---|---|---|---|
| 16 | 20 | 5000 | 2 | sim | sim |
| 8 | 10 | 2500 | 1 | sim | sim |
| 4 | 5 | 1250 | 0 | sim | não |
| 2 | 2 | 600 | 0 | não | não |

As barras entram por `barras_move` (motivo `torneio`, `idem` único por torneio), os vinténs e as gemas pela
mesma fila de entrega que o Eco e o prêmio diário usam. Nada se paga duas vezes (idempotente por torneio).

**A progressão — ganhar de novo continua valendo.** Cada torneio de PvP vencido com chave de 4 ou mais soma
uma CONQUISTA à conta (`conquistas.pvp`), para sempre:

| conquistas | título (permanente, escolhido em Customizar) | moldura "Campeão da Arena" |
|---|---|---|
| 1 | Campeão da Arena | grau I (com chave de 8 ou 16) |
| 2 | Bicampeão da Arena | grau I |
| 3 | Tricampeão da Arena | grau II |
| 5 | Lenda da Arena | grau III |
| 10 | Imortal da Arena | grau III |

Os títulos mais baixos seguem disponíveis. A moldura é da conta para sempre desde a primeira conquista em
chave de 8 ou 16, e leva de 1 a 5 marcas (uma por conquista, até 5). O campeão VIGENTE de cada faixa (o do
último torneio encerrado) leva um louro a mais na plaquinha até o torneio seguinte da mesma faixa acabar. As
barras, os vinténs e as gemas não diminuem na repetição.

**O torneio de guilda.** Qualquer membro de nível 20 a 30 se VOLUNTARIA com a dupla dele
(`POST /api/torneio/voluntariar`); o líder ou um oficial escolhe o representante entre os voluntários
(`POST /api/torneio/representante`). No fechamento, a guilda sem escolha vai com o voluntário de maior nível
(empate: quem se voluntariou primeiro); guilda sem voluntário não entra. Uma vaga por guilda, as vagas
abrindo aos pares como no PvP (contam as guildas com ao menos um voluntário). A guilda da equipe não entra.
A guilda campeã ganha:
- XP em DOBRO (×2) para todos os membros por 7 dias — um fator próprio (`guilda.fatorXp = 2` no contexto do
  juiz), que substitui o +15% do cofre enquanto durar;
- XP para a guilda: 600 (chave de 16), 300 (8), 150 (4), 60 (2);
- a moldura discreta na placa da guilda enquanto for a campeã vigente (até o próximo torneio de guilda
  acabar) e uma marca pequena permanente por título (`guildaTitulos`, até 5);
- o representante ganha o título "Campeão das Guildas" (`conquistas.guilda`).

## 2. As rotas

Tempos em ms. `T` é o torneio como o público o vê:

```
T = { id, tipo: 'pvp'|'guilda', faixa: '20-25'|'25-30'|null, nivelMin, nivelMax, titulo, origem: 'semanal'|'mestre',
      inicioMs, inscricaoAteMs, estado: 'inscricoes'|'sorteado'|'andamento'|'encerrado'|'cancelado',
      vagas: 2|4|8|16,
      inscritos: [{ conta, nome, nivel, classes: [{classId, nivel}], guilda: {id, nome, emblema}|null }],
      chave: null | { tamanho: 2|4|8|16, rodada: <a rodada em curso, de 0>,
                      rodadas: [[ { pos, a: P|null, b: P|null, estado: 'aguarda'|'chamada'|'luta'|'decidida',
                                    vencedor: 'a'|'b'|null, como: 'luta'|'wo'|'bye'|'sorteio'|'desistencia'|null,
                                    previstoMs } ]] },          // P = { conta, nome, guilda: {id, nome, emblema}|null }
      campeao: P|null,
      premio: { barras, vintens, gemas, conquista: bool, moldura: bool, xpGuilda } }   // o do tamanho de agora
```

Públicas (sem conta; o site as lê):
- `GET /api/torneios` → `{ok, agoraMs, torneios: [T]}` — em andamento, os próximos e os 4 últimos encerrados.
- `GET /api/torneio?id=` → `{ok, agoraMs, torneio: T}`.

Com conta:
- `GET /api/torneio/meu` → `{ok, agoraMs, inscricoes: [{torneio, herois, classes, nivel}],
  luta: null | {torneio, rodada, pos, lado: 'A'|'B', adversario: {conta, nome, nivel, classes}, prazoMs,
  presente, elePresente, did: <só com a partida pronta>}, conquistas: {pvp, guilda}, moldura: bool,
  vigente: bool, guilda: null | {torneio, voluntarios: [{conta, nome, nivel, classes, desdeMs}], representante:
  conta|null, souVoluntario, possoEscolher}}`. É também o "ainda estou aqui" de quem espera a chamada.
- `POST /api/torneio/inscrever {torneio, herois: [1 ou 2]}` → `{ok, torneio: T}`. Recusas com `motivo`:
  `fechado`, `cheio`, `nivel` (com `nivel`, `nivelMin`, `nivelMax`), `outra-chave`, `mestre`, `tipo`.
- `POST /api/torneio/sair {torneio}` → `{ok, torneio: T}` (até o fechamento; depois é desistência: W.O.).
- `POST /api/torneio/presente {torneio}` → o mesmo corpo de `/api/torneio/meu`.
- `POST /api/torneio/voluntariar {torneio, herois}` e `POST /api/torneio/desvoluntariar {torneio}`.
- `POST /api/torneio/representante {torneio, conta}` (líder ou oficial; `conta: null` desfaz a escolha).

Do Mestre:
- `GET /api/mestre/torneios` → `{ok, torneios: [T]}` (todos, com os cancelados).
- `POST /api/mestre/torneio/marcar {tipo, faixa, inicioMs, titulo}` → `{ok, torneio: T}`.
- `POST /api/mestre/torneio/cancelar {torneio}` → `{ok, torneio: T}`.

A partida pronta aparece também no `GET /api/arena/estado` (`fase: 'pronta'`, com `torneio: <id>`), que é por
onde o cliente entrega a luta ao Duelo.

## 3. O que cada lado carrega

- **O perfil na praça** (carimbado pelo Relé, nunca pela página): `arena: {n: <conquistas pvp>, vigente: bool}`
  e, na guilda do perfil, `campea: bool` e `titulos: n`.
- **Os títulos** (`js/core/titulos.js`, a mesma régua no juiz): `Titulos.ARENA` (a escada acima) e
  `Titulos.ARENA_GUILDA = 'Campeão das Guildas'`; fonte `arena` no catálogo; `estado.arena = {pvp, guilda}`.
- **A moldura** `arena` na vitrine (`molduras.tem`) de quem a ganhou; o grau sai de `arena.n`.
- **A plateia**: o campeão é anunciado no chat de todos (`plateia`, tipo `torneio`).

## 4. Notas da implementação (o servidor, 10/10)

O servidor é `servidor/torneio.py` (o mixin `TorneioMixin`, as tabelas `torneio*`, o laço `liga_torneios`). A
prova é `python tests/torneio_api.py` (15 provas, com o juiz de verdade). O que segue é TUDO o que saiu
diferente do texto acima, ou que o texto deixava em aberto — o cliente, o site e o painel leem daqui.

**4.1 O que não deu para fazer como estava escrito**

- **As barras: o motivo no banco é `presente`, não `torneio`.** A tabela `barras_movimentos` tem um CHECK na
  coluna `motivo` e não se altera (o rolling update divide o banco) — é a mesma saída do anúncio e do prêmio
  diário: `barras_move(cid, n, 'presente', 'torneio:<id>', 'torneio-<id>-b', …)`. O EXTRATO que a conta lê
  (`GET /api/loja/minha` → `barras.movimentos[]`) mostra `motivo: 'torneio'`, `nome: 'Torneio da Arena'` e
  `torneio: <id>`, que é o que o contrato pedia para a tela.
- **A Gema inteira não passava na fila da loja.** O `confere` de `js/core/loja.js` (a mesma régua no juiz)
  recusa a entrega de `pedras` com uma pedra do elemento `gema`. Ganhou UMA exceção: a entrega com
  `origem: 'torneio'` (que só o servidor escreve, congelada em `loja_pedidos`). Os pedidos do prêmio são
  `sku: 'torneio-vintens'` (`{tipo: 'vintens', alvo: 'carteira', qtd}`) e `sku: 'torneio'`
  (`{tipo: 'pedras', alvo: 'stone-gem', qtd, origem: 'torneio'}`), os dois de preço 0 e entregues NA HORA
  quando o juiz está ligado; a origem do pedido na fila é `'torneio'` (o `origemDe` de `js/core/loja.js`
  ainda a lê como `'loja'` — o aviso "Prêmio do torneio" é do cliente).

**4.2 O que o texto deixava em aberto (decisões do servidor)**

- **O representante da guilda campeã também recebe o prêmio do campeão** (barras, vinténs e gemas da
  tabela, pelo tamanho da chave): a tabela do prêmio não distingue o tipo, e `T.premio` tem os dois lados.
  No de guilda `premio.moldura` é sempre `false` (a moldura "Campeão da Arena" é do PvP) e no de PvP
  `premio.xpGuilda` é sempre `0`.
- **"Conta como conquista" vale para os dois tipos**: com chave de 2, o representante NÃO ganha o título
  "Campeão das Guildas" e a guilda NÃO ganha a marca permanente (`titulos`). O XP em dobro por 7 dias, o XP
  da guilda (60) e a placa de campeã vigente valem com qualquer tamanho.
- **`T.premio` antes do sorteio** é o do tamanho que a chave teria agora: a menor potência de 2 que cabe os
  inscritos (no mínimo 2). **`T.vagas` depois do sorteio** é o tamanho da chave.
- **`T.inscritos` no torneio de guilda, antes do fechamento**, é UM por guilda com voluntário: o
  representante de agora (o escolhido, ou o voluntário de maior nível). É o que conta nas `vagas`.
- **O nível é conferido de novo no fechamento** (só no PvP): quem saiu da faixa entre a inscrição e o
  fechamento (subiu de nível) sai da chave, com o evento `torneio-fora` na trilha da conta.
- **`outra-chave` é por DIA de Brasília do início**: vale também para os torneios do Mestre, e a recusa
  leva `torneio: <o id da chave em que a conta já está>`.
- **Sair depois do fechamento** (`POST /api/torneio/sair` em `sorteado` ou `andamento`) é desistência:
  a luta chamada ou em curso vai para o adversário com `como: 'wo'`, e toda luta seguinte da conta também
  (os dois desistentes na mesma luta: `sorteio`). `como: 'desistencia'` é só a desistência DECLARADA dentro
  do duelo (`desistiu: true` no `POST /api/duelo/fechar`). No torneio de guilda, `sair` durante as
  inscrições é 400 `tipo` (o caminho é `desvoluntariar`).
- **Empate no duelo** (`venc: 'empate'`) conta como "sem vencedor": revanche, e sorteio depois dela.
- **O duelo com o did do torneio mas fora dele** (outro `modo`, outros heróis, o mapa do desafio) não dá a
  vitória a ninguém: fecha sem vencedor (revanche).
- **A luta de 30 minutos conta por duelo**: a revanche tem os 30 minutos dela.
- **`GET /api/torneio/meu` NÃO marca presença**: só o `POST /api/torneio/presente` vale como "estou aqui".
  O `/meu` é a consulta que o cliente repete enquanto espera (não há "visto" que vença no torneio).
- **O laço e as leituras**: o passo roda a cada 5 s numa thread do servidor e em toda rota do torneio; as
  LEITURAS (`/api/torneios`, `/api/torneio`, `/api/torneio/meu`, `/api/mestre/torneios`) dão o passo no
  máximo uma vez por segundo por processo — a resposta pode estar até ~1 s atrás do relógio.
- **Os títulos dos semanais** são `Torneio da Arena — níveis 20 a 25`, `Torneio da Arena — níveis 25 a 30` e
  `Torneio das Guildas` (em português; quem traduz é o cliente, pelo `tipo` e pela `faixa`).

**4.3 Campos e respostas a mais (nada foi renomeado nem tirado)**

- `GET /api/torneio/meu`: `luta.revanche: bool`; `luta.prazoMs` durante a luta é `luta_ms + 30 min` (o teto
  dela); o bloco `guilda` fala do torneio de guilda VIVO MAIS PRÓXIMO — `GET /api/torneio/meu?torneio=<id>`
  escolhe outro (o Mestre pode ter marcado um extra junto com o da semana). `guilda.representante` é o
  ESCOLHIDO (`null` = vale o padrão, o de maior nível); depois do fechamento, quem de fato vai.
- `POST /api/torneio/voluntariar`, `/desvoluntariar` e `/representante` respondem o corpo de
  `/api/torneio/meu` (com o bloco `guilda` DESSE torneio) mais `torneio: T`.
- Recusas além das do contrato (todas com `motivo`): `dois` (400, a conta com dois heróis manda a dupla),
  `mestre` (400 também para o herói Mestre do Fundo; 403 para a conta do Mestre), `sem-inscricao` (409, sair
  sem estar), `sem-guilda` (409), `equipe` (403, a guilda da equipe), `cargo` (403, representante por quem
  não é líder nem oficial), `sem-voluntario` (409). Torneio que não existe: 404. Sem o juiz: 503. O teto de
  pedidos por hora é o da Arena (429, o mesmo balde).
- `GET /api/mestre/torneios`: `{ok, agoraMs, torneios: [T + motivo]}` — `motivo` é o do cancelamento
  (`'poucos'` | `'mestre'` | `null`); os 100 mais recentes. `marcar`: `titulo` é opcional (3 a 60
  caracteres; sem ele, o padrão do tipo), `inicioMs` tem de deixar as inscrições abertas (mais de 10 min à
  frente) e no máximo 180 dias; até 30 torneios do Mestre vivos. `cancelar` devolve `T + motivo`.
- `POST /api/duelo/fechar` responde `torneio: <id>` quando o duelo foi a luta do torneio (com `venc` A/B e
  sem `motivo`, o vencedor avançou; sem vencedor, abriu a revanche). `POST /api/arena/sair` com a partida
  de um torneio não desfaz nada (devolve o estado, ainda `pronta`).
- A ficha da guilda (`GET /api/guilda/minha` e toda resposta com `guilda`) ganhou
  `torneio: {campea, titulos, fatorXp, xpDobroAteMs}`. O juiz aplica o `fatorXp` sozinho (o contexto da sala
  leva `guilda.fatorXp = 2`); para a PRÉVIA na tela bater, `JOGO.Guilda.fatorXp()` precisa existir no cliente
  (`js/core/game.js` já o lê quando existe; sem ele mostra o +15% de sempre e adota o XP do servidor).
- A vitrine (`molduras.todas`) traz a linha `{id: 'arena', sku: null, nome: 'Campeão da Arena', conquistas,
  grau: 1|2|3, marcas: 1..5}` só para quem a tem. `js/core/titulos.js` ganhou `T.grauDaArena(n)` e
  `T.marcasDaArena(n)` (a mesma conta).
- O carimbo do Relé só viaja quando há o que dizer: `arena` falta no perfil de quem não tem conquista nem é
  o vigente (não vem `{n: 0, vigente: false}`), e `campea`/`titulos` faltam na guilda que não tem nenhum dos
  dois — e só saem na guilda em que a conta ESTÁ (o nome do perfil confere com o do banco).
- A plateia: `{t: 'plateia', tipo: 'torneio', nome, dados: {torneio, tipo, faixa, tamanho, titulo, guilda:
  <nome da guilda campeã> | null}}`.
- Os eventos na trilha da conta (`eventos`): `torneio-inscrito`, `-saiu`, `-desistiu`, `-fora`, `-sorteado`,
  `-chamada`, `-luta`, `-sem-vencedor` (com `por`: quem fechou o duelo sem vencedor), `-campeao`,
  `-cancelado`, `-voluntario`, `-representante`; do Mestre, `-marcado` e `-cancelou`.

**4.4 O que fica em aberto**

- O contêiner VELHO do rolling update não conhece o torneio: um deploy no meio de um torneio pode fechar
  uma luta como duelo ranqueado comum (a Brasa mudaria). Não publicar sábado/domingo às 14:00.

**4.5 A brecha fechada: um lado só não fecha "sem vencedor" (10/10, o segundo commit do servidor)**

Como estava, quem perdia a luta fechava o duelo sem vencedor (declarava `fotografada`, mandava um replay torto
que dava 422, cortava o replay no meio) e ganhava a revanche — e, repetindo, o sorteio de 50%. Agora, SÓ para
o did de torneio (o duelo comum não mudou em nada):

- **O fechamento sem vencedor de UM lado espera.** `fotografada`, o W.O. que o relé não prova e o did fechado
  fora do torneio (outro `modo`, outros heróis) respondem 200 `{fase: 'aguardando', motivo: 'torneio',
  esperaAte, esperaMs}` e NADA é guardado; o replay recusado segue respondendo 422 a quem o mandou, também sem
  guardar nada. A janela é de 90 s desde o primeiro fechamento assim (`SOTERRA_TORNEIO_FECHO_S`; a tabela nova
  `torneio_fechos` guarda quem fechou como). O cliente pergunta de novo depois de `esperaMs`, como já faz na
  espera da desistência.
- **O registro limpo do outro lado vale inteiro.** Se o outro fecha com os lances que o juiz refaz até um
  vencedor, é esse o resultado (`como: 'luta'`) — mesmo com a espera `sem-fim` aberta por um replay cortado do
  adversário (no torneio, o registro do OUTRO lado vai ao juiz em vez de só esperar).
- **Revanche**: só quando os DOIS lados fecharam sem vencedor, ou quando a janela venceu sem o registro limpo
  (quem dá esse passo é o relógio do torneio; `porque: 'janela'` no evento). Seguem abrindo a revanche na
  hora os desfechos que não são palavra de um lado: as regras que mudaram no deploy, o empate que o juiz viu e
  a espera da desistência que venceu (120 s, `sem-confirmacao`).
- **O replay recusado contra o registro limpo é derrota**: um lado com 422 e o outro com um registro que o
  juiz aceitou (mesmo sem fim) = vence o limpo, `como: 'wo'`; o duelo guardado sai com `venc`, `fim: 'wo'` e
  `torneio`. Os DOIS recusados (a divergência honesta) = sem vencedor.
- **A reincidência**: quem fechou sem vencedor POR ESCOLHA (`fotografada`, replay recusado, fora do torneio)
  na luta E na revanche, enquanto o outro não fez o mesmo nas duas, perde por W.O. (`como: 'wo'`) em vez de ir
  ao sorteio. Os dois reincidentes, ou nenhum: sorteio. O replay limpo sem fim e o W.O. sem prova não contam
  como escolha.
- **O evento `torneio-sem-vencedor`** agora leva `por` como LISTA das contas que fecharam aquele did sem
  vencedor por escolha (vazia quando ninguém escolheu: regras, empate, espera vencida).
- **O did de torneio que já não é a luta em curso** (decidida por W.O., sorteio ou pela janela), fechado
  depois como duelo da Arena, vale como amistoso (`motivo: 'torneio'`): não ranqueia nem grava vida.
