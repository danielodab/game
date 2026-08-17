/* SOTERRA 2.0 — DATA.unlockTiers, DATA.leveling, DATA.cards, DATA.stars
 * Dono: Criativo Classes. Não editar em outro papel.
 * Curva calibrada para: 1ª Descida completa ≈ 2–3 níveis; nível 5 (escolha do elemento)
 * logo no começo do 2º calabouço; nível 20 no fim do conteúdo normal; nível 30 = troféu.
 */
var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

JOGO.DATA = JOGO.DATA || {};

/* Níveis em que cada caminho elemental libera seu próximo feitiço (ordem fixa). */
JOGO.DATA.unlockTiers = [5, 10, 12, 15, 20, 30];

JOGO.DATA.leveling = {
  maxLevel: 30,

  /* XP ACUMULADA para atingir cada nível: xpTable[0] = nível 1 (0),
   * xpTable[29] = nível 30. Degraus crescem ~1,45× no início e amaciam
   * até ~1,03× no fim, para o veterano nunca travar de vez. */
  xpTable: [
    0, 60, 145, 270, 440,
    670, 980, 1390, 1925, 2620,
    3505, 4620, 6010, 7720, 9800,
    12305, 15290, 18810, 22915, 27655,
    33065, 39175, 46010, 53570, 61850,
    70830, 80465, 90695, 101450, 112640
  ],

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
  elementChoiceLevel: 5
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
