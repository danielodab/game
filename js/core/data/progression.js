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

/* TETO DE INVOCACOES SIMULTANEAS.
 *
 * Chave PROPRIA, e nao um campo dentro de `leveling`: aquela tabela esta
 * congelada por coordenacao com o `xp` dos monstros, e encostar nela obriga uma
 * rodada coordenada que isto aqui nao precisa.
 *
 * `base` vale do nivel 1 em diante; cada nivel em `degraus` soma +1 ao chegar.
 * Um item que conceda +1 deve somar em `bonus` na unidade (ver `Engine.summonCap`).
 */
/* DIFICULDADE POR SALA. Chave propria: `DATA.leveling` esta congelada por
 * coordenacao com o `xp` dos monstros, e estes multiplicadores entram DEPOIS,
 * sobre o valor ja somado — nada muda na economia base.
 *
 * O PREMIO SOBE MAIS QUE O CUSTO, de proposito: dificil cobra +40% de vida e
 * +35% de dano e paga +60% de xp e +50% de drop. Se o premio subisse na mesma
 * proporcao do custo, ninguem escolheria dificil — e modo que ninguem escolhe e
 * trabalho jogado fora. Facil desce menos do que sobe (-25% de ameaca contra
 * -30% de xp): quem pede folga paga por ela.
 *
 * `clima` multiplica SO a parte que machuca. Multiplicar tambem a que cura
 * faria o dificil curar mais — simetria que parece elegante e e errada.
 */
JOGO.DATA.dificuldades = {
  facil:   { id: 'facil',   nome: 'Fácil',   icone: '○',
             vida: 0.75, dano: 0.75, clima: 0.60, xp: 0.70, drop: 0.70,
             resumo: 'Monstros mais fracos e clima brando. Paga menos.' },
  normal:  { id: 'normal',  nome: 'Normal',  icone: '◐',
             vida: 1.00, dano: 1.00, clima: 1.00, xp: 1.00, drop: 1.00,
             resumo: 'O jogo como foi calibrado.' },
  dificil: { id: 'dificil', nome: 'Difícil', icone: '●',
             vida: 1.40, dano: 1.35, clima: 1.60, xp: 1.60, drop: 1.50,
             resumo: 'Monstros mais duros e clima cruel. Paga bem mais.' }
};
JOGO.DATA.dificuldadePadrao = 'normal';

JOGO.DATA.summonCap = {
  base: 1,
  degraus: [15, 30]
};

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

  /* DEFESA DE POSIÇÃO POR NÍVEL (adendo v2.7, §9-H) — esquiva e fixação deixam de
   * ser estatísticas mortas. Até aqui o herói nascia com a esquiva da classe e
   * MORRIA com ela: nível 30 era idêntico ao nível 1, e como nenhum caminho a
   * aumentava, a fixação dos monstros (4 nos fracos, 55 nos chefes) simplesmente
   * ganhava sempre. A partir daqui cada classe caminha do valor de `stats` (nível 1)
   * até o alvo abaixo (nível `maxLevel`), em linha reta:
   *
   *   efetivo = base + round((alvo − base) × (nível − 1) / (maxLevel − 1))
   *
   * Nível 1 é EXATAMENTE a base — a fixação continua mordendo cedo, que é como o
   * jogador aprende que encostar num inimigo é um compromisso.
   *
   * A chave é o `role` da classe (`DATA.classes[*].role`), não o id: quem inventar
   * uma sétima classe herda o ritmo do papel que escolher.
   *
   * POR QUE ESTES NÚMEROS. A fórmula do contrato (§2) é
   * `clamp(0,10 · 0,90 · 0,35 + (esquiva − fixação)×0,02 + elemental)`: a diferença
   * esquiva−fixação só vale alguma coisa numa janela de 40 pontos (de −12,5 a +27,5).
   * Como a fixação dos monstros vai de 4 a 55, os alvos foram escolhidos para que,
   * SEM equipamento e contra a fixação mediana do calabouço 6 (20), no nível 30:
   *   atirador/assassino escapem na maioria das vezes (~0,81/0,85);
   *   mago/suporte/invocador fiquem no meio (~0,45–0,61);
   *   o tanque continue ruim de escapar (~0,25) — ele não foi feito para fugir.
   * E que, contra a fixação de um CHEFE (50–55), todos continuem entre 0,10 e 0,15:
   * o chefe segurar é temático e fica de pé.
   *
   * Do outro lado, `lock` é o que o herói faz COM o inimigo. O tanque sai de 40 e
   * chega a 70: a partir daí nem o monstro mais escorregadio do jogo (esquiva 36,
   * a Arauta da Rajada) escapa dele acima do piso de 10%. É o prêmio de identidade
   * do papel — ele não corre, ele impede que corram. */
  defenseByRole: {
    tanque:    { dodge: 10, lock: 70 },
    atirador:  { dodge: 38, lock: 16 },
    assassino: { dodge: 40, lock: 16 },
    mago:      { dodge: 24, lock: 10 },
    suporte:   { dodge: 28, lock: 12 },
    invocador: { dodge: 20, lock: 30 },
    // GUARDIAO (v3, o Minotauro). Eu tinha posto 8/76, o que o fazia PRENDER
    // mais que o tanque — e o §9-H diz que quem mais prende e o tanque. O
    // pedido do usuario diz a mesma coisa com outras palavras: "sumo = tank ...
    // esse prende mais o inimigo". O Minotauro nao e o que mais segura: e o que
    // mais BARRA, e barrar mora no muro, nao na ficha.
    guardiao:  { dodge: 14, lock: 62 }
  },

  /* Nível em que o herói escolhe o elemento — escolha permanente. */
  elementChoiceLevel: 5,

  /* FÚRIA DA SALA — antídoto contra empate por sustentação (dupla que cura mais do
   * que apanha e nunca resolve; acontecia até com sumo+curandeiro, a dupla inicial).
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
 * sumo 6%, curandeiro 6%). Assim a classe cara é objetivo de longo prazo sem virar moagem
 * infinita: farmar fundo é sempre o caminho mais rápido para ela.
 *
 * Calibragem (supondo 1–2 cartas por sala de chefe): invocador libera em ~10–18 descidas do
 * calabouço 1; bruxo em ~15–28 do calabouço 2; espadachim em ~30–57 do calabouço 3;
 * arqueiro, o troféu da coleção, em ~40–78 descidas dos calabouços 4–5. As 5 estrelas
 * são conteúdo de fim de jogo — a escada é a do dono (30/08): cada degrau
 * custa 5, +10, +20, +30 e +45 cartas excedentes (acumulado 5/15/35/65/110),
 * "para conseguir estrela é difícil". E da ★3 em diante a estrela também
 * LIBERA ELEMENTO EXTRA para a classe (ver DATA.stars.elementSlots). */
