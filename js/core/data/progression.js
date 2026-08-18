/* SOTERRA 2.0 — DATA.unlockTiers, DATA.leveling, DATA.cards, DATA.stars
 * Dono: Criativo Classes. Não editar em outro papel.
 * Curva calibrada (adendo v2.3) sobre a XP real dos monstros: no nível recomendado do
 * calabouço, uma descida completa rende ~1 nível no começo e ~1/3 de nível do 25 em diante.
 * Repetir calabouço raso continua possível, mas o `xpFalloff` faz render cada vez menos:
 * descer fundo é o único caminho eficiente. Nível 5 = escolha do elemento; nível 30 = troféu.
 */
var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

JOGO.DATA = JOGO.DATA || {};

/* Níveis em que cada caminho elemental libera seu próximo feitiço (ordem fixa). */
JOGO.DATA.unlockTiers = [5, 10, 12, 15, 20, 30];

JOGO.DATA.leveling = {
  maxLevel: 30,

  /* ⚠ TABELA CONGELADA (18/08, por coordenação do Orquestrador) — NÃO ALTERAR SOZINHO.
   * Esta tabela e o `xp` dos monstros (`js/core/data/monsters.js`, Criativo Mundo) descrevem
   * a MESMA economia por pontas opostas: ele define quanto o monstro paga, ela define quanto
   * o nível custa. Mexer num lado sem o outro derruba a validação do outro dono — já
   * aconteceu três vezes numa noite. Qualquer ajuste daqui em diante é rodada COORDENADA,
   * com as duas tabelas mudando juntas e as duas páginas de teste rodando no fim.
   *
   * SUGESTÃO REGISTRADA PARA A PRÓXIMA RODADA (do Criativo Mundo — NÃO executada aqui):
   * multiplicar esta `xpTable` E o `xp` de todos os monstros por ~10, na mesma rodada.
   * É mudança puramente cosmética — todas as razões se preservam — mas devolve folga para
   * XP inteira por monstro: hoje o degrau do nível 3 vale 35 XP, o que obriga o outro lado
   * a usar XP fracionária (0,9 · 1,1 · 1,3) para o bufo-de-pólen não valer o mesmo que a
   * carrapicho-mãe. Funciona, mas é apertado.
   *
   * XP ACUMULADA para atingir cada nível: xpTable[0] = nível 1 (0),
   * xpTable[29] = nível 30 (39.055).
   *
   * CALIBRAGEM (adendo v2.3) — feita sobre a XP real dos monstros de
   * `js/core/data/monsters.js` somada pelos spawns de `js/core/data/dungeons.js`.
   * Descida completa (3 salas), XP de GRUPO, por calabouço:
   *   66 · 204 · 422 · 753 · 1196 · 1847   (a XP paga cresce 28× com a profundidade)
   * A XP é dividida pelo tamanho do grupo (1 ou 2 heróis).
   *
   * No nível recomendado de cada calabouço (3 · 7 · 11 · 16 · 22 · 28), uma descida
   * completa em DUPLA rende:
   *   calabouço 1 → 0,94 nível  ·  2 → 0,73  ·  3 → 0,56
   *   calabouço 4 → 0,45        ·  5 → 0,39  ·  6 → 0,33   (≈ 1/3 a partir do 25)
   * Solo rende o dobro (e morre o dobro). A exigência sobe mais que o pagamento:
   * os degraus vão de 15 para 3.050 — 203×, contra os 28× da XP dos monstros. */
  xpTable: [
    0, 15, 40, 75, 125,
    195, 295, 435, 615, 845,
    1145, 1525, 1965, 2485, 3095,
    3805, 4635, 5555, 6580, 7705,
    8955, 10355, 11905, 13605, 15480,
    17555, 19830, 22355, 25130, 28180
  ],

  /* RENDIMENTO DECRESCENTE ao repetir conteúdo raso (adendo v2.3).
   * Multiplicador de XP conforme a distância para o nível recomendado do calabouço:
   * até `recommendedLevel + graceLevels` vale ×1,0; cada nível acima multiplica por
   * 0,75 acumulativo, nunca abaixo de ×0,10 (o piso é atingido 8 níveis depois da graça).
   * Não vale para itens, pedras nem cartas — só XP.
   *
   * Efeito medido na validação: moer SÓ o calabouço 1 do nível 3 ao 30 exige
   * 7.973 descidas em dupla (3.986 solo); descer sempre no calabouço mais fundo
   * liberado exige 77 (39 solo). Profundidade é ~104× mais eficiente — e mesmo
   * sem o falloff seriam 852 descidas, então a curva já pune o raso sozinha. */
  xpFalloff: { graceLevels: 4, factorPerLevel: 0.75, floor: 0.10 },

  /* GANHO POR NÍVEL (adendo v2.2) — todo nível dá +5 PV; o que muda é o dano.
   * Antes de escolher o elemento, o nível dá poder GENÉRICO; a partir da escolha,
   * dá dano no ELEMENTO escolhido (`elemPower`), que só conta em feitiços daquele
   * elemento: `(100 + power + (spell.element === unit.element ? elemPower : 0))/100`.
   *
   * Convenção de corte (para Progress aplicar igual ao que a validação simula):
   * os níveis 2→5 usam `perLevel` (a escolha acontece AO chegar ao 5) e os níveis
   * 6→30 usam `perLevelElement`. No nível 30, portanto:
   *   +145 PV · +12 de poder genérico · +75 de dano no elemento escolhido.
   * Quem sobe sem escolher (impossível hoje, mas o motor não deve quebrar) fica só
   * com `perLevel` e acumula +87 de poder genérico. */
  perLevel: { hp: 5, power: 3 },
  perLevelElement: { hp: 5, elemPower: 3 },

  /* Nível em que o herói escolhe o elemento — escolha permanente. */
  elementChoiceLevel: 5,

  /* FÚRIA DA SALA — antídoto contra empate por sustentação (dupla que cura mais do
   * que apanha e nunca resolve; acontecia até com sumo+curandeira, a dupla inicial).
   * A partir da rodada `afterRound`, cada rodada dá +`powerPerRound` de poder a TODOS
   * os inimigos e corta `healCutPerRound` da cura recebida por AMBOS os lados
   * (acumulativo, piso 0 — a cura zera por volta da rodada 27). Na rodada `maxRounds`
   * a batalha encerra como derrota. O motor lê estes valores com prioridade sobre o
   * próprio padrão (`Engine.ROOM_FURY`).
   *
   * Calibragem medida pelo Motor (108 batalhas): 8 empates antes, 0 depois.
   * Com `afterRound: 12` uma vitória legítima de 38 rodadas virava derrota; com 20
   * nenhuma vitória se perde, todos os empates resolvem e só 4% das batalhas chegam
   * a sentir a fúria (mediana de 5 rodadas) — é invisível no jogo normal e só aparece
   * quando a luta já tinha deixado de ser uma luta. */
  roomFury: { afterRound: 20, powerPerRound: 10, healCutPerRound: 0.15, maxRounds: 40 }
};

