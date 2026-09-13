# SEGURANÇA — o servidor manda na economia e confere a batalha

> Pedido do dono (12/09): "cada item dropado tem um id? preciso que evite hackers
> de duplicação de itens ou aumento de rate e dano." Este documento é a LEI da
> implantação: o que o servidor confere, em que ordem, e o que o cliente faz.

## O problema

Até 12/09 o jogo inteiro era calculado no navegador: a batalha, o dano, o sorteio
do saque, o XP e os vinténs. O servidor guardava o save que o cliente mandava e
só garantia que um número de série (iid) não estivesse em dois lugares. Quem
abrisse o console podia inventar peças novas, mudar o rate, o dano e o XP, e
escrever qualquer número de vinténs — e a loja lia a carteira do save.

## A ideia

Um **JUIZ** em Node (`servidor/juiz/`) carrega **os mesmos arquivos JS do jogo**
num contexto isolado e roda a regra no servidor. Não existe segunda cópia das
regras em Python para divergir: a regra que o cliente usa é a que o juiz usa.

- A API (Python) fala com o juiz por HTTP no 127.0.0.1 (`juiz_ponte.py`).
- Sem juiz no ar, o que precisa de conferência responde 503 — nada é pago sem
  conferir, e o cliente tenta de novo.

## As fases

### Fase 1 — o bilhete da sala, a sala refeita e a recompensa no servidor

1. **Abrir** (`POST /api/sala/abrir`): o cliente pede o bilhete ao chegar na
   antessala de uma sala. O servidor sorteia a SEMENTE, guarda
   `{bilhete, conta, calabouço, sala, dificuldade, semente, aberta_em}` e devolve
   `{bilhete, semente}`. A batalha é criada com essa semente.
2. **Jogar**: o cliente anota cada lance do jogador no formato da batalha em
   dupla (`{a:'p'|'m'|'c'|'e'|'f', u, x, y, s, alvo, ok}`), inclusive os que
   falham (esquiva gasta sorteio).
3. **Fechar** (`POST /api/sala/fechar`): o cliente manda `{bilhete, lances,
   hashFinal}`. O servidor:
   - confere dono, estado aberto, tempo mínimo e o teto de salas por hora;
   - monta o grupo (atributos, itens, pet) a partir do estado que ELE guarda —
     nunca do que o cliente diz;
   - pede ao juiz para refazer a sala (`/refaz`): fase, mortos, desafio, HP;
   - com vitória, pede ao juiz a recompensa com o gerador do servidor
     (XP, vinténs, peças com iid cunhado no servidor, cartas, pedras, selos,
     insígnias, XP do pet, carga do pergaminho, dízimo);
   - aplica no estado da conta e devolve o RECIBO; o cliente aplica o recibo.

### Fase 2 — o estado econômico é do servidor

- O servidor guarda o estado econômico da conta (XP e nível dos heróis, saco,
  peças vestidas com forja e estrelas, pedras, cartas, pets, selos, insígnias,
  pergaminhos, carteira e cofre). O PUT do save não muda esses campos: o que
  vier diferente é ignorado e o servidor devolve o dele.
- Toda operação que muda a economia vira uma chamada (`POST /api/op`), executada
  pelo juiz no estado do servidor com a mesma função do jogo (equipar, forjar,
  fundir, roleta, elementos, pergaminho, cofre, missões, mercado, troca…). O
  cliente aplica na hora (a tela não espera) e confere o hash do estado; se
  divergir, puxa o estado do servidor.
- A carteira da loja passa a ser a do servidor.

### Fase 3 — a batalha conferida em grupo e o duelo ranqueado

- Sala em grupo: o líder pede o bilhete do grupo; a semente vem do servidor e
  cada membro fecha a sala com o mesmo log; o juiz refaz uma vez.
- Poço: a sala gerada com o gerador da semente (hoje é `Math.random`).
- Duelo em rede: bilhete do duelo, o juiz refaz, a Brasa muda no servidor,
  com teto por par de contas por dia (anti-farm).

## Regras de convivência

- **Em casa (file://, sem conta)** o jogo segue local, como sempre.
- **Anistia do corte**: no primeiro contato depois do deploy, o save que o
  servidor já tinha vira o estado inicial daquela conta.
- **Offline no meio da sala**: o recibo não se perde — o cliente guarda o
  bilhete fechado e tenta de novo; a tela diz "conferindo…".
- **Tempo mínimo por sala** calibrado com folga: barra só o impossível.

## Estado da implantação

- [x] Juiz carrega o jogo no Node (`servidor/juiz/motor.js`)
- [x] Sala refeita da semente e dos lances (`servidor/juiz/sala.js`, `tests/juiz_sala.js`)
- [x] Node no contêiner e o juiz no `entrada.sh`; API aceita `--juiz`
- [ ] Bilhete, fechar e recompensa no servidor
- [ ] Estado econômico no servidor e `/api/op`
- [ ] Cliente: bilhete, log de lances, recibo, ops
- [ ] Grupo, Poço semeado, duelo ranqueado