// 08/10 (o dono): os DOIS PRIMEIROS heróis são livres, qualquer classe (Progress.escolheIniciais) — as
// duas escolhidas custam 0; as comuns, para quem não as escolheu, custam 5 cartas (ou a loja).
// 08/10: a ESTRELA passou a ser manual — a carta fica na mão e o jogador a gasta na ficha do herói
// (Progress.subirEstrela); `starCosts` segue acumulado, e o degrau k custa starCosts[k] − starCosts[k−1].
JOGO.DATA.cards = {
  sumo:       { unlockCost:  5, dropWeight:  6, minDungeon: 0, starCosts: [5, 15, 35, 65, 110] },
  curandeiro: { unlockCost:  5, dropWeight:  6, minDungeon: 0, starCosts: [5, 15, 35, 65, 110] },
  invocador:  { unlockCost: 10, dropWeight: 16, minDungeon: 1, starCosts: [5, 15, 35, 65, 110] },
  bruxo:      { unlockCost: 10, dropWeight: 16, minDungeon: 2, starCosts: [5, 15, 35, 65, 110] },
  espadachim: { unlockCost: 20, dropWeight: 24, minDungeon: 3, starCosts: [5, 15, 35, 65, 110] },
  arqueiro:   { unlockCost: 25, dropWeight: 32, minDungeon: 4, starCosts: [5, 15, 35, 65, 110] },
  // O Minotauro e o mais caro: entra no 5o calabouco, depois de o jogador ja
  // ter sentido falta de alguem que segure a linha.
  minotauro:  { unlockCost: 30, dropWeight: 36, minDungeon: 5, starCosts: [5, 15, 35, 65, 110] }
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
  },
  /* ELEMENTOS POR ESTRELA (30/08): "da terceira estrela em diante o jogador
   * poderá escolher outro elemento" — ★3 libera o 2º caminho elemental (da
   * escolha dele), ★4 o 3º, ★5 o 4º. A tabela diz quantos CAMINHOS a classe
   * pode ter por número de estrelas; quem cobra é Progress.elementSlots. */
  elementSlots: { 0: 1, 1: 1, 2: 1, 3: 2, 4: 3, 5: 4 }
};

/* OS PERGAMINHOS DA LOJA DO SITE (Fase C, 10/09) — o que cada um FAZ no jogo.
 * O PREÇO mora só no servidor (servidor/loja.py, CATALOGO); o teste do
 * servidor lê esta tabela e confere que o catálogo a espelha. Quem usa é o
 * Progress (addPergaminho, lePergaminhoXp, reescreveElemento) e o game.js.
 *
 *  xp.fator        o Pergaminho da SABEDORIA multiplica o XP do grupo (×1,5)
 *  xp.salas        cargas que UMA leitura soma: salas VENCIDAS (9 ≈ 3 descidas)
 *  xp.tetoSalas    cargas ativas no máximo (27 = três leituras seguidas)
 *  tetoInventario  quantos de CADA pergaminho o jogador guarda (99)
 *
 * Com um evento de XP no ar os dois juntos param no teto da agenda (×2,0):
 * fXp = max(fEvento, min(2,0, fEvento × fator)). Derrota e abandono não gastam
 * carga, e os vinténs nunca veem o pergaminho (saem de xpTotal). O Pergaminho
 * da REESCRITA troca um caminho elemental por outro e não tem número aqui.
 * O da SABEDORIA saiu da venda em 10/09 (o bônus de XP por tempo, logo abaixo,
 * o substitui); o jogo segue lendo e usando o que já foi comprado. */
JOGO.DATA.pergaminhos = {
  xp: { fator: 1.5, salas: 9, tetoSalas: 27 },
  tetoInventario: 99
};

/* O BÔNUS DE XP POR TEMPO (loja 2, 10/09): 1, 3 ou 7 dias de +50% de XP para
 * o grupo, vendidos na loja do site. O PREÇO mora só no servidor
 * (servidor/loja.py, CATALOGO); este `fator` espelha BONUS_XP de lá, e
 * tests/loja_api.py confere. O prazo corre no relógio do SERVIDOR a partir da
 * ENTREGA no jogo (o /api/loja/retirar manda `entrega.agora`), e comprar de
 * novo SOMA dias (Progress.addBonusXpDias). Ele e o Pergaminho da Sabedoria
 * NÃO se multiplicam — com o bônus no ar o pergaminho pausa e não gasta
 * carga —, e com um evento de XP os dois param no teto da agenda (×2,0):
 * fXp = max(fEvento, min(2,0, fEvento × fator)). Os vinténs nunca o veem. */
JOGO.DATA.bonusXp = { fator: 1.5 };