/* COLEÇÃO DE CARTAS (adendo v2.1) — cartas caem dos chefes, repetidas ACUMULAM.
 *
 *  unlockCost  cartas para liberar a classe (0 = já nasce liberada). Valores fixados pelo usuário.
 *  dropWeight  peso relativo no sorteio da sala de chefe.
 *  minDungeon  índice do calabouço mais raso em que a carta pode cair (0 = o primeiro).
 *  starCosts   cartas EXCEDENTES ao desbloqueio para cada estrela (acumulado, ★1…★5).
 *
 * Toda classe — inclusive as iniciais — tem peso de saque: o excedente é o que compra estrelas,
 * então nunca existe carta inútil. Quanto mais cara a classe, MAIOR o peso e mais fundo o
 * calabouço: nos Fechos rasos só caem as baratas; no último, os pesos somam exatamente 100
 * (leem-se como porcentagem: arqueiro 32%, espadachim 24%, bruxo 16%, invocador 16%,
 * sumo 6%, curandeira 6%). Assim a classe cara é objetivo de longo prazo sem virar moagem
 * infinita: farmar fundo é sempre o caminho mais rápido para ela.
 *
 * Calibragem (supondo 1–2 cartas por sala de chefe): invocador libera em ~10–18 descidas do
 * calabouço 1; bruxo em ~15–28 do calabouço 2; espadachim em ~30–57 do calabouço 3;
 * arqueiro, o troféu da coleção, em ~40–78 descidas dos calabouços 4–5. As 5 estrelas
 * (mais 90 cartas excedentes) são conteúdo de fim de jogo. */
JOGO.DATA.cards = {
  sumo:       { unlockCost:  0, dropWeight:  6, minDungeon: 0, starCosts: [5, 15, 30, 55, 90] },
  curandeira: { unlockCost:  0, dropWeight:  6, minDungeon: 0, starCosts: [5, 15, 30, 55, 90] },
  invocador:  { unlockCost: 10, dropWeight: 16, minDungeon: 1, starCosts: [5, 15, 30, 55, 90] },
  bruxo:      { unlockCost: 10, dropWeight: 16, minDungeon: 2, starCosts: [5, 15, 30, 55, 90] },
  espadachim: { unlockCost: 20, dropWeight: 24, minDungeon: 3, starCosts: [5, 15, 30, 55, 90] },
  arqueiro:   { unlockCost: 25, dropWeight: 32, minDungeon: 4, starCosts: [5, 15, 30, 55, 90] }
};

/* ESTRELAS — bônus fixos e permanentes por classe, somados em Progress.effectiveStats.
 * Contados sobre as cartas excedentes ao desbloqueio, conforme `starCosts`.
 * Desenho da trilha: dois degraus de sobrevivência (★1, ★4), um de dano (★2) e os dois
 * prêmios grandes de economia de ação no fim (★3 = +1 PP, ★5 = +1 PA).
 * Total no ★5: +40 PV, +8 de poder, +10 de esquiva, +1 PP e +1 PA. */
JOGO.DATA.stars = {
  max: 5,
  bonuses: {
    1: { hp: 15 },
    2: { power: 8 },
    3: { pp: 1 },
    4: { hp: 25, dodge: 10 },
    5: { pa: 1 }
  }
};
