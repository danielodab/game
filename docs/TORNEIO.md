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
  sorteio. Luta que passa de 30 minutos decide por sorteio.

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
