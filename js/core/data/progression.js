/* SOTERRA 2.0 — DATA.unlockTiers, DATA.leveling, DATA.cards
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

  /* Ganho fixo por nível. No 30: +174 PV e +87 de poder sobre a base. */
  perLevel: { hp: 6, power: 3 },

  /* Nível em que o herói escolhe o elemento — escolha permanente. */
  elementChoiceLevel: 5
};

/* Cartas de personagem derrubadas por chefes.
 * `dropWeight` 0 = classe já liberada desde o início (a carta não existe no mundo).
 * `minDungeon` = índice do calabouço mais raso em que a carta pode cair (0 = o primeiro).
 * Quanto mais forte a classe, mais rara e mais funda a carta. */
JOGO.DATA.cards = {
  sumo:       { dropWeight: 0,  minDungeon: 0 },
  arqueiro:   { dropWeight: 0,  minDungeon: 0 },
  curandeira: { dropWeight: 18, minDungeon: 1 },
  invocador:  { dropWeight: 12, minDungeon: 2 },
  espadachim: { dropWeight: 7,  minDungeon: 3 },
  bruxo:      { dropWeight: 4,  minDungeon: 4 }
};
