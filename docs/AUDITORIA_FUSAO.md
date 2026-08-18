# Auditoria — fusão, feitiços e efeitos

Pente fino pedido pelo usuário: *"passe um pente fino nos personagens, mas mais
na forma de fundir, nos ataques, nos ataques fundidos, confira seus efeitos.
Veja o que dá para melhorar e se tem algo sem funcionar."*

Tudo abaixo foi **medido** rodando o motor de verdade, não lido do código.

---

## 1. O que está funcionando

### Os 24 tipos de efeito funcionam, todos

Para cada tipo, procurei um feitiço que alguma classe realmente possui, conjurei
numa batalha real e comparei o estado antes e depois (vida, escudo, posição,
PA, PP, efeitos ativos, unidades em campo, clima, armadilhas).

| | |
|---|---|
| Tipos em uso nos dados | 24 |
| Confirmados aplicando efeito | **24** |
| Sem nenhum feitiço que os use | 0 |

`damage · poison · heal · regen · shield · buff · resist · push · pull · root ·
mark · detonateMarks · teleport · moveTo · chain · invisible · reflect ·
dispelShield · cleanse · taunt · summon · trap · weatherShift · swap`

Alguns só passaram na 4ª, 8ª ou 9ª tentativa porque o primeiro feitiço candidato
tinha alcance ou alvo incompatível com a posição de teste — não por defeito.

### As bordas da fusão recusam o que devem recusar

| situação | resultado |
|---|---|
| fundir com aliado longe | recusa ✔ |
| fundir consigo mesmo | recusa ✔ |
| fundir com aliado morto | recusa ✔ |
| fundir com inimigo | recusa ✔ |
| fusão morre → derrota | `lost` ✔ (não devolve os dois, por desenho) |
| dupla morre → derrota | `lost` ✔ |
| um herói morre | continua ✔ |
| só um invocado vivo | `lost` ✔ (invocação não sustenta o lado) |

### Os 2.625 feitiços de fusão estão limpos

Varri todos procurando custo acima do PA máximo, área de tamanho zero, duração
zero, mínimo maior que máximo, alcance invertido, recarga longa demais e
descrição faltando: **nenhuma ocorrência**.

---

## 2. O problema central: FUNDIR CUSTA UM TERÇO DO TURNO

Medi, nas 15 duplas no nível 30, o dano máximo que o grupo faz em UM turno
gastando o PA como quiser, separados e fundidos, contra alvo de vida infinita.

**Fundir rendeu menos em 15 de 15 duplas.**

| dupla | separados | fundidos | |
|---|---|---|---|
| sumo+curandeira | 265 | 121 | −144 |
| sumo+arqueiro | 275 | 133 | −142 |
| sumo+espadachim | 267 | 136 | −131 |
| sumo+bruxo | 254 | 131 | −123 |
| curandeira+invocador | 234 | 123 | −111 |
| … | | | |
| bruxo+curandeira | 198 | 184 | −14 |

A causa é aritmética, não conteúdo:

| | separados | fundidos | |
|---|---|---|---|
| **PA** | 12 | **8** | **−33%** |
| **PP** | 6 | **4** | **−33%** |
| PV | 550 | 550 + 50 de escudo | = |
| Feitiços na mão | 18 | **7** | −61% |
| Corpos | 2 | 1 | |

O bônus de `+2 PA` é sobre UM herói, mas ao fundir some o segundo corpo inteiro,
com os 6 PA dele. O saldo real é −4 PA. O mesmo vale para o passo: +1 sobre um,
−2 no total.

**Hoje a fusão é uma jogada defensiva que custa um terço da ofensiva.** Isso é
uma escolha legítima de desenho, mas contradiz a promessa: o jogador espera que
juntar dois heróis seja o momento de poder, não um modo tanque mais lento.

### Caminhos possíveis (decisão do usuário, nenhum aplicado)

1. **Subir o bônus de PA** de +2 para +5 ou +6, empatando a economia de ações
   com a dos dois separados. Simples e reverte o sinal na hora.
2. **Manter o PA e engrossar os feitiços**: se a fusão age menos vezes, cada
   ação precisa valer por duas. Hoje o poder cresce 3% por nível de fusão e
   1% por degrau — pouco para cobrir −33% de ações.
3. **Assumir o papel defensivo** e deixar claro na interface que fundir troca
   dano por resistência. Aí o escudo de 50 e a vida somada precisam crescer.
4. **Compensar no tempo**: a fusão dura poucos turnos e devolve os dois heróis
   com algum ganho, virando um golpe de misericórdia em vez de um estado.

---

## 3. Achado menor: fusão neutra vira três golpes iguais

50 dos 2.625 repetem o mesmo efeito três vezes — sempre `damage:neutro ×3`,
como em *Trabuco Cru*. Acontece quando os dois heróis ainda não escolheram
elemento (níveis 1 a 4): `@A`, `@B` e o rider da mistura resolvem todos para
neutro. Funciona (são três rolagens), mas a promessa de "ataque composto de dois
elementos" desaparece justamente na primeira fusão que o jogador vê.

---

## 4. Achado menor: quem vira o corpo da fusão

`fusionLook` escolhe o corpo pelo mais "encorpado" (tabela `BULK`). Medindo as
15 fusões, o **mago vira o corpo em 5 delas** — ganha até do arqueiro — porque o
chapéu pontudo o faz medir 4,38 m. Se a intenção é "o mais forte manda", o
critério de altura está contando a história errada.

Alturas resultantes: 4 valores distintos para 15 duplas (3,21 · 3,42 · 3,52 ·
4,38), porque só existem 4 corpos possíveis.
